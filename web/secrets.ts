import { createHmac } from "node:crypto";

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function ownerEmail(): string {
  return requireEnv("OWNER_EMAIL").trim().toLowerCase();
}

export function sessionSecret(): string {
  const value = process.env.SESSION_SECRET;
  if (value) return value;
  if (isProduction()) throw new Error("Missing required environment variable: SESSION_SECRET");
  return "dev-only-insecure-secret-change-me";
}

/**
 * HMAC of a value under a key derived from the session secret and a purpose
 * label. The label keeps the uses apart: a session signature can never be
 * mistaken for an access-code hash, even though one secret backs both.
 */
export function hmacHex(label: string, value: string): string {
  const key = createHmac("sha256", sessionSecret()).update(`regoose:${label}`).digest();
  return createHmac("sha256", key).update(value).digest("hex");
}
