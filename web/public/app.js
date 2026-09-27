// All extracted content comes from arbitrary, untrusted web pages. Every
// value that originates from `article` is inserted via textContent (or as
// a safe attribute like <img src>), never innerHTML -- see appendResultItem
// and buildMetadataBlock.

import { downloadArticle, downloadAllArticles } from "./download.js";

const $ = (id) => document.getElementById(id);

const THEME_KEY = "goose-ts-theme";
const themeToggle = $("theme-toggle");
const themeIcon = themeToggle.querySelector(".theme-icon");
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

function effectiveTheme() {
  const stored = document.documentElement.getAttribute("data-theme");
  if (stored === "light" || stored === "dark") return stored;
  return prefersDark.matches ? "dark" : "light";
}

function syncThemeIcon() {
  // Icon shows the theme a click will switch *to*.
  themeIcon.textContent = effectiveTheme() === "dark" ? "☀️" : "🌙";
}

themeToggle.addEventListener("click", () => {
  const next = effectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
  syncThemeIcon();
});

prefersDark.addEventListener("change", () => {
  if (!document.documentElement.getAttribute("data-theme")) syncThemeIcon();
});

syncThemeIcon();

// Only the owner account can do anything at /admin (see requireOwner in
// server.ts) -- everyone else would just get a 403 in there, so the link
// stays hidden unless /api/me confirms it's worth showing.
fetch("/api/me")
  .then((r) => (r.ok ? r.json() : null))
  .then((me) => {
    if (me?.isOwner) $("admin-link").classList.remove("hidden");
  })
  .catch(() => {});

const urlInput = $("url-input");
const htmlInput = $("html-input");
const htmlUrlInput = $("html-url-input");
const extractBtn = $("extract-btn");
const btnLabel = extractBtn.querySelector(".btn-label");
const spinner = extractBtn.querySelector(".spinner");
const errorBox = $("error-box");
const emptyState = $("empty-state");
const results = $("results");
const resultsList = $("results-list");
const statusBar = $("status-bar");
const downloadAllRow = $("download-all-row");
const resultsLayout = $("results-layout");
const resultSide = $("result-side");
const sideHeading = $("side-heading");
const sidebarMetadata = $("sidebar-metadata");

// Matches the `max-width: 900px` breakpoint in style.css that stacks
// .results-layout to one column. Above it there's room for a persistent
// metadata side column with a toggle per result; at or below it, each
// result instead carries its own metadata inline (see appendResultItem) --
// a separate "which one is showing" toggle isn't usable once the panel it
// affects has scrolled off to who-knows-where on a phone-sized screen.
const DESKTOP_SIDEBAR_BREAKPOINT = 900;
function isDesktopLayout() {
  return window.innerWidth > DESKTOP_SIDEBAR_BREAKPOINT;
}
/** Which layout the current batch was rendered for -- set once per Extract click. */
let desktopLayout = isDesktopLayout();

let activeTab = "url";

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    activeTab = tab.dataset.tab;
    for (const t of document.querySelectorAll(".tab")) {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", String(t === tab));
    }
    for (const content of document.querySelectorAll("[data-tab-content]")) {
      content.classList.toggle("hidden", content.dataset.tabContent !== activeTab);
    }
  });
}

// targetLanguage is only ever consulted as a fallback (see
// Configuration/BaseExtractor.getLanguage) when useMetaLanguage is off, or
// the page has no detectable language -- so the select does nothing while
// "prefer page's declared language" is checked. Disabling it makes that
// dependency visible instead of a silently-ignored dropdown.
const useMetaLanguageCheckbox = $("cfg-use-meta-language");
const targetLanguageSelect = $("cfg-target-language");

function syncTargetLanguageAvailability() {
  targetLanguageSelect.disabled = useMetaLanguageCheckbox.checked;
}

useMetaLanguageCheckbox.addEventListener("change", syncTargetLanguageAvailability);
syncTargetLanguageAvailability();

function readConfig() {
  return {
    enableImageFetching: $("cfg-enable-images").checked,
    useMetaLanguage: $("cfg-use-meta-language").checked,
    targetLanguage: $("cfg-target-language").value,
    httpTimeout: Number($("cfg-http-timeout").value) || 30000,
    ...($("cfg-user-agent").value.trim()
      ? { browserUserAgent: $("cfg-user-agent").value.trim() }
      : {}),
  };
}

function setLoading(loading, progressText) {
  extractBtn.disabled = loading;
  spinner.classList.toggle("hidden", !loading);
  btnLabel.textContent = loading ? (progressText ?? "Extracting…") : "Extract";
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function clearError() {
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// Thrown when the browser can't reach this app's own local server at all
// (as opposed to the server reaching out to a *target* URL and that failing
// -- which is a normal per-item result, not this). Once this happens once
// in a batch, every remaining request is going to fail the same way, so the
// batch stops instead of repeating a doomed fetch per URL.
class LocalServerUnreachableError extends Error {}

/** Current batch's results, in submission order. Rebuilt on each Extract click. */
let currentResults = [];
/** Index into currentResults whose metadata is shown in the sidebar, or null. */
let selectedIndex = null;

async function extract() {
  clearError();

  if (activeTab === "html") {
    if (!htmlInput.value.trim()) {
      showError("Paste some HTML first.");
      return;
    }
    const url = htmlUrlInput.value.trim();
    await runBatch([
      {
        label: url || "(pasted HTML)",
        request: { rawHtml: htmlInput.value, url: url || undefined, config: readConfig() },
      },
    ]);
    return;
  }

  const urls = urlInput.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    showError("Enter at least one URL.");
    return;
  }

  await runBatch(urls.map((url) => ({ label: url, request: { url, config: readConfig() } })));
}

/** Runs one extraction request. Never throws for a target-URL failure -- that comes back as { ok: false }. */
async function runOne(job) {
  try {
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(job.request),
    });
    const payload = await res.json();

    if (!res.ok || !payload.ok) {
      return {
        label: job.label,
        ok: false,
        error: payload.error ?? `Request failed (${res.status})`,
        elapsedMs: payload.elapsedMs ?? 0,
      };
    }

    return { label: job.label, ok: true, article: payload.article, elapsedMs: payload.elapsedMs };
  } catch (err) {
    // Browsers throw TypeError specifically for a fetch that never got a
    // response at all ("Failed to fetch" in Chrome, "NetworkError..." in
    // Firefox, "Load failed" in Safari) -- as opposed to a request that
    // reached the server and came back with an HTTP error, which is
    // already handled above. This almost always means the browser itself
    // couldn't reach this page's own server, not that extraction of the
    // target URL failed -- e.g. an embedded/sandboxed browser view that
    // blocks requests to localhost, or the "npm run web" process having
    // been stopped. Treat it as fatal for the whole batch, not this one item.
    if (err instanceof TypeError) {
      throw new LocalServerUnreachableError(
        `Could not reach the local server at ${window.location.origin}. Make sure "npm run web" ` +
          `is still running. If you're viewing this page inside an embedded or sandboxed browser ` +
          `view, it may be blocking requests to localhost -- try a regular browser tab instead.`,
      );
    }
    return {
      label: job.label,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      elapsedMs: 0,
    };
  }
}

async function runBatch(jobs) {
  currentResults = [];
  selectedIndex = null;
  // Also re-decided on resize if the breakpoint is actually crossed
  // afterward -- see the resize listener below.
  desktopLayout = isDesktopLayout();
  emptyState.classList.add("hidden");
  results.classList.remove("hidden");
  clearChildren(resultsList);
  renderStatusBar([]);

  setLoading(true, jobs.length > 1 ? `Extracting 1/${jobs.length}…` : "Extracting…");

  // Sequential, deliberately: never fire these in parallel. A batch of
  // URLs -- especially ones that might share a domain -- going out one at
  // a time, each waiting for the last to fully finish, looks nothing like
  // the concurrent bursts that trigger anti-bot/rate-limit defenses.
  for (let i = 0; i < jobs.length; i++) {
    if (jobs.length > 1) setLoading(true, `Extracting ${i + 1}/${jobs.length}…`);

    let item;
    try {
      item = await runOne(jobs[i]);
    } catch (err) {
      if (err instanceof LocalServerUnreachableError) {
        showError(err.message);
        break;
      }
      item = {
        label: jobs[i].label,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        elapsedMs: 0,
      };
    }

    currentResults.push(item);
    if (selectedIndex === null && item.ok) selectedIndex = currentResults.length - 1;
    appendResultItem(item, currentResults.length - 1, jobs.length > 1);
    renderStatusBar(currentResults);
  }

  if (selectedIndex === null && currentResults.length > 0) selectedIndex = 0;
  renderSidebar();
  setLoading(false);
}

extractBtn.addEventListener("click", extract);

// These two buttons are static (see index.html) and always act on whatever
// currentResults holds at click time, so they're wired up once here rather
// than rebuilt on every render. downloadAllArticles hits /api/export now
// (see download.js), so a click can fail (server down, bad response) --
// report that instead of leaving it an unhandled rejection.
$("download-all-txt").addEventListener("click", () =>
  runDownload(() => downloadAllArticles(currentResults, "txt")),
);
$("download-all-json").addEventListener("click", () =>
  runDownload(() => downloadAllArticles(currentResults, "json")),
);

async function runDownload(action) {
  try {
    await action();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
}

htmlUrlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") extract();
});

// The URL field is now multi-line (one URL per row), so plain Enter has to
// stay a newline -- ⌘/Ctrl+Enter runs the batch instead.
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    extract();
  }
});

// Whether to show the sidebar+toggle or inline-per-result metadata is
// decided once per Extract (see `desktopLayout`), not on every resize --
// re-fetching nothing costs nothing, so if the window is dragged across the
// breakpoint afterward, bring the already-fetched results along instead of
// leaving them stuck in whichever mode they were built for.
let resizeRerenderTimer = null;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeRerenderTimer);
  resizeRerenderTimer = window.setTimeout(() => {
    if (currentResults.length === 0) return;
    const nowDesktop = isDesktopLayout();
    if (nowDesktop === desktopLayout) return; // breakpoint wasn't actually crossed
    desktopLayout = nowDesktop;
    renderAllResults();
  }, 150);
});

function chip(text) {
  const span = document.createElement("span");
  span.className = "chip";
  span.textContent = text;
  return span;
}

function downloadButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "download-btn";
  button.textContent = label;
  button.addEventListener("click", () => runDownload(onClick));
  return button;
}

function metaRow(dl, label, value) {
  if (!value) return;
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  dl.append(dt, dd);
}

function renderStatusBar(items) {
  clearChildren(statusBar);

  const okCount = items.filter((r) => r.ok).length;
  const failCount = items.length - okCount;
  const totalMs = items.reduce((sum, r) => sum + (r.elapsedMs || 0), 0);

  // With exactly one result, this would just duplicate the per-article
  // download buttons wrapped pointlessly in a one-file zip -- only worth
  // showing once there's an actual batch to bundle.
  downloadAllRow.classList.toggle("hidden", okCount < 2);

  const okSpan = document.createElement("span");
  okSpan.className = "ok";
  okSpan.textContent = items.length > 1 ? `✓ ${okCount} extracted` : "✓ extracted";
  if (okCount > 0) statusBar.append(okSpan);

  if (failCount > 0) {
    const failSpan = document.createElement("span");
    failSpan.className = "bad";
    failSpan.textContent = items.length > 1 ? `✗ ${failCount} failed` : "✗ failed";
    statusBar.append(failSpan);
  }

  if (items.length > 0) {
    const timing = document.createElement("span");
    timing.textContent = items.length > 1 ? `${totalMs}ms total` : `${totalMs}ms`;
    statusBar.append(timing);
  }

  if (items.length === 1 && items[0].ok && items[0].article?.domain) {
    const domain = document.createElement("span");
    domain.textContent = items[0].article.domain;
    statusBar.append(domain);
  }
  if (items.length === 1) {
    const urlSpan = document.createElement("span");
    urlSpan.textContent = items[0].label;
    statusBar.append(urlSpan);
  }
}

/** Rebuilds the whole results list + sidebar from currentResults -- no fetching, just re-rendering (used after a resize crosses the desktop breakpoint). */
function renderAllResults() {
  clearChildren(resultsList);
  const isBatch = currentResults.length > 1;
  currentResults.forEach((item, i) => appendResultItem(item, i, isBatch));
  renderSidebar();
}

/** Builds and appends one <details> for a single extraction result. */
function appendResultItem(item, index, isBatch) {
  const details = document.createElement("details");
  details.className = "result-item";
  // A single result stays open, matching the old single-result UI. In a
  // batch, everything starts collapsed -- each summary is enough to scan.
  details.open = !isBatch;

  const summary = document.createElement("summary");

  const titleSpan = document.createElement("span");
  titleSpan.className = "result-item-title";
  titleSpan.textContent = item.ok ? item.article.title || "(no title found)" : item.label;
  summary.append(titleSpan);

  const statusSpan = document.createElement("span");
  statusSpan.className = "result-item-status";
  statusSpan.textContent = item.ok
    ? `✓ ${item.elapsedMs}ms${item.article?.domain ? ` · ${item.article.domain}` : ""}`
    : "✗ failed";
  if (!item.ok) statusSpan.classList.add("bad");
  summary.append(statusSpan);

  // Only meaningful (and only shown) once there's more than one result --
  // with a single result the sidebar always shows that one, same as before.
  // And only on the desktop layout -- see appendResultItem's other branch.
  if (desktopLayout && isBatch && item.ok) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "meta-toggle";
    toggle.textContent = "Metadata";
    toggle.setAttribute("aria-pressed", String(index === selectedIndex));
    toggle.dataset.index = String(index);
    toggle.addEventListener("click", (e) => {
      // Prevent <summary>'s own click handling (which would otherwise also
      // toggle this item open/closed) -- this button only changes which
      // result's metadata the sidebar shows.
      e.preventDefault();
      e.stopPropagation();
      selectedIndex = index;
      renderSidebar();
      for (const btn of resultsList.querySelectorAll(".meta-toggle")) {
        btn.setAttribute("aria-pressed", String(Number(btn.dataset.index) === selectedIndex));
      }
    });
    summary.append(toggle);
  }

  details.append(summary);

  const body = document.createElement("div");
  body.className = "result-item-body";

  if (!item.ok) {
    const p = document.createElement("p");
    p.className = "error";
    p.textContent = item.error;
    body.append(p);
  } else {
    const article = item.article;

    const bylineParts = [];
    if (article.authors?.length) bylineParts.push(`By ${article.authors.join(", ")}`);
    if (article.publishDate) bylineParts.push(article.publishDate);
    if (bylineParts.length) {
      const byline = document.createElement("p");
      byline.className = "byline";
      byline.textContent = bylineParts.join(" — ");
      body.append(byline);
    }

    if (article.meta?.description) {
      const description = document.createElement("p");
      description.className = "description";
      description.textContent = article.meta.description;
      body.append(description);
    }

    if (article.tags?.length) {
      const tagsBox = document.createElement("div");
      tagsBox.className = "chips";
      for (const tag of article.tags) tagsBox.append(chip(tag));
      body.append(tagsBox);
    }

    const textBox = document.createElement("article");
    textBox.className = "article-text";
    const paragraphs = article.cleanedText ? article.cleanedText.split("\n\n") : [];
    if (paragraphs.length === 0) {
      const p = document.createElement("p");
      p.textContent = "(no article text extracted)";
      textBox.append(p);
    } else {
      for (const paragraph of paragraphs) {
        const p = document.createElement("p");
        p.textContent = paragraph;
        textBox.append(p);
      }
    }
    body.append(textBox);

    const downloadRow = document.createElement("div");
    downloadRow.className = "download-row";
    downloadRow.append(
      downloadButton(".txt", () => downloadArticle(item, "txt")),
      downloadButton(".json", () => downloadArticle(item, "json")),
    );
    body.append(downloadRow);

    // No room for a persistent side column below the desktop breakpoint --
    // each result carries its own metadata inline instead, right where
    // it's easy to find, collapsed by default so it doesn't compete with
    // the article text for attention.
    if (!desktopLayout) {
      const metaDetails = document.createElement("details");
      metaDetails.className = "item-metadata";
      const metaSummary = document.createElement("summary");
      metaSummary.textContent = "Metadata";
      metaDetails.append(metaSummary, buildMetadataBlock(article));
      body.append(metaDetails);
    }
  }

  details.append(body);
  resultsList.append(details);
}

/** One labeled box (Meta, OpenGraph) holding an already-built element. */
function sideSection(heading, contentEl) {
  const section = document.createElement("div");
  section.className = "side-section";
  const h3 = document.createElement("h3");
  h3.textContent = heading;
  section.append(h3, contentEl);
  return section;
}

/** One collapsed <details> box holding a count and a list of rendered items. */
function scrollListDetails(label, items, renderItem) {
  const details = document.createElement("details");
  details.className = "side-section";
  const summary = document.createElement("summary");
  summary.textContent = `${label} (${items.length})`;
  const list = document.createElement("ul");
  list.className = "scroll-list";
  for (const value of items) {
    const li = document.createElement("li");
    li.append(renderItem(value));
    list.append(li);
  }
  details.append(summary, list);
  return details;
}

/**
 * Builds one article's full metadata display (image, meta, OpenGraph,
 * links, tweets, videos, raw JSON) as a standalone element. Used both for
 * the desktop sidebar (one at a time, picked with the "Metadata" toggle)
 * and, below the desktop breakpoint, once per result inline -- see
 * appendResultItem and renderSidebar.
 */
function buildMetadataBlock(article) {
  const wrap = document.createElement("div");
  wrap.className = "metadata-block";

  if (article?.image?.url) {
    const imageCard = document.createElement("div");
    imageCard.className = "image-card";
    const img = document.createElement("img");
    img.src = article.image.url;
    img.alt = article.title || "article image";
    img.loading = "lazy";
    const meta = document.createElement("div");
    meta.className = "image-meta";
    meta.textContent = `${article.image.width}×${article.image.height}`;
    imageCard.append(img, meta);
    wrap.append(imageCard);
  }

  const metaList = document.createElement("dl");
  metaRow(metaList, "lang", article?.meta?.lang);
  metaRow(metaList, "keywords", article?.meta?.keywords);
  metaRow(metaList, "canonical", article?.meta?.canonical);
  metaRow(metaList, "favicon", article?.meta?.favicon);
  // A box with a heading and nothing else reads as broken, not "no data" --
  // leave it out entirely rather than show an empty gray card.
  if (metaList.childElementCount > 0) wrap.append(sideSection("Meta", metaList));

  const ogList = document.createElement("dl");
  for (const [key, value] of Object.entries(article?.opengraph ?? {})) {
    metaRow(ogList, key, value);
  }
  if (ogList.childElementCount > 0) wrap.append(sideSection("OpenGraph", ogList));

  wrap.append(
    scrollListDetails("Links", article?.links ?? [], (href) => document.createTextNode(href)),
  );
  wrap.append(
    scrollListDetails("Tweets", article?.tweets ?? [], (tweetHtml) => {
      const code = document.createElement("code");
      code.textContent = tweetHtml; // escaped text, not rendered as live HTML
      return code;
    }),
  );
  wrap.append(
    scrollListDetails("Videos", article?.movies ?? [], (movie) => {
      const frag = document.createDocumentFragment();
      const summary = document.createElement("div");
      summary.textContent = `${movie.provider ?? "unknown"} · ${movie.embedType ?? ""} · ${movie.width ?? "?"}×${movie.height ?? "?"}`;
      const code = document.createElement("code");
      code.textContent = movie.embedCode ?? movie.src ?? "";
      frag.append(summary, code);
      return frag;
    }),
  );

  const jsonDetails = document.createElement("details");
  jsonDetails.className = "side-section";
  const jsonSummary = document.createElement("summary");
  jsonSummary.textContent = "Raw JSON";
  const jsonPre = document.createElement("pre");
  jsonPre.className = "json-view";
  jsonPre.textContent = article ? JSON.stringify(article, null, 2) : "";
  jsonDetails.append(jsonSummary, jsonPre);
  wrap.append(jsonDetails);

  return wrap;
}

/** Renders the persistent sidebar for whichever result is currently selected -- desktop layout only. */
function renderSidebar() {
  // Drives the grid's column count directly, rather than leaving it to the
  // CSS breakpoint alone -- see the .single-column comment in style.css.
  resultsLayout.classList.toggle("single-column", !desktopLayout);

  if (!desktopLayout) {
    resultSide.classList.add("hidden");
    return;
  }
  resultSide.classList.remove("hidden");

  const item = selectedIndex !== null ? currentResults[selectedIndex] : undefined;
  const isBatch = currentResults.length > 1;

  sideHeading.classList.toggle("hidden", !isBatch);
  if (isBatch) {
    sideHeading.textContent = item?.ok
      ? `Viewing: ${item.article.title || item.label}`
      : "No metadata (fetch failed)";
  }

  clearChildren(sidebarMetadata);
  sidebarMetadata.append(buildMetadataBlock(item?.ok ? item.article : undefined));
}
