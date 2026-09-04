import type { Article } from "../Article.js";
import type { Configuration } from "../Configuration.js";
import type { Parser } from "../dom/Parser.js";
import type { StopWordsClass } from "../text.js";

/** Port of goose.extractors.BaseExtractor. */
export abstract class BaseExtractor {
  protected readonly parser: Parser;
  protected readonly stopwordsClass: StopWordsClass;

  constructor(
    protected readonly config: Configuration,
    protected readonly article: Article,
    parser: Parser,
  ) {
    this.parser = parser;
    this.stopwordsClass = config.stopwordsClass;
  }

  protected getLanguage(): string {
    if (this.config.useMetaLanguage && this.article.metaLang) {
      return this.article.metaLang.slice(0, 2);
    }
    return this.config.targetLanguage;
  }
}
