import type { Request, Response } from "express";
import { parseCookies, serializeCookie } from "./cookies.js";
import {
  createSessionCookieValue,
  SESSION_LIFETIME_MS,
  SESSION_RENEW_AFTER_MS,
  verifySessionCookieValue,
  type Session,
} from "./auth.js";
import { isProduction } from "./secrets.js";

export const SESSION_COOKIE = "regoose_session";

export type AuthedRequest = Request & { session: Session | null };

export function getSession(req: Request): Session | null {
  return verifySessionCookieValue(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
}

export function sessionOf(req: Request): Session | null {
  return (req as AuthedRequest).session ?? null;
}

export function setSessionCookie(res: Response, email: string): void {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, createSessionCookieValue(email), {
      httpOnly: true,
      secure: isProduction(),
      sameSite: "Lax",
      path: "/",
      maxAge: Math.floor(SESSION_LIFETIME_MS / 1000),
    }),
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, "", {
      httpOnly: true,
      secure: isProduction(),
      path: "/",
      maxAge: 0,
    }),
  );
}

/** Re-issues a session that's getting old, so people who keep using the site never have to sign in again. */
export function renewIfDue(res: Response, session: Session): void {
  if (Date.now() - session.issuedAt > SESSION_RENEW_AFTER_MS) setSessionCookie(res, session.email);
}
