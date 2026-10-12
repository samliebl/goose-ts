import {
  BlockedUrlError,
  Configuration,
  VERSION,
  type ConfigurationOptions,
} from "../src/index.js";
import { assertSafeToFetch } from "./ssrf-guard.js";

/**
 * Everything that decides what a visitor may make this server do, kept apart
 * from the Express wiring so it can be tested on its own.
 *
 * Two tiers. "anon" is someone with no session (only exists when
 * PUBLIC_MODE is on): a demo -- pasted HTML, or a URL from the allowlist
 * below, no image fetching. "member" is anyone signed in through the
 * email allowlist: any public URL, images on, higher limits.
 */

export type Tier = "anon" | "member";

export const SITE_URL = process.env.SITE_URL ?? "https://regoose.com";

/** Identifies us to every site we fetch from, with a page explaining who we are and how to ask us to stop. */
export const SERVER_USER_AGENT = `regoose/${VERSION} (+${SITE_URL}/about)`;

/**
 * Sources the public demo may fetch from: sites that publish openly
 * licensed or public-domain material and where extraction was checked to
 * work. Adding a site here is a statement that fetching it for strangers
 * is fine -- so check its terms and robots.txt first. Matches the domain
 * and any subdomain (en.wikipedia.org for wikipedia.org).
 */
export const OPEN_SOURCE_DOMAINS = [
  "wikipedia.org",
  "wikisource.org",
  "wikibooks.org",
  "wikinews.org",
  "gutenberg.org",
  "nasa.gov",
  "nps.gov",
  "loc.gov",
  "nih.gov",
  "epa.gov",
  "plos.org",
  "theconversation.com",
];

/** One-click demos for the public page. Each was run through the real extraction path. */
export const EXAMPLE_URLS = [
  { label: "Bird migration (Wikipedia)", url: "https://en.wikipedia.org/wiki/Bird_migration" },
  { label: "Spruce Goose (Wikipedia)", url: "https://en.wikipedia.org/wiki/Spruce_Goose" },
  {
    label: "Yellowstone geology (NPS)",
    url: "https://www.nps.gov/yell/learn/nature/geology.htm",
  },
];

export function isAllowlistedHost(
  hostname: string,
  domains: readonly string[] = OPEN_SOURCE_DOMAINS,
): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Sites that asked us to stay away, from the BLOCKED_DOMAINS env var (comma-separated). Applies to every tier. */
export function blockedDomains(env: string | undefined = process.env.BLOCKED_DOMAINS): string[] {
  return (env ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export interface TierLimits {
  /** Extractions per window, per IP. */
  ratePerWindow: number;
  windowMs: number;
  /** Extractions per day across everyone in the tier -- the cost ceiling. */
  dailyCap: number;
  /** Largest pasted HTML accepted, in characters. */
  maxRawHtmlChars: number;
  /** Largest fetched page accepted, in bytes. */
  maxResponseBytes: number;
}

export const LIMITS: Record<Tier | "owner", TierLimits> = {
  anon: {
    ratePerWindow: 10,
    windowMs: 10 * 60_000,
    dailyCap: 300,
    maxRawHtmlChars: 1_000_000,
    maxResponseBytes: 3_000_000,
  },
  member: {
    ratePerWindow: 30,
    windowMs: 10 * 60_000,
    dailyCap: 1000,
    maxRawHtmlChars: 3_000_000,
    maxResponseBytes: 5_000_000,
  },
  // The owner isn't subject to the shared daily cap -- it's their own site.
  owner: {
    ratePerWindow: 120,
    windowMs: 10 * 60_000,
    dailyCap: Number.POSITIVE_INFINITY,
    maxRawHtmlChars: 3_000_000,
    maxResponseBytes: 5_000_000,
  },
};

export const DEMO_ONLY_MESSAGE =
  "The public demo only fetches from a short list of open-source sites. Paste the page's HTML instead, or sign in to fetch any URL.";

/**
 * The guard installed as Configuration.urlGuard: runs before the page, every
 * redirect hop, robots.txt, and every image. Verdicts are cached per
 * hostname for the life of one extraction, so image-heavy pages don't pay
 * for a DNS lookup per image.
 */
export function createUrlGuard(
  tier: Tier,
  safeToFetch: (url: string) => Promise<void> = assertSafeToFetch,
  blocked: string[] = blockedDomains(),
): (url: string) => Promise<void> {
  const verdicts = new Map<string, Promise<void>>();
  return (url: string) => {
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      return Promise.reject(new BlockedUrlError("That's not a valid URL."));
    }
    let verdict = verdicts.get(hostname);
    if (!verdict) {
      verdict = isAllowlistedHost(hostname, blocked)
        ? Promise.reject(new BlockedUrlError("This site has asked regoose not to fetch it."))
        : tier === "anon" && !isAllowlistedHost(hostname)
          ? Promise.reject(new BlockedUrlError(DEMO_ONLY_MESSAGE))
          : safeToFetch(url);
      verdicts.set(hostname, verdict);
    }
    return verdict;
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * Builds the Configuration for a request. Nothing a visitor sends is trusted
 * to set a limit: the request's `config` can only choose among a few
 * harmless preferences, clamped into safe ranges, and everything that
 * governs cost, safety, or how we identify ourselves is fixed here.
 */
export function buildConfiguration(
  tier: Tier,
  requested: Partial<ConfigurationOptions> | undefined,
  urlGuard: (url: string) => Promise<void>,
  limits: TierLimits = LIMITS[tier],
): Configuration {
  const raw = requested && typeof requested === "object" ? requested : {};
  const language = typeof raw.targetLanguage === "string" ? raw.targetLanguage : "";

  return new Configuration({
    enableImageFetching: tier === "member" && raw.enableImageFetching !== false,
    useMetaLanguage: raw.useMetaLanguage !== false,
    targetLanguage: /^[a-z]{2}$/.test(language) ? language : "en",
    httpTimeout: clamp(raw.httpTimeout, 1_000, 12_000, 12_000),
    overallTimeoutMs: 20_000,
    maxResponseBytes: limits.maxResponseBytes,
    maxImageBytes: 8_000_000,
    maxRedirects: 5,
    respectRobotsTxt: true,
    browserUserAgent: SERVER_USER_AGENT,
    urlGuard,
  });
}
