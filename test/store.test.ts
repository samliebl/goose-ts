import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readStore, resetStoreCache, updateStore } from "../web/db.js";
import { useTempStore } from "./helpers/env.js";

const temp = useTempStore();
beforeEach(() => {
  temp.setup();
  resetStoreCache();
});
afterEach(() => {
  temp.teardown();
  resetStoreCache();
});

const addMember = (email: string) =>
  updateStore((s) => {
    s.members.push({
      id: "1",
      email,
      status: "active",
      addedAt: "2026-01-01T00:00:00.000Z",
      addedBy: "owner",
      note: "",
      redeemedAt: null,
      termsVersion: null,
      termsAcceptedAt: null,
      lastSeenAt: null,
      extractions: 0,
      epoch: 0,
    });
  });

describe("data file at rest", () => {
  it("is plain JSON in dev (no DATA_KEY)", () => {
    addMember("person@example.com");
    expect(readFileSync(temp.path, "utf-8")).toContain("person@example.com");
  });

  it("is encrypted, and unreadable without the key, when DATA_KEY is set", () => {
    process.env.DATA_KEY = "a-long-random-data-key";
    addMember("person@example.com");

    const raw = readFileSync(temp.path);
    expect(raw.subarray(0, 4).toString()).toBe("RGS1");
    expect(raw.includes(Buffer.from("person@example.com"))).toBe(false);

    resetStoreCache();
    expect(readStore((s) => s.members.map((m) => m.email))).toEqual(["person@example.com"]);
  });

  it("refuses to start with the wrong key, and leaves the file untouched", () => {
    process.env.DATA_KEY = "the-right-key";
    addMember("person@example.com");
    const before = readFileSync(temp.path);

    process.env.DATA_KEY = "the-wrong-key";
    resetStoreCache();
    expect(() => readStore((s) => s.members)).toThrow();
    expect(readFileSync(temp.path).equals(before)).toBe(true);
  });

  it("refuses an encrypted file when no key is configured", () => {
    process.env.DATA_KEY = "k";
    addMember("person@example.com");
    delete process.env.DATA_KEY;
    resetStoreCache();
    expect(() => readStore((s) => s.members)).toThrow(/DATA_KEY/);
  });

  it("detects tampering", () => {
    process.env.DATA_KEY = "k";
    addMember("person@example.com");
    const raw = readFileSync(temp.path);
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    writeFileSync(temp.path, raw);
    resetStoreCache();
    expect(() => readStore((s) => s.members)).toThrow();
  });

  it("requires DATA_KEY in production", () => {
    process.env.NODE_ENV = "production";
    expect(() => updateStore(() => undefined)).toThrow(/DATA_KEY/);
  });

  it("writes with owner-only permissions and keeps the previous version as .bak", () => {
    addMember("a@example.com");
    addMember("b@example.com");
    expect(statSync(temp.path).mode & 0o777).toBe(0o600);
    expect(existsSync(`${temp.path}.bak`)).toBe(true);
    expect(readFileSync(`${temp.path}.bak`, "utf-8")).not.toContain("b@example.com");
  });
});

describe("loading older or damaged files", () => {
  it("turns the original allowlist format into active members, and encrypts on the next save", () => {
    writeFileSync(
      temp.path,
      JSON.stringify({
        allowedEmails: [
          { email: "old@example.com", addedAt: "2026-01-01T00:00:00.000Z", addedBy: "o" },
        ],
        authTokens: [],
      }),
    );
    process.env.DATA_KEY = "k";
    const members = readStore((s) => s.members);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      email: "old@example.com",
      status: "active",
      addedBy: "owner",
    });

    updateStore(() => undefined);
    expect(readFileSync(temp.path).subarray(0, 4).toString()).toBe("RGS1");
  });

  it("moves an unparseable file aside rather than overwriting it", () => {
    writeFileSync(temp.path, "{ this is not json");
    expect(readStore((s) => s.members)).toEqual([]);
    expect(readdirSync(temp.dir).some((f) => f.includes(".corrupt-"))).toBe(true);
  });
});
