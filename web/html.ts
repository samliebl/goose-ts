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
<style>
  :root { --bg:#fcf6e6; --panel:#ffffff; --text:#141b2d; --muted:#4a5470; --link:#0a66b8; --border:#d8d2c0; --btn:#0a66b8; --btn-text:#ffffff; --bad:#b3261e; --good:#1a6b36; --bar:#0a66b8; --head:#1594e9; --head-text:#141b2d; }
  @media (prefers-color-scheme: dark) { :root { --bg:#141b2d; --panel:#1b2540; --text:#fcf6e6; --muted:#a9b3cc; --link:#4fb0f5; --border:#2b3556; --btn:#1594e9; --btn-text:#141b2d; --bad:#ff8a80; --good:#6fd08c; --bar:#1594e9; --head:#1594e9; --head-text:#141b2d; } }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif; color:var(--text); background:var(--bg); }
  a { color:var(--link); }
  header.site { background:var(--head); color:var(--head-text); border-bottom:2px solid #000; }
  header.site .bar { max-width:${options.wide ? "1000px" : "760px"}; margin:0 auto; padding:10px 20px; display:flex; flex-wrap:wrap; gap:4px 18px; align-items:center; justify-content:space-between; }
  header.site a { color:var(--head-text); text-decoration:none; padding:10px 2px; display:inline-block; min-height:44px; line-height:24px; }
  header.site a.brand { padding:6px 2px; } header.site a.brand img { display:block; height:34px; width:auto; }
  img.hero { float:right; width:min(230px,42%); height:auto; margin:0 0 12px 18px; }
  @media (max-width:520px) { img.hero { float:none; display:block; width:min(260px,75%); margin:0 auto 8px; } }
  header.site nav { display:flex; flex-wrap:wrap; gap:0 16px; }
  header.site a:hover { text-decoration:underline; }
  main { max-width:${options.wide ? "1000px" : "760px"}; margin:0 auto; padding:28px 20px 40px; }
  main.narrow { max-width:440px; }
  footer.site { max-width:${options.wide ? "1000px" : "760px"}; margin:0 auto; padding:20px; border-top:1px solid var(--border); color:var(--muted); font-size:14px; }
  footer.site a { color:var(--muted); display:inline-block; padding:8px 6px; min-height:44px; }
  h1 { font-size:28px; line-height:1.2; margin:0 0 12px; } h2 { font-size:20px; margin:32px 0 8px; } h3 { font-size:16px; margin:20px 0 4px; }
  code { background:var(--panel); padding:1px 5px; border-radius:4px; font-size:14px; word-break:break-word; }
  input[type=email], input[type=text], textarea { width:100%; padding:12px; font:inherit; border:1px solid var(--border); border-radius:8px; background:var(--panel); color:var(--text); }
  textarea { min-height:110px; resize:vertical; }
  label { display:block; font-weight:600; margin:14px 0 4px; }
  label.check { display:flex; gap:10px; align-items:flex-start; font-weight:400; margin:14px 0; }
  label.check input { margin-top:5px; width:20px; height:20px; flex:none; }
  button, .btn { padding:12px 18px; min-height:44px; font:inherit; font-weight:600; border:2px solid transparent; border-radius:8px; background:var(--btn); color:var(--btn-text); cursor:pointer; text-decoration:none; display:inline-block; }
  button.secondary { background:transparent; color:var(--link); border-color:var(--link); }
  button.danger { background:transparent; color:var(--bad); border-color:var(--bad); }
  button.small { padding:6px 12px; min-height:36px; font-size:14px; }
  form.inline { display:inline; margin:0; }
  form.row { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0; } form.row input { flex:1 1 220px; width:auto; }
  .muted { color:var(--muted); font-size:14px; }
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
  li { margin:6px 0; }
  .legal h2 { margin-top:28px; } .legal p, .legal li { max-width:70ch; }
</style></head><body>
<header class="site"><div class="bar"><a class="brand" href="/" aria-label="regoose home"><img src="/brand/wordmark-cream.svg" alt="regoose" width="127" height="34"></a><nav aria-label="Main"><a href="/about">about</a><a href="/author">author</a><a href="${REPO}" rel="noopener">github</a>${account}</nav></div></header>
<main>${body}</main>
<footer class="site">regoose is a portfolio project by Sam Liebl. No ads, no trackers, and no cookies unless you sign in.<br>
<a href="/terms">Terms</a> <a href="/privacy">Privacy</a> <a href="/about">About</a> <a href="/author">Author</a> <a href="${REPO}" rel="noopener">Source on GitHub</a></footer>
${options.analytics === false ? "" : '<script src="/m.js" defer></script>'}
</body></html>`;
};

/** A narrower variant for forms (sign-in, redeem, request access). */
export const narrowPage = (title: string, body: string, options: PageOptions = {}): string =>
  page(title, `<div style="max-width:440px">${body}</div>`, options);
