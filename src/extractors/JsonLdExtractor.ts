import { BaseExtractor } from "./BaseExtractor.js";

// schema.org Article and its common subtypes.
const ARTICLE_TYPES = new Set([
  "article",
  "newsarticle",
  "blogposting",
  "report",
  "techarticle",
  "scholarlyarticle",
  "socialmediaposting",
  "advertisercontentarticle",
  "reviewarticle",
  "satiricalarticle",
  "opinionnewsarticle",
  "analysisnewsarticle",
]);

export interface JsonLdArticleData {
  title: string | null;
  text: string | null;
  description: string | null;
  authors: string[];
  publishDate: string | null;
  tags: string[];
  imageUrl: string | null;
}

type JsonRecord = Record<string, unknown>;

function typeMatches(type: unknown): boolean {
  if (typeof type === "string") return ARTICLE_TYPES.has(type.toLowerCase());
  if (Array.isArray(type)) return type.some(typeMatches);
  return false;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function namesFrom(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(namesFrom);
  if (typeof value === "string") return [value];
  if (typeof value === "object") {
    const name = (value as JsonRecord)["name"];
    return typeof name === "string" ? [name] : [];
  }
  return [];
}

function imageUrlFrom(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) return imageUrlFrom(value[0]);
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const url = (value as JsonRecord)["url"];
    return typeof url === "string" ? url : null;
  }
  return null;
}

function tagsFrom(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Fallback extractor: reads schema.org Article/NewsArticle/BlogPosting data
 * out of <script type="application/ld+json"> blocks. Publishers embed this
 * for search engines and social-media link previews regardless of how the
 * page is rendered, so it's present -- and static, no JS execution needed
 * to read it -- even on pages where the visible content is built entirely
 * client-side and ContentExtractor's DOM scoring has nothing to find.
 *
 * Deliberately narrow: only used by Crawler as a fallback when the normal
 * DOM-scored result comes back empty or too thin to be a real article (see
 * MIN_SUBSTANTIAL_TEXT_LENGTH in Crawler.ts), never as a replacement for a
 * DOM-scored result that actually found something.
 */
export class JsonLdExtractor extends BaseExtractor {
  extract(): JsonLdArticleData | null {
    // rawDoc, not doc: DocumentCleaner strips all <script> tags (see
    // Cleaners.ts removeScriptsStyles) before this fallback ever runs.
    const scripts = this.parser.getElementsByTag(this.article.rawDoc!, {
      tag: "script",
      attr: "type",
      value: "^application/ld\\+json$",
    });

    for (const script of scripts) {
      const raw = this.parser.getRawText(script);
      if (!raw.trim()) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }

      const node = this.findArticleNode(parsed);
      if (node) return this.toArticleData(node);
    }

    return null;
  }

  private findArticleNode(value: unknown): JsonRecord | null {
    for (const candidate of this.flatten(value)) {
      if (typeMatches(candidate["@type"])) return candidate;
    }
    return null;
  }

  /** Walks arrays and @graph wrappers to find every candidate node, schema.org-JSON-LD-shaped or not. */
  private *flatten(value: unknown): Generator<JsonRecord> {
    if (Array.isArray(value)) {
      for (const item of value) yield* this.flatten(item);
      return;
    }
    if (value && typeof value === "object") {
      const obj = value as JsonRecord;
      yield obj;
      if (Array.isArray(obj["@graph"])) yield* this.flatten(obj["@graph"]);
    }
  }

  private toArticleData(node: JsonRecord): JsonLdArticleData {
    return {
      title: asString(node["headline"]) ?? asString(node["name"]),
      text: asString(node["articleBody"]),
      description: asString(node["description"]),
      authors: namesFrom(node["author"]),
      publishDate: asString(node["datePublished"]) ?? asString(node["dateCreated"]),
      tags: tagsFrom(node["keywords"]),
      imageUrl: imageUrlFrom(node["image"]),
    };
  }
}
