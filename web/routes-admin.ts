import express, { type Express, type NextFunction, type Request, type Response } from "express";
import {
  createInvite,
  decideRequest,
  getRequest,
  listMembers,
  listRequests,
  normalizeEmail,
  removeMember,
  signOutEverywhere,
} from "./access.js";
import {
  adminTabs,
  membersBody,
  overviewBody,
  requestsBody,
  type ChecklistItem,
} from "./admin-ui.js";
import { loadEvents, recordEvent, summarize } from "./analytics.js";
import { authorPlaceholders } from "./author.js";
import { consumeDailyUsage, readDailyUsage } from "./db.js";
import { page } from "./html.js";
import { inviteMessage, sendEmail } from "./mailer.js";
import { LIMITS, blockedDomains } from "./policy.js";
import { isProduction, ownerEmail } from "./secrets.js";
import { sessionOf } from "./session.js";
import { contactEmail } from "./site.js";

const asText = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  const session = sessionOf(req);
  if (!session) {
    if (req.path.startsWith("/api/")) {
      res.status(401).json({ ok: false, error: "Please sign in." });
    } else {
      res.redirect(302, "/login");
    }
    return;
  }
  if (!session.isOwner) {
    if (req.path.startsWith("/api/")) {
      res.status(403).json({ ok: false, error: "Owner access only." });
    } else {
      res.status(403).send(
        page("Forbidden", "<h1>Owner access only</h1>", {
          viewer: { email: session.email, isOwner: false },
        }),
      );
    }
    return;
  }
  next();
}

export type InviteOutcome =
  "invited" | "bad-email" | "is-owner" | "is-active" | "mail-failed" | "cap";

/**
 * Creates (or replaces) an access code for an address and emails it. Shared
 * by the invite form, "resend", and approving an access request, so they all
 * behave identically.
 */
export async function inviteAndEmail(
  email: string,
  options: { note?: string; addedBy: "owner" | "request"; baseUrl: string },
): Promise<InviteOutcome> {
  if (!normalizeEmail(email)) return "bad-email";
  // A ceiling on invitation emails per day: a hijacked session can't turn this into a spam cannon.
  if (!consumeDailyUsage("invite-email", 50)) return "cap";

  const invite = createInvite(email, options);
  if (!invite.ok) {
    return invite.reason === "invalid-email"
      ? "bad-email"
      : invite.reason === "owner"
        ? "is-owner"
        : "is-active";
  }

  const redeemUrl = `${options.baseUrl}/redeem?email=${encodeURIComponent(invite.email)}&code=${invite.code}`;
  try {
    await sendEmail({
      to: invite.email,
      ...inviteMessage(invite.code, redeemUrl, invite.expiresAt),
    });
  } catch (error) {
    console.error("invite email failed:", error instanceof Error ? error.message : String(error));
    return "mail-failed";
  }
  recordEvent({ type: "invite", tier: "system" });
  return "invited";
}

export function registerAdminRoutes(app: Express, deps: { publicMode: boolean }): void {
  const json = express.json({ limit: "20kb" });
  const form = express.urlencoded({ extended: false, limit: "10kb" });
  const counts = () => ({
    members: listMembers().length,
    pending: listRequests().filter((r) => r.status === "pending").length,
  });
  const baseUrl = (req: Request) => `${req.protocol}://${req.get("host")}`;
  const flashOf = (req: Request) => (typeof req.query.m === "string" ? req.query.m : undefined);
  const shell = (req: Request, res: Response, title: string, body: string) =>
    res.send(
      page(title, body, {
        wide: true,
        viewer: { email: sessionOf(req)!.email, isOwner: true },
        analytics: false,
      }),
    );

  /** HTML forms get a redirect back to the page with a message; API callers get JSON. */
  const respond = (req: Request, res: Response, code: string, back: string, ok: boolean) => {
    if (req.is("application/x-www-form-urlencoded")) {
      res.redirect(302, `${back}?m=${encodeURIComponent(code)}`);
      return;
    }
    res.status(ok ? 200 : 400).json({ ok, result: code });
  };

  // --- Pages ---

  app.get("/admin", requireOwner, (req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const summary = summarize(loadEvents(days), days);
    const author = authorPlaceholders();
    const checklist: ChecklistItem[] = [
      {
        ok: !!contactEmail(),
        text: "A contact email is set for privacy, abuse and takedown requests (PRIVACY_EMAIL). Until then the legal pages point to public GitHub issues.",
      },
      {
        ok: !!process.env.DATA_KEY || !isProduction(),
        text: "Member data is encrypted at rest (DATA_KEY).",
      },
      { ok: !!process.env.RESEND_API_KEY, text: "Email sending is configured (RESEND_API_KEY)." },
      {
        ok: author.length === 0,
        text: author.length
          ? `The author page still has placeholders: ${author.join("; ")}.`
          : "The author page is filled in.",
      },
      { ok: true, text: `Sites blocked by request (BLOCKED_DOMAINS): ${blockedDomains().length}.` },
    ];
    shell(
      req,
      res,
      "Admin",
      adminTabs("overview", counts()) +
        overviewBody({
          summary,
          days,
          checklist,
          publicMode: deps.publicMode,
          usageToday: {
            anon: readDailyUsage("anon"),
            anonCap: LIMITS.anon.dailyCap,
            member: readDailyUsage("member"),
            memberCap: LIMITS.member.dailyCap,
          },
        }),
    );
  });

  app.get("/admin/members", requireOwner, (req, res) => {
    shell(
      req,
      res,
      "Members",
      adminTabs("members", counts()) + membersBody(listMembers(), ownerEmail(), flashOf(req)),
    );
  });

  app.get("/admin/requests", requireOwner, (req, res) => {
    shell(
      req,
      res,
      "Requests",
      adminTabs("requests", counts()) + requestsBody(listRequests(), flashOf(req)),
    );
  });

  // --- Actions (forms and JSON share these) ---

  app.post("/api/admin/invite", requireOwner, form, json, async (req, res) => {
    const result = await inviteAndEmail(asText(req.body?.email, 254), {
      note: asText(req.body?.note, 300),
      addedBy: "owner",
      baseUrl: baseUrl(req),
    });
    respond(req, res, result, "/admin/members", result === "invited");
  });

  app.post("/api/admin/members/resend", requireOwner, form, json, async (req, res) => {
    const result = await inviteAndEmail(asText(req.body?.email, 254), {
      addedBy: "owner",
      baseUrl: baseUrl(req),
    });
    respond(
      req,
      res,
      result === "invited" ? "resent" : result,
      "/admin/members",
      result === "invited",
    );
  });

  app.post("/api/admin/members/remove", requireOwner, form, json, (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const removed = email ? removeMember(email) : false;
    respond(req, res, removed ? "removed" : "not-found", "/admin/members", removed);
  });

  app.post("/api/admin/members/signout", requireOwner, form, json, (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const done = email ? signOutEverywhere(email) : false;
    respond(req, res, done ? "signedout" : "not-found", "/admin/members", done);
  });

  app.post("/api/admin/requests/approve", requireOwner, form, json, async (req, res) => {
    const request = getRequest(asText(req.body?.id, 80));
    if (!request || request.status !== "pending")
      return respond(req, res, "not-found", "/admin/requests", false);

    const result = await inviteAndEmail(request.email, {
      note: request.message.slice(0, 120),
      addedBy: "request",
      baseUrl: baseUrl(req),
    });
    // Mark it approved only if the invitation went out (or they already had access); on a mail failure it stays pending to retry.
    if (result === "invited" || result === "is-active") decideRequest(request.id, "approved");
    respond(
      req,
      res,
      result === "invited" ? "approved" : result,
      "/admin/requests",
      result === "invited",
    );
  });

  app.post("/api/admin/requests/decline", requireOwner, form, json, (req, res) => {
    const decided = decideRequest(asText(req.body?.id, 80), "declined");
    respond(req, res, decided ? "declined" : "not-found", "/admin/requests", !!decided);
  });

  // --- Read-only JSON, for anything that isn't the web UI ---

  app.get("/api/admin/analytics", requireOwner, (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    res.json({ ok: true, summary: summarize(loadEvents(days), days) });
  });

  app.get("/api/admin/members", requireOwner, (_req, res) => {
    res.json({ ok: true, members: listMembers() });
  });

  app.get("/api/admin/requests", requireOwner, (_req, res) => {
    res.json({ ok: true, requests: listRequests() });
  });
}
