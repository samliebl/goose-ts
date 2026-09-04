import { describe, expect, it } from "vitest";
import { extractFixture } from "../helpers/fixtures.js";

describe("TitleExtractor (fixtures)", () => {
  it("test_title_opengraph", async () => {
    const { article, data } = await extractFixture("title", "test_title_opengraph");
    expect(article.title).toBe(data.expected["title"]);
  });

  it("test_title_empty", async () => {
    const { article, data } = await extractFixture("title", "test_title_empty");
    expect(article.title).toBe(data.expected["title"]);
  });
});
