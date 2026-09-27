import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import {
  addAllowedEmail as storeAddAllowedEmail,
  findAuthToken,
  getAllowedEmails,
  insertAuthToken,
  isEmailInAllowlist,
  markAuthTokenUsed,
  purgeExpiredAuthTokens,
  removeAllowedEmail as storeRemoveAllowedEmail,
} from "./db.js";

/**
 * Email-gated access: enter your email, get a one-time sign-in link,
 * clicking it sets a session cookie. No passwords, no open signup --
 * access is controlled entirely by an allowlist (see isEmailAllowed).
 *
 * Session cookies are stateless (HMAC-signed, no server-side session
 * store) -- only the short-lived login token needs a database record, and
 * only so it can be single-use (see consumeLoginToken). Everything here
 * follows the same principle tohode's own auth code documents: store a
 * hash of a secret, never the secret itself, and keep no more state than
 * the thing you're actually trying to guarantee requires.
 */

const TOKEN_LIFETIME_MS = 15 * 60_000; // 15 minutes
const SESSION_LIFETIME_MS = 30 * 24 * 3600_000; // 30 days

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function ownerEmail(): string {
  return requireEnv("OWNER_EMAIL").trim().toLowerCase();
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function sessionSecret(): string {
  const value = process.env.SESSION_SECRET;
  if (value) return value;
  if (isProduction()) throw new Error("Missing required environment variable: SESSION_SECRET");
  return "dev-only-insecure-secret-change-me";
}

function resendFrom(): string {
  return process.env.RESEND_FROM ?? `regoose <send@regoose.com>`;
}

let resendClient: Resend | null = null;

/**
 * Sends an email if RESEND_API_KEY is set; otherwise logs it to the
 * console instead -- fine for local dev (no key needed to click through
 * the login flow yourself), refused outright in production, where a
 * silently-not-sent email is a real problem, not a convenience.
 */
async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (isProduction()) {
      throw new Error("RESEND_API_KEY must be set in production.");
    }
    console.log(
      `\n──── email (not sent: no RESEND_API_KEY) ────\nTo: ${to}\nSubject: ${subject}\n\n${text}\n───────────────────────────────────────────\n`,
    );
    return;
  }
  resendClient ??= new Resend(apiKey);
  await resendClient.emails.send({ from: resendFrom(), to, subject, text });
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

/** True for the hardcoded owner (always allowed, can't be removed) or an email in the allowlist. */
export function isEmailAllowed(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return normalized === ownerEmail() || isEmailInAllowlist(normalized);
}

export function isOwner(email: string): boolean {
  return email.trim().toLowerCase() === ownerEmail();
}

export function listAllowedEmails(): Array<{ email: string; addedAt: string; addedBy: string }> {
  return getAllowedEmails();
}

export function addAllowedEmail(email: string, addedBy: string): void {
  storeAddAllowedEmail(email.trim().toLowerCase(), addedBy);
}

export function removeAllowedEmail(email: string): void {
  storeRemoveAllowedEmail(email.trim().toLowerCase());
}

/**
 * Issues a login token and emails it, if -- and only if -- the address is
 * allowed. Resolves the same way (undefined, no thrown error) regardless
 * of whether the email was allowed or not: the caller must respond
 * identically either way, so this endpoint can't be used to discover
 * which addresses are on the allowlist.
 *
 * baseUrl is the caller's job to supply (see server.ts, which derives it
 * from the actual incoming request) rather than a fixed PUBLIC_URL config
 * value -- a static value drifts the moment the app moves between hosts
 * (a Fly default subdomain today, a custom domain once DNS is pointed at
 * it), silently mailing out links to wherever it used to live.
 */
export async function requestLoginLink(email: string, baseUrl: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!isEmailAllowed(normalized)) return;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS).toISOString();
  insertAuthToken(hashToken(token), normalized, expiresAt);

  const link = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;
  await sendEmail(
    normalized,
    "Your regoose sign-in link",
    `Sign in: ${link}\n\nThis link works once and expires in 15 minutes. If you didn't request this, ignore it.`,
  );
}

/** Spends a login token. Returns the email it was issued for, or null if it's invalid, expired, or already used. */
export function consumeLoginToken(token: string): string | null {
  const hash = hashToken(token);
  const row = findAuthToken(hash);

  if (!row || row.usedAt || new Date(row.expiresAt).getTime() < Date.now()) return null;

  markAuthTokenUsed(hash);
  return row.email;
}

/** Deletes tokens that expired more than a day ago -- called opportunistically on server start, not on a schedule (low enough volume that it doesn't need one). */
export function purgeExpiredTokens(): number {
  return purgeExpiredAuthTokens();
}

// --- Session cookie: stateless, HMAC-signed, nothing stored server-side ---

export interface Session {
  email: string;
}

export function createSessionCookieValue(email: string): string {
  const expiresAt = Date.now() + SESSION_LIFETIME_MS;
  const encoded = Buffer.from(JSON.stringify({ email, expiresAt })).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifySessionCookieValue(value: string | undefined): Session | null {
  if (!value) return null;
  const dotIndex = value.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const encoded = value.slice(0, dotIndex);
  const signature = value.slice(dotIndex + 1);
  if (!timingSafeStringEqual(sign(encoded), signature)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as Record<string, unknown>)["email"] !== "string" ||
    typeof (payload as Record<string, unknown>)["expiresAt"] !== "number"
  ) {
    return null;
  }
  const { email, expiresAt } = payload as { email: string; expiresAt: number };
  if (Date.now() > expiresAt) return null;
  return { email };
}

/** Never throws -- a failed notification must not break the login it's reporting on. */
export async function sendLoginNotification(email: string): Promise<void> {
  try {
    await sendEmail(
      ownerEmail(),
      `regoose: sign-in as ${email}`,
      `${email} just signed in to regoose.${isOwner(email) ? "" : " That's not the owner account -- if you didn't expect this, remove them from the allowlist."}`,
    );
  } catch {
    /* ignored -- see doc comment */
  }
}
