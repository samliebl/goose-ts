import type { Express, Request, Response } from "express";
import {
  acceptTerms,
  createAccessRequest,
  findMember,
  normalizeEmail,
  redeemInvite,
  removeMember,
  signOutEverywhere,
} from "./access.js";
import {
  consumeLoginToken,
  isLoginTokenUsable,
  requestLoginLink,
  sendLoginNotification,
} from "./auth.js";
import { consumeDailyUsage } from "./db.js";
import { page, type PageViewer } from "./html.js";
import { accessRequestMessage, sendEmail } from "./mailer.js";
import {
  accountBody,
  acceptTermsBody,
  checkEmailBody,
  linkExpiredBody,
  loginBody,
  messageBody,
  redeemBody,
  requestAccessBody,
  requestReceivedBody,
  verifyConfirmBody,
} from "./pages.js";
import { createRateLimiter } from "./rate-limit.js";
import { ownerEmail } from "./secrets.js";
import { clearSessionCookie, sessionOf, setSessionCookie } from "./session.js";
import { TERMS_VERSION } from "./site.js";
import { track } from "./track.js";

export function viewerOf(req: Request): PageViewer | null {
  const session = sessionOf(req);
  return session ? { email: session.email, isOwner: session.isOwner } : null;
}

/** Renders a server-side page for this viewer (header links differ for visitors, members and the owner). */
export function render(
  req: Request,
  res: Response,
  title: string,
  body: string,
  status = 200,
): void {
  res.status(status).send(page(title, body, { viewer: viewerOf(req), analytics: true }));
}

const text = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** Only same-site paths: an attacker's `next=https://evil` must not turn a login into an open redirect. */
export function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/(?!\/)[\w\-./?=&%]*$/.test(next) ? next : "/";
}

/**
 * Sign-in, access codes, access requests and the account page. Everything
 * here is reachable without being signed in (except the account page), even
 * when the rest of the site is gated, since these are how people get in.
 */
export function registerAccessRoutes(
  app: Express,
  deps: { clientIp: (req: Request) => string; publicMode: boolean },
): void {
  const { clientIp, publicMode } = deps;
  const loginLimit = createRateLimiter(5, 10 * 60_000);
  const verifyLimit = createRateLimiter(20, 10 * 60_000);
  const redeemLimit = createRateLimiter(10, 10 * 60_000);
  const requestLimit = createRateLimiter(3, 60 * 60_000);
  const tooMany = (req: Request, res: Response) =>
    render(
      req,
      res,
      "Too many requests",
      messageBody("Too many requests", "Please wait a little and try again."),
      429,
    );

  app.get("/login", (req, res) => {
    render(req, res, "Sign in", loginBody({ publicMode }));
  });

  app.post("/api/auth/request-link", async (req, res) => {
    if (!loginLimit(clientIp(req))) return tooMany(req, res);
    const email = text(req.body?.email, 254);
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    try {
      if (email) await requestLoginLink(email, baseUrl);
    } catch {
      // Fall through to the identical response below: success, failure and
      // "no such member" must never be distinguishable from outside.
    }
    track(req, clientIp(req), { type: "login_request" });
    render(req, res, "Check your email", checkEmailBody());
  });

  // The emailed link opens a confirmation page; only a button press spends
  // it. Mail scanners that fetch links in advance can't use it up.
  app.get("/api/auth/verify", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (token && isLoginTokenUsable(token))
      return render(req, res, "Sign in", verifyConfirmBody(token));
    render(req, res, "Link expired", linkExpiredBody(), 400);
  });

  app.post("/api/auth/verify", (req, res) => {
    if (!verifyLimit(clientIp(req))) return tooMany(req, res);
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const email = token ? consumeLoginToken(token) : null;
    if (!email) return render(req, res, "Link expired", linkExpiredBody(), 400);

    setSessionCookie(res, email);
    void sendLoginNotification(email);
    track(req, clientIp(req), { type: "login" });
    res.redirect(302, "/");
  });

  app.post("/api/auth/logout", (_req, res) => {
    clearSessionCookie(res);
    res.redirect(302, publicMode ? "/" : "/login");
  });

  // --- Redeeming an access code ---

  app.get("/redeem", (req, res) => {
    render(
      req,
      res,
      "Enter your access code",
      redeemBody({ email: text(req.query.email, 254), code: text(req.query.code, 20) }),
    );
  });

  app.post("/redeem", (req, res) => {
    const email = text(req.body?.email, 254);
    const code = text(req.body?.code, 40);
    const again = (error: string, status = 400) =>
      render(req, res, "Enter your access code", redeemBody({ email, code }, error), status);

    if (!redeemLimit(clientIp(req))) return tooMany(req, res);
    if (req.body?.agree !== "1")
      return again("Please agree to the Terms and Privacy Policy to continue.");

    const result = redeemInvite(email, code, TERMS_VERSION);
    if (!result.ok) {
      return again(
        result.reason === "locked"
          ? "Too many wrong attempts for that address. Please wait 15 minutes and try again."
          : "That email and code don't match, or the code has expired or been used. Check them and try again, or ask for a new code.",
      );
    }
    setSessionCookie(res, result.member.email);
    void sendLoginNotification(result.member.email);
    track(req, clientIp(req), { type: "redeem" });
    res.redirect(302, "/");
  });

  // --- Asking for access ---

  app.get("/request-access", (req, res) => {
    render(req, res, "Request access", requestAccessBody());
  });

  app.post("/api/request-access", async (req, res) => {
    if (!requestLimit(clientIp(req))) return tooMany(req, res);
    // The honeypot: a field no person sees. A bot that fills it gets the same
    // thank-you page and nothing else happens.
    if (text(req.body?.website, 100))
      return render(req, res, "Request received", requestReceivedBody());
    if (req.body?.agree !== "1") {
      return render(
        req,
        res,
        "Request access",
        messageBody(
          "One more thing",
          "Please agree to the Terms and Privacy Policy to send a request.",
          "/request-access",
          "Back",
        ),
        400,
      );
    }
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      return render(
        req,
        res,
        "Request access",
        messageBody(
          "That email doesn't look right",
          "Please check the address and try again.",
          "/request-access",
          "Back",
        ),
        400,
      );
    }
    const message = text(req.body?.message, 1000);

    // A global daily ceiling, so the form can't be used to flood the owner's inbox.
    if (consumeDailyUsage("access-request", 20)) {
      const result = createAccessRequest(email, message);
      if (result.created) {
        track(req, clientIp(req), { type: "access_request" });
        try {
          await sendEmail({
            to: ownerEmail(),
            replyTo: email,
            ...accessRequestMessage(
              email,
              message,
              `${req.protocol}://${req.get("host")}/admin/requests`,
            ),
          });
        } catch (error) {
          console.error(
            "access request notification failed:",
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    }
    // Identical for new, repeat, over-limit and member addresses: it reveals nothing about who already has access.
    render(req, res, "Request received", requestReceivedBody());
  });

  // --- Terms re-acceptance and the account page (signed in) ---

  const signedIn = (req: Request, res: Response): boolean => {
    if (sessionOf(req)) return true;
    res.redirect(302, "/login");
    return false;
  };

  app.get("/accept-terms", (req, res) => {
    if (!signedIn(req, res)) return;
    render(req, res, "Updated terms", acceptTermsBody(safeNext(req.query.next)));
  });

  app.post("/accept-terms", (req, res) => {
    if (!signedIn(req, res)) return;
    if (req.body?.agree !== "1") return res.redirect(302, "/accept-terms");
    acceptTerms(sessionOf(req)!.email, TERMS_VERSION);
    res.redirect(302, safeNext(req.body?.next));
  });

  app.get("/account", (req, res) => {
    if (!signedIn(req, res)) return;
    const session = sessionOf(req)!;
    const member = findMember(session.email);
    render(
      req,
      res,
      "Your account",
      accountBody({
        email: session.email,
        isOwner: session.isOwner,
        since: member?.redeemedAt ?? null,
        lastSeenAt: member?.lastSeenAt ?? null,
        extractions: member?.extractions ?? 0,
        termsVersion: member?.termsVersion ?? null,
        termsAcceptedAt: member?.termsAcceptedAt ?? null,
      }),
    );
  });

  app.post("/account/signout-all", (req, res) => {
    if (!signedIn(req, res)) return;
    signOutEverywhere(sessionOf(req)!.email);
    track(req, clientIp(req), { type: "signout" });
    clearSessionCookie(res);
    res.redirect(302, "/login");
  });

  app.post("/account/delete", (req, res) => {
    if (!signedIn(req, res)) return;
    const session = sessionOf(req)!;
    if (session.isOwner || req.body?.confirm !== "1") return res.redirect(302, "/account");
    track(req, clientIp(req), { type: "account_delete" });
    removeMember(session.email);
    clearSessionCookie(res);
    res
      .status(200)
      .send(
        page(
          "Account deleted",
          messageBody(
            "Your account was deleted",
            "Everything held about your email address has been erased, and you've been signed out everywhere.",
            "/",
            "Back to regoose",
          ),
          { viewer: null },
        ),
      );
  });
}
