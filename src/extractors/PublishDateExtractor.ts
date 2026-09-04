import { BaseExtractor } from "./BaseExtractor.js";

const KNOWN_PUBLISH_DATE_TAGS = [
  { attribute: "property", value: "rnews:datePublished", content: "content" },
  { attribute: "property", value: "article:published_time", content: "content" },
  { attribute: "name", value: "OriginalPublicationDate", content: "content" },
  { attribute: "itemprop", value: "datePublished", content: "datetime" },
];

/** Port of goose.extractors.publishdate.PublishDateExtractor. */
export class PublishDateExtractor extends BaseExtractor {
  extract(): string | null {
    for (const knownMetaTag of KNOWN_PUBLISH_DATE_TAGS) {
      const metaTags = this.parser.getElementsByTag(this.article.doc!, {
        attr: knownMetaTag.attribute,
        value: knownMetaTag.value,
      });
      if (metaTags.length) {
        return this.parser.getAttribute(metaTags[0]!, knownMetaTag.content);
      }
    }
    return null;
  }
}
