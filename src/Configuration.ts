import { StopWords, type StopWordsClass } from "./text.js";
import { VERSION } from "./version.js";

export interface ConfigurationOptions {
  /** Set false to skip fetching/scoring images entirely. Default true. */
  enableImageFetching?: boolean;
  /** Prefer the page's own declared language over targetLanguage. Default true. */
  useMetaLanguage?: boolean;
  /** Fallback language (ISO 639-1) used for stopword scoring. Default "en". */
  targetLanguage?: string;
  /** StopWords subclass used for content scoring. Default the generic StopWords. */
  stopwordsClass?: StopWordsClass;
  /** User-Agent sent with outbound HTTP requests. */
  browserUserAgent?: string;
  /**
   * Timeout (ms) for each individual outbound HTTP request. Default 12000.
   * Kept well under a minute deliberately: a site that's actually going to
   * respond almost always does so in a few seconds, and a site silently
   * stalling the connection instead of sending a clean block response (a
   * real anti-bot tactic some sites use against datacenter IPs) should read
   * as "failed" quickly, not hang for as long as we're willing to wait.
   */
  httpTimeout?: number;
  /**
   * goose-ts addition, not in python-goose: wall-clock budget (ms) for the
   * *whole* extract() call, not just one request. python-goose's image
   * scoring downloads every candidate image one at a time (see
   * ImagesExtractor) -- on an image-heavy page, a dozen-plus sequential
   * requests each individually within httpTimeout can still add up to
   * several minutes with nothing to show for it. Once this budget is spent,
   * in-flight and future requests are cut short rather than let the whole
   * extraction run indefinitely. Default 20000.
   */
  overallTimeoutMs?: number;
  /**
   * goose-ts addition: called before every outbound request -- the page,
   * each redirect hop, every image, robots.txt -- and may throw to refuse
   * it (throw a BlockedUrlError for a message that's safe to show users).
   * A server that fetches URLs on behalf of strangers uses this to block
   * private/internal addresses; without it, a redirect or an <img> tag in
   * a hostile page could point the fetcher anywhere.
   */
  urlGuard?: (url: string) => Promise<void> | void;
  /** Redirects followed per request, each re-checked by urlGuard. Default 5. */
  maxRedirects?: number;
  /** Largest page body accepted, in bytes. Default 5000000. */
  maxResponseBytes?: number;
  /** Largest single image accepted, in bytes. Default 10000000. */
  maxImageBytes?: number;
  /**
   * Check the site's robots.txt before fetching a page, and refuse if it
   * disallows our User-Agent (an unreachable robots.txt counts as
   * disallowing, per RFC 9309). Default false for library use -- a person
   * running their own script on their own machine -- but any service
   * fetching on behalf of others should turn this on.
   */
  respectRobotsTxt?: boolean;
  /**
   * goose-ts addition, not in python-goose: when DOM-based scoring finds
   * little or nothing (see MIN_SUBSTANTIAL_TEXT_LENGTH in Crawler.ts) --
   * most commonly on client-side-rendered pages, whose initial HTML has no
   * article markup to score -- fall back to schema.org Article JSON-LD
   * data if the page has it. Default true.
   */
  enableJsonLdFallback?: boolean;
}

/** Port of goose.configuration.Configuration, plus goose-ts-only additions (see field docs). */
export class Configuration {
  enableImageFetching: boolean;
  useMetaLanguage: boolean;
  targetLanguage: string;
  stopwordsClass: StopWordsClass;
  browserUserAgent: string;
  httpTimeout: number;
  enableJsonLdFallback: boolean;
  urlGuard: ((url: string) => Promise<void> | void) | undefined;
  maxRedirects: number;
  maxResponseBytes: number;
  maxImageBytes: number;
  respectRobotsTxt: boolean;
  /** Timestamp (ms since epoch) this extraction's overall budget runs out. Computed once, here, so every fetch site shares the same clock regardless of when it happens to run. */
  readonly deadlineAt: number;

  constructor(options: ConfigurationOptions = {}) {
    this.enableImageFetching = options.enableImageFetching ?? true;
    this.useMetaLanguage = options.useMetaLanguage ?? true;
    this.targetLanguage = options.targetLanguage ?? "en";
    this.stopwordsClass = options.stopwordsClass ?? StopWords;
    this.browserUserAgent = options.browserUserAgent ?? `goose-ts/${VERSION}`;
    this.httpTimeout = options.httpTimeout ?? 12_000;
    this.enableJsonLdFallback = options.enableJsonLdFallback ?? true;
    this.urlGuard = options.urlGuard;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.maxResponseBytes = options.maxResponseBytes ?? 5_000_000;
    this.maxImageBytes = options.maxImageBytes ?? 10_000_000;
    this.respectRobotsTxt = options.respectRobotsTxt ?? false;
    this.deadlineAt = Date.now() + (options.overallTimeoutMs ?? 20_000);
  }

  /** Milliseconds left in this extraction's overall budget; never negative. */
  remainingMs(): number {
    return Math.max(0, this.deadlineAt - Date.now());
  }
}
