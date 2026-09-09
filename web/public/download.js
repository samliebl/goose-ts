// Thin client for the "Download" feature. All the actual work -- plain
// text/JSON formatting, sanitized filenames, UTF-8 + BOM handling, the zip
// writer -- lives server-side now, in src/export.ts, reached through
// POST /api/export. This file's only job is to call that endpoint and save
// whatever comes back: the exact same thing the CLI's --format/--zip flags
// and any other API caller get. Nothing about export is GUI-exclusive.

async function requestExport(body) {
  const res = await fetch("/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ?? `Export failed (${res.status})`);
  }
  const filename = parseFilename(res.headers.get("content-disposition")) ?? "download";
  return { blob: await res.blob(), filename };
}

/** Reads the UTF-8-safe filename* param (falling back to the plain one) out of a Content-Disposition header -- see contentDisposition() in web/server.ts, which always sets both. */
function parseFilename(disposition) {
  if (!disposition) return null;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8Match) return decodeURIComponent(utf8Match[1]);
  const plainMatch = /filename="([^"]+)"/i.exec(disposition);
  return plainMatch ? plainMatch[1] : null;
}

function saveBlob(filename, blob) {
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
export async function downloadArticle(item, format) {
  const { blob, filename } = await requestExport({
    article: item.article,
    label: item.label,
    format,
  });
  saveBlob(filename, blob);
}

/** Downloads every successful item at once, as one .zip of individual .txt or .json files. */
export async function downloadAllArticles(items, format) {
  const okItems = items.filter((item) => item.ok);
  if (okItems.length === 0) return;
  const { blob, filename } = await requestExport({
    articles: okItems.map((item) => ({ article: item.article, label: item.label })),
    format,
    zip: true,
  });
  saveBlob(filename, blob);
}
