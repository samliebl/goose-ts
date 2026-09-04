import { describe, expect, it } from "vitest";
import { extractFixture } from "../helpers/fixtures.js";

const FIXTURES = [
  "test_tags_kexp",
  "test_tags_deadline",
  "test_tags_wnyc",
  "test_tags_cnet",
  "test_tags_abcau",
];

describe("TagsExtractor (fixtures)", () => {
  for (const name of FIXTURES) {
    it(name, async () => {
      const { article, data } = await extractFixture("tags", name);
      const expected = new Set(data.expected["tags"] as string[]);
      const actual = new Set(article.tags);
      expect(actual.size).toBe(expected.size);
      for (const tag of actual) expect(expected.has(tag)).toBe(true);
    });
  }
});
