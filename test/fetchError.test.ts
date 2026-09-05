import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Configuration } from "../src/Configuration.js";
import { Goose } from "../src/Goose.js";

// article.fetchError distinguishes "the url couldn't be fetched at all"
// from "fetched fine, but there was nothing worth extracting" -- both of
// which otherwise produce an identical-looking empty Article. Every case
// here uses a mocked global.fetch, so none of it makes a real network
// call (see test/extractors/images.test.ts for the same pattern).

describe("Article.fetchError", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is set with the network error's message when the fetch itself fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));

    const goose = new Goose(new Configuration({ enableImageFetching: false }));
    const article = await goose.extract({ url: "https://example.com/unreachable" });

    expect(article.fetchError).toBe("fetch failed");
    expect(article.cleanedText).toBe("");
    expect(article.title).toBe("");
  });

  it("is set with the status when the response is a non-2xx (e.g. anti-bot blocking)", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("blocked", { status: 403, statusText: "Forbidden" }),
    );

    const goose = new Goose(new Configuration({ enableImageFetching: false }));
    const article = await goose.extract({ url: "https://example.com/blocked" });

    expect(article.fetchError).toBe("HTTP 403 Forbidden");
    expect(article.cleanedText).toBe("");
  });

  it("stays null when the fetch succeeds, even if extraction finds little", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("<html><body><p>short</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );

    const goose = new Goose(
      new Configuration({ enableImageFetching: false, enableJsonLdFallback: false }),
    );
    const article = await goose.extract({ url: "https://example.com/thin-page" });

    expect(article.fetchError).toBeNull();
  });

  it("stays null when extracting from rawHtml directly (no fetch involved)", async () => {
    const goose = new Goose(new Configuration({ enableImageFetching: false }));
    const article = await goose.extract({ rawHtml: "<html><body><p>hi</p></body></html>" });

    expect(article.fetchError).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
