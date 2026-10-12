import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Configuration } from "../src/Configuration.js";
import { BlockedUrlError, guardedFetch, ResponseTooLargeError } from "../src/safeFetch.js";

const redirect = (to: string, status = 302) =>
  new Response(null, { status, headers: { location: to } });
const ok = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers });

describe("guardedFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs the url guard on every hop, including relative redirects", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(redirect("/two"))
      .mockResolvedValueOnce(redirect("https://other.example/three"))
      .mockResolvedValueOnce(ok("done"));
    const guard = vi.fn();
    const config = new Configuration({ urlGuard: guard });

    const result = await guardedFetch("https://a.example/one", config, { maxBytes: 1000 });

    expect(result.bytes.toString()).toBe("done");
    expect(result.finalUrl).toBe("https://other.example/three");
    expect(guard.mock.calls.map((c) => c[0])).toEqual([
      "https://a.example/one",
      "https://a.example/two",
      "https://other.example/three",
    ]);
  });

  it("never lets fetch follow redirects on its own", async () => {
    vi.mocked(fetch).mockResolvedValue(ok("x"));
    await guardedFetch("https://a.example/", new Configuration(), { maxBytes: 10 });
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("rejects a redirect into somewhere the guard refuses, without fetching it", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(redirect("http://169.254.169.254/latest/meta-data/"));
    const guard = vi.fn(async (url: string) => {
      if (url.includes("169.254")) throw new BlockedUrlError("That address isn't allowed.");
    });
    const config = new Configuration({ urlGuard: guard });

    await expect(guardedFetch("https://a.example/", config, { maxBytes: 10 })).rejects.toThrow(
      BlockedUrlError,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a redirect to a non-http scheme", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(redirect("file:///etc/passwd"));
    await expect(
      guardedFetch("https://a.example/", new Configuration(), { maxBytes: 10 }),
    ).rejects.toThrow(BlockedUrlError);
  });

  it("gives up after maxRedirects", async () => {
    vi.mocked(fetch).mockImplementation(async () => redirect("https://a.example/loop"));
    const config = new Configuration({ maxRedirects: 3 });
    await expect(guardedFetch("https://a.example/", config, { maxBytes: 10 })).rejects.toThrow(
      /Too many redirects/,
    );
    expect(fetch).toHaveBeenCalledTimes(4); // the original plus three hops
  });

  it("refuses a body whose declared length is over the cap, without reading it", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok("small", { "content-length": "999999" }));
    await expect(
      guardedFetch("https://a.example/", new Configuration(), { maxBytes: 1000 }),
    ).rejects.toThrow(ResponseTooLargeError);
  });

  it("refuses a body that streams past the cap even with no content-length", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok("x".repeat(5000)));
    await expect(
      guardedFetch("https://a.example/", new Configuration(), { maxBytes: 1000 }),
    ).rejects.toThrow(ResponseTooLargeError);
  });

  it("returns a non-2xx response without reading its body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("nope", { status: 403 }));
    const result = await guardedFetch("https://a.example/", new Configuration(), {
      maxBytes: 1000,
    });
    expect(result.response.status).toBe(403);
    expect(result.bytes.length).toBe(0);
  });

  it("refuses to start once the overall budget is spent", async () => {
    const config = new Configuration({ overallTimeoutMs: -1 });
    await expect(guardedFetch("https://a.example/", config, { maxBytes: 10 })).rejects.toThrow(
      /budget/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
