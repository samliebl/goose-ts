import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * A plain JSON file, not a database -- matches tohode's approach in spirit
 * (see its db/tokens.js: small, embedded, no external service to run or
 * pay for), but even that was more machinery than this actually needs. The
 * data here is tiny (an allowlist, a handful of pending login tokens at
 * any moment) and single-writer (one small Node process), so a
 * read-modify-write JSON file is genuinely sufficient -- no query engine,
 * no native binary, nothing that can fail to compile for a given platform.
 *
 * DB_PATH should point at a Fly volume mount in production (see fly.toml's
 * [mounts] section) so this survives restarts and redeploys; it defaults
 * to a local file under web/.data/ for `npm run web`, which is gitignored.
 */

interface AllowedEmail {
  email: string;
  addedAt: string;
  addedBy: string;
}

interface AuthToken {
  tokenHash: string;
  email: string;
  expiresAt: string;
  usedAt: string | null;
}

interface StoreShape {
  allowedEmails: AllowedEmail[];
  authTokens: AuthToken[];
  /** Extractions served per "YYYY-MM-DD:tier" -- see consumeDailyUsage. */
  usage: Record<string, number>;
}

const DB_PATH = process.env.DB_PATH ?? "web/.data/goose-ts.json";
mkdirSync(dirname(DB_PATH), { recursive: true });

function load(): StoreShape {
  if (!existsSync(DB_PATH)) return { allowedEmails: [], authTokens: [], usage: {} };
  try {
    const parsed: unknown = JSON.parse(readFileSync(DB_PATH, "utf-8"));
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Partial<StoreShape>;
      return {
        allowedEmails: obj.allowedEmails ?? [],
        authTokens: obj.authTokens ?? [],
        usage: obj.usage ?? {},
      };
    }
  } catch {
    /* fall through to a fresh store -- a corrupt file shouldn't crash the server */
  }
  return { allowedEmails: [], authTokens: [], usage: {} };
}

function save(data: StoreShape): void {
  // Write-then-rename so a crash or an auto-stop mid-write can never leave a
  // half-written file -- which load() would read as empty, silently dropping
  // the allowlist.
  const tmp = `${DB_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, DB_PATH);
}

export function isEmailInAllowlist(email: string): boolean {
  return load().allowedEmails.some((e) => e.email === email);
}

export function getAllowedEmails(): AllowedEmail[] {
  return load()
    .allowedEmails.slice()
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export function addAllowedEmail(email: string, addedBy: string): void {
  const store = load();
  if (store.allowedEmails.some((e) => e.email === email)) return;
  store.allowedEmails.push({ email, addedAt: new Date().toISOString(), addedBy });
  save(store);
}

export function removeAllowedEmail(email: string): void {
  const store = load();
  store.allowedEmails = store.allowedEmails.filter((e) => e.email !== email);
  save(store);
}

export function insertAuthToken(tokenHash: string, email: string, expiresAt: string): void {
  const store = load();
  store.authTokens.push({ tokenHash, email, expiresAt, usedAt: null });
  save(store);
}

export function findAuthToken(tokenHash: string): AuthToken | null {
  return load().authTokens.find((t) => t.tokenHash === tokenHash) ?? null;
}

export function markAuthTokenUsed(tokenHash: string): void {
  const store = load();
  const token = store.authTokens.find((t) => t.tokenHash === tokenHash);
  if (token) {
    token.usedAt = new Date().toISOString();
    save(store);
  }
}

/** Drops tokens that expired more than a day ago. Returns how many were removed. */
export function purgeExpiredAuthTokens(): number {
  const store = load();
  const cutoff = Date.now() - 24 * 3600_000;
  const before = store.authTokens.length;
  store.authTokens = store.authTokens.filter((t) => new Date(t.expiresAt).getTime() >= cutoff);
  if (store.authTokens.length !== before) save(store);
  return before - store.authTokens.length;
}

/**
 * Counts one extraction against today's cap for a tier, unless the cap is
 * already reached. Returns whether it was allowed. Kept in the same file as
 * everything else (on the persistent volume) rather than in memory, so a
 * machine restart -- which Fly's auto-stop does constantly -- can't be used
 * to reset the cost ceiling.
 */
export function consumeDailyUsage(tier: string, cap: number, now = new Date()): boolean {
  if (cap === Number.POSITIVE_INFINITY) return true;
  const store = load();
  const today = now.toISOString().slice(0, 10);
  const key = `${today}:${tier}`;

  const cutoff = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString().slice(0, 10);
  for (const k of Object.keys(store.usage)) {
    if (k.slice(0, 10) < cutoff) delete store.usage[k];
  }

  const used = store.usage[key] ?? 0;
  if (used >= cap) return false;
  store.usage[key] = used + 1;
  save(store);
  return true;
}
