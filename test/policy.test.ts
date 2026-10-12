import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockedUrlError } from "../src/index.js";
import { guardedFetch } from "../src/safeFetch.js";
import {
  blockedDomains,
  buildConfiguration,
  createUrlGuard,
  isAllowlistedHost,
  LIMITS,
  SERVER_USER_AGENT,
} from "../web/policy.js";

describe("isAllowlistedHost", () => {
  it.each(["wikipedia.org", "en.wikipedia.org", "EN.Wikipedia.org.", "www.nasa.gov"])(
    "allows %s",
    (host) => {
      expect(isAllowlistedHost(host)).toBe(true);
    },
  );

  it.each(["evilwikipedia.org", "wikipedia.org.evil.com", "notnasa.gov", "example.com", ""])(
    "rejects lookalike or unlisted %j",
    (host) => {
      expect(isAllowlistedHost(host)).toBe(false);
    },
  );
});

describe("blockedDomains", () => {
  it("parses a comma-separated list, trimming and lowercasing", () => {
    expect(blockedDomains(" A.com, b.ORG ,, ")).toEqual(["a.com", "b.org"]);
    expect(blockedDomains(undefined)).toEqual([]);
  });
});

describe("createUrlGuard", () => {
  it("lets anonymous visitors reach only allowlisted hosts, without even running the network check for others", async () => {
    const safe = vi.fn(async () => {});
    const guard = createUrlGuard("anon", safe, []);

    await expect(guard("https://en.wikipedia.org/wiki/Goose")).resolves.toBeUndefined();
    await expect(guard("https://example.com/")).rejects.toThrow(/public demo/);
    await expect(guard("http://169.254.169.254/")).rejects.toThrow(BlockedUrlError);
    expect(safe).toHaveBeenCalledTimes(1);
  });

  it("still runs the network safety check on allowlisted hosts", async () => {
    const safe = vi.fn(async () => {
      throw new BlockedUrlError("That host resolves to an address that isn't allowed.");
    });
    await expect(createUrlGuard("anon", safe, [])("https://en.wikipedia.org/")).rejects.toThrow(
      /resolves/,
    );
  });

  it("lets signed-in members reach any host that passes the network check", async () => {
    const safe = vi.fn(async () => {});
    const guard = createUrlGuard("member", safe, []);
    await expect(guard("https://example.com/")).resolves.toBeUndefined();
    expect(safe).toHaveBeenCalledWith("https://example.com/");
  });

  it("checks each hostname once per extraction, so image-heavy pages don't re-resolve DNS per image", async () => {
    const safe = vi.fn(async () => {});
    const guard = createUrlGuard("member", safe, []);
    await guard("https://cdn.example.com/a.jpg");
    await guard("https://cdn.example.com/b.jpg");
    await guard("https://other.example.com/c.jpg");
    expect(safe).toHaveBeenCalledTimes(2);
  });

  it("honors the owner's blocklist for every tier, subdomains included", async () => {
    const safe = vi.fn(async () => {});
    for (const tier of ["anon", "member"] as const) {
      const guard = createUrlGuard(tier, safe, ["wikipedia.org"]);
      await expect(guard("https://en.wikipedia.org/wiki/Goose")).rejects.toThrow(/asked regoose/);
    }
    expect(safe).not.toHaveBeenCalled();
  });

  it("rejects an unparseable URL", async () => {
    await expect(createUrlGuard("member", async () => {}, [])("nonsense")).rejects.toThrow(
      BlockedUrlError,
    );
  });
});

describe("a redirect can't carry an anonymous visitor off the allowlist", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks a hop from an allowlisted site to anywhere else, before fetching it", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://example.com/landing" } }),
    );
    const config = buildConfiguration(
      "anon",
      {},
      createUrlGuard("anon", async () => {}, []),
    );

    await expect(
      guardedFetch("https://en.wikipedia.org/wiki/Goose", config, { maxBytes: 1000 }),
    ).rejects.toThrow(/public demo/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("buildConfiguration", () => {
  const guard = async () => {};

  it("never fetches images for anonymous visitors, however they ask", () => {
    expect(
      buildConfiguration("anon", { enableImageFetching: true }, guard).enableImageFetching,
    ).toBe(false);
  });

  it("fetches images for members unless they opt out", () => {
    expect(buildConfiguration("member", {}, guard).enableImageFetching).toBe(true);
    expect(
      buildConfiguration("member", { enableImageFetching: false }, guard).enableImageFetching,
    ).toBe(false);
  });

  it.each([
    [999_999_999, 12_000],
    [5, 1_000],
    [7_000, 7_000],
    ["abc", 12_000],
    [undefined, 12_000],
  ])("clamps a requested httpTimeout of %j to %i", (requested, expected) => {
    const config = buildConfiguration("member", { httpTimeout: requested as number }, guard);
    expect(config.httpTimeout).toBe(expected);
  });

  it("only accepts a bare two-letter language code", () => {
    expect(buildConfiguration("member", { targetLanguage: "fr" }, guard).targetLanguage).toBe("fr");
    for (const bad of ["../../etc/passwd", "english", "EN", "", "f"]) {
      expect(buildConfiguration("member", { targetLanguage: bad }, guard).targetLanguage).toBe(
        "en",
      );
    }
  });

  it("ignores every setting a visitor shouldn't control", () => {
    const hostile = {
      browserUserAgent: "Mozilla/5.0 (pretending to be a browser)",
      overallTimeoutMs: 1e9,
      maxResponseBytes: 1e12,
      maxImageBytes: 1e12,
      maxRedirects: 1000,
      respectRobotsTxt: false,
      urlGuard: async () => {},
    };
    const config = buildConfiguration("member", hostile, guard);

    expect(config.browserUserAgent).toBe(SERVER_USER_AGENT);
    expect(config.remainingMs()).toBeLessThanOrEqual(20_000);
    expect(config.maxResponseBytes).toBe(LIMITS.member.maxResponseBytes);
    expect(config.maxImageBytes).toBe(8_000_000);
    expect(config.maxRedirects).toBe(5);
    expect(config.respectRobotsTxt).toBe(true);
    expect(config.urlGuard).toBe(guard);
  });

  it("tolerates a non-object config", () => {
    expect(() => buildConfiguration("anon", "nope" as never, guard)).not.toThrow();
    expect(() => buildConfiguration("anon", null as never, guard)).not.toThrow();
  });
});

describe("LIMITS", () => {
  it("keeps the anonymous tier strictly tighter than members, and the owner uncapped per day", () => {
    expect(LIMITS.anon.ratePerWindow).toBeLessThan(LIMITS.member.ratePerWindow);
    expect(LIMITS.anon.dailyCap).toBeLessThan(LIMITS.member.dailyCap);
    expect(LIMITS.anon.maxRawHtmlChars).toBeLessThanOrEqual(LIMITS.member.maxRawHtmlChars);
    expect(LIMITS.owner.dailyCap).toBe(Number.POSITIVE_INFINITY);
  });
});
