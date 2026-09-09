// Client-side file generation for the "Download" feature. Everything here
// runs against data already sitting in memory (an already-extracted
// article) -- none of it makes another network request.

const RESERVED_FILENAME_CHARS = '<>:"/\\|?*';
// Codepoints 0 through 31 are the C0 control characters (NUL through unit
// separator) -- checked as a plain numeric comparison below rather than a
// regex escape range, which this file didn't survive edits with intact.
const MAX_CONTROL_CHAR_CODE = 31;
// Zero-width and bidi-control characters -- invisible in a filename (or, for
// the bidi overrides, actively misleading: they can make a filename render
// in an order different from its actual character sequence). An article
// title could pick these up from tracking pixels/obfuscation tricks on the
// source page, so strip them rather than let them end up invisibly in a
// saved filename.
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

function isUnsafeFilenameChar(ch) {
  const code = ch.codePointAt(0);
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
 * characters actually reserved by filesystems (plus control characters)
 * get replaced.
 */
export function sanitizeFilename(name, fallback = "article") {
  const cleaned = Array.from(name || "")
    .map((ch) => (isUnsafeFilenameChar(ch) ? "-" : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, ""); // Windows disallows a trailing dot or space
  return (cleaned || fallback).slice(0, 120);
}

function plainTextFor(item) {
  const article = item.article;
  const lines = [article.title || "(no title found)"];

  const bylineParts = [];
  if (article.authors?.length) bylineParts.push(`By ${article.authors.join(", ")}`);
  if (article.publishDate) bylineParts.push(article.publishDate);
  if (bylineParts.length) lines.push(bylineParts.join(" — "));

  lines.push(article.meta?.canonical || item.label);
  lines.push("");
  lines.push(article.cleanedText || "(no article text extracted)");
  return lines.join("\n");
}

const textEncoder = new TextEncoder(); // always encodes to UTF-8
const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

/**
 * Encodes text as UTF-8 bytes, optionally prefixed with a UTF-8 byte-order
 * mark. Plain-text files get one; JSON never does (a BOM there isn't
 * conventional and can trip up strict parsers). Without it, a .txt file
 * with no non-ASCII characters at all is indistinguishable from one in a
 * legacy 8-bit encoding to anything that has to guess -- e.g. Windows
 * Notepad, which falls back to the system locale's codepage rather than
 * UTF-8 -- so an em dash or an accented name three paragraphs in
 * (something goose-ts has no way to predict at export time) turns into a
 * garbled glyph on open. The BOM removes the guessing entirely.
 */
function encodeUtf8(text, withBom) {
  const body = textEncoder.encode(text);
  if (!withBom) return body;
  const bytes = new Uint8Array(UTF8_BOM.length + body.length);
  bytes.set(UTF8_BOM, 0);
  bytes.set(body, UTF8_BOM.length);
  return bytes;
}

/** filename base (no extension) plus the rendered UTF-8 bytes for one article in one format. */
function renderFormat(item, format) {
  const base = sanitizeFilename(item.article.title || item.label);
  if (format === "json") {
    return { base, ext: "json", bytes: encodeUtf8(JSON.stringify(item.article, null, 2), false) };
  }
  return { base, ext: "txt", bytes: encodeUtf8(plainTextFor(item), true) };
}

function triggerDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Give the click a moment to actually start the download before freeing
  // the object URL it points to.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Downloads one article as a single .txt or .json file. */
export function downloadArticle(item, format) {
  const { base, ext, bytes } = renderFormat(item, format);
  const mime = format === "json" ? "application/json" : "text/plain;charset=utf-8";
  triggerDownload(`${base}.${ext}`, new Blob([bytes], { type: mime }));
}

/** Downloads every successful item at once, as one .zip of individual .txt or .json files. */
export function downloadAllArticles(items, format) {
  const okItems = items.filter((item) => item.ok);
  if (okItems.length === 0) return;

  const usedNames = new Set();
  const entries = okItems.map((item) => {
    const { base, ext, bytes } = renderFormat(item, format);
    let name = `${base}.${ext}`;
    for (let n = 2; usedNames.has(name); n++) name = `${base} (${n}).${ext}`;
    usedNames.add(name);
    return { name, data: bytes };
  });

  triggerDownload(`articles-${format}.zip`, buildZip(entries));
}

// -- Minimal ZIP writer (store method -- no compression) --------------------
// The entries here are small extracted-text/JSON files, so a compression
// library isn't worth the weight -- a valid ZIP just needs the right
// record structure plus a CRC32 per entry, not an actual deflate
// implementation. Record layouts below follow APPNOTE.TXT (the ZIP spec).

const CRC_TABLE = buildCrcTable();

function buildCrcTable() {
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

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time fields, as every ZIP entry timestamp is stored. */
function dosDateTime(date) {
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

/** Builds a valid (uncompressed) .zip Blob from [{ name, data: Uint8Array }]. */
function buildZip(entries) {
  // Reuses the module-level textEncoder (see encodeUtf8) -- one instance is
  // plenty; nothing about it is per-call state.
  const { time: dosTime, day: dosDate } = dosDateTime(new Date());
  const chunks = [];
  const central = [];
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

  return new Blob(chunks, { type: "application/zip" });
}
