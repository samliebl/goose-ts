import { AUTHOR } from "./author.js";
import { escapeHtml } from "./html.js";
import { LIMITS, OPEN_SOURCE_DOMAINS, SERVER_USER_AGENT } from "./policy.js";
import { contactHtml, GITHUB_REPO_URL, TERMS_VERSION } from "./site.js";

const termsConsent = (name = "agree") =>
  `<label class="check"><input type="checkbox" name="${name}" value="1" required> <span>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and have read the <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</span></label>`;

const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

// --- About ---

export function aboutBody(): string {
  const anon = LIMITS.anon;
  const member = LIMITS.member;
  const domains = OPEN_SOURCE_DOMAINS.map((d) => `<code>${escapeHtml(d)}</code>`).join(", ");

  return `<h1>About regoose</h1>
<p>regoose turns a web page into clean, readable text: the article, without the clutter. It’s a portfolio project built on <a href="${GITHUB_REPO_URL}" rel="noopener">goose-ts</a>, an open-source TypeScript port of python-goose, and the whole thing &mdash; library, command line tool and this site &mdash; is <a href="${GITHUB_REPO_URL}" rel="noopener">open source</a>.</p>
<p><a class="btn" href="/">Open the tool</a> &nbsp; <a href="/request-access">Request full access</a> &middot; <a href="/redeem">I have an access code</a></p>

<h2>What’s limited about this demo, and why</h2>
<p>The public demo is deliberately smaller than the tool. Fetching other people’s pages on behalf of strangers is something I want to do carefully, and this runs on one small server paid for by one person. Here is what’s restricted and the reasoning behind each limit.</p>
<ul>
  <li><strong>Only a short list of sites can be fetched by URL.</strong> The demo fetches from sites that publish openly licensed or public-domain material and where I’ve checked extraction works: ${domains}. <em>Why:</em> a tool that fetches any address for anonymous visitors can be pointed at sites that don’t want to be scraped, turned into a way to bypass paywalls, or used as a relay to attack other servers. Restricting the demo to sites that welcome reuse removes that risk entirely and keeps me on the right side of other people’s terms.</li>
  <li><strong>Pasting HTML works for any page.</strong> If you’ve already got a page’s source, paste it. <em>Why:</em> nothing is fetched from anywhere, so there’s nobody to impose on.</li>
  <li><strong>The demo doesn’t fetch or score images.</strong> <em>Why:</em> every image is another request to someone else’s server, and image scoring is the slowest, most abusable part of an extraction. Signed-in members get image detection.</li>
  <li><strong>Usage is rate limited:</strong> ${anon.ratePerWindow} extractions per ${anon.windowMs / 60_000} minutes per visitor, and ${anon.dailyCap} a day across everyone in the public demo. Members get ${member.ratePerWindow} per ${member.windowMs / 60_000} minutes. <em>Why:</em> it keeps the service available to everyone, stops runaway automation, and puts a ceiling on what it costs to run. When a limit is reached, the page tells you and you can try again later.</li>
  <li><strong>Size limits:</strong> pages up to ${mb(anon.maxResponseBytes)} (${mb(member.maxResponseBytes)} for members) and pasted HTML up to ${mb(anon.maxRawHtmlChars)}. <em>Why:</em> the server is small, and a very large page could take it down for everyone.</li>
  <li><strong>It obeys robots.txt.</strong> If a site’s robots.txt asks automated tools to stay away from a page (or can’t be read), regoose won’t fetch it, and says why. News sites often do this. <em>Why:</em> it’s the established way for a site to say &ldquo;no&rdquo;, and respecting it is the right default.</li>
  <li><strong>It doesn’t run JavaScript.</strong> Pages that build their content in the browser can come back empty or thin. <em>Why:</em> that needs a full headless browser, which is far heavier and costlier than this project is meant to be.</li>
  <li><strong>It doesn’t get around paywalls or logins.</strong> It sees what an anonymous visitor would see. <em>Why:</em> that’s the line between a reading tool and a circumvention tool.</li>
  <li><strong>Extraction is heuristic.</strong> It’s an algorithm that guesses which part of a page is the article, so some pages (live blogs, index pages, unusual layouts) come out incomplete.</li>
  <li><strong>Nothing is saved.</strong> There’s no history, library, or bookmarking. <em>Why:</em> not storing what people read is a privacy feature, and it keeps the project simple.</li>
  <li><strong>The server naps when idle,</strong> so the first visit after a quiet spell can take a few seconds to wake up.</li>
</ul>

<h2>Full access</h2>
<p>Full access lifts the URL list (any publicly reachable page), turns on image detection, and raises the limits. It’s by invitation: <a href="/request-access">tell me a bit about what you’d like to use it for</a> and I’ll get back to you by email with an access code. There are no passwords &mdash; you enter the code once, and afterwards you can return with an emailed sign-in link.</p>

<h2>How it behaves toward other sites</h2>
<ul>
  <li><strong>It identifies itself.</strong> Requests carry the User-Agent <code>${escapeHtml(SERVER_USER_AGENT)}</code>, which points to this page.</li>
  <li><strong>It respects robots.txt</strong>, as above.</li>
  <li><strong>One page per request.</strong> It doesn’t crawl, follow links, or run in the background.</li>
  <li><strong>It refuses private and internal network addresses,</strong> on every redirect and for every image.</li>
</ul>

<h2>Want regoose to stay away from your site?</h2>
<p>Add a rule for <code>regoose</code> to your <code>robots.txt</code> (<code>User-agent: regoose</code> then <code>Disallow: /</code>) and it stops immediately. Or contact me at ${contactHtml()} and I’ll block it by hand.</p>

<p class="muted">See also the <a href="/terms">Terms of Service</a>, the <a href="/privacy">Privacy Policy</a>, and the <a href="/author">author page</a>.</p>`;
}

// --- Author ---

export function authorBody(): string {
  const photos = AUTHOR.photos.length
    ? `<div class="photos">${AUTHOR.photos
        .map(
          (p) =>
            `<img src="/author/${encodeURIComponent(p.src)}" alt="${escapeHtml(p.alt)}" loading="lazy">`,
        )
        .join("")}</div>`
    : "";
  const initials = AUTHOR.name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const links = AUTHOR.links
    .map((l) =>
      l.url
        ? `<li><a href="${escapeHtml(l.url)}" rel="noopener me">${escapeHtml(l.label)}</a></li>`
        : `<li><span class="muted">${escapeHtml(l.label)} &mdash; coming soon</span></li>`,
    )
    .join("");

  return `<h1>About the author</h1>
<div style="display:flex;flex-wrap:wrap;gap:20px;align-items:center;margin:16px 0">
  ${AUTHOR.photos.length ? "" : `<div class="avatar" aria-hidden="true">${escapeHtml(initials)}</div>`}
  <div style="flex:1 1 260px"><h2 style="margin:0">${escapeHtml(AUTHOR.name)}</h2><p style="margin:4px 0 0">${escapeHtml(AUTHOR.tagline)}</p></div>
</div>
${photos}
${AUTHOR.bio.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}
<h2>Find me</h2>
<ul>${links}</ul>
<p>The source code for this project lives at <a href="${GITHUB_REPO_URL}" rel="noopener">${GITHUB_REPO_URL.replace("https://", "")}</a>.</p>`;
}

// --- Signing in, requesting access, redeeming a code ---

export function loginBody(options: { publicMode: boolean }): string {
  return `<h1>Sign in</h1>
<form method="post" action="/api/auth/request-link" class="row">
  <input type="email" name="email" placeholder="you@example.com" autocomplete="email" required autofocus aria-label="Email address">
  <button type="submit">Email me a link</button>
</form>
<p class="muted">If that address has access, a sign-in link will be emailed to it. Links expire in 15 minutes and work once. There’s no password.</p>
<p><a href="/redeem">I have an access code</a> &middot; <a href="/request-access">Request access</a></p>
${options.publicMode ? '<p class="muted"><a href="/">&larr; Back to the public demo</a></p>' : ""}`;
}

export function checkEmailBody(): string {
  return `<h1>Check your email</h1><p>If that address has access, a sign-in link is on its way. It works once and expires in 15 minutes.</p><p class="muted"><a href="/login">&larr; Back</a></p>`;
}

/** Email links open this, and a button confirms: a mail scanner that "clicks" the link can’t use it up. */
export function verifyConfirmBody(token: string): string {
  return `<h1>Almost there</h1>
<form method="post" action="/api/auth/verify">
  <input type="hidden" name="token" value="${escapeHtml(token)}">
  <button type="submit">Sign in to regoose</button>
</form>
<p class="muted">Signing in on this device keeps you signed in here for 30 days, renewed whenever you use the site.</p>`;
}

export function linkExpiredBody(): string {
  return `<h1>That link has expired</h1><p>It may have been used already, or timed out (they last 15 minutes).</p><p><a class="btn" href="/login">Get a new link</a></p>`;
}

export function requestAccessBody(): string {
  return `<h1>Request full access</h1>
<p>The public demo covers pasted HTML and a short list of open sites. Full access works on any public page. Tell me a little about what you’d like to use it for and I’ll reply by email &mdash; I read every request.</p>
<form method="post" action="/api/request-access">
  <label for="email">Your email address</label>
  <input id="email" type="email" name="email" autocomplete="email" required>
  <label for="message">What would you like to use it for? <span class="muted">(optional)</span></label>
  <textarea id="message" name="message" maxlength="1000"></textarea>
  <div style="position:absolute;left:-9999px" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
  ${termsConsent()}
  <button type="submit">Send request</button>
</form>
<p class="muted">Your email and message are sent to me and stored until I’ve replied (and for 90 days after), then deleted. I won’t use them for anything else. <a href="/privacy">Privacy Policy</a></p>`;
}

export function requestReceivedBody(): string {
  return `<h1>Thanks &mdash; request received</h1><p>I’ll look it over and reply by email. If I approve it, you’ll get an access code.</p><p class="muted"><a href="/">&larr; Back to the demo</a></p>`;
}

export function redeemBody(prefill: { email?: string; code?: string }, error?: string): string {
  return `<h1>Enter your access code</h1>
${error ? `<p class="flash bad" role="alert">${escapeHtml(error)}</p>` : ""}
<form method="post" action="/redeem">
  <label for="email">Your email address</label>
  <input id="email" type="email" name="email" autocomplete="email" required value="${escapeHtml(prefill.email ?? "")}">
  <label for="code">Access code</label>
  <input id="code" type="text" name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required placeholder="ABCDE-FGHJK" value="${escapeHtml(prefill.code ?? "")}" style="font-family:ui-monospace,Menlo,monospace;letter-spacing:.08em">
  ${termsConsent()}
  <button type="submit">Activate access</button>
</form>
<p class="muted">No code yet? <a href="/request-access">Request access</a>. Already activated? <a href="/login">Sign in</a>.</p>`;
}

export function acceptTermsBody(returnTo: string): string {
  return `<h1>Updated terms</h1>
<p>The <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a> (version ${TERMS_VERSION}) apply to your account. Please review and accept them to continue.</p>
<form method="post" action="/accept-terms">
  <input type="hidden" name="next" value="${escapeHtml(returnTo)}">
  ${termsConsent()}
  <button type="submit">Continue</button>
</form>
<form method="post" action="/api/auth/logout" style="margin-top:16px"><button class="secondary small" type="submit">Sign out instead</button></form>`;
}

// --- Account ---

export interface AccountInfo {
  email: string;
  isOwner: boolean;
  since: string | null;
  lastSeenAt: string | null;
  extractions: number;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
}

const day = (iso: string | null) => (iso ? escapeHtml(iso.slice(0, 10)) : "&mdash;");

export function accountBody(info: AccountInfo, flash?: string): string {
  return `<h1>Your account</h1>
${flash ? `<p class="flash">${escapeHtml(flash)}</p>` : ""}
<div class="card">
  <p><strong>${escapeHtml(info.email)}</strong> ${info.isOwner ? '<span class="badge">owner</span>' : '<span class="badge good">member</span>'}</p>
  ${
    info.isOwner
      ? ""
      : `<p class="muted">Member since ${day(info.since)} &middot; last used ${day(info.lastSeenAt)} &middot; ${info.extractions} extractions &middot; accepted terms ${escapeHtml(info.termsVersion ?? "&mdash;")} on ${day(info.termsAcceptedAt)}</p>`
  }
  <p class="muted">This is everything regoose keeps about you. It doesn’t keep what you read.</p>
</div>
<h2>Sign out</h2>
<form method="post" action="/api/auth/logout" class="inline"><button class="secondary" type="submit">Sign out of this device</button></form>
<form method="post" action="/account/signout-all" class="inline"><button class="secondary" type="submit">Sign out of all devices</button></form>
${
  info.isOwner
    ? ""
    : `<h2>Delete my account</h2>
<p>This erases your email address and everything else held about you, and ends access on every device immediately. It can’t be undone; to come back you’d need a new access code.</p>
<form method="post" action="/account/delete">
  <label class="check"><input type="checkbox" name="confirm" value="1" required> <span>Yes, delete my account and data.</span></label>
  <button class="danger" type="submit">Delete my account</button>
</form>`
}`;
}

export function messageBody(
  heading: string,
  text: string,
  backHref = "/",
  backLabel = "Back",
): string {
  return `<h1>${escapeHtml(heading)}</h1><p>${escapeHtml(text)}</p><p class="muted"><a href="${escapeHtml(backHref)}">&larr; ${escapeHtml(backLabel)}</a></p>`;
}
