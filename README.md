# goose-ts

A modern TypeScript/ESM port of [python-goose](https://github.com/grangier/python-goose) for Node.js: pull the article text, main image, metadata, tags, authors, publish date, tweets, and embedded videos out of a web page.

```ts
import { Goose } from "goose-ts";

const goose = new Goose();
const article = await goose.extract({ url: "https://example.com/some-article" });

console.log(article.title);
console.log(article.cleanedText);
console.log(article.topImage?.src);
```

Or from HTML you already have:

```ts
const article = await goose.extract({ rawHtml: html, url: "https://example.com/some-article" });
```

## Install

```bash
npm install goose-ts
```

Requires Node.js 18.17+ (uses native `fetch`, `AbortSignal.timeout`, and `Intl.Segmenter`).

## Three ways to use this

goose-ts, the CLI, and the local web dashboard's HTTP API are three clients of the same core --
extraction (`src/`) and export/formatting (`src/export.ts`) live in one place, and none of the
three has any capability the others lack. The web UI in particular is not a special case: its own
download buttons call the same `/api/export` route documented below, same as any other client
would.

## CLI

```bash
npx goose-ts https://example.com/some-article                    # one URL -> JSON on stdout
npx goose-ts url1 url2 url3                                       # several URLs -> a JSON array
cat urls.txt | npx goose-ts --format text                         # batch from stdin, plain text
npx goose-ts url1 url2 --zip --output articles.zip                # bundle into one .zip
npx goose-ts --file local.html --format text --output article.txt # from a local file, to a file
```

URLs can be given as positional arguments or piped one-per-line on stdin (`--file` for local HTML
takes priority over either, and is always a single item). With more than one URL, requests run
**sequentially, never in parallel** -- same policy as the web dashboard's batch mode, and for the
same reason: a burst of concurrent requests looks like exactly the kind of traffic that trips
anti-bot/rate-limit defenses. A URL that fails doesn't abort the rest of a batch; it's reported
inline (JSON: `{ ok: false, label, error }` in the array; text: a "(failed: ...)" line) and the
exit code is nonzero if anything failed, but stdout/the output file still has everything that
succeeded.

Flags:

- `--format <text|json>` -- output format (default `json`). `--text` is shorthand for `--format text`.
- `--zip` -- bundle results into one `.zip` of individual files, even for a single URL.
- `--output <path>` -- write to this file instead of stdout.
- `--language <lang>`, `--no-images`, `--no-meta-language`, `--timeout <ms>`,
  `--overall-timeout <ms>`, `--user-agent <ua>` -- the same options the web dashboard's
  Configuration panel exposes.
- `--help`

## HTTP API

The local web dashboard (see below) is really a small Express server with two JSON/file routes,
both usable from anything that can make an HTTP request -- not just the bundled frontend.

- **`POST /api/extract`** -- `{ url? , rawHtml?, config? }` (at least one of `url`/`rawHtml`) ->
  `{ ok, elapsedMs, article }` (or `{ ok: false, error }`, HTTP 502, if the fetch itself failed).
  `article` is the same shape as `Goose#extract()`'s `article.infos`.
- **`POST /api/export`** -- pure formatting, no fetching: `{ article, label, format? }` for one
  file, or `{ articles: [{ article, label }, ...], format?, zip? }` for several (always zipped
  once there's more than one; `zip: true` forces it even for one). Responds with the actual file
  bytes -- `Content-Type` and a `Content-Disposition` header carrying both an ASCII-safe filename
  and an RFC 5987 `filename*` for the exact one -- not JSON. Compose the two calls (extract, then
  export whatever came back) rather than fetching the same page twice.

Both bind to `127.0.0.1` only by default -- see the security note below before changing that.

## Web UI

A small local dashboard for poking at extraction interactively — URL or pasted HTML, every
`Configuration` option exposed, and the full result (image, meta, OpenGraph, links, tweets,
videos, raw JSON) rendered side by side.

The URL field takes multiple URLs, one per line. They're extracted **sequentially, never in
parallel** — each request finishes before the next starts, so a batch never looks like a burst of
concurrent traffic to any one site. Each result appears as a collapsed `<details>` row (title in
the summary; a single result stays expanded, same as before). `Configuration` is collapsed by
default, keeping the results themselves the focus.

Above ~900px wide there's room for a persistent metadata side panel: a "Metadata" toggle on each
successful row (acting like a radio group, one at a time, defaulting to the first successful
result) selects which article's links/tweets/OpenGraph/JSON it shows. Below that width -- where a
side column doesn't fit, and a distant panel you have to scroll back up to reach isn't usable
anyway -- each result instead carries its own metadata inline, nested and collapsed under its own
text. Below ~640px, type and spacing tighten further for phone-sized screens.

Every successful result can be downloaded as `.txt` (title, byline, source URL, then the cleaned
text) or `.json` (the same object the sidebar's Raw JSON view shows), filed under its own
sanitized-from-the-title filename. With more than one result, a "Download all" row bundles every
successful article into a single `.zip`, same two format choices, colliding filenames disambiguated
automatically. These buttons are a thin client (`web/public/download.js`) over `POST /api/export`
(see HTTP API above) -- the actual rendering, including a small dependency-free ZIP writer
(uncompressed/"store" entries, plenty for already-small text/JSON files, with filenames flagged
UTF-8 so they don't garble in whatever unzips them), lives once in `src/export.ts` and is exactly
what the CLI's `--format`/`--zip` flags and the API itself use too.

Encoding is handled explicitly rather than left to guesswork: every file is encoded UTF-8, `.txt`
files carry a leading byte-order mark (so an editor that would otherwise fall back to a legacy
codepage -- Windows Notepad, mainly -- renders an em dash or a non-English name correctly instead
of as garbage) while `.json` never gets one (nonstandard there, and some strict parsers choke on
it). Filenames strip the handful of characters actual filesystems reserve, plus zero-width and
bidi-override characters an article title could carry in from the source page, while leaving
non-Latin scripts (Chinese, Arabic, accented Latin, ...) untouched.

```bash
npm install
npm run web   # -> http://127.0.0.1:4173
```

This is a dev tool only (not published with the npm package): a small Express server in
`web/server.ts` runs `Goose#extract()` server-side (needed since `sharp` and outbound `fetch`
can't run in a browser) and serves a plain HTML/CSS/JS frontend from `web/public/`. It binds to
`127.0.0.1` only — don't expose this port on a shared or public network, since it's an
unauthenticated "fetch and parse whatever URL you give it" endpoint. Extracted content (tweet
embed HTML, video embed codes) is rendered as escaped text rather than live HTML, since it
originates from arbitrary, untrusted pages.

Light/dark theme follows your OS preference by default; the toggle in the top bar overrides and
persists that choice. Typography is self-hosted (no CDN, works offline) under
`web/public/fonts/`, all OFL-1.1-licensed (license text alongside each in `fonts/LICENSES/`):
[Inter](https://rsms.me/inter/) for UI text, [Iosevka](https://typeof.net/Iosevka/) for
monospace, and [Junicode](https://junicode.sourceforge.io/) — the scholarly medievalist serif
also listed on [Open Foundry](https://open-foundry.com/fonts/junicode) — for the article body.
Each falls back to a same-genre system stack if it fails to load (Inter → Apple system font,
Iosevka → SF Mono by name → Menlo, Junicode → Garamond). SF Mono itself isn't bundled — Apple's
license doesn't permit redistributing it — but naming it in the stack picks it up for free on a
Mac that already has it installed.

## What you get back

`Goose#extract()` resolves to an `Article`:

- `title`, `cleanedText` — the article's title and cleaned body text
- `topImage` — best-guess main image (`src`, `width`, `height`, `extractionType`, `confidenceScore`)
- `authors`, `tags`, `publishDate`, `metaDescription`, `metaKeywords`, `canonicalLink`, `domain`
- `opengraph` — parsed `og:*` meta tags
- `links` — hrefs found within the extracted article body
- `tweets` — embedded `blockquote.twitter-tweet` HTML
- `movies` — embedded YouTube/Vimeo/Dailymotion/Kewego videos (`Video[]`)

`article.infos` gives you the same data as a plain JSON-friendly object (this is what the CLI
prints).

## Configuration

```ts
import { Goose, Configuration } from "goose-ts";

const goose = new Goose({
  enableImageFetching: true, // fetch & score candidate images (default true)
  targetLanguage: "en", // fallback language for stopword scoring
  useMetaLanguage: true, // prefer the page's own declared language
  httpTimeout: 12_000, // ms, per request (default 12000)
  overallTimeoutMs: 20_000, // ms, wall-clock budget for the whole extract() call (default 20000)
  browserUserAgent: "goose-ts/0.2.0",
  enableJsonLdFallback: true, // see "Client-side-rendered pages" below (default true)
});
```

## Client-side-rendered pages

Like python-goose, extraction is `fetch` + DOM parsing — there's no headless browser, so
JavaScript never runs. On a page whose content is built entirely client-side (an empty SPA shell
that fills itself in after load), the DOM-scoring extractor has nothing to score.

As a fallback for exactly that case, goose-ts (not python-goose — this has no upstream fixtures,
see `test/jsonLdFallback.test.ts`) checks for a `<script type="application/ld+json">` block with
schema.org `Article`/`NewsArticle`/`BlogPosting` data. Publishers embed this HTML-side, for search
engines and social-media previews, regardless of how the visible page renders — so it's often
sitting right there in the initial response even when the DOM has nothing. It only kicks in when
DOM extraction comes back with under ~250 characters of text, and never overrides a real
DOM-scored result; set `enableJsonLdFallback: false` to turn it off entirely.

This doesn't help with true SPAs that have no such metadata (there's no way around actually
running the page's JavaScript for those), but it covers a meaningful slice of "client-side
rendered" sites in practice — including ones whose framework does SSR its initial data as a JSON
blob rather than an `application/ld+json` script (Next.js's `__NEXT_DATA__`, Nuxt's `__NUXT__`,
etc.); that path isn't implemented (no fixed schema there, so it's a much fuzzier heuristic), but
would slot in as an additional fallback in `src/Crawler.ts` alongside this one.

Pass a `Configuration` instance, or a plain options object — both work.

## How this port differs from python-goose

This is a faithful, tested port of python-goose's extraction algorithm (same scoring heuristics, same cleaning rules, same known-tag/known-site lists), validated against **69 of python-goose's own 72 test fixtures** (ported verbatim, see `test/fixtures/`). The two skipped fixtures (`test_guardian1`, `test_bbc_chinese`) fail against real python-goose today too — verified by running the actual Python code — not regressions introduced here.

A few things were deliberately modernized rather than ported 1:1:

- **DOM**: [cheerio](https://cheerio.js.org/) + [domhandler](https://github.com/fb55/domhandler) instead of lxml. This is a "real DOM" tree (text is stored as sibling text nodes) rather than lxml's element+tail-text model, which actually simplifies a few operations (`dropTag`/`remove` need no special tail-text bookkeeping) — see the comments in `src/dom/Parser.ts`.
- **Images**: fetched into memory and measured with [sharp](https://sharp.pixelplumbing.com/) instead of being written to a local cache directory and shelled out to ImageMagick's
  `identify`. No `local_storage_path`/`imagemagick_*` configuration exists here.
- **Network**: native `fetch`, with response charset detection (`Content-Type` header, falling back to [chardet](https://github.com/runk/node-chardet) sniffing) rather than python-goose's unconditional UTF-8 decode.
- **Chinese segmentation**: `Intl.Segmenter` instead of `jieba`.
- **Arabic segmentation**: plain word tokenization instead of `nltk`'s ISRI stemmer — an approximation, not a full port (see `src/text.ts`).
- **Korean stopword scoring**: python-goose's `StopWordsKorean.get_stopword_count` has a bug (it counts every stopword for every candidate word, not just overlapping ones). Reproduced as-is for output parity, not "fixed" — see `src/text.ts`.
- Dropped entirely: the `lxml`/`BeautifulSoup` parser-fallback switch (cheerio's parser is lenient enough not to need it), and a few config fields that were dead code upstream (`extract_publishdate`, `additional_data_extractor`).
- **`article.fetchError`**: python-goose's `HtmlFetcher` silently swallows a failed page fetch (network error, or a non-2xx status like a 403 from anti-bot protection) and returns `None`, so `Goose().extract()` comes back with an `Article` that's just empty in every field — indistinguishable from "fetched fine, found nothing." We keep that same silent behavior in `Crawler`/`HtmlFetcher` for fidelity, but additionally set `article.fetchError` (a plain string, `null` when the fetch succeeded or wasn't used) so a caller — the CLI and the web dashboard both check this — can tell the two apart and say so, instead of quietly reporting success.

## Credits

This project sits at the end of a chain of ports, and wouldn't exist without the people who did
the work before it:

- **[Goose](https://github.com/GravityLabs/goose)** (original, Java then Scala) — Gravity.com /
  Gravity Labs.
- **[python-goose](https://github.com/grangier/python-goose)** — Xavier Grangier (for Recrutae).
  The stopword lists, known-image CSS heuristics, and test fixtures in this repo are carried
  over from here.
- **[node-unfluff](https://github.com/ageitgey/node-unfluff)** — Adam Geitgey. An earlier,
  independent JS reimagining of goose's heuristics; consulted as prior art for what a
  JS-idiomatic API can look like.
- **goose-ts** (this port) — Sam Liebl.

Licensed Apache-2.0, same as every project in that chain — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

This project made use of Claude Code.

## Development

```bash
npm install
npm test        # vitest, runs the fixture suite
npm run build    # tsup -> dist/
npm run typecheck
npm run lint
```

Some ideas for future features.
