import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { Goose } from "./Goose.js";
import { VERSION } from "./version.js";

function printUsage(): void {
  console.log(`goose-ts v${VERSION} -- article/content extraction

Usage:
  goose-ts <url>              Fetch a URL and extract its article
  goose-ts --file <path>      Extract from a local HTML file instead
  goose-ts --text <url>       Print only the cleaned article text
  goose-ts --help             Show this help

Output is a JSON object by default (title, cleanedText, authors, tags, ...).`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      file: { type: "string" },
      text: { type: "boolean", default: false },
      language: { type: "string", short: "l" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help || (!values.file && positionals.length === 0)) {
    printUsage();
    process.exitCode = values.help ? 0 : 1;
    return;
  }

  const goose = new Goose({ targetLanguage: values.language ?? "en" });

  const article = values.file
    ? await goose.extract({ rawHtml: await readFile(values.file, "utf-8") })
    : await goose.extract({ url: positionals[0] });

  if (values.text) {
    console.log(article.cleanedText);
    return;
  }

  console.log(JSON.stringify(article.infos, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
