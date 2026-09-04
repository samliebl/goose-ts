import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Resources ship alongside dist/ in the published package (see package.json
// "files"), but this module's own location differs between dev (src/utils)
// and the built bundle (dist/, flattened by tsup) -- so we probe a few
// plausible relative paths rather than hardcoding one.
const CANDIDATE_ROOTS = [
  join(here, "..", "resources"), // src/utils -> src/resources
  join(here, "..", "src", "resources"), // dist -> src/resources
  join(here, "resources"), // already at package root
];

const resourcesRoot = CANDIDATE_ROOTS.find((candidate) => existsSync(candidate));

/** Reads a bundled resource file (stopword lists, known-image CSS heuristics) as UTF-8 text. */
export function loadResourceFile(relativePath: string): string {
  if (!resourcesRoot) {
    throw new Error("goose-ts: could not locate the bundled resources directory");
  }
  const path = join(resourcesRoot, relativePath);
  try {
    return readFileSync(path, "utf-8");
  } catch {
    throw new Error(`goose-ts: could not read resource file ${path}`);
  }
}
