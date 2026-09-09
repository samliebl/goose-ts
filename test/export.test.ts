import { describe, expect, it } from "vitest";
import type { ArticleInfos } from "../src/Article.js";
import {
  articlePlainText,
  renderArticleExport,
  renderArticlesZip,
  sanitizeFilename,
} from "../src/export.js";

// This is the single implementation behind the CLI's --format/--zip flags,
// the web dashboard's download buttons (via /api/export), and anything
// else that imports goose-ts directly -- see the module comment in
// src/export.ts. These tests are the main regression guard for it, since
// none of the three consumers exercise every code path on their own.

function makeArticle(overrides: Partial<ArticleInfos> = {}): ArticleInfos {
  return {
    meta: { description: "", lang: "en", keywords: "", favicon: "", canonical: "" },
    image: null,
    domain: "example.com",
    title: "A Test Article",
    cleanedText: "Some cleaned body text.",
    opengraph: {},
    tags: [],
    tweets: [],
    movies: [],
    links: [],
    authors: [],
    publishDate: null,
    ...overrides,
  };
}

/** Minimal reader for the store-only zip format buildZip produces -- reads local file headers sequentially, stopping at the central directory. Enough to validate our own writer without an external zip dependency. */
function readStoreZipEntries(bytes: Uint8Array): Array<{ name: string; content: string }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries: Array<{ name: string; content: string }> = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break; // reached the central directory
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const size = view.getUint32(offset + 22, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    entries.push({
      name: decoder.decode(bytes.slice(nameStart, nameStart + nameLength)),
      content: decoder.decode(bytes.slice(dataStart, dataStart + size)),
    });
    offset = dataStart + size;
  }
  return entries;
}

describe("sanitizeFilename", () => {
  it("replaces characters reserved by common filesystems", () => {
    expect(sanitizeFilename('Report: "Q1/Q2" <2024> | Final?*')).toBe(
      "Report- -Q1-Q2- -2024- - Final--",
    );
  });

  it("strips zero-width and bidi-override characters without a trace", () => {
    const zwsp = String.fromCharCode(0x200b);
    const rlo = String.fromCharCode(0x202e);
    const name = sanitizeFilename(`Report${zwsp}: Q1${rlo}Final`);
    expect(name.includes(zwsp)).toBe(false);
    expect(name.includes(rlo)).toBe(false);
  });

  it("leaves non-Latin scripts untouched", () => {
    expect(sanitizeFilename("人工知能の未来について")).toBe("人工知能の未来について");
  });

  it("falls back when the cleaned name is empty", () => {
    expect(sanitizeFilename("", "article")).toBe("article");
    expect(sanitizeFilename("   ", "article")).toBe("article");
  });

  it("trims a trailing dot or space (Windows disallows both)", () => {
    expect(sanitizeFilename("weird name.  ")).toBe("weird name");
  });
});

describe("articlePlainText", () => {
  it("includes title, byline, source, and the cleaned text", () => {
    const article = makeArticle({
      authors: ["Jane Doe"],
      publishDate: "2024-01-01",
      meta: {
        description: "",
        lang: "en",
        keywords: "",
        favicon: "",
        canonical: "https://example.com/a",
      },
    });
    const text = articlePlainText(article, "https://example.com/fallback");
    expect(text).toBe(
      "A Test Article\nBy Jane Doe — 2024-01-01\nhttps://example.com/a\n\nSome cleaned body text.",
    );
  });

  it("falls back to the label when there's no canonical URL", () => {
    const article = makeArticle();
    const text = articlePlainText(article, "https://example.com/fallback");
    expect(text.split("\n")).toContain("https://example.com/fallback");
  });
});

describe("renderArticleExport", () => {
  it("text format: UTF-8 with a leading BOM, matching content, .txt extension", () => {
    const article = makeArticle({ title: "Café — 中文" });
    const result = renderArticleExport(article, "https://example.com/a", "text");

    expect(result.filename).toBe("Café — 中文.txt");
    expect(result.mime).toBe("text/plain;charset=utf-8");
    expect([...result.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    const decoded = new TextDecoder().decode(result.bytes.slice(3));
    expect(decoded).toContain("Café — 中文");
  });

  it("json format: no BOM, valid JSON matching the article", () => {
    const article = makeArticle();
    const result = renderArticleExport(article, "https://example.com/a", "json");

    expect(result.filename).toBe("A Test Article.json");
    expect(result.mime).toBe("application/json");
    expect(result.bytes[0]).toBe(0x7b); // "{" -- no BOM before it

    expect(JSON.parse(new TextDecoder().decode(result.bytes))).toEqual(article);
  });
});

describe("renderArticlesZip", () => {
  it("bundles every item and disambiguates colliding filenames", () => {
    const items = [
      { article: makeArticle({ title: "Same Title", domain: "a.com" }), label: "https://a.com/" },
      { article: makeArticle({ title: "Same Title", domain: "b.com" }), label: "https://b.com/" },
      { article: makeArticle({ title: "Different", domain: "c.com" }), label: "https://c.com/" },
    ];

    const result = renderArticlesZip(items, "text");
    expect(result.filename).toBe("articles-text.zip");
    expect(result.mime).toBe("application/zip");

    const entries = readStoreZipEntries(result.bytes);
    expect(entries.map((e) => e.name)).toEqual([
      "Same Title.txt",
      "Same Title (2).txt",
      "Different.txt",
    ]);
    expect(entries[0]!.content).toContain("a.com");
    expect(entries[1]!.content).toContain("b.com");
  });

  it("round-trips JSON entries byte-for-byte through the zip", () => {
    const article = makeArticle({ title: "Roundtrip", cleanedText: "Café — 中文 🎉" });
    const result = renderArticlesZip([{ article, label: "https://example.com/" }], "json");

    const [entry] = readStoreZipEntries(result.bytes);
    expect(entry!.name).toBe("Roundtrip.json");
    expect(JSON.parse(entry!.content)).toEqual(article);
  });
});
