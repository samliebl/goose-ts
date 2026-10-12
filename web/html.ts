/** Escapes text for safe interpolation into HTML (element content or a quoted attribute). */
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The plain page shell used by the login, admin, and about pages (the main app has its own stylesheet). */
export const page = (title: string, body: string, options: { wide?: boolean } = {}): string =>
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: ${options.wide ? "640px" : "420px"}; margin: 64px auto; padding: 0 20px; color: #141b2d; background: #fcf6e6; }
  a { color: #0a66b8; }
  code { background: #fff; padding: 1px 5px; border-radius: 4px; font-size: 14px; word-break: break-all; }
  input[type=email], input[type=text] { width: 100%; padding: 10px 12px; font: inherit; box-sizing: border-box; border: 1px solid #b8b3a4; border-radius: 6px; background: #fff; color: inherit; }
  button { padding: 10px 16px; font: inherit; border: none; border-radius: 6px; background: #0a66b8; color: #fff; cursor: pointer; }
  form { display: flex; gap: 8px; margin: 16px 0; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  td, th { text-align: left; padding: 6px 8px; border-bottom: 1px solid #d8d2c0; font-size: 14px; }
  .muted { color: #4a5470; font-size: 14px; }
  li { margin: 6px 0; }
  @media (prefers-color-scheme: dark) {
    body { color: #fcf6e6; background: #141b2d; }
    a { color: #1594e9; }
    code { background: #1b2540; }
    input[type=email], input[type=text] { background: #1b2540; border-color: #3a456a; }
    button { background: #1594e9; color: #141b2d; }
    td, th { border-bottom-color: #2b3556; }
    .muted { color: #a9b3cc; }
  }
</style></head><body>${body}</body></html>`;
