import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { deriveKey, isSealed, open, seal } from "./secure-file.js";
import { isProduction } from "./secrets.js";

/**
 * One small file, not a database -- the data is tiny (a handful of people, a
 * few pending codes) and single-writer (one Node process), so an in-memory
 * copy that's written through on every change is genuinely sufficient: no
 * query engine, no native binary, nothing that can fail to compile.
 *
 * What makes that acceptable for personal data:
 *  - Encrypted at rest (AES-256-GCM) whenever DATA_KEY is set, which
 *    production requires. The file lives on Fly's encrypted volume too;
 *    this protects a copy of the file taken any other way.
 *  - Fails closed. A wrong key or a tampered file stops the server with a
 *    clear error rather than being read as "empty" and overwritten, which
 *    would silently erase everyone's access.
 *  - Written atomically (temp file + rename) with 0600 permissions, keeping
 *    the previous version as `.bak`.
 *  - Secrets are stored as hashes (login tokens, access codes), never as
 *    themselves.
 *
 * DB_PATH should point at a Fly volume mount in production (see fly.toml).
 */

export interface Member {
  id: string;
  email: string;
  /** "invited": has a code but hasn't redeemed it yet. "active": can sign in. */
  status: "invited" | "active";
  addedAt: string;
  addedBy: "owner" | "request";
  note: string;
  redeemedAt: string | null;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  lastSeenAt: string | null;
  extractions: number;
  /** Bumped to sign this person out of every device at once. */
  epoch: number;
}

export interface Invite {
  codeHash: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface AccessRequest {
  id: string;
  email: string;
  message: string;
  createdAt: string;
  status: "pending" | "approved" | "declined";
  decidedAt: string | null;
}

export interface AuthToken {
  tokenHash: string;
  email: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface StoreShape {
  version: 2;
  members: Member[];
  invites: Invite[];
  requests: AccessRequest[];
  authTokens: AuthToken[];
  /** Extractions served per "YYYY-MM-DD:tier" -- see consumeDailyUsage. */
  usage: Record<string, number>;
  settings: {
    ownerEpoch: number;
    /** Today's analytics salt. Replaced daily and never kept, so yesterday's visitor hashes can't be linked back to anyone. */
    analyticsSalt: { date: string; salt: string } | null;
  };
}

const emptyStore = (): StoreShape => ({
  version: 2,
  members: [],
  invites: [],
  requests: [],
  authTokens: [],
  usage: {},
  settings: { ownerEpoch: 0, analyticsSalt: null },
});

function dbPath(): string {
  return process.env.DB_PATH ?? "web/.data/goose-ts.json";
}

/** The directory the data file lives in (the Fly volume in production); other persistent files go alongside it. */
export function dataDir(): string {
  return dirname(dbPath());
}

function dataKey(): Buffer | null {
  const secret = process.env.DATA_KEY;
  if (secret) return deriveKey(secret);
  if (isProduction()) throw new Error("Missing required environment variable: DATA_KEY");
  return null;
}

/** Accepts the original (v1) shape too -- its allowlist entries become active members. */
function migrate(parsed: unknown): StoreShape {
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const store = emptyStore();
  if (Array.isArray(obj["members"])) store.members = obj["members"] as Member[];
  if (Array.isArray(obj["invites"])) store.invites = obj["invites"] as Invite[];
  if (Array.isArray(obj["requests"])) store.requests = obj["requests"] as AccessRequest[];
  if (Array.isArray(obj["authTokens"])) store.authTokens = obj["authTokens"] as AuthToken[];
  if (obj["usage"] && typeof obj["usage"] === "object") {
    store.usage = obj["usage"] as Record<string, number>;
  }
  const settings = obj["settings"] as Partial<StoreShape["settings"]> | undefined;
  if (settings) {
    store.settings.ownerEpoch = settings.ownerEpoch ?? 0;
    store.settings.analyticsSalt = settings.analyticsSalt ?? null;
  }

  if (Array.isArray(obj["allowedEmails"])) {
    for (const old of obj["allowedEmails"] as Array<{
      email: string;
      addedAt: string;
      addedBy: string;
    }>) {
      if (store.members.some((m) => m.email === old.email)) continue;
      store.members.push({
        id: crypto.randomUUID(),
        email: old.email,
        status: "active",
        addedAt: old.addedAt,
        addedBy: "owner",
        note: "",
        redeemedAt: old.addedAt,
        termsVersion: null,
        termsAcceptedAt: null,
        lastSeenAt: null,
        extractions: 0,
        epoch: 0,
      });
    }
  }
  return store;
}

let cache: { path: string; data: StoreShape } | null = null;

function load(): StoreShape {
  const path = dbPath();
  if (cache && cache.path === path) return cache.data;

  mkdirSync(dirname(path), { recursive: true });
  let data: StoreShape;
  if (!existsSync(path)) {
    data = emptyStore();
  } else {
    const raw = readFileSync(path);
    let json: string;
    if (isSealed(raw)) {
      const key = dataKey();
      if (!key) throw new Error("The data file is encrypted but DATA_KEY is not set.");
      // Deliberately not caught: a wrong key must stop the server, not read as an empty store.
      json = open(raw, key).toString("utf-8");
    } else {
      json = raw.toString("utf-8");
    }
    try {
      data = migrate(JSON.parse(json));
    } catch {
      const aside = `${path}.corrupt-${Date.now()}`;
      renameSync(path, aside);
      console.error(`Data file was unreadable; moved to ${aside} and starting empty.`);
      data = emptyStore();
    }
  }
  cache = { path, data };
  return data;
}

function save(data: StoreShape): void {
  const path = dbPath();
  const key = dataKey();
  const bytes = Buffer.from(JSON.stringify(data));
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, key ? seal(bytes, key) : bytes, { mode: 0o600 });
  if (existsSync(path)) copyFileSync(path, `${path}.bak`);
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best effort */
  }
}

/** For tests: forget the in-memory copy so the next call re-reads from disk. */
export function resetStoreCache(): void {
  cache = null;
}

/** Reads from the store. The callback must not mutate it. */
export function readStore<T>(fn: (store: StoreShape) => T): T {
  return fn(load());
}

/** Runs a mutation and writes the result through to disk. */
export function updateStore<T>(fn: (store: StoreShape) => T): T {
  const store = load();
  const result = fn(store);
  save(store);
  return result;
}

// --- Login tokens (the emailed sign-in links) ---

export function insertAuthToken(tokenHash: string, email: string, expiresAt: string): void {
  updateStore((s) => {
    s.authTokens.push({ tokenHash, email, expiresAt, usedAt: null });
  });
}

export function findAuthToken(tokenHash: string): AuthToken | null {
  return readStore((s) => s.authTokens.find((t) => t.tokenHash === tokenHash) ?? null);
}

export function markAuthTokenUsed(tokenHash: string): void {
  updateStore((s) => {
    const token = s.authTokens.find((t) => t.tokenHash === tokenHash);
    if (token) token.usedAt = new Date().toISOString();
  });
}

/** Drops tokens that expired more than a day ago. Returns how many were removed. */
export function purgeExpiredAuthTokens(): number {
  return updateStore((s) => {
    const cutoff = Date.now() - 24 * 3600_000;
    const before = s.authTokens.length;
    s.authTokens = s.authTokens.filter((t) => new Date(t.expiresAt).getTime() >= cutoff);
    return before - s.authTokens.length;
  });
}

// --- Daily caps ---

/**
 * Counts one extraction against today's cap for a tier, unless the cap is
 * already reached. Returns whether it was allowed. Kept on the persistent
 * volume rather than in memory, so a machine restart -- which Fly's
 * auto-stop does constantly -- can't be used to reset the cost ceiling.
 */
export function consumeDailyUsage(tier: string, cap: number, now = new Date()): boolean {
  if (cap === Number.POSITIVE_INFINITY) return true;
  return updateStore((store) => {
    const today = now.toISOString().slice(0, 10);
    const key = `${today}:${tier}`;

    const cutoff = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString().slice(0, 10);
    for (const k of Object.keys(store.usage)) {
      if (k.slice(0, 10) < cutoff) delete store.usage[k];
    }

    const used = store.usage[key] ?? 0;
    if (used >= cap) return false;
    store.usage[key] = used + 1;
    return true;
  });
}

export function readDailyUsage(tier: string, now = new Date()): number {
  return readStore((s) => s.usage[`${now.toISOString().slice(0, 10)}:${tier}`] ?? 0);
}
