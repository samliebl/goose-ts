import { createHash } from "node:crypto";

export interface ParsingCandidate {
  url: string;
  linkHash: string;
}

function hash(input: string): string {
  return `${createHash("md5").update(input).digest("hex")}.${Date.now()}`;
}

/** Builds a parsing candidate from raw HTML the caller already has (no fetch needed). */
export function rawParsingCandidate(url: string | undefined, rawHtml: string): ParsingCandidate {
  return { url: url ?? "", linkHash: hash(rawHtml) };
}

/** Builds a parsing candidate from a URL to crawl, expanding `#!` shebang fragments. */
export function urlParsingCandidate(urlToCrawl: string): ParsingCandidate {
  const finalUrl = urlToCrawl.includes("#!")
    ? urlToCrawl.replace("#!", "?_escaped_fragment_=")
    : urlToCrawl;
  return { url: finalUrl, linkHash: hash(finalUrl) };
}
