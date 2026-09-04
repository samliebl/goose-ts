import { BaseExtractor } from "./BaseExtractor.js";

/** Port of goose.extractors.opengraph.OpenGraphExtractor. */
export class OpenGraphExtractor extends BaseExtractor {
  extract(): Record<string, string> {
    const opengraph: Record<string, string> = {};
    const metas = this.parser.getElementsByTag(this.article.doc!, { tag: "meta" });
    for (const meta of metas) {
      const attr = this.parser.getAttribute(meta, "property");
      if (attr?.startsWith("og:")) {
        const value = this.parser.getAttribute(meta, "content");
        if (value) opengraph[attr.split(":")[1]!] = value;
      }
    }
    return opengraph;
  }
}
