import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// node:dns/promises' lookup() has no timeout option -- a hostname whose
// resolver never answers would otherwise hang assertSafeToFetch (and
// everything waiting on it) indefinitely, entirely outside Goose.extract()'s
// own overall time budget (see test/timeout.test.ts), since this runs
// before that budget's clock even starts. Mocked here since a real hanging
// DNS query isn't something a test can wait out.
const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

const { assertSafeToFetch } = await import("../web/ssrf-guard.js");

describe("assertSafeToFetch DNS timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lookupMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects once the lookup takes longer than the timeout, instead of hanging forever", async () => {
    lookupMock.mockImplementation(() => new Promise(() => {})); // never resolves

    const result = assertSafeToFetch("https://slow-resolver.example.com/");
    const assertion = expect(result).rejects.toThrow("Could not resolve that host.");

    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
  });

  it("resolves normally when the lookup answers well within the timeout", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

    await expect(assertSafeToFetch("https://example.com/")).resolves.toBeUndefined();
  });
});
