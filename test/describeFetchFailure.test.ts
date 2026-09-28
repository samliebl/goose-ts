import { describe, expect, it } from "vitest";
import { Article } from "../src/Article.js";
import { describeFetchFailure } from "../src/describeFetchFailure.js";

describe("describeFetchFailure", () => {
  it("returns null when the article didn't fail", () => {
    const article = new Article();
    expect(describeFetchFailure(article)).toBeNull();
  });

  it.each([401, 403, 406, 429, 451])("calls it out as blocking for HTTP %i", (status) => {
    const article = new Article();
    article.fetchError = `HTTP ${status} Forbidden`;

    const message = describeFetchFailure(article);

    expect(message).toContain("blocking automated tools");
    expect(message).toContain(String(status));
  });

  it("calls out a 5xx as a server-side issue, not blocking", () => {
    const article = new Article();
    article.fetchError = "HTTP 500 Internal Server Error";

    const message = describeFetchFailure(article);

    expect(message).not.toContain("blocking automated tools");
    expect(message).toContain("temporary server-side issue");
    expect(message).toContain("500");
  });

  it("calls out an unrecognized 4xx as a deliberate rejection, not a glitch or confirmed blocking", () => {
    const article = new Article();
    article.fetchError = "HTTP 404 Not Found";

    const message = describeFetchFailure(article);

    expect(message).not.toContain("blocking automated tools");
    expect(message).not.toContain("temporary server-side issue");
    expect(message).toContain("deliberate rejection");
    expect(message).toContain("404");
  });

  it("does not call a network-level failure blocking", () => {
    const article = new Article();
    article.fetchError = "fetch failed";

    const message = describeFetchFailure(article);

    expect(message).not.toContain("blocking automated tools");
    expect(message).toContain("couldn't be reached");
  });

  it("explains a timeout as a non-blocking, processing-time problem", () => {
    const article = new Article();
    article.timedOut = true;

    const message = describeFetchFailure(article);

    expect(message).not.toContain("blocking automated tools");
    expect(message).toContain("took too long");
  });

  it("prefers fetchError over timedOut when somehow both are set", () => {
    const article = new Article();
    article.fetchError = "HTTP 403 Forbidden";
    article.timedOut = true;

    expect(describeFetchFailure(article)).toContain("blocking automated tools");
  });
});
