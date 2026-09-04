import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Configuration, Goose, type ConfigurationOptions } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
const HOST = "127.0.0.1";

interface ExtractRequestBody {
  url?: string;
  rawHtml?: string;
  config?: Partial<ConfigurationOptions>;
}

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(join(here, "public")));

app.post("/api/extract", async (req, res) => {
  const body = req.body as ExtractRequestBody;

  if (!body.url && !body.rawHtml) {
    res.status(400).json({ error: "Provide either a url or rawHtml." });
    return;
  }

  const started = performance.now();
  try {
    const config = new Configuration(body.config ?? {});
    const goose = new Goose(config);
    const article = await goose.extract({ url: body.url, rawHtml: body.rawHtml });
    res.json({
      ok: true,
      elapsedMs: Math.round(performance.now() - started),
      article: article.infos,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      elapsedMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`goose-ts web UI: http://${HOST}:${PORT}`);
  console.log(
    "(local dev tool only -- not part of the published package, don't expose this port publicly)",
  );
});
