import { describe, expect, it } from "vitest";
import { extractFixture } from "../helpers/fixtures.js";

describe("AuthorsExtractor (fixtures)", () => {
  it("test_author_schema", async () => {
    const { article, data } = await extractFixture("authors", "test_author_schema");
    const expected = new Set(data.expected["authors"] as string[]);
    const actual = new Set(article.authors);
    expect(actual).toEqual(expected);
  });
});
