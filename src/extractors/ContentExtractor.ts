import type { DomElement } from "../dom/Parser.js";
import { BaseExtractor } from "./BaseExtractor.js";

interface KnownArticleTag {
  attr?: string;
  value?: string;
  tag?: string;
}

const KNOWN_ARTICLE_CONTENT_TAGS: KnownArticleTag[] = [
  { attr: "itemprop", value: "articleBody" },
  { attr: "class", value: "post-content" },
  { tag: "article" },
];

/** Port of goose.extractors.content.ContentExtractor -- goose's main-body scoring algorithm. */
export class ContentExtractor extends BaseExtractor {
  getKnownArticleTags(): DomElement | null {
    for (const item of KNOWN_ARTICLE_CONTENT_TAGS) {
      const nodes = this.parser.getElementsByTag(this.article.doc!, item);
      if (nodes.length) return nodes[0]!;
    }
    return null;
  }

  isArticlebody(node: DomElement): boolean {
    for (const item of KNOWN_ARTICLE_CONTENT_TAGS) {
      if (item.attr && item.value) {
        if (this.parser.getAttribute(node, item.attr) === item.value) return true;
      }
      if (item.tag) {
        if (node.name === item.tag) return true;
      }
    }
    return false;
  }

  calculateBestNode(): DomElement | null {
    const doc = this.article.doc!;
    let topNode: DomElement | null = null;
    const nodesToCheck = this.nodesToCheck(doc);

    let startingBoost = 1.0;
    let cnt = 0;
    let i = 0;
    const parentNodes: DomElement[] = [];
    const nodesWithText: DomElement[] = [];

    for (const node of nodesToCheck) {
      const textNode = this.parser.getText(node);
      const wordStats = new this.stopwordsClass(this.getLanguage()).getStopwordCount(textNode);
      const highLinkDensity = this.isHighlinkDensity(node);
      if (wordStats.getStopwordCount() > 2 && !highLinkDensity) {
        nodesWithText.push(node);
      }
    }

    const nodesNumber = nodesWithText.length;
    const negativeScoring = 0;
    const bottomNegativescoreNodes = nodesNumber * 0.25;

    for (const node of nodesWithText) {
      let boostScore = 0;
      if (this.isBoostable(node)) {
        if (cnt >= 0) {
          boostScore = (1.0 / startingBoost) * 50;
          startingBoost += 1;
        }
      }
      if (nodesNumber > 15) {
        if (nodesNumber - i <= bottomNegativescoreNodes) {
          const booster = bottomNegativescoreNodes - (nodesNumber - i);
          boostScore = -(booster ** 2);
          const negscore = Math.abs(boostScore) + negativeScoring;
          if (negscore > 40) boostScore = 5;
        }
      }

      const textNode = this.parser.getText(node);
      const wordStats = new this.stopwordsClass(this.getLanguage()).getStopwordCount(textNode);
      const upscore = Math.trunc(wordStats.getStopwordCount() + boostScore);

      const parentNode = this.parser.getParent(node) as DomElement | null;
      if (!parentNode) {
        cnt += 1;
        i += 1;
        continue;
      }
      this.updateScore(parentNode, upscore);
      this.updateNodeCount(parentNode, 1);

      if (!parentNodes.includes(parentNode)) parentNodes.push(parentNode);

      const parentParentNode = this.parser.getParent(parentNode) as DomElement | null;
      if (parentParentNode !== null) {
        this.updateNodeCount(parentParentNode, 1);
        this.updateScore(parentParentNode, Math.trunc(upscore / 2));
        if (!parentNodes.includes(parentParentNode)) parentNodes.push(parentParentNode);
      }
      cnt += 1;
      i += 1;
    }

    let topNodeScore = 0;
    for (const e of parentNodes) {
      const score = this.getScore(e);
      if (score > topNodeScore) {
        topNode = e;
        topNodeScore = score;
      }
      if (topNode === null) topNode = e;
    }

    return topNode;
  }

  /**
   * A lot of times the first paragraph might be the caption under an image,
   * so before boosting a parent node we make sure it's connected to other
   * paragraphs with real substance, at least within the next few siblings.
   */
  isBoostable(node: DomElement): boolean {
    const para = "p";
    let stepsAway = 0;
    const minimumStopwordCount = 5;
    const maxStepsawayFromNode = 3;

    for (const currentNode of this.walkSiblings(node)) {
      const currentNodeTag = this.parser.getTag(currentNode);
      if (currentNodeTag === para) {
        if (stepsAway >= maxStepsawayFromNode) return false;
        const paraText = this.parser.getText(currentNode);
        const wordStats = new this.stopwordsClass(this.getLanguage()).getStopwordCount(paraText);
        if (wordStats.getStopwordCount() > minimumStopwordCount) return true;
        stepsAway += 1;
      }
    }
    return false;
  }

  private walkSiblings(node: DomElement): DomElement[] {
    const siblings: DomElement[] = [];
    let current = this.parser.previousSibling(node);
    while (current !== null) {
      siblings.push(current);
      current = this.parser.previousSibling(current);
    }
    return siblings;
  }

  addSiblings(topNode: DomElement): DomElement {
    if (this.isArticlebody(topNode)) return topNode;
    const baselinescoreSiblingsPara = this.getSiblingsScore(topNode);
    for (const currentNode of this.walkSiblings(topNode)) {
      const ps = this.getSiblingsContent(currentNode, baselinescoreSiblingsPara);
      for (const p of ps) {
        this.parser.insertAt(topNode, 0, p);
      }
    }
    return topNode;
  }

  private getSiblingsContent(
    currentSibling: DomElement,
    baselinescoreSiblingsPara: number,
  ): DomElement[] {
    if (currentSibling.name === "p" && this.parser.getText(currentSibling).length > 0) {
      return [currentSibling];
    }

    const potentialParagraphs = this.parser.getElementsByTag(currentSibling, { tag: "p" });
    const ps: DomElement[] = [];
    for (const firstParagraph of potentialParagraphs) {
      const text = this.parser.getText(firstParagraph);
      if (text.length > 0) {
        const wordStats = new this.stopwordsClass(this.getLanguage()).getStopwordCount(text);
        const paragraphScore = wordStats.getStopwordCount();
        const siblingBaselineScore = 0.3;
        const highLinkDensity = this.isHighlinkDensity(firstParagraph);
        const score = baselinescoreSiblingsPara * siblingBaselineScore;
        if (score < paragraphScore && !highLinkDensity) {
          ps.push(this.parser.createElement("p", text));
        }
      }
    }
    return ps;
  }

  /**
   * Normalizes the base score to the average paragraph score within
   * topNode, so long articles with many paragraphs don't unfairly dominate
   * the sibling-inclusion threshold.
   */
  private getSiblingsScore(topNode: DomElement): number {
    let base = 100_000;
    let paragraphsNumber = 0;
    let paragraphsScore = 0;
    const nodesToCheck = this.parser.getElementsByTag(topNode, { tag: "p" });

    for (const node of nodesToCheck) {
      const textNode = this.parser.getText(node);
      const wordStats = new this.stopwordsClass(this.getLanguage()).getStopwordCount(textNode);
      const highLinkDensity = this.isHighlinkDensity(node);
      if (wordStats.getStopwordCount() > 2 && !highLinkDensity) {
        paragraphsNumber += 1;
        paragraphsScore += wordStats.getStopwordCount();
      }
    }

    if (paragraphsNumber > 0) {
      base = Math.trunc(paragraphsScore / paragraphsNumber);
    }

    return base;
  }

  private updateScore(node: DomElement, addToScore: number): void {
    let currentScore = 0;
    const scoreString = this.parser.getAttribute(node, "gravityScore");
    if (scoreString) currentScore = Math.trunc(Number.parseFloat(scoreString));
    const newScore = currentScore + addToScore;
    this.parser.setAttribute(node, "gravityScore", String(newScore));
  }

  private updateNodeCount(node: DomElement, addToCount: number): void {
    let currentScore = 0;
    const countString = this.parser.getAttribute(node, "gravityNodes");
    if (countString) currentScore = Number.parseInt(countString, 10);
    const newScore = currentScore + addToCount;
    this.parser.setAttribute(node, "gravityNodes", String(newScore));
  }

  /** Checks whether a node is mostly link text -- lots of text but mostly linky. */
  isHighlinkDensity(e: DomElement): boolean {
    const links = this.parser.getElementsByTag(e, { tag: "a" });
    if (links.length === 0) return false;

    const text = this.parser.getText(e);
    const wordsNumber = text.split(" ").length;

    const linkText = links.map((link) => this.parser.getText(link)).join("");
    const numberOfLinkWords = linkText.split(" ").length;
    const numberOfLinks = links.length;
    const linkDivisor = numberOfLinkWords / wordsNumber;
    const score = linkDivisor * numberOfLinks;
    return score >= 1.0;
  }

  getScore(node: DomElement): number {
    return this.getNodeGravityScore(node) ?? 0;
  }

  private getNodeGravityScore(node: DomElement): number | null {
    const scoreString = this.parser.getAttribute(node, "gravityScore");
    if (!scoreString) return null;
    return Math.trunc(Number.parseFloat(scoreString));
  }

  private nodesToCheck(doc: DomElement): DomElement[] {
    let nodes: DomElement[] = [];
    for (const tag of ["p", "pre", "td"]) {
      nodes = nodes.concat(this.parser.getElementsByTag(doc, { tag }));
    }
    return nodes;
  }

  private isTableAndNoParaExist(e: DomElement): boolean {
    const subParagraphs = this.parser.getElementsByTag(e, { tag: "p" });
    for (const p of subParagraphs) {
      if (this.parser.getText(p).length < 25) this.parser.remove(p);
    }

    const subParagraphs2 = this.parser.getElementsByTag(e, { tag: "p" });
    return subParagraphs2.length === 0 && e.name !== "td";
  }

  private isNodescoreThresholdMet(node: DomElement, e: DomElement): boolean {
    const topNodeScore = this.getScore(node);
    const currentNodescore = this.getScore(e);
    const thresholdScore = topNodeScore * 0.08;
    return !(currentNodescore < thresholdScore && e.name !== "td");
  }

  /** Removes divs that look like non-content: link clusters, empty tables, low-score fragments. */
  postCleanup(): DomElement {
    const targetNode = this.article.topNode!;
    const node = this.addSiblings(targetNode);
    for (const e of this.parser.getChildren(node)) {
      if (!("name" in e)) continue;
      const el = e as DomElement;
      if (el.name !== "p") {
        if (
          this.isHighlinkDensity(el) ||
          this.isTableAndNoParaExist(el) ||
          !this.isNodescoreThresholdMet(node, el)
        ) {
          this.parser.remove(el);
        }
      }
    }
    return node;
  }
}
