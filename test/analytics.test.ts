import {
  existsSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bucketViewport,
  classifyUserAgent,
  flushAnalytics,
  loadEvents,
  normalizePath,
  percentile,
  primaryLanguage,
  purgeOldAnalytics,
  recordEvent,
  referrerHost,
  summarize,
  visitorHash,
  type AnalyticsEvent,
} from "../web/analytics.js";
import { readStore, resetStoreCache } from "../web/db.js";
import { useTempStore } from "./helpers/env.js";

const temp = useTempStore();
beforeEach(() => {
  temp.setup();
  resetStoreCache();
});
afterEach(() => {
  flushAnalytics();
  temp.teardown();
  resetStoreCache();
});

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  winChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  winEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
};

describe("classifyUserAgent", () => {
  it.each([
    [UA.iphone, { dev: "mobile", br: "Safari", os: "iOS" }],
    [UA.ipad, { dev: "tablet", br: "Safari", os: "iOS" }],
    [UA.androidChrome, { dev: "mobile", br: "Chrome", os: "Android" }],
    [UA.androidTablet, { dev: "tablet", br: "Chrome", os: "Android" }],
    [UA.macSafari, { dev: "desktop", br: "Safari", os: "macOS" }],
    [UA.winChrome, { dev: "desktop", br: "Chrome", os: "Windows" }],
    [UA.winEdge, { dev: "desktop", br: "Edge", os: "Windows" }],
    [UA.linuxFirefox, { dev: "desktop", br: "Firefox", os: "Linux" }],
  ])("classifies %s", (ua, expected) => {
    expect(classifyUserAgent(ua)).toEqual(expected);
  });

  it.each([UA.googlebot, "curl/8.4.0", "python-requests/2.31", "", undefined])(
    "flags %j as a bot",
    (ua) => {
      expect(classifyUserAgent(ua).dev).toBe("bot");
    },
  );
});

describe("small helpers", () => {
  it("buckets viewport widths coarsely and rejects nonsense", () => {
    expect(bucketViewport(375)).toBe("<480");
    expect(bucketViewport(600)).toBe("480-767");
    expect(bucketViewport(820)).toBe("768-1023");
    expect(bucketViewport(1280)).toBe("1024-1439");
    expect(bucketViewport(2560)).toBe("1440+");
    for (const bad of [0, -5, NaN, "wide", 99999, undefined])
      expect(bucketViewport(bad)).toBeUndefined();
  });

  it("keeps only the hostname of a referrer, and drops our own and unparseable ones", () => {
    expect(referrerHost("https://www.news.ycombinator.com/item?id=1&secret=2", "regoose.com")).toBe(
      "news.ycombinator.com",
    );
    expect(referrerHost("https://regoose.com/about", "regoose.com")).toBeUndefined();
    expect(referrerHost("https://www.regoose.com/", "regoose.com:443")).toBeUndefined();
    for (const bad of [
      "",
      "not a url",
      "javascript:alert(1)",
      "https://localhost/",
      undefined,
      5,
    ]) {
      expect(referrerHost(bad, "regoose.com")).toBeUndefined();
    }
  });

  it("takes the primary language subtag", () => {
    expect(primaryLanguage("en-US,en;q=0.9,fr;q=0.8")).toBe("en");
    expect(primaryLanguage("PT")).toBe("pt");
    expect(primaryLanguage("*")).toBeUndefined();
    expect(primaryLanguage(undefined)).toBeUndefined();
  });

  it("only names pages we serve, so a stranger can't pollute the stats", () => {
    expect(normalizePath("/about?x=1#top")).toBe("/about");
    expect(normalizePath("/privacy/")).toBe("/privacy");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("/<script>alert(1)</script>")).toBe("other");
    expect(normalizePath(42)).toBe("other");
  });

  it("computes nearest-rank percentiles", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
  });
});

describe("visitorHash", () => {
  const noon = (day: string) => new Date(`${day}T12:00:00Z`);

  it("is stable within a day for the same person and differs between people", () => {
    const a = visitorHash("1.2.3.4", "ua", noon("2026-03-01"));
    expect(visitorHash("1.2.3.4", "ua", noon("2026-03-01"))).toBe(a);
    expect(visitorHash("1.2.3.5", "ua", noon("2026-03-01"))).not.toBe(a);
    expect(visitorHash("1.2.3.4", "other-ua", noon("2026-03-01"))).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("can't link the same person across days, and keeps only the current day's salt", () => {
    const day1 = visitorHash("1.2.3.4", "ua", noon("2026-03-01"));
    const day2 = visitorHash("1.2.3.4", "ua", noon("2026-03-02"));
    expect(day2).not.toBe(day1);
    expect(readStore((s) => s.settings.analyticsSalt?.date)).toBe("2026-03-02");
  });

  it("never puts the IP in the data file", () => {
    visitorHash("203.0.113.77", "ua");
    expect(readFileSync(temp.path, "utf-8")).not.toContain("203.0.113.77");
  });
});

describe("recording", () => {
  it("writes events to a day file that can be read back, one per line", () => {
    recordEvent({ type: "pageview", tier: "anon", path: "/", dev: "mobile" });
    recordEvent({ type: "extract", tier: "member", host: "example.com", outcome: "ok", ms: 120 });
    flushAnalytics();

    const events = loadEvents(1);
    expect(events.map((e) => e.type)).toEqual(["pageview", "extract"]);
    expect(events[0]).toMatchObject({ path: "/", dev: "mobile" });
    expect(typeof events[0]!.t).toBe("string");
  });

  it("skips a damaged line instead of failing", () => {
    recordEvent({ type: "boot", tier: "system" });
    flushAnalytics();
    const day = new Date().toISOString().slice(0, 10);
    const file = join(temp.dir, "analytics", `${day}.ndjson`);
    writeFileSync(file, `${readFileSync(file, "utf-8")}{"half written\n`);
    expect(loadEvents(1)).toHaveLength(1);
  });

  it("deletes day files past the retention window and keeps recent ones", () => {
    const folder = join(temp.dir, "analytics");
    mkdirSync(folder, { recursive: true });
    const now = new Date("2026-06-30T00:00:00Z");
    for (const day of ["2026-01-01", "2026-03-31", "2026-04-02", "2026-06-29"]) {
      writeFileSync(join(folder, `${day}.ndjson`), "{}\n");
    }
    writeFileSync(join(folder, "notes.txt"), "keep me");
    utimesSync(join(folder, "notes.txt"), now, now);

    expect(purgeOldAnalytics(now, 90)).toBe(2);
    expect(readdirSync(folder).sort()).toEqual([
      "2026-04-02.ndjson",
      "2026-06-29.ndjson",
      "notes.txt",
    ]);
    expect(existsSync(join(folder, "2026-01-01.ndjson"))).toBe(false);
  });
});

describe("summarize", () => {
  const now = new Date("2026-05-10T15:00:00Z");
  const ev = (
    day: string,
    e: Partial<AnalyticsEvent> & Pick<AnalyticsEvent, "type">,
  ): AnalyticsEvent => ({
    t: `${day}T10:00:00.000Z`,
    tier: "anon",
    ...e,
  });

  const events: AnalyticsEvent[] = [
    ev("2026-05-10", {
      type: "pageview",
      v: "a",
      path: "/",
      dev: "mobile",
      br: "Safari",
      os: "iOS",
      lang: "en",
      vw: "<480",
      cs: "dark",
      ref: "news.ycombinator.com",
    }),
    ev("2026-05-10", {
      type: "pageview",
      v: "b",
      path: "/about",
      dev: "desktop",
      br: "Chrome",
      os: "macOS",
      lang: "en",
      vw: "1440+",
      cs: "light",
    }),
    ev("2026-05-10", {
      type: "extract",
      v: "a",
      mode: "url",
      host: "en.wikipedia.org",
      outcome: "ok",
      ms: 400,
    }),
    ev("2026-05-10", {
      type: "extract",
      v: "a",
      mode: "url",
      host: "en.wikipedia.org",
      outcome: "ok",
      ms: 800,
    }),
    ev("2026-05-10", { type: "extract", v: "b", mode: "paste", outcome: "ok", ms: 20 }),
    ev("2026-05-10", {
      type: "extract",
      v: "a",
      mode: "url",
      host: "reuters.com",
      outcome: "robots",
      ms: 90,
    }),
    ev("2026-05-10", {
      type: "extract",
      v: "b",
      mode: "url",
      host: "nytimes.com",
      outcome: "demo-only",
      ms: 1,
    }),
    ev("2026-05-10", { type: "export", v: "a", fmt: "text" }),
    ev("2026-05-10", { type: "ratelimit" }),
    ev("2026-05-09", {
      type: "pageview",
      v: "a",
      path: "/",
      dev: "mobile",
      br: "Safari",
      os: "iOS",
    }),
    ev("2026-05-09", { type: "boot", tier: "system" }),
    ev("2026-05-09", { type: "pageview", v: "bot1", path: "/", dev: "bot" }),
    ev("2026-04-01", { type: "pageview", v: "old", path: "/", dev: "desktop" }),
  ];

  const s = summarize(events, 7, now);

  it("counts totals over the range, ignoring bots and events outside it", () => {
    expect(s.totals).toMatchObject({
      pageviews: 3,
      extractions: 5,
      extractionsOk: 3,
      exports: 1,
      rateLimited: 1,
      boots: 1,
    });
    expect(s.eventCount).toBe(11);
  });

  it("counts visitors per day and sums them, so a returning person counts once a day", () => {
    expect(s.totals.visitors).toBe(3); // a,b on the 10th; a on the 9th
    expect(s.daily).toHaveLength(7);
    expect(s.daily.at(-1)).toEqual({
      date: "2026-05-10",
      visitors: 2,
      pageviews: 2,
      extractions: 5,
    });
    expect(s.daily.at(-2)).toMatchObject({ date: "2026-05-09", visitors: 1, pageviews: 1 });
  });

  it("breaks pageviews down by page, referrer, device, browser, OS, language and screen", () => {
    expect(s.pages[0]).toEqual({ key: "/", count: 2 });
    expect(s.referrers).toEqual([{ key: "news.ycombinator.com", count: 1 }]);
    expect(s.devices).toEqual([
      { key: "mobile", count: 2 },
      { key: "desktop", count: 1 },
    ]);
    expect(s.browsers[0]).toEqual({ key: "Safari", count: 2 });
    expect(s.viewports.map((v) => v.key).sort()).toEqual(["1440+", "<480"]);
    expect(s.colorSchemes.map((v) => v.key).sort()).toEqual(["dark", "light"]);
  });

  it("separates what was fetched, what sites refused, and what visitors wanted that the demo won't fetch", () => {
    expect(s.hosts).toEqual([{ key: "en.wikipedia.org", count: 2 }]);
    expect(s.refusedHosts).toEqual([{ key: "reuters.com", count: 1 }]);
    expect(s.wantedHosts).toEqual([{ key: "nytimes.com", count: 1 }]);
    expect(s.outcomes.find((o) => o.key === "ok")?.count).toBe(3);
    expect(s.modes.find((m) => m.key === "paste")?.count).toBe(1);
  });

  it("reports extraction speed and the visitor funnel", () => {
    expect(s.durations).toMatchObject({ samples: 5, p50: 90, p95: 800 });
    expect(s.funnel).toEqual({ visited: 3, extracted: 2, exported: 1 });
  });

  it("handles no data at all", () => {
    const empty = summarize([], 30, now);
    expect(empty.totals.visitors).toBe(0);
    expect(empty.durations.p50).toBeNull();
    expect(empty.daily).toHaveLength(30);
  });
});
