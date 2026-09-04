import { BaseExtractor } from "./BaseExtractor.js";

const TITLE_SPLITTERS = ["|", "-", "»", ":"];

/** Port of goose.extractors.title.TitleExtractor. */
export class TitleExtractor extends BaseExtractor {
  private cleanTitle(rawTitle: string): string {
    let title = rawTitle;

    const siteName = this.article.opengraph["site_name"];
    if (siteName) {
      title = title.replace(siteName, "").trim();
    }

    if (this.article.domain) {
      const pattern = new RegExp(escapeRegExp(this.article.domain), "i");
      title = title.replace(pattern, "").trim();
    }

    const titleWords = title.split(/\s+/).filter(Boolean);
    if (titleWords.length === 0) return "";

    if (titleWords[0] && TITLE_SPLITTERS.includes(titleWords[0])) titleWords.shift();
    if (titleWords.length && TITLE_SPLITTERS.includes(titleWords[titleWords.length - 1]!)) {
      titleWords.pop();
    }

    return titleWords.join(" ").trim();
  }

  private getTitle(): string {
    const ogTitle = this.article.opengraph["title"];
    if (ogTitle !== undefined) {
      return this.cleanTitle(ogTitle);
    }

    const metaHeadline = this.parser.getElementsByTag(this.article.doc!, {
      tag: "meta",
      attr: "name",
      value: "headline",
    });
    if (metaHeadline.length > 0) {
      const content = this.parser.getAttribute(metaHeadline[0]!, "content");
      return this.cleanTitle(content ?? "");
    }

    const titleElement = this.parser.getElementsByTag(this.article.doc!, { tag: "title" });
    if (titleElement.length > 0) {
      return this.cleanTitle(this.parser.getText(titleElement[0]!));
    }

    return "";
  }

  extract(): string {
    return this.getTitle();
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
