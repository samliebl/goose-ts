import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A throwaway data directory plus the env the web modules need, restored afterwards. */
export function useTempStore(extraEnv: Record<string, string | undefined> = {}) {
  const saved: Record<string, string | undefined> = {};
  let dir = "";
  const env: Record<string, string | undefined> = {
    OWNER_EMAIL: "owner@example.com",
    SESSION_SECRET: "test-session-secret-0123456789",
    DATA_KEY: undefined,
    NODE_ENV: "test",
    ...extraEnv,
  };

  return {
    get dir() {
      return dir;
    },
    get path() {
      return join(dir, "store.json");
    },
    setup() {
      dir = mkdtempSync(join(tmpdir(), "regoose-test-"));
      for (const [k, v] of Object.entries({ DB_PATH: join(dir, "store.json"), ...env })) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
    teardown() {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
