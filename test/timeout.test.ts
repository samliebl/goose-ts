import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Configuration } from "../src/Configuration.js";
import { Goose } from "../src/Goose.js";
import { ImageUtils } from "../src/utils/images.js";
import { loadFixture } from "./helpers/fixtures.js";

// Covers the overall-extraction time budget (Configuration.deadlineAt /
// remainingMs) added after real image-heavy pages (CNN, BBC) were observed
// hanging for minutes: image scoring fetches candidates one at a time (see
// ImagesExtractor), and without a shared clock across those requests, a
// slow or image-heavy page had no bound on total wall-clock time even
// though every individual fetch was itself bounded by httpTimeout.

describe("Configuration overall timeout budget", () => {
  it("remainingMs() counts down and floors at zero, never negative", async () => {
    const config = new Configuration({ overallTimeoutMs: 30 });
    expect(config.remainingMs()).toBeGreaterThan(0);
    expect(config.remainingMs()).toBeLessThanOrEqual(30);

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(config.remainingMs()).toBe(0);
  });

  it("defaults to a 20s budget when unset", () => {
    const config = new Configuration();
    expect(config.remainingMs()).toBeGreaterThan(19_000);
    expect(config.remainingMs()).toBeLessThanOrEqual(20_000);
  });
});

describe("ImageUtils.fetchImageInfo respects the overall budget", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips the request entirely once the budget is already spent", async () => {
    const config = new Configuration({ overallTimeoutMs: -1 }); // already expired
    const result = await ImageUtils.fetchImageInfo("https://example.com/photo.jpg", config);

    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Article.timedOut", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is set when the overall budget is already spent by the time image scoring runs", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));

    const { html, data } = loadFixture("images/test_basic_image", "test_basic_image");
    const config = new Configuration({ enableImageFetching: true, overallTimeoutMs: -1 });
    const article = await new Goose(config).extract({ url: data.url, rawHtml: html });

    expect(article.timedOut).toBe(true);
    // Image scoring bailed before ever starting a request.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stays false on a normal, well-within-budget extraction", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 404 }));

    const { html, data } = loadFixture("images/test_basic_image", "test_basic_image");
    const config = new Configuration({ enableImageFetching: true });
    const article = await new Goose(config).extract({ url: data.url, rawHtml: html });

    expect(article.timedOut).toBe(false);
  });
});
