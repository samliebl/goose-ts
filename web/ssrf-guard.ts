import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Blocks outbound fetches to loopback, private (RFC1918), CGNAT (RFC6598),
 * and link-local addresses -- the last of which includes cloud metadata
 * endpoints (169.254.169.254), the concrete reason this exists: goose-ts's
 * own HtmlFetcher does no SSRF filtering at all (it's a general-purpose
 * library, not opinionated about deployment context), so a publicly
 * reachable server built on it must add this itself before ever calling
 * goose.extract()/extractEvents() with a URL the caller controls.
 *
 * Resolves the hostname before checking, not just the URL string, so a
 * hostname that *resolves* to a blocked address is caught too, not only an
 * IP literal typed directly into the URL.
 *
 * Known limitation: this checks the resolved address at request time, then
 * lets the caller's own fetch resolve the hostname again -- a DNS answer
 * that changes between those two lookups (DNS rebinding) could in
 * principle slip through. Closing that fully means pinning the resolved IP
 * and forcing the actual fetch to use it, which needs a custom fetch
 * dispatcher; not done here. Worth hardening later if this ever becomes a
 * more attractive target than a small personal tool.
 */

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true; // malformed -- fail closed
  const [a, b] = parts as [number, number, number, number];
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 0) return true;
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local (fc00::/7)
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice("::ffff:".length);
    if (isIP(v4) === 4) return isBlockedIPv4(v4);
  }
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".internal") ||
    lower.endsWith(".local")
  );
}

/** Throws with a plain, user-facing message if the URL isn't safe to fetch server-side. */
export async function assertSafeToFetch(urlString: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("That's not a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed.");
  }

  if (isBlockedHostname(url.hostname)) {
    throw new Error("That host isn't allowed.");
  }

  const literalIpVersion = isIP(url.hostname);
  if (literalIpVersion === 4 && isBlockedIPv4(url.hostname)) {
    throw new Error("That address isn't allowed.");
  }
  if (literalIpVersion === 6 && isBlockedIPv6(url.hostname)) {
    throw new Error("That address isn't allowed.");
  }

  if (!literalIpVersion) {
    let addresses: string[];
    try {
      addresses = (await lookup(url.hostname, { all: true })).map((r) => r.address);
    } catch {
      throw new Error("Could not resolve that host.");
    }
    for (const address of addresses) {
      const version = isIP(address);
      if (version === 4 && isBlockedIPv4(address)) {
        throw new Error("That host resolves to an address that isn't allowed.");
      }
      if (version === 6 && isBlockedIPv6(address)) {
        throw new Error("That host resolves to an address that isn't allowed.");
      }
    }
  }
}
