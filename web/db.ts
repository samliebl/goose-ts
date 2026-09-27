import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
}

const DB_PATH = process.env.DB_PATH ?? "web/.data/goose-ts.json";
mkdirSync(dirname(DB_PATH), { recursive: true });

function load(): StoreShape {
  if (!existsSync(DB_PATH)) return { allowedEmails: [], authTokens: [] };
  try {
    const parsed: unknown = JSON.parse(readFileSync(DB_PATH, "utf-8"));
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Partial<StoreShape>;
      return { allowedEmails: obj.allowedEmails ?? [], authTokens: obj.authTokens ?? [] };
    }
  } catch {
    /* fall through to a fresh store -- a corrupt file shouldn't crash the server */
  }
  return { allowedEmails: [], authTokens: [] };
}

function save(data: StoreShape): void {
  writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
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
