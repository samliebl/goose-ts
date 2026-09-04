import { describe, expect, it } from "vitest";
import { extractFixture } from "../helpers/fixtures.js";

describe("OpenGraphExtractor (fixtures)", () => {
  it("test_opengraph", async () => {
    const { article, data } = await extractFixture("opengraph", "test_opengraph");
    expect(article.opengraph).toEqual(data.expected["opengraph"]);
  });
});
