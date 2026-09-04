import { describe, expect, it } from "vitest";
import { extractFixture } from "../helpers/fixtures.js";

const FIXTURES = [
  "test_publish_date",
  "test_publish_date_rnews",
  "test_publish_date_article",
  "test_publish_date_schema",
];

describe("PublishDateExtractor (fixtures)", () => {
  for (const name of FIXTURES) {
    it(name, async () => {
      const { article, data } = await extractFixture("publishdate", name);
      expect(article.publishDate).toBe(data.expected["publish_date"]);
    });
  }
});
