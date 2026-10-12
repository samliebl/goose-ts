import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import {
  purgeExpiredAuthTokens,
  readStore,
  updateStore,
  type AccessRequest,
  type Member,
} from "./db.js";
import { hmacHex, ownerEmail } from "./secrets.js";

/**
 * Who may use the full tool, and how they get in.
 *
 * Nobody has a password. The owner invites someone by email (or approves
 * their request); they receive a one-time access code, enter it once, and
 * from then on come back through the 30-day session cookie -- renewed
 * whenever they use the site -- or an emailed sign-in link. The only thing
 * kept about a person is what's in `Member`: an email address and a few
 * dates and counters.
 */

export const INVITE_TTL_MS = 14 * 24 * 3600_000;
const REQUEST_RETENTION_MS = 90 * 24 * 3600_000;

/** No 0/O/1/I/L: a code read off a phone and typed in shouldn't be ambiguous. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 10;

export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length < 5 || email.length > 254) return null;
  const part = `[^\\s@<>()\\[\\]\\\\,;:"]+`;
  return new RegExp(`^${part}@${part}\\.[^\\s@<>()\\[\\]\\\\,;:"]{2,}$`).test(email) ? email : null;
}

export function isOwnerEmail(email: string): boolean {
  return email.trim().toLowerCase() === ownerEmail();
}

export function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** "ABCDEFGHJK" -> "ABCDE-FGHJK", for display. */
export function formatCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** Forgives the spaces, dashes and lowercase a person types; returns null if what's left can't be a code. */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c))
    ? code
    : null;
}

const hashCode = (email: string, code: string) => hmacHex("access-code", `${email}:${code}`);

function equalHex(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// --- Members ---

export function findMember(email: string): Member | null {
  return readStore((s) => s.members.find((m) => m.email === email) ?? null);
}

export function listMembers(): Member[] {
  return readStore((s) => s.members.slice().sort((a, b) => b.addedAt.localeCompare(a.addedAt)));
}

/** The owner always counts; everyone else needs to have redeemed their code. */
export function canSignIn(email: string): boolean {
  return isOwnerEmail(email) || findMember(email)?.status === "active";
}

export function getEpoch(email: string): number {
  if (isOwnerEmail(email)) return readStore((s) => s.settings.ownerEpoch);
  return findMember(email)?.epoch ?? 0;
}

/** Signs a person out of every device by invalidating all the sessions issued so far. */
export function signOutEverywhere(email: string): boolean {
  return updateStore((s) => {
    if (isOwnerEmail(email)) {
      s.settings.ownerEpoch++;
      return true;
    }
    const member = s.members.find((m) => m.email === email);
    if (!member) return false;
    member.epoch++;
    return true;
  });
}

/**
 * Deletes everything held about an email address: the member record, any
 * codes, sign-in links, and access requests. This is both "remove" in the
 * admin panel and "delete my account" on the account page. Their sessions
 * stop working at once, because a session is only valid for a current member.
 */
export function removeMember(email: string): boolean {
  return updateStore((s) => {
    const before = s.members.length;
    s.members = s.members.filter((m) => m.email !== email);
    s.invites = s.invites.filter((i) => i.email !== email);
    s.authTokens = s.authTokens.filter((t) => t.email !== email);
    s.requests = s.requests.filter((r) => r.email !== email);
    return s.members.length !== before;
  });
}

export function acceptTerms(email: string, version: string): void {
  updateStore((s) => {
    const member = s.members.find((m) => m.email === email);
    if (member) {
      member.termsVersion = version;
      member.termsAcceptedAt = new Date().toISOString();
    }
  });
}

/** Writes at most once an hour per person, so ordinary use doesn't rewrite the data file on every request. */
const lastTouched = new Map<string, number>();
export function touchMember(email: string): void {
  const now = Date.now();
  if (now - (lastTouched.get(email) ?? 0) < 3600_000) return;
  lastTouched.set(email, now);
  updateStore((s) => {
    const member = s.members.find((m) => m.email === email);
    if (member) member.lastSeenAt = new Date(now).toISOString();
  });
}

export function recordMemberExtraction(email: string): void {
  updateStore((s) => {
    const member = s.members.find((m) => m.email === email);
    if (member) {
      member.extractions++;
      member.lastSeenAt = new Date().toISOString();
    }
  });
}

// --- Invites and access codes ---

export type InviteResult =
  | { ok: true; code: string; email: string; expiresAt: string }
  | { ok: false; reason: "owner" | "active" | "invalid-email" };

/**
 * Creates (or replaces) the code for an email address. A fresh code
 * invalidates any earlier unused one, so "resend" is just "invite again".
 */
export function createInvite(
  rawEmail: string,
  options: { note?: string; addedBy: "owner" | "request" },
): InviteResult {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, reason: "invalid-email" };
  if (isOwnerEmail(email)) return { ok: false, reason: "owner" };

  return updateStore((s) => {
    let member = s.members.find((m) => m.email === email);
    if (member?.status === "active") return { ok: false, reason: "active" } as const;

    const now = new Date();
    if (!member) {
      member = {
        id: randomUUID(),
        email,
        status: "invited",
        addedAt: now.toISOString(),
        addedBy: options.addedBy,
        note: (options.note ?? "").slice(0, 300),
        redeemedAt: null,
        termsVersion: null,
        termsAcceptedAt: null,
        lastSeenAt: null,
        extractions: 0,
        epoch: 0,
      };
      s.members.push(member);
    }

    s.invites = s.invites.filter((i) => i.email !== email);
    const code = generateCode();
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();
    s.invites.push({
      codeHash: hashCode(email, code),
      email,
      createdAt: now.toISOString(),
      expiresAt,
      usedAt: null,
    });
    return { ok: true, code, email, expiresAt } as const;
  });
}

/** Five wrong guesses locks an address out of redeeming for a while, so a code can't be brute-forced. */
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60_000;
const failures = new Map<string, { count: number; lockedUntil: number }>();

export function resetRedeemFailures(): void {
  failures.clear();
}

export type RedeemResult =
  { ok: true; member: Member } | { ok: false; reason: "invalid" | "locked" };

export function redeemInvite(
  rawEmail: string,
  rawCode: string,
  termsVersion: string,
): RedeemResult {
  const email = normalizeEmail(rawEmail);
  const code = normalizeCode(rawCode);
  const now = Date.now();

  const state = email ? failures.get(email) : undefined;
  if (state && state.lockedUntil > now) return { ok: false, reason: "locked" };

  const member = email && code ? tryRedeem(email, code, termsVersion, now) : null;
  if (member) {
    failures.delete(email!);
    return { ok: true, member };
  }

  if (email) {
    if (failures.size > 5000) failures.clear(); // bounded: this is keyed by whatever strangers type
    const count = (state?.count ?? 0) + 1;
    failures.set(email, {
      count: count >= MAX_FAILURES ? 0 : count,
      lockedUntil: count >= MAX_FAILURES ? now + LOCKOUT_MS : 0,
    });
  }
  return { ok: false, reason: "invalid" };
}

function tryRedeem(email: string, code: string, termsVersion: string, now: number): Member | null {
  const expected = hashCode(email, code);
  return updateStore((s) => {
    const invite = s.invites.find(
      (i) =>
        i.email === email &&
        !i.usedAt &&
        new Date(i.expiresAt).getTime() > now &&
        equalHex(i.codeHash, expected),
    );
    const member = s.members.find((m) => m.email === email);
    if (!invite || !member) return null;

    const stamp = new Date(now).toISOString();
    invite.usedAt = stamp;
    member.status = "active";
    member.redeemedAt = stamp;
    member.termsVersion = termsVersion;
    member.termsAcceptedAt = stamp;
    return { ...member };
  });
}

// --- Access requests ---

/**
 * Stores a request from a visitor. A repeat from the same address within a
 * week (or while one is still pending) is ignored, so the form can't be used
 * to flood the owner's inbox.
 */
export function createAccessRequest(
  email: string,
  message: string,
): { created: true; request: AccessRequest } | { created: false } {
  return updateStore((s) => {
    const weekAgo = Date.now() - 7 * 24 * 3600_000;
    const recent = s.requests.some(
      (r) =>
        r.email === email && (r.status === "pending" || new Date(r.createdAt).getTime() > weekAgo),
    );
    if (recent) return { created: false } as const;
    const request: AccessRequest = {
      id: randomUUID(),
      email,
      message: message.slice(0, 1000),
      createdAt: new Date().toISOString(),
      status: "pending",
      decidedAt: null,
    };
    s.requests.push(request);
    return { created: true, request } as const;
  });
}

export function listRequests(): AccessRequest[] {
  return readStore((s) =>
    s.requests.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
}

export function getRequest(id: string): AccessRequest | null {
  return readStore((s) => s.requests.find((r) => r.id === id) ?? null);
}

export function decideRequest(id: string, status: "approved" | "declined"): AccessRequest | null {
  return updateStore((s) => {
    const request = s.requests.find((r) => r.id === id);
    if (!request || request.status !== "pending") return null;
    request.status = status;
    request.decidedAt = new Date().toISOString();
    return { ...request };
  });
}

// --- Retention ---

/**
 * Enforces how long things are kept: spent or expired codes after 30 days,
 * decided requests after 90, unanswered requests after 180, sign-in links a
 * day after they expire. Run at startup and daily.
 */
export function purgeStaleData(now = Date.now()): {
  invites: number;
  requests: number;
  tokens: number;
} {
  const tokens = purgeExpiredAuthTokens();
  const result = updateStore((s) => {
    const invitesBefore = s.invites.length;
    s.invites = s.invites.filter((i) => {
      const done = i.usedAt ? new Date(i.usedAt).getTime() : new Date(i.expiresAt).getTime();
      return (
        now - done < 30 * 24 * 3600_000 || (!i.usedAt && new Date(i.expiresAt).getTime() > now)
      );
    });

    const requestsBefore = s.requests.length;
    s.requests = s.requests.filter((r) => {
      const age = now - new Date(r.createdAt).getTime();
      if (r.status === "pending") return age < 2 * REQUEST_RETENTION_MS;
      return now - new Date(r.decidedAt ?? r.createdAt).getTime() < REQUEST_RETENTION_MS;
    });
    return {
      invites: invitesBefore - s.invites.length,
      requests: requestsBefore - s.requests.length,
    };
  });
  return { ...result, tokens };
}
