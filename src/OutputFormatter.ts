import { decode } from "html-entities";
import { Text as DomText } from "domhandler";
import type { Article } from "./Article.js";
import type { Configuration } from "./Configuration.js";
import type { DomElement, Parser } from "./dom/Parser.js";
import { innerTrim } from "./text.js";

/** Port of goose.outputformatters.OutputFormatter. */
export class OutputFormatter {
  private topNode: DomElement | null = null;

  constructor(
    private readonly config: Configuration,
    private readonly article: Article,
    private readonly parser: Parser,
  ) {}

  private getLanguage(): string {
    if (this.config.useMetaLanguage && this.article.metaLang) {
      return this.article.metaLang.slice(0, 2);
    }
    return this.config.targetLanguage;
  }

  private getTopNode(): DomElement {
    return this.topNode!;
  }

  getFormattedText(): string {
    this.topNode = this.article.topNode;
    this.removeNegativescoresNodes();
    this.linksToText();
    this.addNewlineToBr();
    this.replaceWithText();
    this.removeFewwordsParagraphs();
    return this.convertToText();
  }

  private convertToText(): string {
    const txts: string[] = [];
    for (const node of this.parser.childNodes(this.getTopNode())) {
      const txt = this.parser.getText(node);
      if (txt) {
        const decoded = decode(txt);
        txts.push(...innerTrim(decoded).split("\\n"));
      }
    }
    return txts.join("\n\n");
  }

  private addNewlineToBr(): void {
    for (const e of this.parser.getElementsByTag(this.getTopNode(), { tag: "br" })) {
      // Literal two-char "\n" sentinel (not a real newline) -- matches
      // python-goose's r'\n', which convertToText later splits back out on.
      const textNode = new DomText("\\n");
      textNode.parent = e;
      e.children = [textNode];
    }
  }

  private linksToText(): void {
    this.parser.stripTags(this.getTopNode(), "a");
  }

  private removeNegativescoresNodes(): void {
    const gravityItems = this.parser.cssSelect(this.getTopNode(), "*[gravityScore]");
    for (const item of gravityItems) {
      const scoreAttr = this.parser.getAttribute(item, "gravityScore");
      const score = scoreAttr ? Math.trunc(Number.parseFloat(scoreAttr)) : 0;
      if (score < 1) this.parser.remove(item);
    }
  }

  private replaceWithText(): void {
    this.parser.stripTags(this.getTopNode(), "b", "strong", "i", "br", "sup");
  }

  private removeFewwordsParagraphs(): void {
    const allNodes = this.parser.getElementsByTags(this.getTopNode(), ["*"]).reverse();
    const stopwords = new this.config.stopwordsClass(this.getLanguage());
    for (const el of allNodes) {
      const tag = this.parser.getTag(el);
      const text = this.parser.getText(el);
      const wordStats = stopwords.getStopwordCount(text);
      if (
        (tag !== "br" || text !== "\\r") &&
        wordStats.getStopwordCount() < 3 &&
        this.parser.getElementsByTag(el, { tag: "object" }).length === 0 &&
        this.parser.getElementsByTag(el, { tag: "embed" }).length === 0
      ) {
        this.parser.remove(el);
      } else {
        const trimmed = this.parser.getText(el);
        if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
          this.parser.remove(el);
        }
      }
    }
  }
}
