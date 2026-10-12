import type { Configuration } from "./Configuration.js";
import { guardedFetch } from "./safeFetch.js";

/** The site's robots.txt asks automated tools not to fetch this URL (or couldn't be read). */
export class RobotsDisallowedError extends Error {
  override name = "RobotsDisallowedError";
}

interface Rule {
  allow: boolean;
  pattern: string;
}

type Verdict = { kind: "rules"; rules: Rule[] } | { kind: "allow-all" } | { kind: "disallow-all" };

const ROBOTS_MAX_BYTES = 500_000;
const ROBOTS_TIMEOUT_MS = 5_000;
const OK_TTL_MS = 60 * 60_000;
const UNREACHABLE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 500;

const cache = new Map<string, { verdict: Verdict; expiresAt: number }>();

/** For tests. */
export function clearRobotsCache(): void {
  cache.clear();
}

/** The product token a robots.txt group would name us by: "regoose/0.2 (+https://...)" -> "regoose". */
export function productToken(userAgent: string): string {
  return (userAgent.split(/[\s/]/)[0] ?? "").toLowerCase();
}

/** Parses robots.txt into the rules that apply to `token` (its own groups if any, else the "*" groups). */
export function parseRobots(text: string, token: string): Rule[] {
  const specific: Rule[] = [];
  const wildcard: Rule[] = [];
  let currentAgents: string[] = [];
  let sawRuleInGroup = false;
  let sawSpecificGroup = false;

  for (const rawLine of text.split(/\r?\n/).slice(0, 5000)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === "user-agent") {
      // Consecutive user-agent lines share one group; one after a rule starts a new group.
      if (sawRuleInGroup) {
        currentAgents = [];
        sawRuleInGroup = false;
      }
      currentAgents.push(value.toLowerCase());
      if (value.toLowerCase() === token) sawSpecificGroup = true;
    } else if (field === "allow" || field === "disallow") {
      sawRuleInGroup = true;
      // An empty Disallow means "allow everything" -- it adds no restriction.
      if (field === "disallow" && value === "") continue;
      const rule: Rule = { allow: field === "allow", pattern: value };
      if (currentAgents.includes(token)) specific.push(rule);
      if (currentAgents.includes("*")) wildcard.push(rule);
    }
  }
  // A group naming us outranks "*" entirely, even if it has no rules of its own.
  return sawSpecificGroup ? specific : wildcard;
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Longest matching pattern wins; on a tie, Allow wins (RFC 9309). */
export function isPathAllowed(rules: Rule[], pathAndQuery: string): boolean {
  let best: { length: number; allow: boolean } | null = null;
  for (const rule of rules) {
    if (!patternToRegex(rule.pattern).test(pathAndQuery)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { length, allow: rule.allow };
    }
  }
  return best ? best.allow : true;
}

async function loadVerdict(origin: string, config: Configuration): Promise<Verdict> {
  try {
    const { response, bytes } = await guardedFetch(`${origin}/robots.txt`, config, {
      headers: { "User-Agent": config.browserUserAgent },
      maxBytes: ROBOTS_MAX_BYTES,
      timeoutMs: Math.min(config.httpTimeout, ROBOTS_TIMEOUT_MS),
    });
    // RFC 9309: a 4xx means "no robots.txt" (everything allowed); a 5xx or
    // an unreachable server means we can't know, so assume disallowed. 429
    // is a 4xx but really means "slow down," so it's treated the same way.
    if (response.ok) {
      return {
        kind: "rules",
        rules: parseRobots(bytes.toString("utf-8"), productToken(config.browserUserAgent)),
      };
    }
    if (response.status === 429 || response.status >= 500) return { kind: "disallow-all" };
    return { kind: "allow-all" };
  } catch {
    return { kind: "disallow-all" };
  }
}

/** Throws RobotsDisallowedError unless the URL's site permits fetching it. */
export async function assertRobotsAllowed(url: string, config: Configuration): Promise<void> {
  if (!config.respectRobotsTxt) return;

  const parsed = new URL(url);
  const origin = parsed.origin;
  let entry = cache.get(origin);
  if (!entry || entry.expiresAt < Date.now()) {
    const verdict = await loadVerdict(origin, config);
    entry = {
      verdict,
      expiresAt: Date.now() + (verdict.kind === "disallow-all" ? UNREACHABLE_TTL_MS : OK_TTL_MS),
    };
    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(origin, entry);
  }

  const { verdict } = entry;
  const allowed =
    verdict.kind === "allow-all" ||
    (verdict.kind === "rules" && isPathAllowed(verdict.rules, parsed.pathname + parsed.search));
  if (!allowed) {
    throw new RobotsDisallowedError(
      verdict.kind === "disallow-all"
        ? `Couldn't read ${parsed.hostname}'s robots.txt.`
        : `${parsed.hostname}'s robots.txt does not allow automated tools to fetch this page.`,
    );
  }
}
