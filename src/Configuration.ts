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
    this.deadlineAt = Date.now() + (options.overallTimeoutMs ?? 20_000);
  }

  /** Milliseconds left in this extraction's overall budget; never negative. */
  remainingMs(): number {
    return Math.max(0, this.deadlineAt - Date.now());
  }
}
