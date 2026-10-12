import { escapeHtml } from "./html.js";

export const GITHUB_REPO_URL = "https://github.com/samliebl/goose-ts";
export const GITHUB_PROFILE_URL = "https://github.com/samliebl";

/** Bumped whenever the Terms or Privacy Policy change in a way people should re-accept. */
export const TERMS_VERSION = "2026-10-12";
export const POLICY_DATE = "October 12, 2026";

/**
 * Where people reach the operator about privacy requests, abuse reports and
 * takedowns. Set PRIVACY_EMAIL (or ABUSE_EMAIL) in production; until then the
 * pages fall back to GitHub issues, which works but is public -- so the admin
 * overview flags it as something to fix before opening the site.
 */
export function contactEmail(): string | null {
  return process.env.PRIVACY_EMAIL || process.env.ABUSE_EMAIL || null;
}

export function contactHtml(): string {
  const email = contactEmail();
  return email
    ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`
    : `<a href="${GITHUB_REPO_URL}/issues">GitHub issues</a>`;
}
