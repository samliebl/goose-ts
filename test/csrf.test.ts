import { describe, expect, it } from "vitest";
import { isSameSiteRequest } from "../web/csrf.js";

const host = "regoose.com";

describe("isSameSiteRequest", () => {
  it("accepts a matching origin and rejects a different one", () => {
    expect(
      isSameSiteRequest({ origin: "https://regoose.com", host, secFetchSite: undefined }),
    ).toBe(true);
    expect(
      isSameSiteRequest({ origin: "https://evil.example", host, secFetchSite: "cross-site" }),
    ).toBe(false);
    expect(isSameSiteRequest({ origin: "not a url", host, secFetchSite: undefined })).toBe(false);
  });

  it("accepts the null origin a browser sends on a same-origin form post, but only with proof", () => {
    expect(isSameSiteRequest({ origin: "null", host, secFetchSite: "same-origin" })).toBe(true);
    expect(isSameSiteRequest({ origin: "null", host, secFetchSite: "cross-site" })).toBe(false);
    expect(isSameSiteRequest({ origin: "null", host, secFetchSite: undefined })).toBe(false);
  });

  it("without an origin, refuses only what the browser says is cross-site", () => {
    expect(isSameSiteRequest({ origin: undefined, host, secFetchSite: undefined })).toBe(true);
    expect(isSameSiteRequest({ origin: undefined, host, secFetchSite: "same-origin" })).toBe(true);
    expect(isSameSiteRequest({ origin: undefined, host, secFetchSite: "cross-site" })).toBe(false);
  });
});
