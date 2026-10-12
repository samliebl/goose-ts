import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { canSignIn, findMember, getEpoch, isOwnerEmail } from "./access.js";
import { findAuthToken, insertAuthToken, markAuthTokenUsed } from "./db.js";
import { loginLinkMessage, sendEmail } from "./mailer.js";
import { ownerEmail, sessionSecret } from "./secrets.js";

/**
 * Passwordless sign-in. A person is either the owner or a member who has
 * redeemed an access code (see access.ts). To come back they use an emailed
 * one-time link, and once signed in a device stays signed in: the session
 * cookie lasts 30 days and is renewed whenever the site is used.
 *
 * Session cookies are stateless -- HMAC-signed, no session table -- but still
 * revocable: each carries the person's `epoch`, and a session only counts
 * while that person is still a member and their epoch hasn't been bumped
 * ("sign out everywhere"). Login links are single-use and stored hashed.
 */

export const TOKEN_LIFETIME_MS = 15 * 60_000; // 15 minutes
export const SESSION_LIFETIME_MS = 30 * 24 * 3600_000; // 30 days
/** A session older than this is re-issued when used, so active people never get signed out. */
export const SESSION_RENEW_AFTER_MS = 24 * 3600_000;

export interface Session {
  email: string;
  issuedAt: number;
  isOwner: boolean;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export const isOwner = isOwnerEmail;

/**
 * Emails a sign-in link, if -- and only if -- this address can sign in.
 * Resolves the same way whether or not it could (no thrown error, no
 * difference in timing worth speaking of): the caller must respond
 * identically either way, so this can't be used to find out who has access.
 *
 * baseUrl is the caller's job to supply (server.ts derives it from the actual
 * request) rather than a fixed config value, which drifts the moment the app
 * moves between hosts.
 */
export async function requestLoginLink(email: string, baseUrl: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!canSignIn(normalized)) return;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString();
  insertAuthToken(hashToken(token), normalized, expiresAt);

  const link = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;
  await sendEmail({ to: normalized, ...loginLinkMessage(link) });
}

/** Spends a login token. Returns the email it was issued for, or null if it's invalid, expired, or already used. */
export function consumeLoginToken(token: string): string | null {
  const hash = hashToken(token);
  const row = findAuthToken(hash);
  if (!row || row.usedAt || new Date(row.expiresAt).getTime() < Date.now()) return null;
  if (!canSignIn(row.email)) return null;

  markAuthTokenUsed(hash);
  return row.email;
}

/** Whether a login token is still spendable, without spending it (for the confirmation page). */
export function isLoginTokenUsable(token: string): boolean {
  const row = findAuthToken(hashToken(token));
  return (
    !!row && !row.usedAt && new Date(row.expiresAt).getTime() >= Date.now() && canSignIn(row.email)
  );
}

// --- Session cookie ---

export function createSessionCookieValue(email: string, now = Date.now()): string {
  const payload = {
    email,
    issuedAt: now,
    expiresAt: now + SESSION_LIFETIME_MS,
    epoch: getEpoch(email),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifySessionCookieValue(
  value: string | undefined,
  now = Date.now(),
): Session | null {
  if (!value) return null;
  const dotIndex = value.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const encoded = value.slice(0, dotIndex);
  if (!timingSafeStringEqual(sign(encoded), value.slice(dotIndex + 1))) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
  const { email, issuedAt, expiresAt, epoch } = payload;
  if (
    typeof email !== "string" ||
    typeof issuedAt !== "number" ||
    typeof expiresAt !== "number" ||
    typeof epoch !== "number"
  ) {
    return null;
  }
  if (now > expiresAt) return null;

  // Valid signature isn't enough: the person must still have access, and
  // nobody may have signed their devices out since this was issued.
  if (!canSignIn(email) || getEpoch(email) !== epoch) return null;
  return { email, issuedAt, isOwner: isOwnerEmail(email) };
}

/** Tells the owner a new person signed in -- only for members, never for the owner's own sign-ins. */
export async function sendLoginNotification(email: string): Promise<void> {
  if (isOwnerEmail(email)) return;
  try {
    const member = findMember(email);
    await sendEmail({
      to: ownerEmail(),
      subject: `regoose: ${email} signed in`,
      text: `${email} just signed in to regoose${member?.note ? ` (your note: ${member.note})` : ""}.`,
    });
  } catch {
    /* A failed notification must not break the sign-in it's reporting on. */
  }
}
