import type { AccessRequest, Member } from "./db.js";
import type { Count, Summary } from "./analytics.js";
import { escapeHtml } from "./html.js";

export const FLASH_MESSAGES: Record<string, { text: string; bad?: boolean }> = {
  invited: { text: "Invitation sent. They’ll get an email with an access code." },
  resent: { text: "A new access code was sent. The old one no longer works." },
  approved: { text: "Approved. An access code was emailed to them." },
  declined: { text: "Declined. Nothing was sent; reply to them yourself if you’d like to." },
  removed: {
    text: "Removed. Everything held about that address was erased and their sessions ended.",
  },
  signedout: { text: "Signed out of every device." },
  "bad-email": { text: "That doesn’t look like a valid email address.", bad: true },
  "is-owner": { text: "That’s your own address; you already have access.", bad: true },
  "is-active": { text: "They already have access.", bad: true },
  "mail-failed": {
    text: "The invitation was created but the email couldn’t be sent. Use Resend code to try again.",
    bad: true,
  },
  cap: { text: "Today’s limit on invitation emails has been reached.", bad: true },
  "not-found": { text: "That one wasn’t found (it may already have been handled).", bad: true },
};

export function flashHtml(code: string | undefined): string {
  const flash = code ? FLASH_MESSAGES[code] : undefined;
  return flash
    ? `<p class="flash${flash.bad ? " bad" : ""}" role="status">${escapeHtml(flash.text)}</p>`
    : "";
}

export function adminTabs(
  active: "overview" | "members" | "requests",
  counts: { members: number; pending: number },
): string {
  const tab = (href: string, key: string, label: string) =>
    `<a href="${href}"${active === key ? ' class="on" aria-current="page"' : ""}>${label}</a>`;
  return `<div class="tabs">${tab("/admin", "overview", "Overview")}${tab("/admin/members", "members", `Members (${counts.members})`)}${tab(
    "/admin/requests",
    "requests",
    `Requests${counts.pending ? ` (${counts.pending} new)` : ""}`,
  )}</div>`;
}

// --- Charts, as plain SVG: no script needed, so they work under the strict CSP ---

export function barChart(
  rows: Array<{ label: string; a: number; b: number }>,
  names: { a: string; b: string },
): string {
  const width = 640;
  const height = 150;
  const top = 14;
  const bottom = 18;
  const max = Math.max(1, ...rows.flatMap((r) => [r.a, r.b]));
  const slot = width / Math.max(1, rows.length);
  const bar = Math.max(1, Math.min(14, slot / 2 - 1));
  const scale = (v: number) => ((height - top - bottom) * v) / max;
  const total = rows.reduce((n, r) => n + r.a, 0);

  const bars = rows
    .map((r, i) => {
      const x = i * slot + (slot - bar * 2) / 2;
      const ha = scale(r.a);
      const hb = scale(r.b);
      return `<g><title>${escapeHtml(r.label)}: ${r.a} ${escapeHtml(names.a)}, ${r.b} ${escapeHtml(names.b)}</title>
<rect class="b" x="${x.toFixed(1)}" y="${(height - bottom - ha).toFixed(1)}" width="${bar}" height="${ha.toFixed(1)}"/>
<rect class="b2" x="${(x + bar).toFixed(1)}" y="${(height - bottom - hb).toFixed(1)}" width="${bar}" height="${hb.toFixed(1)}"/></g>`;
    })
    .join("");

  const first = rows[0]?.label.slice(5) ?? "";
  const last = rows.at(-1)?.label.slice(5) ?? "";
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(names.a)} (dark bars) and ${escapeHtml(names.b)} (light bars) per day, ${total} ${escapeHtml(names.a)} in total">
<text x="0" y="10">${max}</text>${bars}
<text x="0" y="${height - 4}">${escapeHtml(first)}</text><text x="${width}" y="${height - 4}" text-anchor="end">${escapeHtml(last)}</text></svg>`;
}

function countTable(title: string, rows: Count[], empty = "No data yet."): string {
  const total = rows.reduce((n, r) => n + r.count, 0);
  const body = rows.length
    ? rows
        .map(
          (r) =>
            `<tr><td>${escapeHtml(r.key)}</td><td class="num">${r.count}</td><td class="num muted">${Math.round((r.count / total) * 100)}%</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="3" class="muted">${empty}</td></tr>`;
  return `<div class="card"><h3 style="margin-top:0">${escapeHtml(title)}</h3><div class="table-wrap"><table><tbody>${body}</tbody></table></div></div>`;
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const ms = (n: number | null) =>
  n === null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`;

export interface ChecklistItem {
  ok: boolean;
  text: string;
}

export function overviewBody(opts: {
  summary: Summary;
  days: number;
  checklist: ChecklistItem[];
  usageToday: { anon: number; anonCap: number; member: number; memberCap: number };
  publicMode: boolean;
}): string {
  const { summary: s, days, checklist, usageToday, publicMode } = opts;
  const t = s.totals;
  const mobile = s.devices.find((d) => d.key === "mobile")?.count ?? 0;
  const tablet = s.devices.find((d) => d.key === "tablet")?.count ?? 0;
  const deviceTotal = s.devices.reduce((n, d) => n + d.count, 0);
  const todo = checklist.filter((c) => !c.ok);

  const kpi = (value: string, label: string) =>
    `<div class="kpi"><b>${value}</b><span>${escapeHtml(label)}</span></div>`;
  const range = [7, 30, 90]
    .map((d) => `<a href="/admin?days=${d}"${d === days ? ' class="on"' : ""}>${d} days</a>`)
    .join("");

  return `<h1>Overview</h1>
<div class="card"><strong>Site is ${publicMode ? "public" : "invite-only"}</strong> <span class="muted">(${publicMode ? "anyone can use the demo" : "everything needs a sign-in; set PUBLIC_MODE to open the demo"})</span>
<ul style="margin:8px 0 0;padding-left:20px">${checklist
    .map(
      (c) =>
        `<li>${c.ok ? '<span class="badge good">ok</span>' : '<span class="badge bad">todo</span>'} ${escapeHtml(c.text)}</li>`,
    )
    .join("")}</ul>${todo.length ? "" : ""}</div>

<div class="tabs" aria-label="Date range">${range}</div>
<div class="kpis">
${kpi(String(t.visitors), "Visitors (unique per day, summed)")}
${kpi(String(t.pageviews), "Page views")}
${kpi(String(t.extractions), "Extractions")}
${kpi(pct(t.extractionsOk, t.extractions), "Succeeded")}
${kpi(ms(s.durations.p50), "Median extraction time")}
${kpi(ms(s.durations.p95), "Slowest 5% (p95)")}
${kpi(pct(mobile + tablet, deviceTotal), "Phone / tablet share")}
${kpi(String(t.exports), "Downloads")}
${kpi(String(t.rateLimited), "Rate-limited requests")}
${kpi(String(t.capReached + t.busy), "Daily cap / busy refusals")}
${kpi(String(t.accessRequests), "Access requests")}
${kpi(String(t.redemptions), "Codes redeemed")}
${kpi(String(t.logins), "Member sign-ins")}
${kpi(String(t.boots), "Server cold starts")}
</div>

<div class="card"><h3 style="margin-top:0">Per day: visitors (dark) and extractions (light)</h3>
${barChart(
  s.daily.map((d) => ({ label: d.date, a: d.visitors, b: d.extractions })),
  { a: "visitors", b: "extractions" },
)}</div>

<div class="card"><h3 style="margin-top:0">Today’s usage against the daily caps</h3>
<p style="margin:0">Public demo: <strong>${usageToday.anon}</strong> of ${usageToday.anonCap} &middot; Members: <strong>${usageToday.member}</strong> of ${usageToday.memberCap}</p></div>

<div class="grid2">
${countTable("Pages", s.pages)}
${countTable("Referring sites", s.referrers, "No referrers (direct visits or none sent).")}
${countTable("Devices", s.devices)}
${countTable("Screen width", s.viewports)}
${countTable("Browsers", s.browsers)}
${countTable("Operating systems", s.oses)}
${countTable("Languages", s.languages)}
${countTable("Light / dark preference", s.colorSchemes)}
${countTable("Extraction outcomes", s.outcomes)}
${countTable("Extractions by tier", s.extractionsByTier)}
${countTable("Pasted HTML vs URL", s.modes)}
${countTable("Sites extracted successfully", s.hosts)}
${countTable("Sites that refused us (robots.txt or blocking)", s.refusedHosts)}
${countTable("Sites visitors asked for that the demo won’t fetch", s.wantedHosts, "None yet. This is a good guide for what to add to the allowlist.")}
</div>

<div class="card"><h3 style="margin-top:0">Funnel (visitors, unique per day, summed)</h3>
<p style="margin:0">Visited <strong>${s.funnel.visited}</strong> &rarr; ran an extraction <strong>${s.funnel.extracted}</strong> (${pct(s.funnel.extracted, s.funnel.visited)}) &rarr; downloaded a result <strong>${s.funnel.exported}</strong> (${pct(s.funnel.exported, s.funnel.extracted)})</p></div>

<p class="muted">Analytics are first-party and cookieless. Visitors are a hash that resets daily, so the same person on two days counts twice, and nobody can be followed across days. IP addresses, full URLs and member identities are never recorded; the owner’s own activity and bots are excluded; Do Not Track / Global Privacy Control visitors appear only in anonymous totals. Events are deleted after 90 days. The same numbers are available as JSON at <code>/api/admin/analytics?days=${days}</code>.</p>`;
}

// --- Members ---

const date = (iso: string | null) => (iso ? escapeHtml(iso.slice(0, 10)) : "—");

export function membersBody(members: Member[], owner: string, flash?: string): string {
  const rows = members
    .map((m) => {
      const status =
        m.status === "active"
          ? '<span class="badge good">active</span>'
          : '<span class="badge">invited</span>';
      const actions =
        m.status === "invited"
          ? `<form class="inline" method="post" action="/api/admin/members/resend"><input type="hidden" name="email" value="${escapeHtml(m.email)}"><button class="secondary small" type="submit">Resend code</button></form> `
          : `<form class="inline" method="post" action="/api/admin/members/signout"><input type="hidden" name="email" value="${escapeHtml(m.email)}"><button class="secondary small" type="submit">Sign out everywhere</button></form> `;
      return `<tr>
<td><strong>${escapeHtml(m.email)}</strong>${m.note ? `<br><span class="muted">${escapeHtml(m.note)}</span>` : ""}</td>
<td>${status}</td>
<td>${date(m.addedAt)}<br><span class="muted">${m.addedBy === "request" ? "requested" : "invited"}</span></td>
<td>${date(m.lastSeenAt)}</td>
<td class="num">${m.extractions}</td>
<td>${escapeHtml(m.termsVersion ?? "—")}</td>
<td>${actions}<details style="display:inline-block"><summary class="muted" style="cursor:pointer;padding:8px 0">Remove&hellip;</summary>
<form method="post" action="/api/admin/members/remove"><input type="hidden" name="email" value="${escapeHtml(m.email)}"><button class="danger small" type="submit">Erase ${escapeHtml(m.email)} and end their access</button></form></details></td>
</tr>`;
    })
    .join("");

  return `<h1>Members</h1>
${flashHtml(flash)}
<div class="card"><h3 style="margin-top:0">Invite someone</h3>
<p class="muted" style="margin-top:0">Enter their email. They get a one-time access code, enter it once and from then on come back with an emailed sign-in link. That’s all they have to do.</p>
<form class="row" method="post" action="/api/admin/invite">
<input type="email" name="email" placeholder="their@email.com" required aria-label="Their email address">
<input type="text" name="note" placeholder="Private note (optional)" maxlength="300" aria-label="Private note">
<button type="submit">Email access code</button></form></div>

<div class="table-wrap"><table>
<tr><th>Email</th><th>Status</th><th>Added</th><th>Last used</th><th class="num">Extractions</th><th>Terms</th><th></th></tr>
<tr><td><strong>${escapeHtml(owner)}</strong></td><td><span class="badge">owner</span></td><td colspan="5" class="muted">You always have access.</td></tr>
${rows || '<tr><td colspan="7" class="muted">No one else yet.</td></tr>'}
</table></div>
<p class="muted">Removing someone erases everything held about their address and ends their sessions at once. The note is only visible to you.</p>`;
}

// --- Requests ---

export function requestsBody(requests: AccessRequest[], flash?: string): string {
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  const card = (r: AccessRequest) => `<div class="card">
<p style="margin:0"><strong>${escapeHtml(r.email)}</strong> <span class="muted">${date(r.createdAt)}</span></p>
<p style="white-space:pre-wrap;margin:8px 0">${r.message ? escapeHtml(r.message) : '<span class="muted">(no message)</span>'}</p>
<form class="inline" method="post" action="/api/admin/requests/approve"><input type="hidden" name="id" value="${escapeHtml(r.id)}"><button type="submit">Approve &amp; email code</button></form>
<form class="inline" method="post" action="/api/admin/requests/decline"><input type="hidden" name="id" value="${escapeHtml(r.id)}"><button class="secondary" type="submit">Decline</button></form>
<p class="muted" style="margin:8px 0 0">The notification email’s Reply-To is their address, so you can talk to them first and approve afterwards.</p></div>`;

  return `<h1>Access requests</h1>
${flashHtml(flash)}
${pending.length ? pending.map(card).join("") : '<p class="muted">Nothing waiting.</p>'}
<h2>Decided</h2>
<div class="table-wrap"><table><tr><th>Email</th><th>Asked</th><th>Decision</th><th>Decided</th></tr>
${
  decided
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.email)}</td><td>${date(r.createdAt)}</td><td><span class="badge ${r.status === "approved" ? "good" : ""}">${r.status}</span></td><td>${date(r.decidedAt)}</td></tr>`,
    )
    .join("") || '<tr><td colspan="4" class="muted">None yet.</td></tr>'
}</table></div>
<p class="muted">Requests are deleted automatically 90 days after you decide (180 if never answered).</p>`;
}
