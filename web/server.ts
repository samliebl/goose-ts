import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  Configuration,
  Goose,
  renderArticleExport,
  renderArticlesZip,
  type ArticleInfos,
  type ConfigurationOptions,
  type ExportableArticle,
  type ExportFormat,
} from "../src/index.js";
import {
  addAllowedEmail,
  consumeLoginToken,
  createSessionCookieValue,
  isOwner,
  listAllowedEmails,
  purgeExpiredTokens,
  removeAllowedEmail,
  requestLoginLink,
  sendLoginNotification,
  verifySessionCookieValue,
  type Session,
} from "./auth.js";
import { parseCookies, serializeCookie } from "./cookies.js";
import { createRateLimiter } from "./rate-limit.js";
import { assertSafeToFetch } from "./ssrf-guard.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
// Local dev stays loopback-only by default, same as always; production
// sets HOST=0.0.0.0 (Fly secrets/env) -- a container's loopback interface
// isn't reachable from Fly's proxy at all, so this has to be configurable,
// not hardcoded, for a public deploy to work in the first place.
const HOST = process.env.HOST ?? "127.0.0.1";
const SESSION_COOKIE = "regoose_session";

interface ExtractRequestBody {
  url?: string;
  rawHtml?: string;
  config?: Partial<ConfigurationOptions>;
}

interface ExportRequestBody {
  // Single article: { article, label }. Several at once (always zipped): { articles: [{article, label}, ...] }.
  article?: ArticleInfos;
  label?: string;
  articles?: ExportableArticle[];
  format?: ExportFormat;
  /** Force a .zip even for a single article. More than one article always gets one, regardless of this flag. */
  zip?: boolean;
}

/** RFC 6266/5987 Content-Disposition, so a filename with non-ASCII characters (an article title in Chinese, say) survives download correctly instead of being mangled or rejected. */
function contentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

purgeExpiredTokens();

const app = express();
app.set("trust proxy", true); // Fly's edge proxy sits in front of this -- req.ip needs this to reflect the real client, not Fly's own proxy address.
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));

function getSession(req: Request): Session | null {
  const cookies = parseCookies(req.headers.cookie);
  return verifySessionCookieValue(cookies[SESSION_COOKIE]);
}

function setSessionCookie(res: Response, email: string): void {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, createSessionCookieValue(email), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: 30 * 24 * 3600,
    }),
  );
}

function clearSessionCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 }),
  );
}

const html = (title: string, body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body { font: 15px system-ui, sans-serif; max-width: 420px; margin: 80px auto; padding: 0 20px; color: #1f2328; }
  input[type=email], input[type=text] { width: 100%; padding: 8px 10px; font: inherit; box-sizing: border-box; border: 1px solid #d0d7de; border-radius: 6px; }
  button { padding: 8px 14px; font: inherit; border: none; border-radius: 6px; background: #0969da; color: #fff; cursor: pointer; }
  form { display: flex; gap: 8px; margin: 16px 0; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid #d0d7de; font-size: 13px; }
  .muted { color: #59636e; font-size: 13px; }
</style></head><body>${body}</body></html>`;

// -- Public auth routes: reachable without a session --------------------

const loginRateLimit = createRateLimiter(5, 10 * 60_000); // 5 requests / 10 min / IP

app.get("/login", (_req, res) => {
  res.send(
    html(
      "Sign in",
      `<h1>regoose</h1>
       <form method="post" action="/api/auth/request-link">
         <input type="email" name="email" placeholder="you@example.com" required autofocus>
         <button type="submit">Send link</button>
       </form>
       <p class="muted">If that address is allowed, a sign-in link will be emailed to it. Links expire in 15 minutes and work once.</p>`,
    ),
  );
});

app.post("/api/auth/request-link", async (req, res) => {
  if (!loginRateLimit(req.ip ?? "unknown")) {
    res.status(429).send(html("Too many requests", "<p>Slow down and try again shortly.</p>"));
    return;
  }

  const email = typeof req.body?.email === "string" ? req.body.email : "";
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  try {
    if (email) await requestLoginLink(email, baseUrl);
  } catch {
    // Fall through to the identical response below regardless -- see
    // requestLoginLink's doc comment on why success/failure/not-allowed
    // must never be distinguishable from the outside.
  }
  res.send(
    html(
      "Check your email",
      `<h1>Check your email</h1><p>If ${email ? "that address is" : "you entered an address that's"} allowed, a sign-in link is on its way.</p>`,
    ),
  );
});

app.get("/api/auth/verify", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const email = token ? consumeLoginToken(token) : null;

  if (!email) {
    res
      .status(400)
      .send(
        html(
          "Link expired",
          '<p>That link is invalid, expired, or already used. <a href="/login">Request a new one</a>.</p>',
        ),
      );
    return;
  }

  setSessionCookie(res, email);
  void sendLoginNotification(email); // fire-and-forget -- see its own doc comment
  // Redirect rather than render here, so the token doesn't linger in the
  // browser's address bar or history once it's been spent.
  res.redirect(302, "/");
});

app.post("/api/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.redirect(302, "/login");
});

// -- Everything below here requires a valid session ----------------------

app.use((req: Request, res: Response, next: NextFunction) => {
  const session = getSession(req);
  if (!session) {
    res.redirect(302, "/login");
    return;
  }
  (req as Request & { session: Session }).session = session;
  next();
});

app.use(express.static(join(here, "public")));

// Lets the static frontend know whether to show the admin link -- the
// static index.html has no server-side templating, so it can't know this
// on its own.
app.get("/api/me", (req, res) => {
  const session = (req as Request & { session: Session }).session;
  res.json({ email: session.email, isOwner: isOwner(session.email) });
});

function requireOwner(req: Request, res: Response, next: NextFunction): void {
  const session = (req as Request & { session: Session }).session;
  if (!isOwner(session.email)) {
    res.status(403).send(html("Forbidden", "<p>Owner access only.</p>"));
    return;
  }
  next();
}

app.get("/admin", requireOwner, (_req, res) => {
  const rows = listAllowedEmails()
    .map(
      (e) =>
        `<tr><td>${e.email}</td><td class="muted">${e.addedAt}</td>
         <td><form method="post" action="/api/admin/allowlist/remove" style="margin:0">
           <input type="hidden" name="email" value="${e.email}">
           <button type="submit">Remove</button>
         </form></td></tr>`,
    )
    .join("");

  res.send(
    html(
      "Admin",
      `<h1>Allowlist</h1>
       <form method="post" action="/api/admin/allowlist/add">
         <input type="email" name="email" placeholder="someone@example.com" required>
         <button type="submit">Add</button>
       </form>
       <table><tr><th>Email</th><th>Added</th><th></th></tr>${rows}</table>
       <p class="muted"><a href="/">&larr; Back to regoose</a></p>`,
    ),
  );
});

app.post("/api/admin/allowlist/add", requireOwner, (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const session = (req as Request & { session: Session }).session;
  if (email) addAllowedEmail(email, session.email);
  res.redirect(302, "/admin");
});

app.post("/api/admin/allowlist/remove", requireOwner, (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  if (email) removeAllowedEmail(email);
  res.redirect(302, "/admin");
});

app.post("/api/extract", async (req, res) => {
  const body = req.body as ExtractRequestBody;

  if (!body.url && !body.rawHtml) {
    res.status(400).json({ error: "Provide either a url or rawHtml." });
    return;
  }

  const started = performance.now();
  try {
    if (body.url) {
      await assertSafeToFetch(body.url);
    }

    const config = new Configuration(body.config ?? {});
    const goose = new Goose(config);
    const article = await goose.extract({ url: body.url, rawHtml: body.rawHtml });

    // HtmlFetcher swallows fetch errors and returns null rather than
    // throwing (faithful to python-goose's HtmlFetcher, which does the
    // same) -- Crawler then just returns an empty Article, with no
    // exception for this catch block to report. article.fetchError is set
    // only on that path (network failure OR non-2xx status, e.g. a 403
    // from anti-bot protection), so check it explicitly to tell "the URL
    // itself couldn't be fetched" apart from "fetched fine, but there was
    // nothing worth extracting."
    if (article.fetchError) {
      res.status(502).json({
        ok: false,
        elapsedMs: Math.round(performance.now() - started),
        error: `Could not fetch ${body.url}: ${article.fetchError}. If this is a non-2xx status, the site may be blocking this request's User-Agent -- try customizing it below.`,
      });
      return;
    }

    res.json({
      ok: true,
      elapsedMs: Math.round(performance.now() - started),
      article: article.infos,
    });
  } catch (error) {
    const isSsrfRejection = error instanceof Error && !body.rawHtml && body.url !== undefined;
    res.status(isSsrfRejection ? 400 : 500).json({
      ok: false,
      elapsedMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Pure formatting, no fetching -- takes article(s) the caller already has
// (typically from a prior /api/extract call) and renders them as a
// downloadable .txt/.json file, or a .zip of several. This is exactly what
// the web dashboard's own download buttons call; nothing about the export
// feature is GUI-only. See src/export.ts for the actual rendering logic.
app.post("/api/export", (req, res) => {
  const body = req.body as ExportRequestBody;
  const format: ExportFormat = body.format === "text" ? "text" : "json";

  const items: ExportableArticle[] = body.articles?.length
    ? body.articles
    : body.article
      ? [{ article: body.article, label: body.label ?? "article" }]
      : [];

  if (items.length === 0) {
    res
      .status(400)
      .json({ ok: false, error: "Provide article + label, or articles: [{ article, label }]." });
    return;
  }

  try {
    // More than one article always gets zipped -- there's only one HTTP
    // response to hand back, and a zip is the closest thing to "several
    // real files" that a single response body can be. A single article
    // gets zipped too only if the caller explicitly asked for it.
    const wantsZip = body.zip === true || items.length > 1;
    const rendered = wantsZip
      ? renderArticlesZip(items, format)
      : renderArticleExport(items[0]!.article, items[0]!.label, format);

    res.setHeader("Content-Type", rendered.mime);
    res.setHeader("Content-Disposition", contentDisposition(rendered.filename));
    res.send(Buffer.from(rendered.bytes));
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`goose-ts web UI: http://${HOST}:${PORT}`);
  if (HOST === "127.0.0.1") {
    console.log(
      "(local dev tool only -- not part of the published package, don't expose this port publicly)",
    );
  }
});
