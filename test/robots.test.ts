import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Configuration } from "../src/Configuration.js";
import {
  assertRobotsAllowed,
  clearRobotsCache,
  isPathAllowed,
  parseRobots,
  productToken,
  RobotsDisallowedError,
} from "../src/robots.js";

const UA = "regoose/0.2.0 (+https://regoose.com/about)";

describe("productToken", () => {
  it("takes the product name from a full User-Agent", () => {
    expect(productToken(UA)).toBe("regoose");
    expect(productToken("goose-ts/0.2.0")).toBe("goose-ts");
  });
});

describe("parseRobots / isPathAllowed", () => {
  const allowed = (txt: string, path: string, token = "regoose") =>
    isPathAllowed(parseRobots(txt, token), path);

  it("allows everything when there are no rules or the Disallow is empty", () => {
    expect(allowed("", "/anything")).toBe(true);
    expect(allowed("User-agent: *\nDisallow:", "/anything")).toBe(true);
  });

  it("applies the * group when no group names us", () => {
    const txt = "User-agent: *\nDisallow: /private/";
    expect(allowed(txt, "/private/x")).toBe(false);
    expect(allowed(txt, "/public/x")).toBe(true);
  });

  it("lets a group naming us override * entirely", () => {
    const txt = "User-agent: *\nDisallow: /\n\nUser-agent: regoose\nDisallow: /secret";
    expect(allowed(txt, "/article")).toBe(true);
    expect(allowed(txt, "/secret/x")).toBe(false);
  });

  it("treats a named group with no rules as allowing everything, still beating *", () => {
    const txt = "User-agent: *\nDisallow: /\n\nUser-agent: regoose\nDisallow:";
    expect(allowed(txt, "/article")).toBe(true);
  });

  it("blocks us by name even when * allows", () => {
    const txt = "User-agent: regoose\nDisallow: /\n\nUser-agent: *\nDisallow:";
    expect(allowed(txt, "/article")).toBe(false);
  });

  it("applies one group to several consecutive user-agent lines", () => {
    const txt = "User-agent: googlebot\nUser-agent: regoose\nDisallow: /x";
    expect(allowed(txt, "/x/1")).toBe(false);
  });

  it("uses the longest matching pattern, and Allow wins a tie", () => {
    const txt = "User-agent: *\nDisallow: /docs/\nAllow: /docs/public/";
    expect(allowed(txt, "/docs/private")).toBe(false);
    expect(allowed(txt, "/docs/public/page")).toBe(true);
    expect(allowed("User-agent: *\nDisallow: /a\nAllow: /a", "/a")).toBe(true);
  });

  it("supports * wildcards and a $ end anchor", () => {
    const txt = "User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp*/cache";
    expect(allowed(txt, "/files/report.pdf")).toBe(false);
    expect(allowed(txt, "/files/report.pdf?download=1")).toBe(true);
    expect(allowed(txt, "/tmp123/cache")).toBe(false);
  });

  it("ignores comments, blank lines, and unknown fields", () => {
    const txt = "# hi\nUser-agent: * # everyone\nCrawl-delay: 10\nDisallow: /nope # no\n";
    expect(allowed(txt, "/nope")).toBe(false);
    expect(allowed(txt, "/yes")).toBe(true);
  });
});

describe("assertRobotsAllowed", () => {
  const config = () => new Configuration({ respectRobotsTxt: true, browserUserAgent: UA });
  const robots = (body: string, status = 200) => new Response(body, { status });

  beforeEach(() => {
    clearRobotsCache();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing, and fetches nothing, when the option is off", async () => {
    await assertRobotsAllowed("https://a.example/x", new Configuration());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows a path robots.txt permits and refuses one it doesn't", async () => {
    vi.mocked(fetch).mockImplementation(async () => robots("User-agent: *\nDisallow: /private"));
    await expect(
      assertRobotsAllowed("https://a.example/news/1", config()),
    ).resolves.toBeUndefined();
    await expect(assertRobotsAllowed("https://a.example/private/1", config())).rejects.toThrow(
      RobotsDisallowedError,
    );
  });

  it("fetches robots.txt once per origin and reuses it", async () => {
    vi.mocked(fetch).mockImplementation(async () => robots("User-agent: *\nDisallow:"));
    await assertRobotsAllowed("https://a.example/1", config());
    await assertRobotsAllowed("https://a.example/2", config());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("https://a.example/robots.txt");
  });

  it("treats a missing robots.txt (404) as allowing everything", async () => {
    vi.mocked(fetch).mockImplementation(async () => robots("not found", 404));
    await expect(assertRobotsAllowed("https://a.example/x", config())).resolves.toBeUndefined();
  });

  it.each([500, 503, 429])(
    "treats a %i robots.txt as disallowing, since it can't be read",
    async (status) => {
      vi.mocked(fetch).mockImplementation(async () => robots("", status));
      await expect(assertRobotsAllowed("https://a.example/x", config())).rejects.toThrow(
        /Couldn't read/,
      );
    },
  );

  it("treats an unreachable robots.txt as disallowing", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
    await expect(assertRobotsAllowed("https://a.example/x", config())).rejects.toThrow(
      RobotsDisallowedError,
    );
  });

  it("runs robots.txt itself through the url guard", async () => {
    const guard = vi.fn(async () => {});
    vi.mocked(fetch).mockImplementation(async () => robots(""));
    const cfg = new Configuration({
      respectRobotsTxt: true,
      browserUserAgent: UA,
      urlGuard: guard,
    });
    await assertRobotsAllowed("https://a.example/x", cfg);
    expect(guard).toHaveBeenCalledWith("https://a.example/robots.txt");
  });
});
