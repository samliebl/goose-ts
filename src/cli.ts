import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { Goose } from "./Goose.js";
import type { ArticleInfos } from "./Article.js";
import { describeFetchFailure } from "./describeFetchFailure.js";
import {
  articlePlainText,
  encodeTextWithBom,
  renderArticleExport,
  renderArticlesZip,
  type ExportFormat,
} from "./export.js";
import { VERSION } from "./version.js";

function printUsage(): void {
  console.log(`goose-ts v${VERSION} -- article/content extraction

Usage:
  goose-ts <url>...            Fetch one or more URLs and extract each article
  goose-ts --file <path>       Extract from a local HTML file instead
  cat urls.txt | goose-ts      Read URLs (one per line) from stdin, batch mode

  --format <text|json>  Output format (default json). --text is shorthand for --format text.
  --zip                 Bundle results into one .zip of individual files (any count)
  --output <path>       Write to this file instead of stdout
  --language <lang>     Fallback language (ISO 639-1) for stopword scoring; default en
  --no-images           Skip fetching/scoring images
  --no-meta-language    Don't prefer the page's own declared language over --language
  --timeout <ms>        HTTP timeout per request; default 30000
  --overall-timeout <ms> Total budget for one extraction (mainly bounds image scoring); default 45000
  --user-agent <ua>     User-Agent sent with outbound requests
  --help                Show this help

With more than one URL, requests run sequentially (never in parallel) -- see the web
dashboard's README section for why. Output is one JSON object per URL by default, or a
JSON array once there's more than one. All three interfaces (this CLI, the local web
dashboard, and the goose-ts package itself) share the same extraction and export code --
nothing here is GUI-only.`);
}

interface Job {
  label: string;
  request: { url?: string; rawHtml?: string };
}

interface Result {
  ok: boolean;
  label: string;
  article?: ArticleInfos;
  error?: string;
}

async function readUrlsFromStdin(): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks)
    .toString("utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Writes bytes to a file, or to stdout if no path is given. Text/JSON output gets a trailing newline appended (POSIX text-file convention, and friendlier to a terminal prompt); zip bytes never do -- that would corrupt the binary. */
async function writeBytes(
  bytes: Uint8Array,
  outputPath: string | undefined,
  appendNewline: boolean,
): Promise<void> {
  const out = appendNewline ? new Uint8Array([...bytes, 0x0a]) : bytes; // 0x0a = "\n"
  if (outputPath) {
    await writeFile(outputPath, out);
  } else {
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(out, (err) => (err ? reject(err) : resolve()));
    });
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      file: { type: "string" },
      format: { type: "string" },
      text: { type: "boolean", default: false },
      zip: { type: "boolean", default: false },
      output: { type: "string" },
      language: { type: "string", short: "l" },
      "no-images": { type: "boolean", default: false },
      "no-meta-language": { type: "boolean", default: false },
      timeout: { type: "string" },
      "overall-timeout": { type: "string" },
      "user-agent": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printUsage();
    return;
  }

  if (values.format && values.format !== "text" && values.format !== "json") {
    console.error(`Unknown --format "${values.format}" -- expected "text" or "json".`);
    process.exitCode = 1;
    return;
  }
  // --format wins if given explicitly; --text is shorthand for --format text; default json.
  const format: ExportFormat =
    (values.format as ExportFormat | undefined) ?? (values.text ? "text" : "json");

  const config = {
    targetLanguage: values.language ?? "en",
    enableImageFetching: !values["no-images"],
    useMetaLanguage: !values["no-meta-language"],
    ...(values.timeout ? { httpTimeout: Number(values.timeout) } : {}),
    ...(values["overall-timeout"] ? { overallTimeoutMs: Number(values["overall-timeout"]) } : {}),
    ...(values["user-agent"] ? { browserUserAgent: values["user-agent"] } : {}),
  };
  const goose = new Goose(config);

  // --file (rawHtml) is inherently a single item -- doesn't combine with a
  // batch of URLs, so it takes priority over positionals/stdin if given.
  let jobs: Job[];
  if (values.file) {
    jobs = [{ label: values.file, request: { rawHtml: await readFile(values.file, "utf-8") } }];
  } else if (positionals.length > 0) {
    jobs = positionals.map((url) => ({ label: url, request: { url } }));
  } else if (!process.stdin.isTTY) {
    const urls = await readUrlsFromStdin();
    jobs = urls.map((url) => ({ label: url, request: { url } }));
  } else {
    jobs = [];
  }

  if (jobs.length === 0) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  // Sequential, deliberately, matching the web dashboard: a batch of URLs
  // going out one at a time, each waiting for the last to finish, never
  // looks like the concurrent bursts that trigger anti-bot/rate-limit
  // defenses -- see web/public/app.js's runBatch for the same policy.
  const results: Result[] = [];
  for (const job of jobs) {
    const article = await goose.extract(job.request);
    const failure = describeFetchFailure(article);
    if (failure) {
      results.push({ ok: false, label: job.label, error: failure });
    } else {
      results.push({ ok: true, label: job.label, article: article.infos });
    }
  }

  const failed = results.filter((r) => !r.ok);
  if (jobs.length === 1 && !results[0]!.ok) {
    // Single-URL failure stays a plain stderr message + nonzero exit,
    // matching this CLI's existing (and tested) single-URL behavior --
    // batch failures below are reported differently, inline with whatever
    // else succeeded, since aborting the whole run over one bad URL in a
    // batch would throw away everything else that worked.
    console.error(results[0]!.error);
    process.exitCode = 1;
    return;
  }

  if (values.zip) {
    const okResults = results.filter((r): r is Result & { article: ArticleInfos } => r.ok);
    if (okResults.length === 0) {
      console.error("Nothing to zip -- every URL failed.");
      process.exitCode = 1;
      return;
    }
    const zip = renderArticlesZip(
      okResults.map((r) => ({ article: r.article, label: r.label })),
      format,
    );
    await writeBytes(zip.bytes, values.output, false);
  } else if (jobs.length === 1) {
    const rendered = renderArticleExport(results[0]!.article!, jobs[0]!.label, format);
    await writeBytes(rendered.bytes, values.output, true);
  } else if (format === "json") {
    // One array entry per URL, success or failure -- mirrors the web
    // dashboard's per-result status rather than an all-or-nothing batch.
    const payload = JSON.stringify(
      results.map((r) => (r.ok ? { ok: true, label: r.label, article: r.article } : r)),
      null,
      2,
    );
    await writeBytes(new TextEncoder().encode(payload), values.output, true);
  } else {
    const separator = `\n\n${"=".repeat(40)}\n\n`;
    const combined = results
      .map((r) =>
        r.ok ? articlePlainText(r.article!, r.label) : `${r.label}\n(failed: ${r.error})`,
      )
      .join(separator);
    await writeBytes(encodeTextWithBom(combined), values.output, true);
  }

  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
