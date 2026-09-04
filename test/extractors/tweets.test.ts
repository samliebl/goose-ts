import { describe, expect, it } from "vitest";
import { extractFixture } from "../helpers/fixtures.js";

describe("TweetsExtractor (fixtures)", () => {
  it("test_tweet", async () => {
    const { article, data } = await extractFixture("tweets", "test_tweet");
    expect(article.tweets.length).toBe(data.expected["tweets"]);
  });
});
