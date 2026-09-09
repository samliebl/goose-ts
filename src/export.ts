import type { ArticleInfos } from "./Article.js";

/**
 * Turns an already-extracted article into downloadable file bytes -- plain
 * text, JSON, or a zip of several at once. This is the single
 * implementation behind every place goose-ts can export an article: the
 * CLI's --format/--zip flags, the web dashboard's download buttons (via
 * web/server.ts's /api/export), and anything else that imports this
 * package directly. None of it does any fetching -- it only ever formats
 * data the caller already has.
 */

export type ExportFormat = "text" | "json";

/** One article plus the label (source URL, or a stand-in like "(pasted HTML)") used for its filename/header when the title is missing. */
export interface ExportableArticle {
  article: ArticleInfos;
  label: string;
}

export interface RenderedExport {
  filename: string;
  bytes: Uint8Array;
  mime: string;
}

const RESERVED_FILENAME_CHARS = '<>:"/\\|?*';
// Codepoints 0 through 31 are the C0 control characters (NUL through unit
// separator) -- checked as a plain numeric comparison rather than a regex
// escape range (some tooling used to edit this file doesn't survive that
// notation intact).
const MAX_CONTROL_CHAR_CODE = 31;
// Zero-width and bidi-control characters -- invisible in a filename (or,
// for the bidi overrides, actively misleading: they can make a filename
// render in an order different from its actual character sequence). An
// article title could pick these up from tracking/obfuscation tricks on
// the source page, so strip them rather than let them end up invisibly in
// a saved filename. Article *content* is never touched -- only filenames.
const INVISIBLE_OR_BIDI_CODEPOINTS = new Set([
  0x200b,
  0x200c,
  0x200d, // zero-width space / ZWNJ / ZWJ
  0x200e,
  0x200f, // left-to-right / right-to-left marks
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e, // bidi embedding/override controls
  0x2060, // word joiner
  0xfeff, // BOM / zero-width no-break space
]);

function isUnsafeFilenameChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    code <= MAX_CONTROL_CHAR_CODE ||
    RESERVED_FILENAME_CHARS.includes(ch) ||
    INVISIBLE_OR_BIDI_CODEPOINTS.has(code)
  );
}

/**
 * Strips characters that are invalid (or awkward) in a filename on any
 * common OS, without touching non-ASCII text -- a Chinese, Arabic, or
 * accented-Latin title should come through untouched; only the handful of
 * characters actually reserved by filesystems (plus control and
 * invisible/bidi characters) get replaced.
 */
export function sanitizeFilename(name: string, fallback = "article"): string {
  const cleaned = Array.from(name || "")
    .map((ch) => (isUnsafeFilenameChar(ch) ? "-" : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, ""); // Windows disallows a trailing dot or space
  return (cleaned || fallback).slice(0, 120);
}

/** The plain-text export: title, byline, source URL, then the cleaned article text. */
export function articlePlainText(article: ArticleInfos, label: string): string {
  const lines = [article.title || "(no title found)"];

  const bylineParts: string[] = [];
  if (article.authors?.length) bylineParts.push(`By ${article.authors.join(", ")}`);
  if (article.publishDate) bylineParts.push(article.publishDate);
  if (bylineParts.length) lines.push(bylineParts.join(" — "));

  lines.push(article.meta?.canonical || label);
  lines.push("");
  lines.push(article.cleanedText || "(no article text extracted)");
  return lines.join("\n");
}

const textEncoder = new TextEncoder(); // always encodes to UTF-8
const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

/**
 * Encodes text as UTF-8 bytes, optionally prefixed with a UTF-8 byte-order
 * mark. Plain-text exports get one; JSON never does (nonstandard there,
 * and some strict parsers reject it). Without it, a .txt file with no
 * non-Latin characters at all is indistinguishable from a legacy 8-bit
 * encoding to anything that has to guess -- Windows Notepad, mainly, which
 * falls back to the system locale's codepage rather than UTF-8 -- so an em
 * dash or an accented name further into the article (unpredictable at
 * export time) turns into a garbled glyph on open. The BOM removes the
 * guessing entirely.
 */
function encodeUtf8(text: string, withBom: boolean): Uint8Array {
  const body = textEncoder.encode(text);
  if (!withBom) return body;
  const bytes = new Uint8Array(UTF8_BOM.length + body.length);
  bytes.set(UTF8_BOM, 0);
  bytes.set(body, UTF8_BOM.length);
  return bytes;
}

/** UTF-8 bytes with a leading byte-order mark -- see encodeUtf8's doc comment. Exposed for callers that need BOM-safe text bytes for something other than a single article (the CLI's multi-URL --format text batch, which concatenates several articles into one file). */
export function encodeTextWithBom(text: string): Uint8Array {
  return encodeUtf8(text, true);
}

function renderOne(
  article: ArticleInfos,
  label: string,
  format: ExportFormat,
): { base: string; ext: string; bytes: Uint8Array; mime: string } {
  const base = sanitizeFilename(article.title || label);
  if (format === "json") {
    return {
      base,
      ext: "json",
      bytes: encodeUtf8(JSON.stringify(article, null, 2), false),
      mime: "application/json",
    };
  }
  return {
    base,
    ext: "txt",
    bytes: encodeUtf8(articlePlainText(article, label), true),
    mime: "text/plain;charset=utf-8",
  };
}

/** Renders one article as a single downloadable .txt or .json file. */
export function renderArticleExport(
  article: ArticleInfos,
  label: string,
  format: ExportFormat,
): RenderedExport {
  const { base, ext, bytes, mime } = renderOne(article, label, format);
  return { filename: `${base}.${ext}`, bytes, mime };
}

/** Renders several articles at once as a single .zip of individual .txt or .json files. */
export function renderArticlesZip(
  items: ExportableArticle[],
  format: ExportFormat,
): RenderedExport {
  const usedNames = new Set<string>();
  const entries = items.map(({ article, label }) => {
    const { base, ext, bytes } = renderOne(article, label, format);
    let name = `${base}.${ext}`;
    for (let n = 2; usedNames.has(name); n++) name = `${base} (${n}).${ext}`;
    usedNames.add(name);
    return { name, data: bytes };
  });

  return {
    filename: `articles-${format}.zip`,
    bytes: buildZip(entries),
    mime: "application/zip",
  };
}

// -- Minimal ZIP writer (store method -- no compression) --------------------
// The entries here are small extracted-text/JSON files, so a compression
// library isn't worth the weight -- a valid ZIP just needs the right
// record structure plus a CRC32 per entry, not an actual deflate
// implementation. Record layouts below follow APPNOTE.TXT (the ZIP spec).
// Pure typed-array/DataView code, no Node-specific APIs -- works the same
// wherever this module runs.

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time fields, as every ZIP entry timestamp is stored. */
function dosDateTime(date: Date): { time: number; day: number } {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const day =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0xf) << 5) |
    (date.getDate() & 0x1f);
  return { time, day };
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Builds a valid (uncompressed) .zip from [{ name, data }]. */
function buildZip(entries: ZipEntry[]): Uint8Array {
  const { time: dosTime, day: dosDate } = dosDateTime(new Date());
  const chunks: Uint8Array[] = [];
  const central: Array<{ nameBytes: Uint8Array; crc: number; size: number; offset: number }> = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = textEncoder.encode(name);
    const crc = crc32(data);

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true); // local file header signature
    header.setUint16(4, 20, true); // version needed to extract
    header.setUint16(6, 0x0800, true); // general purpose flag: UTF-8 filename
    header.setUint16(8, 0, true); // compression method: stored
    header.setUint16(10, dosTime, true);
    header.setUint16(12, dosDate, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, data.length, true); // compressed size == uncompressed, stored
    header.setUint32(22, data.length, true);
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, 0, true); // extra field length

    chunks.push(new Uint8Array(header.buffer), nameBytes, data);
    central.push({ nameBytes, crc, size: data.length, offset });
    offset += 30 + nameBytes.length + data.length;
  }

  const centralStart = offset;
  for (const rec of central) {
    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true); // central directory file header signature
    header.setUint16(4, 20, true); // version made by
    header.setUint16(6, 20, true); // version needed to extract
    header.setUint16(8, 0x0800, true); // UTF-8 filename
    header.setUint16(10, 0, true); // stored
    header.setUint16(12, dosTime, true);
    header.setUint16(14, dosDate, true);
    header.setUint32(16, rec.crc, true);
    header.setUint32(20, rec.size, true);
    header.setUint32(24, rec.size, true);
    header.setUint16(28, rec.nameBytes.length, true);
    header.setUint16(30, 0, true); // extra field length
    header.setUint16(32, 0, true); // comment length
    header.setUint16(34, 0, true); // disk number start
    header.setUint16(36, 0, true); // internal attributes
    header.setUint32(38, 0, true); // external attributes
    header.setUint32(42, rec.offset, true); // offset of local header

    chunks.push(new Uint8Array(header.buffer), rec.nameBytes);
    offset += 46 + rec.nameBytes.length;
  }
  const centralSize = offset - centralStart;

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); // end of central directory signature
  eocd.setUint16(8, central.length, true); // entries on this disk
  eocd.setUint16(10, central.length, true); // total entries
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, centralStart, true);
  chunks.push(new Uint8Array(eocd.buffer));

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}
