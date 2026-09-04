import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Article } from "../../src/Article.js";
import { Configuration } from "../../src/Configuration.js";
import { Goose } from "../../src/Goose.js";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_ROOT = join(here, "..", "fixtures", "extractors");

export interface FixtureData {
  url: string;
  target_language?: string;
  expected: Record<string, unknown>;
}

export function loadFixture(category: string, name: string): { html: string; data: FixtureData } {
  const dir = join(FIXTURES_ROOT, category);
  const html = readFileSync(join(dir, `${name}.html`), "utf-8");
  const data = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf-8")) as FixtureData;
  return { html, data };
}

export async function extractFixture(
  category: string,
  name: string,
  configOverrides: Partial<ConstructorParameters<typeof Configuration>[0]> = {},
): Promise<{ article: Article; data: FixtureData }> {
  const { html, data } = loadFixture(category, name);
  const config = new Configuration({
    enableImageFetching: false,
    ...(data.target_language
      ? { targetLanguage: data.target_language, useMetaLanguage: false }
      : {}),
    ...configOverrides,
  });
  const goose = new Goose(config);
  const article = await goose.extract({ url: data.url, rawHtml: html });
  return { article, data };
}
