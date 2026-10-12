import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// db.ts reads DB_PATH once at import time, so point it at a throwaway file first.
const dir = mkdtempSync(join(tmpdir(), "regoose-usage-"));
process.env.DB_PATH = join(dir, "db.json");
const { consumeDailyUsage } = await import("../web/db.js");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("consumeDailyUsage", () => {
  it("allows requests up to the cap and refuses the next one", () => {
    const now = day("2026-01-10");
    expect(consumeDailyUsage("anon", 2, now)).toBe(true);
    expect(consumeDailyUsage("anon", 2, now)).toBe(true);
    expect(consumeDailyUsage("anon", 2, now)).toBe(false);
    expect(consumeDailyUsage("anon", 2, now)).toBe(false);
  });

  it("counts each tier separately", () => {
    const now = day("2026-01-11");
    expect(consumeDailyUsage("anon", 1, now)).toBe(true);
    expect(consumeDailyUsage("anon", 1, now)).toBe(false);
    expect(consumeDailyUsage("member", 1, now)).toBe(true);
  });

  it("starts over the next day", () => {
    expect(consumeDailyUsage("anon", 1, day("2026-01-12"))).toBe(true);
    expect(consumeDailyUsage("anon", 1, day("2026-01-12"))).toBe(false);
    expect(consumeDailyUsage("anon", 1, day("2026-01-13"))).toBe(true);
  });

  it("never limits an infinite cap, and doesn't write anything for it", () => {
    for (let i = 0; i < 5; i++) {
      expect(consumeDailyUsage("owner", Number.POSITIVE_INFINITY, day("2026-01-14"))).toBe(true);
    }
    expect(readFileSync(process.env.DB_PATH!, "utf-8")).not.toContain("owner");
  });

  it("forgets counts older than a week, so the file doesn't grow forever", () => {
    consumeDailyUsage("anon", 5, day("2026-02-01"));
    consumeDailyUsage("anon", 5, day("2026-02-20"));
    const usage = JSON.parse(readFileSync(process.env.DB_PATH!, "utf-8")).usage as Record<
      string,
      number
    >;
    expect(Object.keys(usage).some((k) => k.startsWith("2026-02-01"))).toBe(false);
    expect(Object.keys(usage).some((k) => k.startsWith("2026-02-20"))).toBe(true);
  });
});
