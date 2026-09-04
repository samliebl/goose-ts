import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Image } from "../../src/Image.js";
import { FIXTURES_ROOT, loadFixture } from "../helpers/fixtures.js";
import { Configuration } from "../../src/Configuration.js";
import { Goose } from "../../src/Goose.js";

const FIELD_MAP: Record<string, keyof Image> = {
  extraction_type: "extractionType",
  src: "src",
  confidence_score: "confidenceScore",
  bytes: "bytes",
  height: "height",
  width: "width",
};

/** Finds the single binary fixture file alongside a fixture's .html/.json, if any. */
function findBinaryFixture(dir: string): Buffer | null {
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).find((f) => !f.endsWith(".html") && !f.endsWith(".json"));
  return file ? readFileSync(join(dir, file)) : null;
}

const FIXTURES = [
  "test_basic_image",
  "test_known_image_css_class",
  "test_known_image_css_id",
  "test_known_image_css_parent_class",
  "test_known_image_css_parent_id",
  "test_known_image_empty_src",
  "test_known_image_name_parent",
  "test_opengraph_tag",
];

describe("ImagesExtractor (fixtures)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const name of FIXTURES) {
    it(name, async () => {
      const dir = join(FIXTURES_ROOT, "images", name);
      const binary = findBinaryFixture(dir);

      vi.mocked(fetch).mockImplementation(async () => {
        if (binary) {
          return new Response(binary, { status: 200, headers: { "content-type": "image/jpeg" } });
        }
        return new Response(null, { status: 404 });
      });

      const { html, data } = loadFixture(`images/${name}`, name);
      const config = new Configuration({ enableImageFetching: true });
      const article = await new Goose(config).extract({ url: data.url, rawHtml: html });

      const expectedImage = data.expected["top_image"] as Record<string, unknown>;
      for (const [field, value] of Object.entries(expectedImage)) {
        if (field === "top_image_node") continue;
        const key = FIELD_MAP[field];
        if (!key) throw new Error(`Unmapped field: ${field}`);
        expect(article.topImage?.[key]).toBe(value);
      }

      if (typeof data.expected["cleaned_text"] === "string") {
        const expectedText = data.expected["cleaned_text"] as string;
        expect(article.cleanedText.slice(0, expectedText.length)).toBe(expectedText);
      }
    });
  }
});
