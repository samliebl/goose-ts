/**
 * Just enough cookie handling for one HttpOnly session cookie -- not a
 * general-purpose cookie library. Hand-rolled rather than depending on one:
 * this is a handful of well-understood lines, and it avoids pinning to an
 * external package's API shape for something this small.
 */

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    cookies[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return cookies;
}

export interface SetCookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  path?: string;
  /** Seconds. Omit (or 0) to expire the cookie immediately, for clearing it. */
  maxAge?: number;
}

export function serializeCookie(
  name: string,
  value: string,
  options: SetCookieOptions = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}
