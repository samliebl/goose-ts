import { createHmac, randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { dataDir, readStore, updateStore } from "./db.js";

/**
 * First-party, cookieless, privacy-preserving analytics.
 *
 * What it can answer: how many people visit, from where (referring site),
 * on what kind of device, whether the layout works on phones, what they ask
 * the tool to do and whether it works, where it fails, and how fast.
 *
 * What it deliberately never records, and why that's a design choice rather
 * than a missing feature -- each of these would create obligations (consent,
 * disclosure, deletion) that a small portfolio project shouldn't take on:
 *  - IP addresses. A visitor is a hash of IP + browser + a salt that is
 *    replaced every day and then thrown away, so a visitor can be counted
 *    within a day but never followed across days, and the hash can't be
 *    reversed afterwards.
 *  - Full URLs people ask regoose to fetch, or anything they paste: only the
 *    hostname, because a query string or a page can be personal.
 *  - The raw User-Agent (only a coarse device/browser/OS family), cookies or
 *    local storage identifiers, fingerprinting signals, or location.
 *  - Who a signed-in member is: events carry a tier ("anon"/"member"), never
 *    an email. The owner's own activity isn't recorded at all.
 * Visitors sending Do Not Track or Global Privacy Control get no visitor
 * hash, no device details and no referrer: just operational counts.
 *
 * Events are appended to one file per UTC day and deleted after 90 days.
 */

export const RETENTION_DAYS = 90;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

export type Tier = "anon" | "member" | "system";

export type EventType =
  | "pageview"
  | "extract"
  | "export"
  | "ratelimit"
  | "cap"
  | "busy"
  | "boot"
  | "access_request"
  | "invite"
  | "redeem"
  | "login_request"
  | "login"
  | "signout"
  | "account_delete";

export interface AnalyticsEvent {
  t: string;
  type: EventType;
  tier: Tier;
  /** Visitor hash for the day (absent under DNT/GPC). */
  v?: string;
  path?: string;
  ref?: string;
  dev?: Device;
  br?: string;
  os?: string;
  lang?: string;
  vw?: string;
  cs?: "dark" | "light";
  touch?: boolean;
  /** Hostname only, never the full URL. */
  host?: string;
  mode?: "url" | "paste";
  outcome?: string;
  status?: number;
  ms?: number;
  len?: number;
  img?: boolean;
  fmt?: string;
  n?: number;
}

export type Device = "mobile" | "tablet" | "desktop" | "bot";

// --- Classifying a client, coarsely ---

const BOT_PATTERN =
  /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|uptime|curl\/|wget|python-requests|httpclient|headless|lighthouse|pingdom|go-http|axios|node-fetch|okhttp|java\//i;

export function classifyUserAgent(ua: string | undefined): { dev: Device; br: string; os: string } {
  const s = ua ?? "";
  if (!s || BOT_PATTERN.test(s)) return { dev: "bot", br: "other", os: "other" };

  const dev: Device = /ipad|tablet|(android(?!.*mobile))/i.test(s)
    ? "tablet"
    : /mobi|iphone|ipod|android.*mobile/i.test(s)
      ? "mobile"
      : "desktop";

  const br = /edg(e|a|ios)?\//i.test(s)
    ? "Edge"
    : /opr\/|opera/i.test(s)
      ? "Opera"
      : /samsungbrowser/i.test(s)
        ? "Samsung Internet"
        : /fxios|firefox/i.test(s)
          ? "Firefox"
          : /crios|chrome|chromium/i.test(s)
            ? "Chrome"
            : /safari/i.test(s)
              ? "Safari"
              : "other";

  const os = /iphone|ipad|ipod/i.test(s)
    ? "iOS"
    : /android/i.test(s)
      ? "Android"
      : /windows/i.test(s)
        ? "Windows"
        : /cros/i.test(s)
          ? "ChromeOS"
          : /mac os x|macintosh/i.test(s)
            ? "macOS"
            : /linux|x11/i.test(s)
              ? "Linux"
              : "other";

  return { dev, br, os };
}

/** Screen width in coarse buckets -- enough to see if phones are being served well, too coarse to fingerprint. */
export function bucketViewport(width: unknown): string | undefined {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0 || w > 20000) return undefined;
  if (w < 480) return "<480";
  if (w < 768) return "480-767";
  if (w < 1024) return "768-1023";
  if (w < 1440) return "1024-1439";
  return "1440+";
}

/** The referring site's hostname (never the path or query), or undefined for direct visits and our own pages. */
export function referrerHost(referrer: unknown, ownHost: string): string | undefined {
  if (typeof referrer !== "string" || !referrer) return undefined;
  try {
    const url = new URL(referrer);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".") || host.length > 60) return undefined;
    if (
      host ===
      ownHost
        .toLowerCase()
        .replace(/:\d+$/, "")
        .replace(/^www\./, "")
    )
      return undefined;
    return host;
  } catch {
    return undefined;
  }
}

/** Primary language subtag ("en-US,fr;q=0.8" -> "en"). */
export function primaryLanguage(header: string | undefined): string | undefined {
  const match = /^\s*([a-z]{2,3})(?:[-_;,]|$)/i.exec(header ?? "");
  return match ? match[1]!.toLowerCase() : undefined;
}

/** Only pages we serve are counted by name; anything else (a beacon from a stranger) lands in "other". */
const KNOWN_PATHS = new Set([
  "/",
  "/about",
  "/author",
  "/terms",
  "/privacy",
  "/login",
  "/request-access",
  "/redeem",
  "/account",
]);

export function normalizePath(path: unknown): string {
  if (typeof path !== "string") return "other";
  const clean = path.split(/[?#]/)[0]!.replace(/\/+$/, "") || "/";
  return KNOWN_PATHS.has(clean) ? clean : "other";
}

// --- Daily-rotating visitor hash ---

function saltFor(day: string): string {
  const existing = readStore((s) => s.settings.analyticsSalt);
  if (existing?.date === day) return existing.salt;
  // A new day: replace the salt, which is what makes yesterday's hashes permanently unlinkable.
  const salt = randomBytes(32).toString("hex");
  updateStore((s) => {
    s.settings.analyticsSalt = { date: day, salt };
  });
  return salt;
}

/** Throws away a salt from a previous day, so yesterday's hashes stay unlinkable even if nobody visits today. */
export function discardStaleSalt(now = new Date()): void {
  const today = now.toISOString().slice(0, 10);
  if (
    readStore((s) => s.settings.analyticsSalt?.date !== today && s.settings.analyticsSalt !== null)
  ) {
    updateStore((s) => {
      s.settings.analyticsSalt = null;
    });
  }
}

export function visitorHash(ip: string, userAgent: string, now = new Date()): string {
  const salt = saltFor(now.toISOString().slice(0, 10));
  return createHmac("sha256", salt).update(`${ip}|${userAgent}`).digest("hex").slice(0, 16);
}

// --- Recording ---

const dir = () => join(dataDir(), "analytics");
const fileFor = (day: string) => join(dir(), `${day}.ndjson`);

let buffer: AnalyticsEvent[] = [];
let timer: NodeJS.Timeout | null = null;

/** Writes anything buffered. Called every couple of seconds, and on shutdown. */
export function flushAnalytics(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (buffer.length === 0) return;
  const pending = buffer;
  buffer = [];

  try {
    mkdirSync(dir(), { recursive: true });
    const byDay = new Map<string, string[]>();
    for (const event of pending) {
      const day = event.t.slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), JSON.stringify(event)]);
    }
    for (const [day, lines] of byDay) {
      const file = fileFor(day);
      // A flood of events must not be able to fill the volume.
      if (existsSync(file) && statSync(file).size > MAX_FILE_BYTES) continue;
      appendFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
    }
  } catch (error) {
    // Analytics must never take the site down with it.
    console.error(
      "analytics write failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function recordEvent(event: Omit<AnalyticsEvent, "t"> & { t?: string }): void {
  buffer.push({ ...event, t: event.t ?? new Date().toISOString() });
  if (buffer.length >= 100) flushAnalytics();
  else timer ??= setTimeout(flushAnalytics, 2000).unref();
}

/** Deletes day files past the retention window. Returns how many were removed. */
export function purgeOldAnalytics(now = new Date(), retentionDays = RETENTION_DAYS): number {
  if (!existsSync(dir())) return 0;
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString().slice(0, 10);
  let removed = 0;
  for (const name of readdirSync(dir())) {
    const match = /^(\d{4}-\d{2}-\d{2})\.ndjson$/.exec(name);
    if (match && match[1]! < cutoff) {
      rmSync(join(dir(), name));
      removed++;
    }
  }
  return removed;
}

// --- Reading and summarizing ---

const MAX_EVENTS_READ = 500_000;

export function loadEvents(days: number, now = new Date()): AnalyticsEvent[] {
  flushAnalytics();
  const events: AnalyticsEvent[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const file = fileFor(day);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf-8").split("\n")) {
      if (!line) continue;
      try {
        events.push(JSON.parse(line) as AnalyticsEvent);
      } catch {
        /* a half-written line from a crash: skip it */
      }
      if (events.length >= MAX_EVENTS_READ) return events;
    }
  }
  return events;
}

export interface Count {
  key: string;
  count: number;
}

export interface Summary {
  days: number;
  from: string;
  to: string;
  eventCount: number;
  totals: {
    /** Unique per day, summed over the range: the same person on two days counts twice, by design. */
    visitors: number;
    pageviews: number;
    extractions: number;
    extractionsOk: number;
    exports: number;
    rateLimited: number;
    capReached: number;
    busy: number;
    boots: number;
    accessRequests: number;
    invites: number;
    redemptions: number;
    logins: number;
  };
  daily: Array<{ date: string; visitors: number; pageviews: number; extractions: number }>;
  pages: Count[];
  referrers: Count[];
  devices: Count[];
  browsers: Count[];
  oses: Count[];
  languages: Count[];
  viewports: Count[];
  colorSchemes: Count[];
  extractionsByTier: Count[];
  modes: Count[];
  outcomes: Count[];
  hosts: Count[];
  refusedHosts: Count[];
  wantedHosts: Count[];
  durations: { p50: number | null; p95: number | null; avg: number | null; samples: number };
  funnel: { visited: number; extracted: number; exported: number };
}

function tally(values: Array<string | undefined>, limit = 10): Count[] {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  ]!;
}

/** Extraction outcomes that mean "a site said no" rather than "something broke", for the refusals table. */
const REFUSAL_OUTCOMES = new Set(["robots", "blocking", "demo-only"]);

export function summarize(events: AnalyticsEvent[], days: number, now = new Date()): Summary {
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dates.push(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  }
  const inRange = new Set(dates);
  const evs = events.filter((e) => inRange.has(e.t.slice(0, 10)) && e.dev !== "bot");

  const perDay = new Map(
    dates.map((d) => [d, { visitors: new Set<string>(), pageviews: 0, extractions: 0 }]),
  );
  const extractedBy = new Map(dates.map((d) => [d, new Set<string>()]));
  const exportedBy = new Map(dates.map((d) => [d, new Set<string>()]));
  const count = (type: EventType) => evs.filter((e) => e.type === type).length;

  for (const e of evs) {
    const day = perDay.get(e.t.slice(0, 10))!;
    if (e.v && (e.type === "pageview" || e.type === "extract" || e.type === "export")) {
      day.visitors.add(e.v);
    }
    if (e.type === "pageview") day.pageviews++;
    if (e.type === "extract") {
      day.extractions++;
      if (e.v) extractedBy.get(e.t.slice(0, 10))!.add(e.v);
    }
    if (e.type === "export" && e.v) exportedBy.get(e.t.slice(0, 10))!.add(e.v);
  }

  const pageviews = evs.filter((e) => e.type === "pageview");
  const extracts = evs.filter((e) => e.type === "extract");
  const timed = extracts
    .filter((e) => typeof e.ms === "number")
    .map((e) => e.ms!)
    .sort((a, b) => a - b);

  const sumSets = (m: Map<string, Set<string>>) => [...m.values()].reduce((n, s) => n + s.size, 0);
  const visitorsTotal = [...perDay.values()].reduce((n, d) => n + d.visitors.size, 0);

  return {
    days,
    from: dates[0]!,
    to: dates[dates.length - 1]!,
    eventCount: evs.length,
    totals: {
      visitors: visitorsTotal,
      pageviews: pageviews.length,
      extractions: extracts.length,
      extractionsOk: extracts.filter((e) => e.outcome === "ok").length,
      exports: count("export"),
      rateLimited: count("ratelimit"),
      capReached: count("cap"),
      busy: count("busy"),
      boots: count("boot"),
      accessRequests: count("access_request"),
      invites: count("invite"),
      redemptions: count("redeem"),
      logins: count("login"),
    },
    daily: dates.map((date) => {
      const d = perDay.get(date)!;
      return {
        date,
        visitors: d.visitors.size,
        pageviews: d.pageviews,
        extractions: d.extractions,
      };
    }),
    pages: tally(pageviews.map((e) => e.path)),
    referrers: tally(pageviews.map((e) => e.ref)),
    devices: tally(pageviews.map((e) => e.dev)),
    browsers: tally(pageviews.map((e) => e.br)),
    oses: tally(pageviews.map((e) => e.os)),
    languages: tally(pageviews.map((e) => e.lang)),
    viewports: tally(
      pageviews.map((e) => e.vw),
      6,
    ),
    colorSchemes: tally(
      pageviews.map((e) => e.cs),
      2,
    ),
    extractionsByTier: tally(extracts.map((e) => e.tier)),
    modes: tally(extracts.map((e) => e.mode)),
    outcomes: tally(extracts.map((e) => e.outcome)),
    hosts: tally(extracts.filter((e) => e.outcome === "ok").map((e) => e.host)),
    refusedHosts: tally(
      extracts
        .filter((e) => REFUSAL_OUTCOMES.has(e.outcome ?? "") && e.outcome !== "demo-only")
        .map((e) => e.host),
    ),
    wantedHosts: tally(extracts.filter((e) => e.outcome === "demo-only").map((e) => e.host)),
    durations: {
      p50: percentile(timed, 50),
      p95: percentile(timed, 95),
      avg: timed.length ? Math.round(timed.reduce((a, b) => a + b, 0) / timed.length) : null,
      samples: timed.length,
    },
    funnel: {
      visited: visitorsTotal,
      extracted: sumSets(extractedBy),
      exported: sumSets(exportedBy),
    },
  };
}
