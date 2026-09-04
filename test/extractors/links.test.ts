import { describe, expect, it } from "vitest";
import { extractFixture } from "../helpers/fixtures.js";

describe("LinksExtractor (fixtures)", () => {
  it("test_links", async () => {
    const { article, data } = await extractFixture("links", "test_links");
    expect(article.links.length).toBe(data.expected["links"]);
  });
});
