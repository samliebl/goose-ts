/** Escapes text for safe interpolation into HTML (element content or a quoted attribute). */
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface PageViewer {
  email: string;
  isOwner: boolean;
}

export interface PageOptions {
  wide?: boolean;
  /** Who’s looking, for the sign-in / account / admin links in the header. */
  viewer?: PageViewer | null;
  /** Leave the analytics beacon off (admin and account pages). */
  analytics?: boolean;
}

const REPO = "https://github.com/samliebl/goose-ts";

/**
 * The wordmark, set inline wherever the name appears in running copy. Sized in
 * em so it follows the surrounding font size; the offset drops its baseline
 * onto the text baseline (the g descends below it).
 */
export const WORDMARK = `<img class="wm" src="/brand/wordmark-blue.svg" alt="regoose" width="921" height="204">`;

const NO_WORDMARK_INSIDE = new Set([
  "script",
  "style",
  "title",
  "textarea",
  "option",
  "code",
  "pre",
]);

/**
 * Replaces the standalone word "regoose" in the text of an HTML fragment with
 * the wordmark. Leaves tags, attributes, code samples, addresses and domains
 * (regoose.com, send@regoose.com) alone.
 */
export const brandify = (html: string): string => {
  let skipping: string | null = null;
  return html
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith("<")) {
        const m = /^<(\/?)([a-zA-Z0-9]+)/.exec(part);
        const closing = m?.[1] === "/";
        const tag = m?.[2]?.toLowerCase();
        if (tag && NO_WORDMARK_INSIDE.has(tag)) {
          if (!closing) skipping = tag;
          else if (skipping === tag) skipping = null;
        }
        return part;
      }
      if (skipping) return part;
      return part.replace(/(?<![\w.@/-])regoose(?![\w-]|\.\w)/g, WORDMARK);
    })
    .join("");
};

/**
 * The shell for every server-rendered page (the main tool has its own
 * stylesheet): header with navigation, the content, and a footer carrying the
 * legal links. Palette and contrast follow the approved brand colors.
 */
export const page = (title: string, body: string, options: PageOptions = {}): string => {
  const viewer = options.viewer;
  const account = viewer
    ? `${viewer.isOwner ? '<a href="/admin">admin</a>' : ""}<a href="/account">account</a>`
    : '<a href="/login">sign in</a>';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="theme-color" content="#1594e9">
<link rel="icon" href="/brand/favicon.svg" type="image/svg+xml"><link rel="icon" href="/brand/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png"><link rel="manifest" href="/brand/site.webmanifest">
<meta property="og:site_name" content="regoose"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:type" content="website">
<meta property="og:image" content="https://regoose.com/brand/og.png"><meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/fonts.css">
<style>
  :root { --bg:#ffffff; --panel:#fcf6e6; --text:#141b2d; --muted:#4a5470; --link:#0a66b8; --border:#e7e1d0; --cream:#fcf6e6; --btn:#0a66b8; --btn-text:#ffffff; --bad:#b3261e; --good:#1a6b36; --bar:#0a66b8; --head:#1594e9; --head-text:#fcf6e6; }
  @media (prefers-color-scheme: dark) { :root { --bg:#141b2d; --panel:#1b2540; --text:#fcf6e6; --muted:#a9b3cc; --link:#4fb0f5; --border:#2b3556; --btn:#1594e9; --btn-text:#141b2d; --bad:#ff8a80; --good:#6fd08c; --bar:#1594e9; --head:#1594e9; --head-text:#fcf6e6; --cream:#fcf6e6; } }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust:100%; }
  body { margin:0; font:16px/1.65 "Inter Variable",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; color:var(--text); background:var(--bg); -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; text-rendering:optimizeLegibility; font-kerning:normal; font-variant-ligatures:common-ligatures; }
  a { color:var(--link); text-underline-offset:3px; text-decoration-thickness:1px; }
  img.wm { height:.84em; width:auto; vertical-align:-.2265em; }
  header.site { position:relative; background:var(--head); color:var(--head-text); border-bottom:2px solid #000; }
  header.site .bar { max-width:${options.wide ? "1000px" : "760px"}; margin:0 auto; padding:14px 24px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
  header.site a.brand { display:flex; align-items:center; min-height:44px; padding:0; } header.site a.brand img { display:block; height:32px; width:auto; }
  header.site nav { display:flex; gap:8px; }
  header.site nav a { color:var(--head-text); border:1.5px solid var(--head-text); border-radius:10px; padding:0 16px; min-height:40px; display:inline-flex; align-items:center; font-size:14px; font-weight:600; text-decoration:none; }
  header.site nav a:hover { background:rgba(252,246,230,.2); }
  .menu-toggle { display:none; align-items:center; gap:8px; min-height:44px; padding:0 16px; border:1.5px solid var(--head-text); border-radius:10px; background:transparent; color:var(--head-text); font:inherit; font-size:14px; font-weight:600; cursor:pointer; }
  .menu-toggle::after { content:""; width:7px; height:7px; border-right:2px solid currentColor; border-bottom:2px solid currentColor; transform:translateY(-2px) rotate(45deg); transition:transform .15s; }
  header.menu-open .menu-toggle::after { transform:translateY(1px) rotate(-135deg); }
  img.hero { float:right; width:min(190px,36%); height:auto; margin:4px 0 16px 28px; }
  @media (max-width:640px) {
    .menu-toggle { display:inline-flex; }
    header.site .bar { padding:10px 16px; }
    header.site nav { display:none; position:absolute; left:0; right:0; top:100%; flex-direction:column; gap:0; background:var(--head); border-bottom:2px solid #000; padding:4px 16px 12px; z-index:10; }
    header.menu-open nav { display:flex; }
    header.site nav a { border:0; border-bottom:1px solid rgba(252,246,230,.4); border-radius:0; min-height:52px; padding:0 4px; font-size:16px; }
    header.site nav a:last-child { border-bottom:0; }
    img.hero { float:none; display:block; width:min(180px,55%); margin:0 auto 20px; }
  }
  main { max-width:${options.wide ? "1000px" : "760px"}; margin:0 auto; padding:48px 24px 72px; }
  main.narrow { max-width:440px; }
  footer.site { background:linear-gradient(var(--border),var(--border)) 24px 0 / calc(100% - 48px) 1px no-repeat; max-width:${options.wide ? "1000px" : "760px"}; margin:0 auto; padding:28px 24px 48px; color:var(--muted); font-size:14px; line-height:1.7; }
  footer.site a { color:var(--muted); display:inline-block; padding:10px 0; margin-right:18px; min-height:44px; }
  h1 { font-size:30px; line-height:1.2; letter-spacing:-.015em; margin:0 0 20px; } h2 { font-size:20px; line-height:1.35; letter-spacing:-.01em; margin:44px 0 12px; } h3 { font-size:16px; margin:28px 0 6px; } p { margin:0 0 1em; }
  code { background:var(--panel); padding:1px 5px; border-radius:4px; font-size:14px; word-break:break-word; }
  input[type=email], input[type=text], textarea { width:100%; padding:12px; font:inherit; border:1px solid var(--border); border-radius:8px; background:var(--panel); color:var(--text); }
  textarea { min-height:110px; resize:vertical; }
  label { display:block; font-weight:600; font-size:15px; margin:24px 0 8px; }
  label.check { display:flex; gap:12px; align-items:flex-start; font-weight:400; margin:20px 0 24px; }
  label.check input { margin-top:5px; width:20px; height:20px; flex:none; }
  button, .btn { padding:12px 18px; min-height:44px; font:inherit; font-weight:600; border:2px solid transparent; border-radius:8px; background:var(--btn); color:var(--btn-text); cursor:pointer; text-decoration:none; display:inline-block; }
  button.secondary { background:transparent; color:var(--link); border-color:var(--link); }
  button.danger { background:transparent; color:var(--bad); border-color:var(--bad); }
  button.small { padding:6px 12px; min-height:36px; font-size:14px; }
  form.inline { display:inline; margin:0; }
  form.row { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0; } form.row input { flex:1 1 220px; width:auto; }
  .muted { color:var(--muted); font-size:14px; line-height:1.65; } form + p.muted { margin-top:24px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:16px 18px; margin:16px 0; }
  .flash { border-left:4px solid var(--good); background:var(--panel); padding:10px 14px; margin:16px 0; border-radius:4px; }
  .flash.bad { border-left-color:var(--bad); }
  .table-wrap { overflow-x:auto; margin:12px 0; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--border); vertical-align:top; }
  th { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .badge { font-size:12px; padding:2px 8px; border-radius:99px; border:1px solid var(--border); white-space:nowrap; }
  .badge.good { color:var(--good); border-color:var(--good); } .badge.bad { color:var(--bad); border-color:var(--bad); }
  .tabs { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 18px; } .tabs a { padding:8px 14px; border-radius:99px; border:1px solid var(--border); text-decoration:none; min-height:40px; } .tabs a.on { background:var(--btn); color:var(--btn-text); border-color:var(--btn); }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:16px 0; }
  .kpi { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:12px 14px; } .kpi b { display:block; font-size:26px; line-height:1.2; font-variant-numeric:tabular-nums; } .kpi span { color:var(--muted); font-size:13px; }
  .grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px; }
  svg.chart { width:100%; height:auto; display:block; } svg.chart .b { fill:var(--bar); } svg.chart .b2 { fill:var(--muted); opacity:.55; } svg.chart text { fill:var(--muted); font-size:10px; }
  .avatar { width:140px; height:140px; border-radius:50%; background:var(--head); color:var(--head-text); display:flex; align-items:center; justify-content:center; font-size:48px; font-weight:700; border:3px solid #000; }
  .photos { display:flex; flex-wrap:wrap; gap:12px; margin:16px 0; } .photos img { max-width:100%; height:auto; max-height:320px; border-radius:12px; border:2px solid #000; }
  li { margin:8px 0; }
  .legal h2 { margin-top:28px; } .legal p, .legal li { max-width:70ch; }
</style></head><body>
<header class="site"><div class="bar"><a class="brand" href="/" aria-label="regoose home"><img src="/brand/wordmark-cream.svg" alt="regoose" width="921" height="204"></a><button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button><nav id="site-nav" aria-label="Main"><a href="/about">about</a><a href="/author">author</a><a href="${REPO}" rel="noopener">github</a>${account}</nav></div></header>
<main>${brandify(body)}</main>
<footer class="site">${WORDMARK} is a portfolio project by Sam Liebl. No ads, no trackers and no cookies unless you sign in.<br>
<a href="/terms">Terms</a> <a href="/privacy">Privacy</a> <a href="/about">About</a> <a href="/author">Author</a> <a href="${REPO}" rel="noopener">Source on GitHub</a></footer>
${options.analytics === false ? "" : '<script src="/m.js" defer></script>'}
<script src="/brand/menu.js" defer></script>
</body></html>`;
};

/** A narrower variant for forms (sign-in, redeem, request access). */
export const narrowPage = (title: string, body: string, options: PageOptions = {}): string =>
  page(title, `<div style="max-width:440px">${body}</div>`, options);
