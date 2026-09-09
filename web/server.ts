import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  Configuration,
  Goose,
  renderArticleExport,
  renderArticlesZip,
  type ArticleInfos,
  type ConfigurationOptions,
  type ExportableArticle,
  type ExportFormat,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
const HOST = "127.0.0.1";

interface ExtractRequestBody {
  url?: string;
  rawHtml?: string;
  config?: Partial<ConfigurationOptions>;
}

interface ExportRequestBody {
  // Single article: { article, label }. Several at once (always zipped): { articles: [{article, label}, ...] }.
  article?: ArticleInfos;
  label?: string;
  articles?: ExportableArticle[];
  format?: ExportFormat;
  /** Force a .zip even for a single article. More than one article always gets one, regardless of this flag. */
  zip?: boolean;
}

/** RFC 6266/5987 Content-Disposition, so a filename with non-ASCII characters (an article title in Chinese, say) survives download correctly instead of being mangled or rejected. */
function contentDisposition(filename: string): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(join(here, "public")));

app.post("/api/extract", async (req, res) => {
  const body = req.body as ExtractRequestBody;

  if (!body.url && !body.rawHtml) {
    res.status(400).json({ error: "Provide either a url or rawHtml." });
    return;
  }

  const started = performance.now();
  try {
    const config = new Configuration(body.config ?? {});
    const goose = new Goose(config);
    const article = await goose.extract({ url: body.url, rawHtml: body.rawHtml });

    // HtmlFetcher swallows fetch errors and returns null rather than
    // throwing (faithful to python-goose's HtmlFetcher, which does the
    // same) -- Crawler then just returns an empty Article, with no
    // exception for this catch block to report. article.fetchError is set
    // only on that path (network failure OR non-2xx status, e.g. a 403
    // from anti-bot protection), so check it explicitly to tell "the URL
    // itself couldn't be fetched" apart from "fetched fine, but there was
    // nothing worth extracting."
    if (article.fetchError) {
      res.status(502).json({
        ok: false,
        elapsedMs: Math.round(performance.now() - started),
        error: `Could not fetch ${body.url}: ${article.fetchError}. If this is a non-2xx status, the site may be blocking this request's User-Agent -- try customizing it below.`,
      });
      return;
    }

    res.json({
      ok: true,
      elapsedMs: Math.round(performance.now() - started),
      article: article.infos,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      elapsedMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Pure formatting, no fetching -- takes article(s) the caller already has
// (typically from a prior /api/extract call) and renders them as a
// downloadable .txt/.json file, or a .zip of several. This is exactly what
// the web dashboard's own download buttons call; nothing about the export
// feature is GUI-only. See src/export.ts for the actual rendering logic.
app.post("/api/export", (req, res) => {
  const body = req.body as ExportRequestBody;
  const format: ExportFormat = body.format === "text" ? "text" : "json";

  const items: ExportableArticle[] = body.articles?.length
    ? body.articles
    : body.article
      ? [{ article: body.article, label: body.label ?? "article" }]
      : [];

  if (items.length === 0) {
    res
      .status(400)
      .json({ ok: false, error: "Provide article + label, or articles: [{ article, label }]." });
    return;
  }

  try {
    // More than one article always gets zipped -- there's only one HTTP
    // response to hand back, and a zip is the closest thing to "several
    // real files" that a single response body can be. A single article
    // gets zipped too only if the caller explicitly asked for it.
    const wantsZip = body.zip === true || items.length > 1;
    const rendered = wantsZip
      ? renderArticlesZip(items, format)
      : renderArticleExport(items[0]!.article, items[0]!.label, format);

    res.setHeader("Content-Type", rendered.mime);
    res.setHeader("Content-Disposition", contentDisposition(rendered.filename));
    res.send(Buffer.from(rendered.bytes));
  } catch (error) {
    res
      .status(500)
      .json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`goose-ts web UI: http://${HOST}:${PORT}`);
  console.log(
    "(local dev tool only -- not part of the published package, don't expose this port publicly)",
  );
});
