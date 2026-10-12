import { escapeHtml } from "./html.js";
import { OPEN_SOURCE_DOMAINS, SERVER_USER_AGENT, SITE_URL } from "./policy.js";

/** The page our User-Agent points to: who we are, how we behave, how to ask us to stop. */
export function aboutBody(): string {
  const contact = process.env.ABUSE_EMAIL
    ? `<a href="mailto:${escapeHtml(process.env.ABUSE_EMAIL)}">${escapeHtml(process.env.ABUSE_EMAIL)}</a>`
    : `<a href="https://github.com/samliebl/goose-ts/issues">open an issue on GitHub</a>`;

  return `<h1>regoose</h1>
<p>regoose turns a web page into clean, readable text: the article, without the clutter. It's a portfolio project built on <a href="https://github.com/samliebl/goose-ts">goose-ts</a>, an open-source TypeScript port of python-goose.</p>

<h2>How it behaves</h2>
<ul>
  <li><strong>It identifies itself.</strong> Requests carry the User-Agent <code>${escapeHtml(SERVER_USER_AGENT)}</code>, which points here.</li>
  <li><strong>It respects robots.txt.</strong> If a site's robots.txt disallows the page, or can't be read, regoose won't fetch it.</li>
  <li><strong>One page per request.</strong> A visitor asks for a page, regoose fetches that page (plus its images, for signed-in users) and shows the result. It doesn't crawl, follow links, or run in the background.</li>
  <li><strong>It stores nothing.</strong> Extracted text is not saved on the server. Your IP address is held in memory briefly for rate limiting; the hosting platform keeps its own access logs.</li>
  <li><strong>It doesn't get around anything.</strong> No logins, no paywall tricks, no changing its identity. If a site refuses it, regoose says so and stops.</li>
  <li><strong>It's rate limited,</strong> and refuses private and internal network addresses.</li>
</ul>

<h2>Public demo</h2>
<p>Without signing in you can paste HTML, or fetch pages from sites that publish openly licensed or public-domain material: ${OPEN_SOURCE_DOMAINS.map((d) => `<code>${escapeHtml(d)}</code>`).join(", ")}. Anything else requires an invitation.</p>

<h2>Want regoose to stay away from your site?</h2>
<p>Add a rule for <code>regoose</code> to your <code>robots.txt</code> (<code>User-agent: regoose</code> then <code>Disallow: /</code>) and it will stop immediately. Or ${contact} and I'll block it by hand.</p>

<p class="muted"><a href="${escapeHtml(SITE_URL)}/">&larr; Back to regoose</a></p>`;
}
