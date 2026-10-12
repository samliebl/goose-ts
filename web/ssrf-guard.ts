import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { BlockedUrlError } from "../src/index.js";

/**
 * Blocks outbound fetches to loopback, private (RFC1918), CGNAT (RFC6598),
 * link-local (incl. the cloud metadata address 169.254.169.254), multicast,
 * and other non-public ranges -- the reason this exists: goose-ts's own
 * fetcher is a general-purpose library with no opinion about deployment, so
 * a publicly reachable server built on it must add this itself.
 *
 * It's installed as Configuration.urlGuard, so it runs before the page
 * fetch, before every redirect hop, and before every image -- not just on
 * the URL the visitor typed.
 *
 * Resolves the hostname before checking, not just the URL string, so a
 * hostname that *resolves* to a blocked address is caught too.
 *
 * Known limitation: this checks the resolved address, then lets fetch
 * resolve the hostname again -- a DNS answer that changes between those two
 * lookups (DNS rebinding) could in principle slip through. Closing that
 * fully means pinning the resolved IP for the actual connection, which
 * needs a custom fetch dispatcher; not done. The public tier only reaches
 * a fixed allowlist of domains, which keeps that out of anonymous reach.
 */

function isBlockedIPv4Octets(a: number, b: number, c: number): boolean {
  if (a === 0) return true; // "this" network
  if (a === 10) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol / TEST-NET-1
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast and reserved
  return false;
}

export function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true; // malformed -- fail closed
  }
  return isBlockedIPv4Octets(parts[0]!, parts[1]!, parts[2]!);
}

/** Expands an IPv6 literal (with "::" and/or a trailing dotted IPv4) into its eight 16-bit groups. */
function parseIPv6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);

  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = tail.split(".").map(Number);
    if (v4.length !== 4 || v4.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
    text = `${text.slice(0, lastColon + 1)}${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;

  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.length === 8 && nums.every((n) => !Number.isNaN(n)) ? nums : null;
}

export function isBlockedIPv6(ip: string): boolean {
  const g = parseIPv6(ip);
  if (!g) return true; // malformed -- fail closed

  const v4 = (hi: number, lo: number) => isBlockedIPv4Octets(hi >> 8, hi & 255, lo >> 8);
  const firstFiveZero = g.slice(0, 5).every((n) => n === 0);

  if (g.every((n) => n === 0)) return true; // ::
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true; // ::1
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // link-local
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // unique local -- includes Fly's private 6PN (fdaa::/16)
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  if (firstFiveZero && g[5] === 0xffff) return v4(g[6]!, g[7]!); // IPv4-mapped
  if (firstFiveZero && g[5] === 0) return true; // deprecated IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0)) {
    return v4(g[6]!, g[7]!); // NAT64
  }
  if (g[0] === 0x2002) return v4(g[1]!, g[2]!); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  return (
    !hostname.includes(".") || // single-label names resolve via internal search domains
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".local")
  );
}

/**
 * node:dns/promises' lookup() has no timeout option -- without one, a
 * hostname whose resolver never answers hangs this call, and everything
 * waiting on it, indefinitely. It needs its own bound.
 */
const DNS_LOOKUP_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Throws a BlockedUrlError with a plain, user-facing message if the URL isn't safe to fetch server-side. */
export async function assertSafeToFetch(urlString: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new BlockedUrlError("That's not a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError("Only http and https URLs are allowed.");
  }
  if (url.username || url.password) {
    throw new BlockedUrlError("URLs with a username or password aren't allowed.");
  }
  if (url.port !== "" && url.port !== "80" && url.port !== "443") {
    throw new BlockedUrlError("Only the standard web ports (80 and 443) are allowed.");
  }

  // WHATWG URL keeps the brackets on IPv6 hostnames; drop them (and any trailing root dot).
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const literal = isIP(hostname);

  if (literal === 4 || literal === 6) {
    if (literal === 4 ? isBlockedIPv4(hostname) : isBlockedIPv6(hostname)) {
      throw new BlockedUrlError("That address isn't allowed.");
    }
    return;
  }

  if (isBlockedHostname(hostname.toLowerCase())) {
    throw new BlockedUrlError("That host isn't allowed.");
  }

  let addresses: string[];
  try {
    addresses = (
      await withTimeout(
        lookup(hostname, { all: true }),
        DNS_LOOKUP_TIMEOUT_MS,
        () => new Error("timed out"),
      )
    ).map((r) => r.address);
  } catch {
    throw new BlockedUrlError("Could not resolve that host.");
  }
  for (const address of addresses) {
    const version = isIP(address);
    if (version === 4 ? isBlockedIPv4(address) : isBlockedIPv6(address)) {
      throw new BlockedUrlError("That host resolves to an address that isn't allowed.");
    }
  }
}
