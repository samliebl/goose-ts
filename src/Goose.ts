import type { Article } from "./Article.js";
import { Configuration, type ConfigurationOptions } from "./Configuration.js";
import { Crawler } from "./Crawler.js";

export interface ExtractOptions {
  url?: string;
  rawHtml?: string;
}

/** Port of goose.Goose -- the library's main entry point. */
export class Goose {
  readonly config: Configuration;

  constructor(config: Configuration | ConfigurationOptions = {}) {
    this.config = config instanceof Configuration ? config : new Configuration(config);
  }

  /** Extracts an Article from a URL (fetched over the network) or from raw HTML you already have. */
  async extract(options: ExtractOptions): Promise<Article> {
    if (!options.url && !options.rawHtml) {
      throw new Error("goose-ts: extract() requires either a url or rawHtml");
    }
    const crawler = new Crawler(this.config);
    return crawler.crawl({ url: options.url, rawHtml: options.rawHtml });
  }
}
