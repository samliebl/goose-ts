import type { Configuration } from "./Configuration.js";
import { assertRobotsAllowed } from "./robots.js";

/** The URL guard (or a redirect rule) refused this address. The message is safe to show users. */
export class BlockedUrlError extends Error {
  override name = "BlockedUrlError";
}

/** The response body exceeded the configured size cap. */
export class ResponseTooLargeError extends Error {
  override name = "ResponseTooLargeError";
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface GuardedFetchOptions {
  headers?: Record<string, string>;
  /** Largest body (bytes) to accept; larger responses throw ResponseTooLargeError. */
  maxBytes: number;
  /** Overrides config.httpTimeout (still clamped to the overall budget). */
  timeoutMs?: number;
  /** Check each hop's robots.txt first. Only the page fetch does this -- not images or robots.txt itself. */
  checkRobots?: boolean;
}

export interface GuardedResponse {
  response: Response;
  /** The URL actually fetched last, after any redirects. */
  finalUrl: string;
  /** The body; empty for non-2xx responses (which are never read). */
  bytes: Buffer;
}

async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new ResponseTooLargeError(`Response is larger than the ${maxBytes}-byte limit.`);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ResponseTooLargeError(`Response is larger than the ${maxBytes}-byte limit.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Every outbound request in goose-ts goes through here. Unlike a bare
 * fetch(), it (1) runs config.urlGuard before every hop, so a redirect or
 * an image URL found inside a page can't reach somewhere the first URL
 * couldn't; (2) follows redirects manually, with a cap; (3) bounds the whole
 * thing -- hops and body -- by the overall extraction budget; and (4) refuses
 * bodies over a size cap rather than buffering them whole.
 */
export async function guardedFetch(
  url: string,
  config: Configuration,
  options: GuardedFetchOptions,
): Promise<GuardedResponse> {
  const remaining = config.remainingMs();
  if (remaining <= 0) throw new Error("The extraction time budget is already spent.");
  const signal = AbortSignal.timeout(Math.min(options.timeoutMs ?? config.httpTimeout, remaining));

  let current = url;
  for (let hop = 0; hop <= config.maxRedirects; hop++) {
    await config.urlGuard?.(current);
    if (options.checkRobots) await assertRobotsAllowed(current, config);

    const response = await fetch(current, {
      headers: options.headers,
      signal,
      redirect: "manual",
    });

    const location = response.headers.get("location");
    if (REDIRECT_STATUSES.has(response.status) && location) {
      await response.body?.cancel();
      const next = new URL(location, current);
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        throw new BlockedUrlError("Redirected to a non-http(s) address.");
      }
      current = next.toString();
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();
      return { response, finalUrl: current, bytes: Buffer.alloc(0) };
    }
    return { response, finalUrl: current, bytes: await readCapped(response, options.maxBytes) };
  }
  throw new Error(`Too many redirects (more than ${config.maxRedirects}).`);
}
