import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  describeFetchFailure,
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
import { aboutBody } from "./about.js";
import { parseCookies, serializeCookie } from "./cookies.js";
import { consumeDailyUsage } from "./db.js";
import { escapeHtml, page as html } from "./html.js";
import {
  buildConfiguration,
  createUrlGuard,
  EXAMPLE_URLS,
  LIMITS,
  OPEN_SOURCE_DOMAINS,
  type Tier,
  type TierLimits,
} from "./policy.js";
import { createRateLimiter } from "./rate-limit.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
// Local dev stays loopback-only by default, same as always; production
// sets HOST=0.0.0.0 (Fly secrets/env) -- a container's loopback interface
// isn't reachable from Fly's proxy at all, so this has to be configurable,
// not hardcoded, for a public deploy to work in the first place.
const HOST = process.env.HOST ?? "127.0.0.1";
const SESSION_COOKIE = "regoose_session";
const IS_PROD = process.env.NODE_ENV === "production";

/**
 * Off by default. Off: every page and API call requires a signed-in session,
 * exactly as before. On: visitors without a session get the public demo
 * (see policy.ts for what that tier can and can't do). Flipping it is a
 * deploy-time decision (PUBLIC_MODE=true in fly.toml), not a code change.
 */
const PUBLIC_MODE = process.env.PUBLIC_MODE === "true";

/** Extractions allowed to run at once. The machine is small; past this, say "busy" instead of falling over. */
const MAX_CONCURRENT_EXTRACTIONS = 2;
let activeExtractions = 0;

type AuthedRequest = Request & { session: Session | null };

purgeExpiredTokens();

const app = express();
app.disable("x-powered-by");
// One proxy hop (Fly's edge) sits in front of this. `true` would trust a
// client-supplied X-Forwarded-For outright and let anyone pick the IP our
// rate limits see; a single hop trusts only the entry Fly itself appends.
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

// script-src 'self' is why the theme snippet lives in a file, not inline.
// img-src allows any https host because extracted articles show their own
// lead image; everything else is same-origin.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (IS_PROD) res.setHeader("Strict-Transport-Security", "max-age=31536000");
  next();
});

/** The visitor's real IP, for rate limiting. On Fly that's the Fly-Client-IP header, which the edge sets itself and a client can't forge. */
function clientIp(req: Request): string {
  return (IS_PROD ? req.get("fly-client-ip") : undefined) || req.ip || "unknown";
}

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

// -- Public auth routes: reachable without a session --------------------

const loginRateLimit = createRateLimiter(5, 10 * 60_000); // 5 requests / 10 min / IP

app.get("/about", (_req, res) => {
  res.send(html("About regoose", aboutBody(), { wide: true }));
});

app.get("/robots.txt", (_req, res) => {
  res
    .type("text/plain")
    .send(
      [
        "User-agent: *",
        "Allow: /",
        "Disallow: /api/",
        "Disallow: /admin",
        "Disallow: /login",
        "",
      ].join("\n"),
    );
});

app.get("/login", (_req, res) => {
  res.send(
    html(
      "Sign in",
      `<h1>regoose</h1>
       <form method="post" action="/api/auth/request-link">
         <input type="email" name="email" placeholder="you@example.com" required autofocus>
         <button type="submit">Send link</button>
       </form>
       <p class="muted">If that address is allowed, a sign-in link will be emailed to it. Links expire in 15 minutes and work once.</p>
       ${PUBLIC_MODE ? '<p class="muted"><a href="/">&larr; Back to the public demo</a></p>' : ""}`,
    ),
  );
});

app.post("/api/auth/request-link", async (req, res) => {
  if (!loginRateLimit(clientIp(req))) {
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

// -- Everything below here needs a session, unless PUBLIC_MODE is on ------

app.use((req: Request, res: Response, next: NextFunction) => {
  const session = getSession(req);
  (req as AuthedRequest).session = session;
  if (session || PUBLIC_MODE) {
    next();
    return;
  }
  if (req.path.startsWith("/api/")) {
    res.status(401).json({ ok: false, error: "Please sign in." });
    return;
  }
  res.redirect(302, "/login");
});

app.use(express.static(join(here, "public")));

function sessionOf(req: Request): Session | null {
  return (req as AuthedRequest).session;
}

function tierOf(req: Request): Tier {
  return sessionOf(req) ? "member" : "anon";
}

function limitsOf(req: Request): TierLimits {
  const session = sessionOf(req);
  if (!session) return LIMITS.anon;
  return isOwner(session.email) ? LIMITS.owner : LIMITS.member;
}

// Lets the static frontend adapt to who's looking -- the static index.html
// has no server-side templating, so it can't know this on its own.
app.get("/api/me", (req, res) => {
  const session = sessionOf(req);
  const tier = tierOf(req);
  res.json({
    email: session?.email ?? null,
    isOwner: session ? isOwner(session.email) : false,
    tier,
    publicMode: PUBLIC_MODE,
    allowedDomains: tier === "anon" ? OPEN_SOURCE_DOMAINS : null,
    examples: EXAMPLE_URLS,
  });
});

function requireOwner(req: Request, res: Response, next: NextFunction): void {
  const session = sessionOf(req);
  if (!session) {
    res.redirect(302, "/login");
    return;
  }
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
        `<tr><td>${escapeHtml(e.email)}</td><td class="muted">${escapeHtml(e.addedAt)}</td>
         <td><form method="post" action="/api/admin/allowlist/remove" style="margin:0">
           <input type="hidden" name="email" value="${escapeHtml(e.email)}">
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
  const session = sessionOf(req)!;
  if (email && email.length <= 254) addAllowedEmail(email, session.email);
  res.redirect(302, "/admin");
});

app.post("/api/admin/allowlist/remove", requireOwner, (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  if (email) removeAllowedEmail(email);
  res.redirect(302, "/admin");
});

// -- Extraction ------------------------------------------------------------

/** Per-IP limits, one limiter per tier so a flood of anonymous traffic can't use up a signed-in user's allowance. */
const extractLimiters = {
  anon: createRateLimiter(LIMITS.anon.ratePerWindow, LIMITS.anon.windowMs),
  member: createRateLimiter(LIMITS.member.ratePerWindow, LIMITS.member.windowMs),
  owner: createRateLimiter(LIMITS.owner.ratePerWindow, LIMITS.owner.windowMs),
};
const exportLimiter = createRateLimiter(60, 10 * 60_000);

function rateLimited(res: Response, windowMs: number): void {
  res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
  res
    .status(429)
    .json({ ok: false, error: "Too many requests. Wait a few minutes and try again." });
}

function limitExtractions(req: Request, res: Response, next: NextFunction): void {
  const session = sessionOf(req);
  const limiter = !session
    ? extractLimiters.anon
    : isOwner(session.email)
      ? extractLimiters.owner
      : extractLimiters.member;
  if (!limiter(clientIp(req))) {
    rateLimited(res, limitsOf(req).windowMs);
    return;
  }
  next();
}

function limitExports(req: Request, res: Response, next: NextFunction): void {
  if (!exportLimiter(clientIp(req))) {
    rateLimited(res, 10 * 60_000);
    return;
  }
  next();
}

interface ExtractRequestBody {
  url?: unknown;
  rawHtml?: unknown;
  config?: Partial<ConfigurationOptions>;
}

const MAX_URL_LENGTH = 2048;

app.post("/api/extract", limitExtractions, express.json({ limit: "4mb" }), async (req, res) => {
  const body = (req.body ?? {}) as ExtractRequestBody;
  const tier = tierOf(req);
  const limits = limitsOf(req);
  const fail = (status: number, error: string) => res.status(status).json({ ok: false, error });

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const rawHtml = typeof body.rawHtml === "string" ? body.rawHtml : "";

  if (!url && !rawHtml) return fail(400, "Provide either a url or rawHtml.");
  if (url.length > MAX_URL_LENGTH) return fail(400, "That URL is too long.");
  if (rawHtml.length > limits.maxRawHtmlChars) {
    return fail(
      413,
      `That HTML is too large (limit ${Math.round(limits.maxRawHtmlChars / 1_000_000)} MB).`,
    );
  }

  // Checked in this order on purpose: "busy" must not use up anyone's daily
  // allowance, and a request that can't run mustn't count against it either.
  if (activeExtractions >= MAX_CONCURRENT_EXTRACTIONS) {
    res.setHeader("Retry-After", "5");
    return fail(503, "regoose is busy right now. Try again in a few seconds.");
  }
  const capTier = isOwner(sessionOf(req)?.email ?? "") ? "owner" : tier;
  if (!consumeDailyUsage(capTier, LIMITS[capTier].dailyCap)) {
    return fail(
      503,
      tier === "anon"
        ? "The public demo has reached its limit for today. Please try again tomorrow."
        : "The daily limit has been reached. Please try again tomorrow.",
    );
  }

  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  activeExtractions++;
  try {
    const config = buildConfiguration(tier, body.config, createUrlGuard(tier), limits);
    const goose = new Goose(config);
    // Pasted HTML never triggers a fetch of `url`; it only serves as the base for resolving relative links.
    const article = await goose.extract({ url: url || undefined, rawHtml: rawHtml || undefined });

    // HtmlFetcher swallows fetch errors and returns null rather than
    // throwing (faithful to python-goose's HtmlFetcher, which does the
    // same) -- Crawler then just returns an empty Article, with no
    // exception for this catch block to report. article.fetchError and
    // article.fetchErrorKind say why, so check them to tell "the URL itself
    // couldn't be fetched" apart from "fetched fine, but there was nothing
    // worth extracting."
    const failure = describeFetchFailure(article);
    if (failure) {
      const status =
        article.fetchErrorKind === "robots"
          ? 403
          : article.fetchErrorKind === "blocked-url"
            ? 400
            : article.fetchErrorKind === "too-large"
              ? 413
              : article.fetchError
                ? 502
                : 504;
      return res.status(status).json({ ok: false, elapsedMs: elapsed(), error: failure });
    }

    return res.json({ ok: true, elapsedMs: elapsed(), article: article.infos });
  } catch (error) {
    // Log the real reason; show visitors a generic one, since an internal
    // error message can carry paths or other details they shouldn't see.
    console.error("extract failed:", error instanceof Error ? error.message : String(error));
    return res.status(500).json({
      ok: false,
      elapsedMs: elapsed(),
      error: "Something went wrong extracting that page.",
    });
  } finally {
    activeExtractions--;
  }
});

interface ExportRequestBody {
  // Single article: { article, label }. Several at once (always zipped): { articles: [{article, label}, ...] }.
  article?: ArticleInfos;
  label?: string;
  articles?: ExportableArticle[];
  format?: ExportFormat;
  /** Force a .zip even for a single article. More than one article always gets one, regardless of this flag. */
  zip?: boolean;
}

const MAX_EXPORT_ITEMS = 25;

/** RFC 6266/5987 Content-Disposition, so a filename with non-ASCII characters (an article title in Chinese, say) survives download correctly instead of being mangled or rejected. */
function contentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// Pure formatting, no fetching -- takes article(s) the caller already has
// (typically from a prior /api/extract call) and renders them as a
// downloadable .txt/.json file, or a .zip of several. This is exactly what
// the web dashboard's own download buttons call; nothing about the export
// feature is GUI-only. See src/export.ts for the actual rendering logic.
app.post("/api/export", limitExports, express.json({ limit: "4mb" }), (req, res) => {
  const body = (req.body ?? {}) as ExportRequestBody;
  const format: ExportFormat = body.format === "text" ? "text" : "json";

  const items: ExportableArticle[] = Array.isArray(body.articles)
    ? body.articles
    : body.article
      ? [{ article: body.article, label: typeof body.label === "string" ? body.label : "article" }]
      : [];

  if (items.length === 0) {
    res
      .status(400)
      .json({ ok: false, error: "Provide article + label, or articles: [{ article, label }]." });
    return;
  }
  if (items.length > MAX_EXPORT_ITEMS) {
    res.status(400).json({ ok: false, error: `At most ${MAX_EXPORT_ITEMS} articles per export.` });
    return;
  }
  if (items.some((i) => !i || typeof i.article !== "object" || i.article === null)) {
    res.status(400).json({ ok: false, error: "Each item needs an article object." });
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
      : renderArticleExport(items[0]!.article, String(items[0]!.label ?? "article"), format);

    res.setHeader("Content-Type", rendered.mime);
    res.setHeader("Content-Disposition", contentDisposition(rendered.filename));
    res.send(Buffer.from(rendered.bytes));
  } catch (error) {
    console.error("export failed:", error instanceof Error ? error.message : String(error));
    res.status(400).json({ ok: false, error: "Couldn't build that export from the data given." });
  }
});

// Malformed JSON or an over-limit body lands here (from express.json), as a
// clean JSON error instead of Express's default HTML stack trace.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  const status =
    typeof err === "object" && err !== null && "status" in err && typeof err.status === "number"
      ? err.status
      : 500;
  res.status(status >= 400 && status < 500 ? status : 500).json({
    ok: false,
    error: status === 413 ? "That request is too large." : "That request couldn't be read.",
  });
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandled rejection:", reason instanceof Error ? reason.message : reason);
});

app.listen(PORT, HOST, () => {
  console.log(`goose-ts web UI: http://${HOST}:${PORT}`);
  console.log(`public mode: ${PUBLIC_MODE ? "ON" : "off (sign-in required)"}`);
  if (HOST === "127.0.0.1") {
    console.log(
      "(local dev tool only -- not part of the published package, don't expose this port publicly)",
    );
  }
});
