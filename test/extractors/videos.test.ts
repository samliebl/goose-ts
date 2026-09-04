import { describe, expect, it } from "vitest";
import type { Video } from "../../src/Video.js";
import { extractFixture } from "../helpers/fixtures.js";

const FIELD_MAP: Record<string, keyof Video> = {
  embed_type: "embedType",
  provider: "provider",
  width: "width",
  height: "height",
  embed_code: "embedCode",
  src: "src",
};

const FIXTURES = ["test_embed", "test_iframe", "test_object"];

describe("VideosExtractor (fixtures)", () => {
  for (const name of FIXTURES) {
    it(name, async () => {
      const { article, data } = await extractFixture("videos", name);
      const expected = data.expected["movies"] as Array<Record<string, string>>;
      expect(article.movies.length).toBe(expected.length);
      for (let i = 0; i < expected.length; i++) {
        for (const [field, value] of Object.entries(expected[i]!)) {
          const key = FIELD_MAP[field];
          if (!key) throw new Error(`Unmapped field: ${field}`);
          expect(article.movies[i]![key]).toBe(value);
        }
      }
    });
  }
});
