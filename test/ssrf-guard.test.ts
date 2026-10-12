import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockedUrlError } from "../src/index.js";

// node:dns/promises is mocked: a real hanging or rebinding DNS answer isn't
// something a test can produce on demand.
const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

const { assertSafeToFetch, isBlockedIPv4, isBlockedIPv6 } = await import("../web/ssrf-guard.js");

describe("isBlockedIPv4", () => {
  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "172.16.5.5",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "192.0.2.1",
  ])("blocks %s", (ip) => {
    expect(isBlockedIPv4(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "172.32.0.1",
    "172.15.0.1",
    "100.63.255.255",
    "100.128.0.1",
  ])("allows public %s", (ip) => {
    expect(isBlockedIPv4(ip)).toBe(false);
  });

  it.each(["1.2.3", "1.2.3.4.5", "256.0.0.1", "a.b.c.d", ""])(
    "fails closed on malformed %j",
    (ip) => {
      expect(isBlockedIPv4(ip)).toBe(true);
    },
  );
});

describe("isBlockedIPv6", () => {
  it.each([
    "::",
    "::1",
    "fe80::1",
    "fd00::1",
    "fdaa:1:2::3", // Fly's private network
    "fc00::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1", // how URL normalizes the line above
    "::ffff:a00:1", // 10.0.0.1
    "::ffff:a9fe:a9fe", // 169.254.169.254
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
    "2001:db8::1",
    "2001::1",
  ])("blocks %s", (ip) => {
    expect(isBlockedIPv6(ip)).toBe(true);
  });

  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:808:808"])(
    "allows public %s",
    (ip) => {
      expect(isBlockedIPv6(ip)).toBe(false);
    },
  );

  it.each(["", "1:2:3", "zzzz::1", "1::2::3"])("fails closed on malformed %j", (ip) => {
    expect(isBlockedIPv6(ip)).toBe(true);
  });
});

describe("assertSafeToFetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://2130706433/", // decimal form of 127.0.0.1
    "http://0x7f.1/", // hex/short form
    "http://169.254.169.254/latest/meta-data/",
    "http://[fdaa:1::2]/",
    "http://localhost/",
    "http://localhost./",
    "http://service.localhost/",
    "http://redis/", // single-label name
    "http://app.internal/",
    "http://printer.local/",
  ])("blocks %s without a DNS lookup", async (url) => {
    await expect(assertSafeToFetch(url)).rejects.toThrow(BlockedUrlError);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it.each(["ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "not a url", ""])(
    "blocks the scheme/shape of %j",
    async (url) => {
      await expect(assertSafeToFetch(url)).rejects.toThrow(BlockedUrlError);
    },
  );

  it("blocks credentials in the URL and non-standard ports", async () => {
    await expect(assertSafeToFetch("https://user:pw@example.com/")).rejects.toThrow(/username/);
    await expect(assertSafeToFetch("https://example.com:8080/")).rejects.toThrow(/ports/);
    await expect(assertSafeToFetch("http://example.com:22/")).rejects.toThrow(/ports/);
  });

  it("allows an ordinary public host, including explicit standard ports", async () => {
    await expect(assertSafeToFetch("https://example.com/a")).resolves.toBeUndefined();
    await expect(assertSafeToFetch("https://example.com:443/a")).resolves.toBeUndefined();
    await expect(assertSafeToFetch("http://93.184.216.34/")).resolves.toBeUndefined();
  });

  it("blocks a hostname that resolves to a private address, even one of several answers", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    await expect(assertSafeToFetch("https://rebind.example.com/")).rejects.toThrow(
      /resolves to an address/,
    );
  });

  it("blocks a hostname that resolves to a private IPv6 address", async () => {
    lookupMock.mockResolvedValue([{ address: "fd00::1", family: 6 }]);
    await expect(assertSafeToFetch("https://v6.example.com/")).rejects.toThrow(BlockedUrlError);
  });

  it("rejects once the lookup takes longer than the timeout, instead of hanging forever", async () => {
    lookupMock.mockImplementation(() => new Promise(() => {})); // never resolves

    const result = assertSafeToFetch("https://slow-resolver.example.com/");
    const assertion = expect(result).rejects.toThrow("Could not resolve that host.");

    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
  });
});
