// All extracted content comes from arbitrary, untrusted web pages. Every
// value that originates from `article` is inserted via textContent (or as
// a safe attribute like <img src>), never innerHTML -- see renderResults.

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

const urlInput = $("url-input");
const htmlInput = $("html-input");
const htmlUrlInput = $("html-url-input");
const extractBtn = $("extract-btn");
const btnLabel = extractBtn.querySelector(".btn-label");
const spinner = extractBtn.querySelector(".spinner");
const errorBox = $("error-box");
const emptyState = $("empty-state");
const results = $("results");

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

function setLoading(loading) {
  extractBtn.disabled = loading;
  spinner.classList.toggle("hidden", !loading);
  btnLabel.textContent = loading ? "Extracting…" : "Extract";
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

async function extract() {
  clearError();

  const body =
    activeTab === "url"
      ? { url: urlInput.value.trim(), config: readConfig() }
      : {
          rawHtml: htmlInput.value,
          url: htmlUrlInput.value.trim() || undefined,
          config: readConfig(),
        };

  if (activeTab === "url" && !body.url) {
    showError("Enter a URL first.");
    return;
  }
  if (activeTab === "html" && !body.rawHtml.trim()) {
    showError("Paste some HTML first.");
    return;
  }

  setLoading(true);
  try {
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json();

    if (!res.ok || !payload.ok) {
      showError(payload.error ?? `Request failed (${res.status})`);
      return;
    }

    renderResults(payload.article, payload.elapsedMs, (body.url ?? body.rawHtml) ? body.url : "");
  } catch (err) {
    // Browsers throw TypeError specifically for a fetch that never got a
    // response at all ("Failed to fetch" in Chrome, "NetworkError..." in
    // Firefox, "Load failed" in Safari) -- as opposed to a request that
    // reached the server and came back with an HTTP error, which is
    // already handled above. This almost always means the browser itself
    // couldn't reach this page's own server, not that extraction failed --
    // e.g. an embedded/sandboxed browser view that blocks requests to
    // localhost, or the "npm run web" process having been stopped.
    if (err instanceof TypeError) {
      showError(
        `Could not reach the local server at ${window.location.origin}. Make sure "npm run web" ` +
          `is still running. If you're viewing this page inside an embedded or sandboxed browser ` +
          `view, it may be blocking requests to localhost -- try a regular browser tab instead.`,
      );
    } else {
      showError(err instanceof Error ? err.message : String(err));
    }
  } finally {
    setLoading(false);
  }
}

extractBtn.addEventListener("click", extract);
for (const input of [urlInput, htmlUrlInput]) {
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") extract();
  });
}

function chip(text) {
  const span = document.createElement("span");
  span.className = "chip";
  span.textContent = text;
  return span;
}

function metaRow(dl, label, value) {
  if (!value) return;
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  dl.append(dt, dd);
}

function renderResults(article, elapsedMs, requestedUrl) {
  emptyState.classList.add("hidden");
  results.classList.remove("hidden");

  const statusBar = $("status-bar");
  clearChildren(statusBar);
  const ok = document.createElement("span");
  ok.className = "ok";
  ok.textContent = "✓ extracted";
  const timing = document.createElement("span");
  timing.textContent = `${elapsedMs}ms`;
  statusBar.append(ok, timing);
  if (article.domain) {
    const domain = document.createElement("span");
    domain.textContent = article.domain;
    statusBar.append(domain);
  }
  if (requestedUrl) {
    const urlSpan = document.createElement("span");
    urlSpan.textContent = requestedUrl;
    statusBar.append(urlSpan);
  }

  $("result-title").textContent = article.title || "(no title found)";

  const bylineParts = [];
  if (article.authors?.length) bylineParts.push(`By ${article.authors.join(", ")}`);
  if (article.publishDate) bylineParts.push(article.publishDate);
  $("result-byline").textContent = bylineParts.join(" — ");

  $("result-description").textContent = article.meta?.description ?? "";

  const tagsBox = $("result-tags");
  clearChildren(tagsBox);
  for (const tag of article.tags ?? []) tagsBox.append(chip(tag));

  const textBox = $("result-text");
  clearChildren(textBox);
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

  const imageCard = $("image-card");
  clearChildren(imageCard);
  if (article.image?.url) {
    const img = document.createElement("img");
    img.src = article.image.url;
    img.alt = article.title || "article image";
    img.loading = "lazy";
    const meta = document.createElement("div");
    meta.className = "image-meta";
    meta.textContent = `${article.image.width}×${article.image.height}`;
    imageCard.append(img, meta);
  }

  const metaList = $("meta-list");
  clearChildren(metaList);
  metaRow(metaList, "lang", article.meta?.lang);
  metaRow(metaList, "keywords", article.meta?.keywords);
  metaRow(metaList, "canonical", article.meta?.canonical);
  metaRow(metaList, "favicon", article.meta?.favicon);

  const ogList = $("opengraph-list");
  clearChildren(ogList);
  for (const [key, value] of Object.entries(article.opengraph ?? {})) {
    metaRow(ogList, key, value);
  }

  const links = article.links ?? [];
  $("links-count").textContent = String(links.length);
  const linksList = $("links-list");
  clearChildren(linksList);
  for (const href of links) {
    const li = document.createElement("li");
    li.textContent = href;
    linksList.append(li);
  }

  const tweets = article.tweets ?? [];
  $("tweets-count").textContent = String(tweets.length);
  const tweetsList = $("tweets-list");
  clearChildren(tweetsList);
  for (const tweetHtml of tweets) {
    const li = document.createElement("li");
    const code = document.createElement("code");
    code.textContent = tweetHtml; // escaped text, not rendered as live HTML
    li.append(code);
    tweetsList.append(li);
  }

  const movies = article.movies ?? [];
  $("movies-count").textContent = String(movies.length);
  const moviesList = $("movies-list");
  clearChildren(moviesList);
  for (const movie of movies) {
    const li = document.createElement("li");
    const summary = document.createElement("div");
    summary.textContent = `${movie.provider ?? "unknown"} · ${movie.embedType ?? ""} · ${movie.width ?? "?"}×${movie.height ?? "?"}`;
    const code = document.createElement("code");
    code.textContent = movie.embedCode ?? movie.src ?? "";
    li.append(summary, code);
    moviesList.append(li);
  }

  $("json-view").textContent = JSON.stringify(article, null, 2);
}
