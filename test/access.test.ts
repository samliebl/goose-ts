import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canSignIn,
  createAccessRequest,
  createInvite,
  decideRequest,
  findMember,
  formatCode,
  listRequests,
  normalizeCode,
  normalizeEmail,
  purgeStaleData,
  redeemInvite,
  removeMember,
  resetRedeemFailures,
  signOutEverywhere,
  getEpoch,
} from "../web/access.js";
import { readStore, resetStoreCache, updateStore } from "../web/db.js";
import { useTempStore } from "./helpers/env.js";

const temp = useTempStore();
beforeEach(() => {
  temp.setup();
  resetStoreCache();
  resetRedeemFailures();
});
afterEach(() => {
  temp.teardown();
  resetStoreCache();
});

const invite = (email = "guest@example.com") => {
  const r = createInvite(email, { addedBy: "owner" });
  if (!r.ok) throw new Error(`invite failed: ${r.reason}`);
  return r;
};

describe("normalizeEmail", () => {
  it.each([
    ["  Person@Example.COM ", "person@example.com"],
    ["a.b+tag@sub.example.co.uk", "a.b+tag@sub.example.co.uk"],
  ])("accepts %j", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it.each(["", "nope", "a@b", "a b@c.com", "a@b.com\nBcc: x@y.com", "<x@y.com>", "a@b.c", 5, null])(
    "rejects %j",
    (input) => {
      expect(normalizeEmail(input)).toBeNull();
    },
  );

  it("rejects absurdly long addresses", () => {
    expect(normalizeEmail(`${"a".repeat(250)}@example.com`)).toBeNull();
  });
});

describe("codes", () => {
  it("normalizes what people type, and rejects what can't be a code", () => {
    expect(normalizeCode("abcde-fghjk")).toBe("ABCDEFGHJK");
    expect(normalizeCode(" ABCDE FGHJK ")).toBe("ABCDEFGHJK");
    expect(normalizeCode("ABCDE-FGHJ")).toBeNull();
    expect(normalizeCode("ABCDE-FGHJ0")).toBeNull(); // 0 is never issued
    expect(normalizeCode(undefined)).toBeNull();
    expect(formatCode("ABCDEFGHJK")).toBe("ABCDE-FGHJK");
  });

  it("issues a code in the expected shape", () => {
    const { code } = invite();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{10}$/);
  });
});

describe("invites and redemption", () => {
  it("creates an invited (not yet active) member who can't sign in until redeeming", () => {
    const { email } = invite();
    expect(findMember(email)).toMatchObject({ status: "invited", addedBy: "owner" });
    expect(canSignIn(email)).toBe(false);
  });

  it("activates the member when the right code is redeemed, recording the terms version", () => {
    const { email, code } = invite();
    const result = redeemInvite(email, formatCode(code).toLowerCase(), "v1");
    expect(result.ok).toBe(true);
    expect(findMember(email)).toMatchObject({ status: "active", termsVersion: "v1" });
    expect(canSignIn(email)).toBe(true);
  });

  it("works exactly once", () => {
    const { email, code } = invite();
    expect(redeemInvite(email, code, "v1").ok).toBe(true);
    expect(redeemInvite(email, code, "v1").ok).toBe(false);
  });

  it("rejects a wrong code, and a right code for the wrong email", () => {
    const { email, code } = invite();
    invite("other@example.com");
    expect(redeemInvite(email, "ZZZZZZZZZZ", "v1").ok).toBe(false);
    expect(redeemInvite("other@example.com", code, "v1").ok).toBe(false);
    expect(canSignIn(email)).toBe(false);
  });

  it("rejects an expired code", () => {
    const { email, code } = invite();
    updateStore((s) => {
      s.invites[0]!.expiresAt = new Date(Date.now() - 1000).toISOString();
    });
    expect(redeemInvite(email, code, "v1").ok).toBe(false);
  });

  it("replaces the old code when invited again", () => {
    const first = invite();
    const second = invite();
    expect(second.code).not.toBe(first.code);
    expect(redeemInvite(first.email, first.code, "v1").ok).toBe(false);
    expect(redeemInvite(second.email, second.code, "v1").ok).toBe(true);
  });

  it("won't invite the owner, someone already active, or a malformed address", () => {
    expect(createInvite("owner@example.com", { addedBy: "owner" })).toEqual({
      ok: false,
      reason: "owner",
    });
    const { email, code } = invite();
    redeemInvite(email, code, "v1");
    expect(createInvite(email, { addedBy: "owner" })).toEqual({ ok: false, reason: "active" });
    expect(createInvite("nope", { addedBy: "owner" })).toEqual({
      ok: false,
      reason: "invalid-email",
    });
  });

  it("locks an address out after five wrong guesses, even for the right code", () => {
    const { email, code } = invite();
    for (let i = 0; i < 5; i++)
      expect(redeemInvite(email, "ZZZZZZZZZZ", "v1")).toEqual({ ok: false, reason: "invalid" });
    expect(redeemInvite(email, code, "v1")).toEqual({ ok: false, reason: "locked" });
  });

  it("never stores the code itself", () => {
    const { code } = invite();
    expect(readFileSync(temp.path, "utf-8")).not.toContain(code);
  });
});

describe("removal and sign-out", () => {
  it("erases everything held about an address", () => {
    const { email, code } = invite();
    redeemInvite(email, code, "v1");
    createAccessRequest(email, "hello");
    updateStore((s) => {
      s.authTokens.push({ tokenHash: "x", email, expiresAt: "2099-01-01T00:00:00Z", usedAt: null });
    });

    expect(removeMember(email)).toBe(true);
    const contents = readFileSync(temp.path, "utf-8");
    expect(contents).not.toContain(email);
    expect(canSignIn(email)).toBe(false);
    expect(removeMember(email)).toBe(false);
  });

  it("signing out everywhere bumps the epoch, for members and the owner", () => {
    const { email, code } = invite();
    redeemInvite(email, code, "v1");
    expect(getEpoch(email)).toBe(0);
    expect(signOutEverywhere(email)).toBe(true);
    expect(getEpoch(email)).toBe(1);

    expect(getEpoch("owner@example.com")).toBe(0);
    signOutEverywhere("owner@example.com");
    expect(getEpoch("owner@example.com")).toBe(1);
    expect(signOutEverywhere("nobody@example.com")).toBe(false);
  });
});

describe("access requests", () => {
  it("stores a request, ignores a repeat from the same address, and can be decided once", () => {
    const first = createAccessRequest("asker@example.com", "I'd like to read research papers.");
    expect(first.created).toBe(true);
    expect(createAccessRequest("asker@example.com", "again").created).toBe(false);

    const id = listRequests()[0]!.id;
    expect(decideRequest(id, "approved")?.status).toBe("approved");
    expect(decideRequest(id, "declined")).toBeNull();
  });

  it("truncates an overlong message", () => {
    createAccessRequest("asker@example.com", "x".repeat(5000));
    expect(listRequests()[0]!.message.length).toBe(1000);
  });
});

describe("retention", () => {
  it("drops old spent codes and decided/unanswered requests, and keeps recent or live ones", () => {
    const day = 24 * 3600_000;
    const now = Date.now();
    const iso = (offset: number) => new Date(now + offset).toISOString();
    updateStore((s) => {
      s.invites.push(
        {
          codeHash: "live",
          email: "a@example.com",
          createdAt: iso(0),
          expiresAt: iso(5 * day),
          usedAt: null,
        },
        {
          codeHash: "expired-long-ago",
          email: "b@example.com",
          createdAt: iso(-60 * day),
          expiresAt: iso(-45 * day),
          usedAt: null,
        },
        {
          codeHash: "used-long-ago",
          email: "c@example.com",
          createdAt: iso(-60 * day),
          expiresAt: iso(-45 * day),
          usedAt: iso(-50 * day),
        },
      );
      s.requests.push(
        {
          id: "1",
          email: "r1@example.com",
          message: "",
          createdAt: iso(-10 * day),
          status: "pending",
          decidedAt: null,
        },
        {
          id: "2",
          email: "r2@example.com",
          message: "",
          createdAt: iso(-200 * day),
          status: "pending",
          decidedAt: null,
        },
        {
          id: "3",
          email: "r3@example.com",
          message: "",
          createdAt: iso(-120 * day),
          status: "declined",
          decidedAt: iso(-100 * day),
        },
        {
          id: "4",
          email: "r4@example.com",
          message: "",
          createdAt: iso(-20 * day),
          status: "approved",
          decidedAt: iso(-19 * day),
        },
      );
    });

    const purged = purgeStaleData(now);
    expect(purged.invites).toBe(2);
    expect(purged.requests).toBe(2);
    expect(readStore((s) => s.invites.map((i) => i.codeHash))).toEqual(["live"]);
    expect(readStore((s) => s.requests.map((r) => r.id)).sort()).toEqual(["1", "4"]);
  });
});
