import { BaseExtractor } from "./BaseExtractor.js";

/** Port of goose.extractors.authors.AuthorsExtractor. */
export class AuthorsExtractor extends BaseExtractor {
  extract(): string[] {
    const authors: string[] = [];
    const authorNodes = this.parser.getElementsByTag(this.article.doc!, {
      attr: "itemprop",
      value: "author",
    });

    for (const author of authorNodes) {
      const nameNodes = this.parser.getElementsByTag(author, { attr: "itemprop", value: "name" });
      if (nameNodes.length > 0) {
        authors.push(this.parser.getText(nameNodes[0]!));
      }
    }

    return [...new Set(authors)];
  }
}
