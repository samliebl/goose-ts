import { contactHtml, GITHUB_REPO_URL, POLICY_DATE, TERMS_VERSION } from "./site.js";

/**
 * The Terms of Service and Privacy Policy. These describe what the software
 * actually does -- if the behavior changes (what’s stored, for how long, who
 * processes it), these must change with it, and TERMS_VERSION in site.ts
 * must be bumped so members are asked to accept the new version.
 */

export function termsBody(): string {
  return `<div class="legal">
<h1>Terms of Service</h1>
<p class="muted">Version ${TERMS_VERSION} &middot; Last updated ${POLICY_DATE}</p>

<p>These terms govern your use of regoose (the &ldquo;Service&rdquo;), a web tool that turns a web page into clean, readable text. It is a personal portfolio project operated by Reondir LLC, a limited liability company in the United States (&ldquo;Reondir&rdquo;, &ldquo;I&rdquo;, &ldquo;me&rdquo;, the &ldquo;operator&rdquo;). By using the Service, signing in or entering an access code, you agree to these terms and to the <a href="/privacy">Privacy Policy</a>. If you don’t agree, please don’t use it.</p>

<h2>1. Who may use it</h2>
<p>You must be at least 16 years old and able to form a binding agreement where you live. You must not use the Service if you are barred from doing so by law.</p>

<h2>2. What the Service is</h2>
<p>regoose fetches a page that you ask for (or processes HTML you paste), extracts the main text and shows it to you. It is an experimental demo provided for free, on an &ldquo;as is&rdquo; basis. It has two levels of access:</p>
<ul>
  <li><strong>Public demo</strong> &mdash; pasted HTML, and pages from a short list of sites that publish openly licensed or public-domain material. The <a href="/about">About page</a> explains the limits and the reasons for them.</li>
  <li><strong>Full access</strong> &mdash; by invitation or approved request, using any publicly reachable page, subject to the same rules and to rate limits.</li>
</ul>
<p>I may change, limit, suspend or discontinue any part of the Service at any time, including usage limits and the list of sites available in the demo. There is no uptime or accuracy commitment.</p>

<h2>3. Access codes and accounts</h2>
<p>Full access is tied to your email address, not a password. An access code is for you alone: don’t share it or let anyone else use your access. You are responsible for activity under your access. I may revoke access at any time, with or without notice, for any reason, including misuse. You can delete your account yourself at any time from the account page.</p>

<h2>4. Acceptable use</h2>
<p>You agree that you will not, and will not help anyone else to:</p>
<ul>
  <li>use the Service for anything unlawful, or to infringe anyone’s copyright or other rights;</li>
  <li>use it to fetch pages from sites whose terms of use or robots.txt forbid automated access, or try to get around a site’s access controls, paywalls, logins or bot protections;</li>
  <li>use it for bulk, automated or systematic collection of content (for example crawling, building datasets or training or fine-tuning machine-learning models), or run it unattended against a site;</li>
  <li>send requests designed to overload, probe or attack the Service or any third-party site, or use it to reach private, internal or non-public network addresses;</li>
  <li>try to evade or bypass rate limits, daily limits, the demo’s site list or other protections, including by using multiple identities;</li>
  <li>interfere with the Service’s security or other people’s use of it, or attempt to access data that isn’t yours;</li>
  <li>misrepresent your identity or your purpose, or use the Service for harassment, fraud or spam.</li>
</ul>

<h2>5. Third-party content is not mine, and not yours by default</h2>
<p>Text shown by the Service comes from pages operated by other people, and belongs to them or their licensors. The Service shows it to you transiently at your request and does not store it. Extracting text does not give you any right to it. You are responsible for making sure your use of what you extract &mdash; reading, saving, quoting, sharing &mdash; is lawful and respects the source’s license and terms. Personal, non-commercial reading is the intended use. I am not affiliated with, and do not endorse, any site you fetch from and I don’t verify the accuracy or completeness of extracted text, which may be missing, reordered or wrong.</p>
<p>If you operate a site and would like regoose to stop fetching it, add <code>User-agent: regoose</code> and <code>Disallow: /</code> to your robots.txt, or contact me (see section 13) and I’ll block it. If you believe content has been used in a way that infringes your rights, tell me where; since the Service doesn’t store or host extracted content, the remedy is usually to block the source.</p>

<h2>6. Ownership</h2>
<p>The regoose source code is open source under the Apache License 2.0 (<a href="${GITHUB_REPO_URL}" rel="noopener">repository</a>), and that license governs the code. The regoose name, logo and mascot artwork, and the text of this site, are not covered by that license; all rights are reserved. If you send feedback, I may use it freely.</p>

<h2>7. Privacy</h2>
<p>How your information is handled is described in the <a href="/privacy">Privacy Policy</a>, which forms part of these terms.</p>

<h2>8. Disclaimers</h2>
<p>To the fullest extent permitted by law, the Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind, whether express or implied, including merchantability, fitness for a particular purpose, accuracy, availability and non-infringement. I do not warrant that the Service will be uninterrupted, secure or error-free or that any extraction will be complete or correct.</p>

<h2>9. Limitation of liability</h2>
<p>To the fullest extent permitted by law, I will not be liable for any indirect, incidental, special, consequential or punitive damages or for loss of data, profits or goodwill, arising from your use of or inability to use the Service. My total liability for any claim relating to the Service is limited to US$50. Some places don’t allow certain limitations, so parts of this section may not apply to you.</p>

<h2>10. Indemnity</h2>
<p>You agree to indemnify and hold me harmless from claims, damages and expenses (including reasonable legal fees) arising from your breach of these terms or your misuse of the Service or of content obtained through it.</p>

<h2>11. Suspension and termination</h2>
<p>I may suspend or end your access, or block a request or a site, at any time. You may stop using the Service at any time and delete your account from the account page. Sections that by their nature should survive termination (including 5, 6, 8, 9, 10 and 12) will survive.</p>

<h2>12. Governing law and disputes</h2>
<p>These terms are governed by the laws of the State of North Carolina, USA, without regard to conflict-of-law rules. Please contact me first and give me a chance to resolve any dispute informally. Any dispute that can’t be resolved that way will be brought in the state or federal courts located in North Carolina, and you consent to their jurisdiction. Nothing here limits mandatory consumer rights you have under the law of the country where you live.</p>

<h2>13. Changes and contact</h2>
<p>I may update these terms. The version and date are at the top of this page; if a change is material, signed-in members will be asked to accept the new version, and continued use after a change takes effect means you accept it. If any part of these terms is unenforceable, the rest stays in effect. These terms and the Privacy Policy are the entire agreement between you and me about the Service.</p>
<p>Questions, privacy requests, takedown or exclusion requests: ${contactHtml()}.</p>
</div>`;
}

export function privacyBody(): string {
  return `<div class="legal">
<h1>Privacy Policy</h1>
<p class="muted">Version ${TERMS_VERSION} &middot; Last updated ${POLICY_DATE}</p>

<p>regoose is a small portfolio project operated by Reondir LLC, a limited liability company in the United States, which is the controller of the personal data described here. I collect as little as I can. This policy says exactly what, why, for how long, who else touches it and what your rights are. Contact: ${contactHtml()}.</p>

<h2>The short version</h2>
<ul>
  <li>No ads, no third-party trackers, no social-media widgets, no data sales and no profiling.</li>
  <li>If you just visit, there are no cookies. I measure visits with a privacy-preserving counter that can’t follow you from one day to the next.</li>
  <li>If you get full access, I keep your email address and a few dates and counters &mdash; not what you read.</li>
  <li>Pages you extract, and HTML you paste, are processed in memory and not stored.</li>
  <li>You can delete your account yourself, any time, from the account page.</li>
</ul>

<h2>1. What I collect, and why</h2>

<h3>When you visit without signing in</h3>
<ul>
  <li><strong>Visit statistics</strong> (unless your browser sends Do Not Track or Global Privacy Control, see below): which page, the site that referred you (hostname only), a coarse device type, browser and operating-system family, your browser’s primary language, a coarse screen-width bucket and whether your system prefers a dark theme. To count visitors without identifying them, I compute a one-way hash of your IP address and browser details together with a secret salt that is <strong>replaced every day and then discarded</strong>. I can tell two requests on the same day came from the same device, but I cannot tell who you are, cannot follow you across days and cannot recover your IP address from it. Your IP address and your raw browser string are not stored in the statistics.</li>
  <li><strong>What you ask the tool to do</strong>: whether you pasted HTML or gave a URL, the <em>hostname</em> of the page (never the full address, which could contain personal information), whether it worked, if not why not, how long it took and the size of the result. Pasted HTML and extracted text are not stored.</li>
  <li><strong>Abuse protection</strong>: your IP address is held briefly in the server’s memory to apply rate limits (for up to an hour) and is not written to disk. Daily usage totals are kept as plain counts with no identifiers.</li>
</ul>
<p>Purpose: to keep the service working and safe, to see whether it works on phones and which sites fail and to decide what to improve.</p>

<h3>If you ask for access</h3>
<p>Your email address and the message you write are stored and emailed to me so I can decide and reply. If I approve, you get an access code by email.</p>

<h3>If you have full access (a member)</h3>
<ul>
  <li>Your <strong>email address</strong>, when you were added or invited, any private note I made about you, when you redeemed your code, which version of these terms you accepted and when, when you last used the service and a count of how many extractions you’ve run.</li>
  <li>A <strong>session cookie</strong> (below) so you stay signed in.</li>
  <li>Access codes and sign-in links are stored only as irreversible hashes, never in readable form.</li>
  <li>I do <strong>not</strong> record which pages you extract, tied to you. Your extractions appear in the anonymous statistics above with no email attached.</li>
</ul>
<p>Purpose: to give you access, keep your account secure, prevent abuse and meet my obligation to record your acceptance of the terms.</p>

<h3>Emails</h3>
<p>I send only transactional email: an access code, a sign-in link and replies to you. There is no marketing or newsletter, and no tracking pixels or tracked links in these emails.</p>

<h3>Content from other sites</h3>
<p>When you view an extracted article, your browser may load that article’s lead image directly from the original site’s server, which will see your IP address and browser details as with any image. Members' extractions may also have regoose’s server request images from the article’s site while scoring them.</p>

<h2>2. Cookies and similar technologies</h2>
<ul>
  <li><code>regoose_session</code> &mdash; set only when you sign in. HttpOnly, Secure, SameSite=Lax; lasts up to 30 days and renews while you use the site. It’s strictly necessary for staying signed in, so no consent banner is needed.</li>
  <li><code>goose-ts-theme</code> &mdash; kept in your browser’s local storage only if you choose a light or dark theme, so the choice persists. It is never sent to the server.</li>
</ul>
<p>There are no advertising, analytics or other tracking cookies, and nothing is loaded from third-party servers except as described above.</p>

<h2>3. Do Not Track and Global Privacy Control</h2>
<p>If your browser sends <code>DNT: 1</code> or <code>Sec-GPC: 1</code>, I don’t record any visit statistics about you: no page-view counter runs, and tool usage is counted only as anonymous totals with no visitor hash, device details or referrer.</p>

<h2>4. Legal bases (EU/UK GDPR)</h2>
<ul>
  <li><strong>Performing the agreement with you / steps you request</strong> (Art. 6(1)(b)): handling an access request, running your account and signing you in.</li>
  <li><strong>Legitimate interests</strong> (Art. 6(1)(f)): security and abuse prevention, rate limiting, keeping the service running, plus minimal, privacy-preserving usage statistics. I’ve kept the statistics deliberately coarse and short-lived so they have little impact on you; you can object at any time (see your rights), and a DNT or GPC signal is treated as an objection.</li>
  <li><strong>Legal obligation</strong> (Art. 6(1)(c)): where the law requires me to keep or disclose something.</li>
</ul>

<h2>5. How long I keep things</h2>
<div class="table-wrap"><table>
<tr><th>Data</th><th>Kept for</th></tr>
<tr><td>Visit and usage statistics</td><td>90 days, then deleted. The daily salt is deleted every day.</td></tr>
<tr><td>IP address for rate limiting</td><td>Up to an hour, in memory only; lost on restart.</td></tr>
<tr><td>Daily usage counts (no identifiers)</td><td>7 days.</td></tr>
<tr><td>Access requests (email and message)</td><td>90 days after I decide; 180 days if never answered; sooner if you ask.</td></tr>
<tr><td>Access codes</td><td>Expire after 14 days; deleted 30 days after being used or expiring.</td></tr>
<tr><td>Sign-in links</td><td>Expire after 15 minutes; deleted a day later.</td></tr>
<tr><td>Member record</td><td>Until you delete your account or I remove you.</td></tr>
<tr><td>Hosting provider server logs</td><td>Under the host’s own policy, outside my control (see below).</td></tr>
</table></div>

<h2>6. Who else handles your data</h2>
<p>I don’t sell or share personal data for advertising. Two service providers process data for me:</p>
<ul>
  <li><strong>Fly.io</strong> hosts the site and stores its data on an encrypted volume in the United States (Ashburn, Virginia). Like any host, it may log connection details such as IP addresses.</li>
  <li><strong>Resend</strong> delivers the transactional emails described above, so it sees recipients' email addresses and the message contents.</li>
</ul>
<p>I may also disclose information if required by law or to protect against abuse or security threats. If the project were ever transferred to someone else, this policy would continue to apply to the data unless you were told otherwise.</p>

<h2>7. International transfers</h2>
<p>The service runs in the United States, so if you’re elsewhere (including the EEA, UK or Switzerland) your data is transferred there. My providers rely on recognized transfer mechanisms, such as the EU&ndash;US Data Privacy Framework or standard contractual clauses, as described in their own policies.</p>

<h2>8. Security</h2>
<ul>
  <li>HTTPS only, with HSTS and a strict content-security policy.</li>
  <li>Member data is encrypted at rest (AES-256-GCM) on top of the host’s volume encryption; access codes and sign-in links are stored as keyed hashes and are single-use.</li>
  <li>Sessions can be revoked: removing an account, or choosing &ldquo;sign out everywhere&rdquo;, invalidates them immediately.</li>
  <li>Only the operator can see member data. The service refuses requests to private or internal network addresses and is rate limited.</li>
</ul>
<p>No system is perfectly secure. If a breach affecting your personal data occurs, I’ll notify you and the relevant authorities as the law requires.</p>

<h2>9. Your rights</h2>
<p>Depending on where you live, you may have the right to access your data, correct it, delete it, restrict or object to its use, receive a copy in a portable format, withdraw consent and complain to a regulator (in the EU/UK, your local data-protection authority). California residents (CCPA/CPRA) and residents of other US states with privacy laws may know, correct and delete their data and opt out of sale or sharing &mdash; I don’t sell or share personal data, and I won’t discriminate against you for exercising a right.</p>
<p><strong>To exercise them:</strong> members can delete their account on the <a href="/account">account page</a>, which erases everything held about their address immediately. For anything else, or if you’ve never had an account, contact ${contactHtml()}. I may need to confirm you control the email address involved, and will respond within 30 days. Visit statistics can’t be tied to you, so there is nothing to look up or delete for them.</p>

<h2>10. Children</h2>
<p>regoose is not directed at children and isn’t meant for anyone under 16. I don’t knowingly collect personal data from children; if you think I have, tell me and I’ll delete it.</p>

<h2>11. Other sites</h2>
<p>Pages you extract belong to other sites with their own privacy practices. This policy covers regoose only.</p>

<h2>12. Changes</h2>
<p>If I change this policy, I’ll update the version and date above, and ask signed-in members to accept material changes. The source code is public (<a href="${GITHUB_REPO_URL}" rel="noopener">repository</a>), so you can check that the software does what this policy says.</p>
</div>`;
}
