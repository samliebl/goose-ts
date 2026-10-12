import type { Request } from "express";
import {
  classifyUserAgent,
  primaryLanguage,
  recordEvent,
  visitorHash,
  type AnalyticsEvent,
  type Tier,
} from "./analytics.js";
import { sessionOf } from "./session.js";

/** Do Not Track or Global Privacy Control: record only anonymous operational counts. */
export function optedOut(req: Request): boolean {
  return req.get("sec-gpc") === "1" || req.get("dnt") === "1";
}

export function tierOfRequest(req: Request): Tier {
  return sessionOf(req) ? "member" : "anon";
}

/**
 * Records an event about a request. The owner's own activity is never
 * recorded, and visitors who opted out get no visitor hash.
 */
export function track(
  req: Request,
  ip: string,
  event: Omit<AnalyticsEvent, "t" | "tier" | "v">,
): void {
  const session = sessionOf(req);
  if (session?.isOwner) return;
  const ua = req.get("user-agent") ?? "";
  if (classifyUserAgent(ua).dev === "bot") return;
  recordEvent({
    ...event,
    tier: session ? "member" : "anon",
    ...(optedOut(req) ? {} : { v: visitorHash(ip, ua) }),
  });
}

export { primaryLanguage };
