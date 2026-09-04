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
  /** Timeout (ms) for outbound HTTP requests. Default 30000. */
  httpTimeout?: number;
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

  constructor(options: ConfigurationOptions = {}) {
    this.enableImageFetching = options.enableImageFetching ?? true;
    this.useMetaLanguage = options.useMetaLanguage ?? true;
    this.targetLanguage = options.targetLanguage ?? "en";
    this.stopwordsClass = options.stopwordsClass ?? StopWords;
    this.browserUserAgent = options.browserUserAgent ?? `goose-ts/${VERSION}`;
    this.httpTimeout = options.httpTimeout ?? 30_000;
    this.enableJsonLdFallback = options.enableJsonLdFallback ?? true;
  }
}
