import chardet from "chardet";
import iconv from "iconv-lite";
import type { Configuration } from "./Configuration.js";
import { guardedFetch } from "./safeFetch.js";

function detectCharset(contentType: string | null, buffer: Buffer): string {
  const headerMatch = contentType?.match(/charset=([\w-]+)/i);
  if (headerMatch?.[1]) return headerMatch[1];
  return chardet.detect(buffer) ?? "utf-8";
}

/**
 * Fetches a URL's HTML over the network. python-goose's HtmlFetcher just
 * decoded bytes as UTF-8 unconditionally; we additionally honor the
 * response's Content-Type charset (falling back to sniffing) since that's
 * an easy, low-risk correctness win for live fetches.
 */
export class HtmlFetcher {
  request: Request | null = null;
  response: Response | null = null;
  /** Set only when the network request itself failed (DNS, connection, TLS, timeout). */
  error: unknown = null;

  constructor(private readonly config: Configuration) {}

  async getHtml(url: string): Promise<string | null> {
    this.request = new Request(url, {
      headers: { "User-Agent": this.config.browserUserAgent },
    });

    let buffer: Buffer;
    try {
      const { response, bytes } = await guardedFetch(url, this.config, {
        headers: { "User-Agent": this.config.browserUserAgent },
        maxBytes: this.config.maxResponseBytes,
        checkRobots: this.config.respectRobotsTxt,
      });
      this.response = response;
      if (!response.ok) return null;
      buffer = bytes;
    } catch (err) {
      this.response = null;
      this.error = err;
      return null;
    }

    const charset = detectCharset(this.response.headers.get("content-type"), buffer);
    try {
      return iconv.decode(buffer, charset);
    } catch {
      return buffer.toString("utf-8");
    }
  }

  getUrl(): string | null {
    return this.response?.url ?? null;
  }
}
