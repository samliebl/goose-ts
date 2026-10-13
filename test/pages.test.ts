import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INVITE_TTL_MS } from "../web/access.js";
import { RETENTION_DAYS } from "../web/analytics.js";
import { FLASH_MESSAGES, membersBody, requestsBody } from "../web/admin-ui.js";
import { authorBody } from "./../web/pages.js";
import { authorPlaceholders } from "../web/author.js";
import { page } from "../web/html.js";
import { privacyBody, termsBody } from "../web/legal.js";
import { accountBody, aboutBody, redeemBody, verifyConfirmBody } from "../web/pages.js";
import { LIMITS, OPEN_SOURCE_DOMAINS } from "../web/policy.js";
import { safeNext } from "../web/routes-access.js";
import { TERMS_VERSION } from "../web/site.js";

const XSS = `"><script>alert(1)</script>`;

describe("pages escape what visitors control", () => {
  it("escapes prefilled redeem fields and error text", () => {
    const html = redeemBody({ email: XSS, code: XSS }, XSS);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&#60;script&#62;");
  });

  it("escapes the sign-in token echoed into the confirmation form", () => {
    expect(verifyConfirmBody(XSS)).not.toContain("<script>");
  });

  it("escapes member emails, notes and request messages in the admin views", () => {
    const member = {
      id: "1",
      email: `a${XSS}@x.com`,
      status: "active" as const,
      addedAt: "2026-01-01T00:00:00Z",
      addedBy: "owner" as const,
      note: XSS,
      redeemedAt: null,
      termsVersion: null,
      termsAcceptedAt: null,
      lastSeenAt: null,
      extractions: 0,
      epoch: 0,
    };
    expect(membersBody([member], "owner@example.com")).not.toContain("<script>alert");
    const request = {
      id: "r1",
      email: `a${XSS}@x.com`,
      message: XSS,
      createdAt: "2026-01-01T00:00:00Z",
      status: "pending" as const,
      decidedAt: null,
    };
    expect(requestsBody([request])).not.toContain("<script>alert");
  });

  it("escapes the page title", () => {
    expect(page(XSS, "<p>x</p>")).not.toContain("<script>alert(1)</script></title>");
  });
});

describe("safeNext", () => {
  it.each(["/", "/about", "/admin/members?m=invited"])("allows the local path %s", (path) => {
    expect(safeNext(path)).toBe(path);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "",
    undefined,
    5,
  ])("falls back to / for %j", (value) => {
    expect(safeNext(value)).toBe("/");
  });
});

describe("account page", () => {
  const base = {
    email: "a@b.com",
    since: null,
    lastSeenAt: null,
    extractions: 0,
    termsVersion: null,
    termsAcceptedAt: null,
  };
  it("offers deletion to members but not to the owner", () => {
    expect(accountBody({ ...base, isOwner: false })).toContain("/account/delete");
    expect(accountBody({ ...base, isOwner: true })).not.toContain("/account/delete");
  });
});

describe("author page", () => {
  it("lists links without bullets, shows the other projects, and has nothing left to fill in", () => {
    const html = authorBody();
    expect(html).toContain('class="plain"');
    expect(html).toContain("tohode.com");
    expect(html).toContain("truyne.com");
    expect(html).toContain("linkedin.com/in/samliebl");
    expect(html).not.toContain("github.com/samliebl/goose-ts");
    expect(html).not.toContain("mailto:");
    expect(authorPlaceholders()).toEqual([]);
  });
});

// The policies make promises about numbers; these fail if the code and the
// words drift apart.
describe("legal text matches the code", () => {
  const privacy = privacyBody();

  it("states the analytics retention period the code enforces", () => {
    expect(privacy).toContain(`${RETENTION_DAYS} days`);
  });

  it("states the access-code lifetime the code enforces", () => {
    expect(privacy).toContain(`${INVITE_TTL_MS / 86_400_000} days`);
  });

  it("names the terms version and links the other document", () => {
    expect(privacy).toContain(TERMS_VERSION);
    expect(termsBody()).toContain(TERMS_VERSION);
    expect(termsBody()).toContain('href="/privacy"');
    expect(privacy).toContain('href="/account"');
  });

  it("discloses the processors and the cookie actually used", () => {
    for (const word of ["Fly.io", "Resend", "regoose_session", "Global Privacy Control"]) {
      expect(privacy).toContain(word);
    }
  });
});

describe("about page matches the limits in the code", () => {
  const about = aboutBody();

  it("quotes the real rate and daily limits", () => {
    expect(about).toContain(`${LIMITS.anon.ratePerWindow} extractions`);
    expect(about).toContain(`${LIMITS.anon.dailyCap} a day`);
  });

  it("lists every allowlisted site", () => {
    for (const domain of OPEN_SOURCE_DOMAINS) expect(about).toContain(domain);
  });

  it("explains each restriction with a reason", () => {
    expect(about).toContain("What\u2019s limited");
    expect((about.match(/<em>Why:<\/em>/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});

describe("admin messages", () => {
  it("has a message for every outcome the invite flow can return", () => {
    for (const key of [
      "invited",
      "bad-email",
      "is-owner",
      "is-active",
      "mail-failed",
      "cap",
      "not-found",
    ]) {
      expect(FLASH_MESSAGES[key]).toBeDefined();
    }
  });
});

beforeEach(() => undefined);
afterEach(() => undefined);
