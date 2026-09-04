import { BaseExtractor } from "./BaseExtractor.js";

const RE_LANG = /^[A-Za-z]{2}$/;

export interface MetasResult {
  description: string;
  keywords: string;
  lang: string | null;
  favicon: string;
  canonical: string;
  domain: string | null;
}

/** Port of goose.extractors.metas.MetasExtractor. */
export class MetasExtractor extends BaseExtractor {
  private getDomain(): string | null {
    if (!this.article.finalUrl) return null;
    try {
      return new URL(this.article.finalUrl).hostname || null;
    } catch {
      return null;
    }
  }

  private getFavicon(): string {
    const meta = this.parser.getElementsByTag(this.article.doc!, {
      tag: "link",
      attr: "rel",
      value: "icon",
    });
    if (meta.length) return this.parser.getAttribute(meta[0]!, "href") ?? "";
    return "";
  }

  private getCanonicalLink(): string {
    if (this.article.finalUrl) {
      const meta = this.parser.getElementsByTag(this.article.doc!, {
        tag: "link",
        attr: "rel",
        value: "canonical",
      });
      if (meta.length > 0) {
        let href = this.parser.getAttribute(meta[0]!, "href");
        if (href) {
          href = href.trim();
          try {
            const parsed = new URL(href);
            if (!parsed.hostname) throw new Error("relative");
          } catch {
            try {
              const finalUrl = new URL(this.article.finalUrl);
              href = new URL(href, `${finalUrl.protocol}//${finalUrl.hostname}`).toString();
            } catch {
              // leave href as-is if we can't resolve it
            }
          }
          return href;
        }
      }
    }
    return this.article.finalUrl;
  }

  private getMetaLang(): string | null {
    let attr = this.parser.getAttribute(this.article.doc!, "lang");
    if (attr === null) {
      const items: Array<{ tag: string; attr: string; value: string }> = [
        { tag: "meta", attr: "http-equiv", value: "content-language" },
        { tag: "meta", attr: "name", value: "lang" },
      ];
      for (const item of items) {
        const meta = this.parser.getElementsByTag(this.article.doc!, item);
        if (meta.length) {
          attr = this.parser.getAttribute(meta[0]!, "content");
          break;
        }
      }
    }

    if (attr) {
      const value = attr.slice(0, 2);
      if (RE_LANG.test(value)) return value.toLowerCase();
    }

    return null;
  }

  private getMetaContent(metaSelector: string): string {
    const meta = this.parser.cssSelect(this.article.doc!, metaSelector);
    let content: string | null = null;
    if (meta.length > 0) content = this.parser.getAttribute(meta[0]!, "content");
    return content ? content.trim() : "";
  }

  private getMetaDescription(): string {
    return this.getMetaContent("meta[name=description]");
  }

  private getMetaKeywords(): string {
    return this.getMetaContent("meta[name=keywords]");
  }

  extract(): MetasResult {
    return {
      description: this.getMetaDescription(),
      keywords: this.getMetaKeywords(),
      lang: this.getMetaLang(),
      favicon: this.getFavicon(),
      canonical: this.getCanonicalLink(),
      domain: this.getDomain(),
    };
  }
}
