import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  describeFetchFailure,
  Goose,
  renderArticleExport,
  renderArticlesZip,
  type Article,
  type ArticleInfos,
  type ConfigurationOptions,
  type ExportableArticle,
  type ExportFormat,
} from "../src/index.js";
import { findMember, purgeStaleData, recordMemberExtraction, touchMember } from "./access.js";
import {
  bucketViewport,
  classifyUserAgent,
  discardStaleSalt,
  flushAnalytics,
  normalizePath,
  primaryLanguage,
  purgeOldAnalytics,
  recordEvent,
  referrerHost,
  visitorHash,
} from "./analytics.js";
import { consumeDailyUsage } from "./db.js";
import { privacyBody, termsBody } from "./legal.js";
import { aboutBody, authorBody } from "./pages.js";
import {
  buildConfiguration,
  createUrlGuard,
  DEMO_ONLY_MESSAGE,
  EXAMPLE_URLS,
  LIMITS,
  OPEN_SOURCE_DOMAINS,
  type Tier,
  type TierLimits,
} from "./policy.js";
import { createRateLimiter } from "./rate-limit.js";
import { registerAccessRoutes, render } from "./routes-access.js";
import { registerAdminRoutes } from "./routes-admin.js";
import { isProduction, ownerEmail } from "./secrets.js";
import { getSession, renewIfDue, sessionOf, type AuthedRequest } from "./session.js";
import { TERMS_VERSION } from "./site.js";
import { optedOut, track } from "./track.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
// Local dev stays loopback-only by default, same as always; production
// sets HOST=0.0.0.0 (Fly secrets/env) -- a container's loopback interface
// isn't reachable from Fly's proxy at all, so this has to be configurable,
// not hardcoded, for a public deploy to work in the first place.
const HOST = process.env.HOST ?? "127.0.0.1";
const IS_PROD = isProduction();

/**
 * Off by default. Off: every page and API call requires a signed-in session,
 * exactly as before (except the pages people need in order to get in, and
 * the legal pages). On: visitors without a session get the public demo (see
 * policy.ts for what that tier can and can't do). Flipping it is a
 * deploy-time decision (PUBLIC_MODE=true in fly.toml), not a code change.
 */
const PUBLIC_MODE = process.env.PUBLIC_MODE === "true";

/** Extractions allowed to run at once. The machine is small; past this, say "busy" instead of falling over. */
const MAX_CONCURRENT_EXTRACTIONS = 2;
let activeExtractions = 0;

// --- Housekeeping: enforce retention at startup and once a day ---

function runMaintenance(): void {
  try {
    const purged = purgeStaleData();
    const analytics = purgeOldAnalytics();
    discardStaleSalt();
    if (purged.invites || purged.requests || purged.tokens || analytics) {
      console.log(
        `retention: removed ${purged.invites} codes, ${purged.requests} requests, ${purged.tokens} sign-in links, ${analytics} analytics days`,
      );
    }
  } catch (error) {
    console.error("maintenance failed:", error instanceof Error ? error.message : String(error));
  }
}
runMaintenance();
setInterval(runMaintenance, 24 * 3600_000).unref();
recordEvent({ type: "boot", tier: "system" });

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

// Cross-site request forgery: a state-changing request from a browser must
// come from this site. SameSite=Lax on the session cookie already keeps it
// from being sent on cross-site POSTs; this refuses them outright as well.
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const origin = req.get("origin");
  let sameSite = true;
  if (origin) {
    try {
      sameSite = new URL(origin).host === req.get("host");
    } catch {
      sameSite = false;
    }
  } else if (req.get("sec-fetch-site") === "cross-site") {
    sameSite = false;
  }
  if (sameSite) return next();
  if (req.path.startsWith("/api/")) {
    res.status(403).json({ ok: false, error: "Cross-site requests aren't allowed." });
  } else {
    res.status(403).send("Cross-site requests aren't allowed.");
  }
});

/** The visitor's real IP, for rate limiting. On Fly that's the Fly-Client-IP header, which the edge sets itself and a client can't forge. */
function clientIp(req: Request): string {
  return (IS_PROD ? req.get("fly-client-ip") : undefined) || req.ip || "unknown";
}

// Everyone's session is resolved up front, so the public pages can adapt to
// who's looking. A session that's getting old is renewed here, so people who
// keep using the site never have to sign in again.
app.use((req, res, next) => {
  const session = getSession(req);
  (req as AuthedRequest).session = session;
  if (session) {
    renewIfDue(res, session);
    if (!session.isOwner) touchMember(session.email);
  }
  next();
});

// -- Pages anyone may see, signed in or not --------------------------------

const staticPage = (title: string, body: () => string) => (req: Request, res: Response) => {
  render(req, res, title, body());
};

app.get("/about", staticPage("About regoose", aboutBody));
app.get("/author", staticPage("About the author", authorBody));
app.get("/terms", staticPage("Terms of Service", termsBody));
app.get("/privacy", staticPage("Privacy Policy", privacyBody));
app.use("/author", express.static(join(here, "public", "author"), { maxAge: "1d" }));

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
        "Disallow: /redeem",
        "Disallow: /account",
        "",
      ].join("\n"),
    );
});

// The visit counter. A separate file (not inline) because of the CSP.
app.get("/m.js", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.sendFile(join(here, "public", "m.js"));
});

const beaconLimit = createRateLimiter(60, 60_000);
app.post("/api/beacon", express.json({ limit: "2kb" }), (req, res) => {
  res.status(204).end();
  try {
    const session = sessionOf(req);
    if (session?.isOwner || optedOut(req) || !beaconLimit(clientIp(req))) return;
    const ua = req.get("user-agent") ?? "";
    const client = classifyUserAgent(ua);
    if (client.dev === "bot") return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    recordEvent({
      type: "pageview",
      tier: session ? "member" : "anon",
      v: visitorHash(clientIp(req), ua),
      path: normalizePath(body["p"]),
      ref: referrerHost(body["r"], req.get("host") ?? ""),
      dev: client.dev,
      br: client.br,
      os: client.os,
      lang: primaryLanguage(req.get("accept-language")),
      vw: bucketViewport(body["w"]),
      cs: body["d"] === true ? "dark" : "light",
      touch: body["t"] === true,
    });
  } catch {
    /* analytics must never matter to the visitor */
  }
});

// Sign-in, access codes, access requests, the account page.
registerAccessRoutes(app, { clientIp, publicMode: PUBLIC_MODE });

// -- Everything below here needs a session, unless PUBLIC_MODE is on ------

app.use((req: Request, res: Response, next: NextFunction) => {
  const session = sessionOf(req);
  if (!session && !PUBLIC_MODE) {
    if (req.path.startsWith("/api/")) {
      res.status(401).json({ ok: false, error: "Please sign in." });
    } else {
      res.redirect(302, "/login");
    }
    return;
  }

  // Members must have accepted the current terms.
  if (session && !session.isOwner && req.path !== "/api/auth/logout") {
    if (findMember(session.email)?.termsVersion !== TERMS_VERSION) {
      if (req.path.startsWith("/api/")) {
        res.status(403).json({ ok: false, error: "Please accept the updated terms to continue." });
      } else {
        res.redirect(302, `/accept-terms?next=${encodeURIComponent(req.path)}`);
      }
      return;
    }
  }
  next();
});

app.use(express.static(join(here, "public")));

function tierOf(req: Request): Tier {
  return sessionOf(req) ? "member" : "anon";
}

function limitsOf(req: Request): TierLimits {
  const session = sessionOf(req);
  if (!session) return LIMITS.anon;
  return session.isOwner ? LIMITS.owner : LIMITS.member;
}

// Lets the static frontend adapt to who's looking -- the static index.html
// has no server-side templating, so it can't know this on its own.
app.get("/api/me", (req, res) => {
  const session = sessionOf(req);
  const tier = tierOf(req);
  res.json({
    email: session?.email ?? null,
    isOwner: session?.isOwner ?? false,
    tier,
    publicMode: PUBLIC_MODE,
    allowedDomains: tier === "anon" ? OPEN_SOURCE_DOMAINS : null,
    examples: EXAMPLE_URLS,
  });
});

registerAdminRoutes(app, { publicMode: PUBLIC_MODE });

// -- Extraction ------------------------------------------------------------

/** Per-IP limits, one limiter per tier so a flood of anonymous traffic can't use up a signed-in user's allowance. */
const extractLimiters = {
  anon: createRateLimiter(LIMITS.anon.ratePerWindow, LIMITS.anon.windowMs),
  member: createRateLimiter(LIMITS.member.ratePerWindow, LIMITS.member.windowMs),
  owner: createRateLimiter(LIMITS.owner.ratePerWindow, LIMITS.owner.windowMs),
};
const exportLimiter = createRateLimiter(60, 10 * 60_000);

function rateLimited(req: Request, res: Response, windowMs: number): void {
  track(req, clientIp(req), { type: "ratelimit" });
  res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
  res
    .status(429)
    .json({ ok: false, error: "Too many requests. Wait a few minutes and try again." });
}

function limitExtractions(req: Request, res: Response, next: NextFunction): void {
  const session = sessionOf(req);
  const limiter = !session
    ? extractLimiters.anon
    : session.isOwner
      ? extractLimiters.owner
      : extractLimiters.member;
  if (!limiter(clientIp(req))) {
    rateLimited(req, res, limitsOf(req).windowMs);
    return;
  }
  next();
}

function limitExports(req: Request, res: Response, next: NextFunction): void {
  if (!exportLimiter(clientIp(req))) {
    rateLimited(req, res, 10 * 60_000);
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

/** A short, stable label for how an extraction ended, for the analytics breakdowns. */
function outcomeOf(article: Article): string {
  if (article.fetchErrorKind === "robots") return "robots";
  if (article.fetchErrorKind === "blocked-url") {
    return article.fetchError === DEMO_ONLY_MESSAGE ? "demo-only" : "blocked-url";
  }
  if (article.fetchErrorKind === "too-large") return "too-large";
  if (article.fetchError) {
    const status = /^HTTP (\d+)/.exec(article.fetchError)?.[1];
    if (!status) return "network";
    return [401, 403, 406, 429, 451].includes(Number(status)) ? "blocking" : "http-error";
  }
  if (article.timedOut) return "timeout";
  return "ok";
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .slice(0, 80);
  } catch {
    return undefined;
  }
}

app.post("/api/extract", limitExtractions, express.json({ limit: "4mb" }), async (req, res) => {
  const body = (req.body ?? {}) as ExtractRequestBody;
  const tier = tierOf(req);
  const limits = limitsOf(req);
  const session = sessionOf(req);
  const ip = clientIp(req);
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
    track(req, ip, { type: "busy" });
    res.setHeader("Retry-After", "5");
    return fail(503, "regoose is busy right now. Try again in a few seconds.");
  }
  const capTier = session?.isOwner ? "owner" : tier;
  if (!consumeDailyUsage(capTier, LIMITS[capTier].dailyCap)) {
    track(req, ip, { type: "cap" });
    return fail(
      503,
      tier === "anon"
        ? "The public demo has reached its limit for today. Please try again tomorrow."
        : "The daily limit has been reached. Please try again tomorrow.",
    );
  }
  if (session && !session.isOwner) recordMemberExtraction(session.email);

  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const mode = rawHtml ? "paste" : "url";
  const host = rawHtml ? undefined : hostOf(url);
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
    track(req, ip, {
      type: "extract",
      mode,
      host,
      outcome: outcomeOf(article),
      ms: elapsed(),
      len: failure ? 0 : article.cleanedText.length,
      img: config.enableImageFetching,
    });

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
    track(req, ip, { type: "extract", mode, host, outcome: "error", ms: elapsed() });
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

    track(req, clientIp(req), { type: "export", fmt: format, n: items.length });
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

// Fly stops an idle machine with SIGINT then SIGTERM; write out buffered
// analytics before exiting rather than losing the last couple of seconds.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    flushAnalytics();
    process.exit(0);
  });
}

app.listen(PORT, HOST, () => {
  console.log(`goose-ts web UI: http://${HOST}:${PORT}`);
  console.log(`public mode: ${PUBLIC_MODE ? "ON" : "off (sign-in required)"}`);
  console.log(`owner: ${ownerEmail() ? "configured" : "missing"}`);
  if (HOST === "127.0.0.1") {
    console.log(
      "(local dev tool only -- not part of the published package, don't expose this port publicly)",
    );
  }
});
