import { BaseExtractor } from "./BaseExtractor.js";

const A_REL_TAG_SELECTOR = "a[rel=tag]";
const A_HREF_TAG_SELECTOR =
  "a[href*='/tag/'], a[href*='/tags/'], a[href*='/topic/'], a[href*='?keyword=']";

/** Port of goose.extractors.tags.TagsExtractor. */
export class TagsExtractor extends BaseExtractor {
  extract(): string[] {
    const node = this.article.doc!;
    const tags: string[] = [];

    if (this.parser.childNodes(node).length === 0) return tags;

    let elements = this.parser.cssSelect(node, A_REL_TAG_SELECTOR);
    if (!elements.length) {
      elements = this.parser.cssSelect(node, A_HREF_TAG_SELECTOR);
      if (!elements.length) return tags;
    }

    for (const el of elements) {
      const tag = this.parser.getText(el);
      if (tag) tags.push(tag);
    }

    return [...new Set(tags)];
  }
}
