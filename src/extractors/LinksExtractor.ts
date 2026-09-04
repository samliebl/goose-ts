import { BaseExtractor } from "./BaseExtractor.js";

/** Port of goose.extractors.links.LinksExtractor. */
export class LinksExtractor extends BaseExtractor {
  extract(): string[] {
    const links: string[] = [];
    for (const item of this.parser.getElementsByTag(this.article.topNode!, { tag: "a" })) {
      const href = this.parser.getAttribute(item, "href");
      if (href) links.push(href);
    }
    return links;
  }
}
