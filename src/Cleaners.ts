import { isTag, isText, type ChildNode } from "domhandler";
import type { Article } from "./Article.js";
import type { Configuration } from "./Configuration.js";
import type { DomElement, Parser } from "./dom/Parser.js";
import { ReplaceSequence } from "./utils/replaceSequence.js";

const REMOVE_NODES_RE =
  "^side$|combx|retweet|mediaarticlerelated|menucontainer|" +
  "navbar|storytopbar-bucket|utility-bar|inline-share-tools" +
  "|comment|PopularQuestions|contact|foot|footer|Footer|footnote" +
  "|cnn_strycaptiontxt|cnn_html_slideshow|cnn_strylftcntnt" +
  "|^links$|meta$|shoutbox|sponsor" +
  "|tags|socialnetworking|socialNetworking|cnnStryHghLght" +
  "|cnn_stryspcvbx|^inset$|pagetools|post-attributes" +
  "|welcome_form|contentTools2|the_answers" +
  "|communitypromo|runaroundLeft|subscribe|vcard|articleheadings" +
  "|date|^print$|popup|author-dropdown|tools|socialtools|byline" +
  "|konafilter|KonaFilter|breadcrumbs|^fn$|wp-caption-text" +
  "|legende|ajoutVideo|timestamp|js_replies";

const CAPTION_RE = "^caption$";
const GOOGLE_RE = " google ";
const ENTRIES_RE = "^[^entry-]more.*$";
const FACEBOOK_RE = "[^-]facebook";
const FACEBOOK_BROADCASTING_RE = "facebook-broadcasting";
const TWITTER_RE = "[^-]twitter";

const TAG_LIST = ["a", "blockquote", "dl", "div", "img", "ol", "p", "pre", "table", "ul"];

/** Port of goose.cleaners.DocumentCleaner. */
export class DocumentCleaner {
  private readonly parser: Parser;
  private readonly tablinesReplacements = new ReplaceSequence()
    .create("\n", "\n\n")
    .append("\t")
    .append("^\\s+$");

  constructor(
    private readonly config: Configuration,
    private readonly article: Article,
    parser: Parser,
  ) {
    this.parser = parser;
  }

  clean(): DomElement {
    let doc = this.article.doc!;
    doc = this.cleanBodyClasses(doc);
    doc = this.cleanArticleTags(doc);
    doc = this.cleanEmTags(doc);
    doc = this.removeDropCaps(doc);
    doc = this.removeScriptsStyles(doc);
    doc = this.cleanBadTags(doc);
    doc = this.removeNodesRegex(doc, CAPTION_RE);
    doc = this.removeNodesRegex(doc, GOOGLE_RE);
    doc = this.removeNodesRegex(doc, ENTRIES_RE);
    doc = this.removeNodesRegex(doc, FACEBOOK_RE);
    doc = this.removeNodesRegex(doc, FACEBOOK_BROADCASTING_RE);
    doc = this.removeNodesRegex(doc, TWITTER_RE);
    doc = this.cleanParaSpans(doc);
    doc = this.divToPara(doc, "div");
    doc = this.divToPara(doc, "span");
    return doc;
  }

  private cleanBodyClasses(doc: DomElement): DomElement {
    const elements = this.parser.getElementsByTag(doc, { tag: "body" });
    if (elements.length) this.parser.delAttribute(elements[0]!, "class");
    return doc;
  }

  private cleanArticleTags(doc: DomElement): DomElement {
    for (const article of this.parser.getElementsByTag(doc, { tag: "article" })) {
      for (const attr of ["id", "name", "class"]) this.parser.delAttribute(article, attr);
    }
    return doc;
  }

  private cleanEmTags(doc: DomElement): DomElement {
    for (const node of this.parser.getElementsByTag(doc, { tag: "em" })) {
      if (this.parser.getElementsByTag(node, { tag: "img" }).length === 0) {
        this.parser.dropTag(node);
      }
    }
    return doc;
  }

  private removeDropCaps(doc: DomElement): DomElement {
    for (const item of this.parser.cssSelect(doc, "span[class~=dropcap], span[class~=drop_cap]")) {
      this.parser.dropTag(item);
    }
    return doc;
  }

  private removeScriptsStyles(doc: DomElement): DomElement {
    for (const item of this.parser.getElementsByTag(doc, { tag: "script" }))
      this.parser.remove(item);
    for (const item of this.parser.getElementsByTag(doc, { tag: "style" }))
      this.parser.remove(item);
    for (const item of this.parser.getComments(doc)) this.parser.remove(item);
    return doc;
  }

  private cleanBadTags(doc: DomElement): DomElement {
    for (const attr of ["id", "class", "name"] as const) {
      for (const node of this.parser.getElementsByTag(doc, { attr, value: REMOVE_NODES_RE })) {
        this.parser.remove(node);
      }
    }
    return doc;
  }

  private removeNodesRegex(doc: DomElement, pattern: string): DomElement {
    for (const attr of ["id", "class"] as const) {
      for (const node of this.parser.getElementsByTag(doc, { attr, value: pattern })) {
        this.parser.remove(node);
      }
    }
    return doc;
  }

  private cleanParaSpans(doc: DomElement): DomElement {
    for (const item of this.parser.cssSelect(doc, "p span")) this.parser.dropTag(item);
    return doc;
  }

  private getFlushedBuffer(replacementText: string): DomElement {
    return this.parser.textToPara(replacementText);
  }

  /**
   * Walks a div's children, merging runs of "text interleaved with <a>
   * tags" into flushed <span> replacement nodes so link-heavy inline
   * fragments collapse into plain text later. Uses domhandler's real
   * `.prev`/`.next` sibling pointers directly (rather than Parser's
   * element-only previousSibling/nextSibling) because it needs to see the
   * raw text-node siblings between anchors.
   */
  private getReplacementNodes(div: DomElement): ChildNode[] {
    let replacementText: string[] = [];
    const nodesToReturn: ChildNode[] = [];
    const nodesToRemove: ChildNode[] = [];
    const kids = this.parser.childNodesWithText(div);

    for (const kid of kids) {
      if (isTag(kid) && kid.name === "p" && replacementText.length > 0) {
        nodesToReturn.push(this.getFlushedBuffer(replacementText.join("")));
        replacementText = [];
        nodesToReturn.push(kid);
      } else if (isText(kid)) {
        const kidText = this.parser.getText(kid);
        const replaceText = this.tablinesReplacements.replaceAll(kidText);
        if (replaceText.length > 1) {
          let previousSiblingNode: ChildNode | null = kid.prev;
          while (
            previousSiblingNode &&
            isTag(previousSiblingNode) &&
            previousSiblingNode.name === "a" &&
            this.parser.getAttribute(previousSiblingNode, "grv-usedalready") !== "yes"
          ) {
            replacementText.push(` ${this.parser.outerHtml(previousSiblingNode)} `);
            nodesToRemove.push(previousSiblingNode);
            this.parser.setAttribute(previousSiblingNode, "grv-usedalready", "yes");
            previousSiblingNode = previousSiblingNode.prev;
          }

          replacementText.push(replaceText);

          let nextSiblingNode: ChildNode | null = kid.next;
          while (
            nextSiblingNode &&
            isTag(nextSiblingNode) &&
            nextSiblingNode.name === "a" &&
            this.parser.getAttribute(nextSiblingNode, "grv-usedalready") !== "yes"
          ) {
            replacementText.push(` ${this.parser.outerHtml(nextSiblingNode)} `);
            nodesToRemove.push(nextSiblingNode);
            this.parser.setAttribute(nextSiblingNode, "grv-usedalready", "yes");
            nextSiblingNode = nextSiblingNode.next;
          }
        }
      } else {
        nodesToReturn.push(kid);
      }
    }

    if (replacementText.length > 0) {
      nodesToReturn.push(this.getFlushedBuffer(replacementText.join("")));
    }

    for (const n of nodesToRemove) this.parser.remove(n);

    return nodesToReturn;
  }

  private divToPara(doc: DomElement, domType: string): DomElement {
    const divs = this.parser.getElementsByTag(doc, { tag: domType });

    for (const div of divs) {
      const items = this.parser.getElementsByTags(div, TAG_LIST);
      if (items.length === 0) {
        this.parser.replaceTag(div, "p");
      } else {
        const replaceNodes = this.getReplacementNodes(div);
        this.parser.removeAllChildren(div);
        for (let c = 0; c < replaceNodes.length; c++) {
          this.parser.insertAt(div, c, replaceNodes[c]!);
        }
      }
    }

    return doc;
  }
}
