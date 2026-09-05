import { Article } from "./Article.js";
import { DocumentCleaner } from "./Cleaners.js";
import type { Configuration } from "./Configuration.js";
import type { DomElement } from "./dom/Parser.js";
import { Parser } from "./dom/Parser.js";
import { AuthorsExtractor } from "./extractors/AuthorsExtractor.js";
import { ContentExtractor } from "./extractors/ContentExtractor.js";
import { ImagesExtractor } from "./extractors/ImagesExtractor.js";
import { JsonLdExtractor } from "./extractors/JsonLdExtractor.js";
import { LinksExtractor } from "./extractors/LinksExtractor.js";
import { MetasExtractor } from "./extractors/MetasExtractor.js";
import { OpenGraphExtractor } from "./extractors/OpenGraphExtractor.js";
import { PublishDateExtractor } from "./extractors/PublishDateExtractor.js";
import { TagsExtractor } from "./extractors/TagsExtractor.js";
import { TitleExtractor } from "./extractors/TitleExtractor.js";
import { TweetsExtractor } from "./extractors/TweetsExtractor.js";
import { VideosExtractor } from "./extractors/VideosExtractor.js";
import { Image } from "./Image.js";
import { HtmlFetcher } from "./Network.js";
import { OutputFormatter } from "./OutputFormatter.js";
import { ImageUtils } from "./utils/images.js";
import { rawParsingCandidate, urlParsingCandidate, type ParsingCandidate } from "./utils/url.js";

export interface CrawlCandidate {
  url?: string;
  rawHtml?: string;
}

/**
 * Below this length, DOM-scored text isn't a real article result -- either
 * ContentExtractor found no top node at all, or found one with barely
 * anything in it. Below this bar, try the JSON-LD fallback (see
 * JsonLdExtractor) instead of returning a near-empty article.
 */
const MIN_SUBSTANTIAL_TEXT_LENGTH = 250;

/** Port of goose.crawler.Crawler -- orchestrates the full extraction pipeline. */
export class Crawler {
  constructor(private readonly config: Configuration) {}

  async crawl(candidate: CrawlCandidate): Promise<Article> {
    const article = new Article();
    const parseCandidate = this.getParseCandidate(candidate);

    const rawHtml = await this.getHtml(candidate, article);
    if (rawHtml === null) return article;

    const parser = new Parser(rawHtml);

    article.finalUrl = parseCandidate.url;
    article.linkHash = parseCandidate.linkHash;
    article.rawHtml = rawHtml;
    article.doc = parser.doc;
    article.rawDoc = parser.doc.cloneNode(true);

    const contentExtractor = new ContentExtractor(this.config, article, parser);
    const cleaner = new DocumentCleaner(this.config, article, parser);
    const formatter = new OutputFormatter(this.config, article, parser);

    article.opengraph = new OpenGraphExtractor(this.config, article, parser).extract();
    article.publishDate = new PublishDateExtractor(this.config, article, parser).extract();

    const metas = new MetasExtractor(this.config, article, parser).extract();
    article.metaLang = metas.lang;
    article.metaFavicon = metas.favicon;
    article.metaDescription = metas.description;
    article.metaKeywords = metas.keywords;
    article.canonicalLink = metas.canonical;
    article.domain = metas.domain;

    article.tags = new TagsExtractor(this.config, article, parser).extract();
    article.authors = new AuthorsExtractor(this.config, article, parser).extract();
    article.title = new TitleExtractor(this.config, article, parser).extract();

    // If we find a known content-body tag, force article.doc to it so the
    // cleaner doesn't strip unrelated chrome around it.
    const articleBody = contentExtractor.getKnownArticleTags();
    if (articleBody !== null) {
      article.doc = articleBody;
    }

    article.doc = cleaner.clean();

    article.topNode = contentExtractor.calculateBestNode();

    if (article.topNode !== null) {
      article.links = new LinksExtractor(this.config, article, parser).extract();
      article.tweets = new TweetsExtractor(this.config, article, parser).extract();
      new VideosExtractor(this.config, article, parser).getVideos();

      if (this.config.enableImageFetching) {
        const topNode: DomElement = article.topNode;
        article.topImage = await new ImagesExtractor(this.config, article, parser).getBestImage(
          topNode,
        );
      }

      article.topNode = contentExtractor.postCleanup();
      article.cleanedText = formatter.getFormattedText();
    }

    if (
      this.config.enableJsonLdFallback &&
      article.cleanedText.trim().length < MIN_SUBSTANTIAL_TEXT_LENGTH
    ) {
      await this.applyJsonLdFallback(article, parser);
    }

    return article;
  }

  private async applyJsonLdFallback(article: Article, parser: Parser): Promise<void> {
    const jsonLd = new JsonLdExtractor(this.config, article, parser).extract();
    if (!jsonLd?.text) return;

    // We only get here when DOM-based extraction substantially failed, so
    // JSON-LD wins outright wherever it has a value -- including title,
    // which TitleExtractor always sets *something* for (its last resort is
    // the raw <title> tag, which on a true CSR shell is commonly a
    // placeholder like "Loading..." rather than the real headline).
    article.cleanedText = jsonLd.text;
    if (jsonLd.title) article.title = jsonLd.title;
    if (jsonLd.description) article.metaDescription = jsonLd.description;
    if (jsonLd.authors.length) article.authors = jsonLd.authors;
    if (jsonLd.publishDate) article.publishDate = jsonLd.publishDate;
    if (jsonLd.tags.length) article.tags = jsonLd.tags;

    if (!article.topImage && jsonLd.imageUrl && this.config.enableImageFetching) {
      const image = new Image();
      image.src = jsonLd.imageUrl;
      image.extractionType = "json-ld";
      image.confidenceScore = 100;

      const localImage = await ImageUtils.fetchImageInfo(jsonLd.imageUrl, this.config);
      if (localImage) {
        image.bytes = localImage.bytes;
        image.height = localImage.height;
        image.width = localImage.width;
      }
      article.topImage = image;
    }
  }

  private getParseCandidate(candidate: CrawlCandidate): ParsingCandidate {
    if (candidate.rawHtml) return rawParsingCandidate(candidate.url, candidate.rawHtml);
    return urlParsingCandidate(candidate.url ?? "");
  }

  private async getHtml(candidate: CrawlCandidate, article: Article): Promise<string | null> {
    if (candidate.rawHtml) return candidate.rawHtml;
    if (!candidate.url) return null;

    const fetcher = new HtmlFetcher(this.config);
    const html = await fetcher.getHtml(candidate.url);
    article.additionalData = { request: fetcher.request, response: fetcher.response };

    if (html === null) {
      article.fetchError = fetcher.response
        ? `HTTP ${fetcher.response.status} ${fetcher.response.statusText}`.trim()
        : describeNetworkError(fetcher.error);
    }

    return html;
  }
}

function describeNetworkError(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "network error";
}
