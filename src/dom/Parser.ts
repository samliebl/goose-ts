import { load, type CheerioAPI } from "cheerio";
import {
  Element as DomElement,
  Text as DomText,
  hasChildren,
  isComment,
  isTag,
  isText,
  type AnyNode,
  type ChildNode,
  type ParentNode,
} from "domhandler";
import { nextElementSibling, prevElementSibling } from "domutils";
import serialize from "dom-serializer";
import { innerTrim } from "../text.js";

export type { AnyNode, ChildNode, ParentNode };
export type { DomElement };

export interface TagQuery {
  tag?: string;
  attr?: string;
  value?: string;
  childs?: boolean;
}

function relinkChildren(parent: ParentNode): void {
  const kids = parent.children as ChildNode[];
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i]!;
    kid.parent = parent;
    kid.prev = kids[i - 1] ?? null;
    kid.next = kids[i + 1] ?? null;
  }
}

/** Descendant-or-self search over elements, document order (self visited first). */
function collectElements(root: AnyNode, predicate: (el: DomElement) => boolean): DomElement[] {
  const out: DomElement[] = [];
  const visit = (n: AnyNode): void => {
    if (isTag(n) && predicate(n)) out.push(n);
    if (hasChildren(n)) {
      for (const child of n.children) visit(child);
    }
  };
  visit(root);
  return out;
}

/**
 * Collects text runs the way lxml's itertext() effectively does: text is
 * one "piece" per element boundary crossed, not per Text node. lxml stores
 * "tail" text merged into the surrounding text flow, so consecutive text
 * with no remaining element between it (e.g. after dropTag/stripTags
 * spliced an unwrapped element's children into its parent) is one
 * contiguous run; domhandler instead leaves those as separate sibling Text
 * nodes. Merging consecutive Text-node siblings here (rather than only at
 * mutation time) reproduces that regardless of how the adjacency arose, so
 * getText's word-boundary space only lands at real element boundaries --
 * e.g. `<p>Hello<b>World</b></p>` -> "Hello World", but a stripped
 * `<a>Exercice</a>: après` -> "Exercice: après", not "Exercice : après".
 */
function collectTextPieces(node: AnyNode): string[] {
  const out: string[] = [];
  const visit = (n: AnyNode): void => {
    if (isText(n)) {
      out.push(n.data);
      return;
    }
    if (!hasChildren(n)) return;

    let buffer = "";
    const flush = (): void => {
      if (buffer) {
        out.push(buffer);
        buffer = "";
      }
    };
    for (const child of n.children) {
      if (isText(child)) {
        buffer += child.data;
      } else {
        flush();
        visit(child);
      }
    }
    flush();
  };
  visit(node);
  return out;
}

/**
 * A cheerio/domhandler-backed facade over the DOM, shaped to match
 * python-goose's `goose.parsers.Parser` (an lxml wrapper) method-for-method.
 * Keeping the same method names/semantics made translating goose's
 * extraction algorithms mechanical, since lxml's element+tail text model
 * and domhandler's real-DOM (text nodes as siblings) model differ in a few
 * places -- see dropTag/stripTags/remove, which are simpler here precisely
 * because domhandler already represents "tail" text as sibling text nodes.
 */
export class Parser {
  readonly $: CheerioAPI;
  /** The root <html> element, analogous to what lxml.html.fromstring() returns. */
  readonly doc: DomElement;

  constructor(html: string) {
    this.$ = load(html);
    const root = this.$.root()[0]!;
    const htmlEl = root.children.find((c): c is DomElement => isTag(c) && c.name === "html");
    this.doc =
      htmlEl ??
      (root.children.find(isTag) as DomElement | undefined) ??
      (root as unknown as DomElement);
  }

  cssSelect(node: AnyNode, selector: string): DomElement[] {
    return this.$(selector, node as never).toArray() as DomElement[];
  }

  dropTag(nodes: DomElement | DomElement[]): void {
    const list = Array.isArray(nodes) ? nodes : [nodes];
    for (const node of list) {
      const parent = node.parent;
      if (!parent) continue;
      const idx = parent.children.indexOf(node);
      if (idx === -1) continue;
      const kids = node.children.slice() as ChildNode[];
      parent.children.splice(idx, 1, ...kids);
      relinkChildren(parent);
    }
  }

  nodeToString(node: AnyNode): string {
    // xmlMode self-closes empty elements (<iframe .../> rather than
    // <iframe ...></iframe>), matching lxml's etree.tostring output that
    // python-goose's embed_code/tweet HTML strings were captured with.
    return serialize(node, { xmlMode: true });
  }

  replaceTag(node: DomElement, tag: string): void {
    node.name = tag;
  }

  stripTags(node: AnyNode, ...tags: string[]): void {
    this.dropTag(this.getElementsByTags(node, tags));
  }

  getElementById(node: AnyNode, id: string): DomElement | null {
    return collectElements(node, (el) => el.attribs["id"] === id)[0] ?? null;
  }

  getElementsByTag(node: AnyNode, opts: TagQuery = {}): DomElement[] {
    const { tag, attr, value, childs } = opts;
    const re = attr && value ? new RegExp(value, "i") : null;
    const matches = collectElements(node, (el) => {
      if (tag && el.name !== tag) return false;
      if (re) {
        const av = el.attribs[attr!];
        if (av === undefined || !re.test(av)) return false;
      }
      return true;
    });
    if (tag || childs) {
      const idx = matches.indexOf(node as DomElement);
      if (idx !== -1) matches.splice(idx, 1);
    }
    return matches;
  }

  appendChild(node: ParentNode, child: ChildNode): void {
    node.children.push(child);
    relinkChildren(node);
  }

  childNodes(node: ParentNode): ChildNode[] {
    return node.children.slice() as ChildNode[];
  }

  /**
   * python-goose synthesizes pseudo text-nodes from lxml's tail-text model
   * here; domhandler already stores text as real sibling nodes, so this is
   * just the node's children.
   */
  childNodesWithText(node: ParentNode): ChildNode[] {
    return this.childNodes(node);
  }

  textToPara(text: string): DomElement {
    const frag$ = load(`<span>${text}</span>`, null, false);
    return frag$("span")[0] as DomElement;
  }

  getChildren(node: ParentNode): ChildNode[] {
    return this.childNodes(node);
  }

  getElementsByTags(node: AnyNode, tags: string[]): DomElement[] {
    // Mirrors python-goose's cssselect(','.join(tags)) -- "*" is the CSS
    // universal selector (matches every element), not a literal tag name.
    const wildcard = tags.includes("*");
    const set = new Set(tags);
    const matches = collectElements(node, (el) => wildcard || set.has(el.name));
    const idx = matches.indexOf(node as DomElement);
    if (idx !== -1) matches.splice(idx, 1);
    return matches;
  }

  createElement(tag = "p", text?: string | null): DomElement {
    const el = new DomElement(tag, {});
    if (text) {
      const t = new DomText(text);
      t.parent = el;
      el.children = [t];
    }
    return el;
  }

  getComments(node: AnyNode): AnyNode[] {
    const out: AnyNode[] = [];
    const visit = (n: AnyNode): void => {
      if (isComment(n)) out.push(n);
      if (hasChildren(n)) {
        for (const child of n.children) visit(child);
      }
    };
    if (hasChildren(node)) {
      for (const child of node.children) visit(child);
    }
    return out;
  }

  getParent(node: AnyNode): ParentNode | null {
    if (node === this.doc) return null;
    return (node as ChildNode).parent ?? null;
  }

  remove(node: AnyNode): void {
    const parent = (node as ChildNode).parent;
    if (!parent) return;
    const idx = parent.children.indexOf(node as ChildNode);
    if (idx === -1) return;
    parent.children.splice(idx, 1);
    relinkChildren(parent);
  }

  insertAt(parent: ParentNode, index: number, node: ChildNode): void {
    parent.children.splice(index, 0, node);
    relinkChildren(parent);
  }

  removeAllChildren(node: ParentNode): void {
    for (const kid of node.children) {
      (kid as ChildNode).parent = null;
      (kid as ChildNode).prev = null;
      (kid as ChildNode).next = null;
    }
    node.children.length = 0;
  }

  getTag(node: AnyNode): string {
    if (isText(node)) return "text";
    if (isComment(node)) return "#comment";
    return (node as DomElement).name;
  }

  getText(node: AnyNode): string {
    return innerTrim(collectTextPieces(node).join(" ").trim());
  }

  /**
   * Raw, unmangled text content -- unlike getText, does not collapse
   * whitespace or insert word-boundary spaces. Needed for content where
   * whitespace is meaningful, like JSON inside a <script> tag.
   */
  getRawText(node: AnyNode): string {
    if (!hasChildren(node)) return "";
    return node.children.map((c) => (isText(c) ? c.data : "")).join("");
  }

  previousSiblings(node: AnyNode): DomElement[] {
    const out: DomElement[] = [];
    let current = prevElementSibling(node as ChildNode);
    while (current) {
      out.push(current);
      current = prevElementSibling(current);
    }
    return out;
  }

  previousSibling(node: AnyNode): DomElement | null {
    return prevElementSibling(node as ChildNode);
  }

  nextSibling(node: AnyNode): DomElement | null {
    return nextElementSibling(node as ChildNode);
  }

  isTextNode(node: AnyNode): boolean {
    return isText(node);
  }

  getAttribute(node: AnyNode, attr?: string | null): string | null {
    if (!attr) return null;
    if (!isTag(node)) return null;
    return node.attribs[attr] ?? null;
  }

  delAttribute(node: AnyNode, attr?: string | null): void {
    if (!attr || !isTag(node)) return;
    delete node.attribs[attr];
  }

  setAttribute(node: AnyNode, attr?: string | null, value?: string | null): void {
    if (!attr || !value || !isTag(node)) return;
    node.attribs[attr] = value;
  }

  outerHtml(node: AnyNode): string {
    return this.nodeToString(node);
  }
}
