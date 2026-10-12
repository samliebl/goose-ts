import { Resend } from "resend";
import { formatCode } from "./access.js";
import { isProduction } from "./secrets.js";

/**
 * Every email regoose sends is transactional -- a sign-in link, an access
 * code, a notice to the owner. There is no newsletter, no marketing, and no
 * tracking pixel; nothing here needs an unsubscribe link.
 */

function resendFrom(): string {
  return process.env.RESEND_FROM ?? "regoose <send@send.regoose.com>";
}

let resendClient: Resend | null = null;

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

/**
 * Sends via Resend if RESEND_API_KEY is set; otherwise logs it to the console
 * instead -- fine for local dev (click through the flows without a key),
 * refused outright in production, where a silently-unsent email is a real
 * problem, not a convenience.
 */
export async function sendEmail(email: OutgoingEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (isProduction()) throw new Error("RESEND_API_KEY must be set in production.");
    console.log(
      `\n---- email (not sent: no RESEND_API_KEY) ----\nTo: ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n---------------------------------------------\n`,
    );
    return;
  }
  resendClient ??= new Resend(apiKey);
  await resendClient.emails.send({
    from: resendFrom(),
    to: email.to,
    subject: email.subject,
    text: email.text,
    ...(email.replyTo ? { replyTo: email.replyTo } : {}),
  });
}

export function loginLinkMessage(link: string): Pick<OutgoingEmail, "subject" | "text"> {
  return {
    subject: "Your regoose sign-in link",
    text: `Sign in to regoose: ${link}\n\nThis link works once and expires in 15 minutes. If you didn't ask for it, ignore this email and nothing will happen.`,
  };
}

export function inviteMessage(
  code: string,
  redeemUrl: string,
  expiresAt: string,
): Pick<OutgoingEmail, "subject" | "text"> {
  const days = Math.max(1, Math.round((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));
  return {
    subject: "Your regoose access code",
    text: [
      "You've been given access to regoose's full tool, which turns almost any web page into clean, readable text.",
      "",
      `Your access code: ${formatCode(code)}`,
      "",
      `Enter it here (the link fills it in for you): ${redeemUrl}`,
      "",
      `The code works once and expires in ${days} days. After you enter it you'll stay signed in on that device, and you can always get back in later with an emailed sign-in link -- there's no password to remember.`,
      "",
      "If you weren't expecting this, you can ignore it. Nothing happens unless the code is used.",
    ].join("\n"),
  };
}

export function accessRequestMessage(
  email: string,
  message: string,
  adminUrl: string,
): Pick<OutgoingEmail, "subject" | "text"> {
  return {
    subject: `regoose access request from ${email}`,
    text: [
      `${email} asked for access to regoose's full tool.`,
      "",
      message ? `What they said they'd use it for:\n${message}` : "(They didn't say what for.)",
      "",
      `Reply to this email to talk to them directly, or approve/decline here: ${adminUrl}`,
    ].join("\n"),
  };
}
