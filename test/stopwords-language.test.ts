import { describe, expect, it } from "vitest";
import { StopWords } from "../src/text.js";

// The language code is interpolated into a resource file path, and a server
// may pass it straight from a request -- only a bare ISO code may ever
// reach the filesystem.
describe("StopWords language handling", () => {
  it("loads a real language", () => {
    expect(new StopWords("en").STOP_WORDS.size).toBeGreaterThan(50);
  });

  it.each(["../../../etc/hosts", "en/../../x", "en\0", "EN", "english", ""])(
    "treats %j as no language rather than building a file path from it",
    (language) => {
      expect(new StopWords(language).STOP_WORDS.size).toBe(0);
    },
  );
});
