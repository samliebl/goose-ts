import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent: Array<{ to: string; subject: string; text: string }> = [];
vi.mock("../web/mailer.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../web/mailer.js")>()),
  sendEmail: async (email: { to: string; subject: string; text: string }) => {
    sent.push(email);
  },
}));

const access = await import("../web/access.js");
const auth = await import("../web/auth.js");
const { resetStoreCache } = await import("../web/db.js");
const { useTempStore } = await import("./helpers/env.js");

const temp = useTempStore();
beforeEach(() => {
  temp.setup();
  resetStoreCache();
  access.resetRedeemFailures();
  sent.length = 0;
});
afterEach(() => {
  temp.teardown();
  resetStoreCache();
});

function makeMember(email = "member@example.com"): string {
  const r = access.createInvite(email, { addedBy: "owner" });
  if (!r.ok) throw new Error("invite failed");
  access.redeemInvite(email, r.code, "v1");
  return email;
}

describe("session cookies", () => {
  it("accepts the owner and an active member", () => {
    const owner = auth.verifySessionCookieValue(auth.createSessionCookieValue("owner@example.com"));
    expect(owner).toMatchObject({ email: "owner@example.com", isOwner: true });

    const email = makeMember();
    expect(auth.verifySessionCookieValue(auth.createSessionCookieValue(email))).toMatchObject({
      email,
      isOwner: false,
    });
  });

  it("rejects someone who isn't a member, or hasn't redeemed their code", () => {
    expect(
      auth.verifySessionCookieValue(auth.createSessionCookieValue("stranger@example.com")),
    ).toBeNull();
    const r = access.createInvite("pending@example.com", { addedBy: "owner" });
    expect(r.ok).toBe(true);
    expect(
      auth.verifySessionCookieValue(auth.createSessionCookieValue("pending@example.com")),
    ).toBeNull();
  });

  it("stops working the moment the member is removed", () => {
    const email = makeMember();
    const cookie = auth.createSessionCookieValue(email);
    expect(auth.verifySessionCookieValue(cookie)).not.toBeNull();
    access.removeMember(email);
    expect(auth.verifySessionCookieValue(cookie)).toBeNull();
  });

  it("stops working after 'sign out everywhere', while a new session works", () => {
    const email = makeMember();
    const old = auth.createSessionCookieValue(email);
    access.signOutEverywhere(email);
    expect(auth.verifySessionCookieValue(old)).toBeNull();
    expect(auth.verifySessionCookieValue(auth.createSessionCookieValue(email))).not.toBeNull();
  });

  it("expires after 30 days", () => {
    const issued = Date.now();
    const cookie = auth.createSessionCookieValue("owner@example.com", issued);
    expect(
      auth.verifySessionCookieValue(cookie, issued + auth.SESSION_LIFETIME_MS - 1000),
    ).not.toBeNull();
    expect(
      auth.verifySessionCookieValue(cookie, issued + auth.SESSION_LIFETIME_MS + 1000),
    ).toBeNull();
  });

  it("rejects tampering, a different secret, and garbage", () => {
    const cookie = auth.createSessionCookieValue("owner@example.com");
    const [payload, sig] = cookie.split(".") as [string, string];
    const forged = Buffer.from(
      JSON.stringify({ email: "owner@example.com", issuedAt: 0, expiresAt: 9e15, epoch: 0 }),
    ).toString("base64url");
    expect(auth.verifySessionCookieValue(`${forged}.${sig}`)).toBeNull();
    expect(auth.verifySessionCookieValue(`${payload}.${sig}x`)).toBeNull();
    for (const bad of ["", "nodot", ".", "a.b", undefined]) {
      expect(auth.verifySessionCookieValue(bad)).toBeNull();
    }
    process.env.SESSION_SECRET = "a-different-secret";
    expect(auth.verifySessionCookieValue(cookie)).toBeNull();
  });
});

describe("emailed sign-in links", () => {
  const tokenFrom = (text: string) => decodeURIComponent(/token=([^\s&]+)/.exec(text)![1]!);

  it("sends nothing to an address that can't sign in, and a single-use link to one that can", async () => {
    await auth.requestLoginLink("stranger@example.com", "https://regoose.test");
    expect(sent).toHaveLength(0);

    const email = makeMember();
    await auth.requestLoginLink(email, "https://regoose.test");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(email);
    expect(sent[0]!.text).toContain("https://regoose.test/api/auth/verify?token=");

    const token = tokenFrom(sent[0]!.text);
    expect(auth.isLoginTokenUsable(token)).toBe(true);
    expect(auth.consumeLoginToken(token)).toBe(email);
    expect(auth.consumeLoginToken(token)).toBeNull();
  });

  it("does not send a link to someone who has an invite but hasn't redeemed it", async () => {
    access.createInvite("pending@example.com", { addedBy: "owner" });
    await auth.requestLoginLink("pending@example.com", "https://regoose.test");
    expect(sent).toHaveLength(0);
  });

  it("refuses a link whose owner has since been removed", async () => {
    const email = makeMember();
    await auth.requestLoginLink(email, "https://regoose.test");
    const token = tokenFrom(sent[0]!.text);
    access.removeMember(email);
    expect(auth.consumeLoginToken(token)).toBeNull();
  });

  it("rejects an unknown token", () => {
    expect(auth.consumeLoginToken("nonsense")).toBeNull();
    expect(auth.isLoginTokenUsable("nonsense")).toBe(false);
  });
});

describe("sign-in notifications", () => {
  it("tells the owner when a member signs in, but never about the owner's own sign-ins", async () => {
    await auth.sendLoginNotification("owner@example.com");
    expect(sent).toHaveLength(0);
    await auth.sendLoginNotification(makeMember());
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("owner@example.com");
  });
});
