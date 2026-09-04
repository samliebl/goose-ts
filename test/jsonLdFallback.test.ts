import { describe, expect, it } from "vitest";
import { Configuration, type ConfigurationOptions } from "../src/Configuration.js";
import { Goose } from "../src/Goose.js";

// This fallback is a goose-ts addition (not part of python-goose), so there
// are no upstream fixtures to port -- these are hand-written, modeled on
// how real client-side-rendered pages (React/Vue app shells) and their
// schema.org JSON-LD actually look.

const CSR_SHELL_WITH_JSON_LD = `
<html>
  <head>
    <title>Loading...</title>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      "headline": "Local Team Wins Championship After Dramatic Overtime",
      "description": "A last-second goal sealed the win.",
      "articleBody": "The home team pulled off a stunning upset on Saturday night, coming from three goals down to win in overtime. Fans who had started filing out of the stadium in the third period rushed back to their seats as the comeback unfolded. The winning goal, scored with just four seconds left on the clock, sent the crowd into a frenzy that lasted long after the final whistle. Coaches on both sides called it one of the most remarkable finishes either had witnessed in decades of competition.",
      "author": { "@type": "Person", "name": "Jamie Rivera" },
      "datePublished": "2026-03-14T08:00:00Z",
      "keywords": ["sports", "championship", "overtime"],
      "image": { "@type": "ImageObject", "url": "https://example.com/photo.jpg" }
    }
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script src="/static/bundle.js"></script>
  </body>
</html>
`;

const GRAPH_WRAPPED_JSON_LD = `
<html>
  <head>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "BreadcrumbList", "itemListElement": [] },
        { "@type": "Organization", "name": "Example News" },
        {
          "@type": "BlogPosting",
          "headline": "Why Static Site Generators Are Having a Moment",
          "articleBody": "Static site generators have quietly become one of the most popular ways to ship a fast, reliable website. By doing the rendering work at build time instead of on every request, they sidestep a whole category of runtime failures. Content teams get a familiar authoring workflow, while developers get to keep the tooling they already like. The result is a generation of sites that load instantly and rarely go down, even under heavy traffic.",
          "datePublished": "2026-01-05"
        }
      ]
    }
    </script>
  </head>
  <body><div id="app"></div></body>
</html>
`;

const NORMAL_ARTICLE_WITH_UNRELATED_JSON_LD = `
<html>
  <head>
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": "This headline should NOT win",
      "articleBody": "This JSON-LD body text should never be used because the real DOM content below is already substantial and should be preferred over it in every case we care about here."
    }
    </script>
  </head>
  <body>
    <article>
      <p>Six years ago, a small team of engineers set out to rebuild their company's aging platform from scratch, betting that a full rewrite would pay for itself within a year. It did not. What followed was an eighteen-month slog through unexpected edge cases, half-finished migrations, and a growing pile of technical debt that the rewrite was supposed to eliminate in the first place.</p>
      <p>By the second year, the team had learned to ship incrementally instead, breaking the remaining work into pieces small enough to land safely every week. Customers barely noticed the transition, which in hindsight was exactly the point: the best migrations are the ones nobody has to think about.</p>
    </article>
  </body>
</html>
`;

const MALFORMED_JSON_LD = `
<html>
  <head>
    <script type="application/ld+json">
    { this is not valid json at all }
    </script>
  </head>
  <body><div id="root"></div></body>
</html>
`;

function goose(overrides: ConfigurationOptions = {}) {
  return new Goose(new Configuration({ enableImageFetching: false, ...overrides }));
}

describe("JSON-LD fallback", () => {
  it("recovers title/text/authors/date/tags from a NewsArticle block when the DOM has nothing", async () => {
    const article = await goose().extract({
      rawHtml: CSR_SHELL_WITH_JSON_LD,
      url: "https://example.com/a",
    });

    expect(article.title).toBe("Local Team Wins Championship After Dramatic Overtime");
    expect(article.cleanedText).toContain("stunning upset on Saturday night");
    expect(article.authors).toEqual(["Jamie Rivera"]);
    expect(article.publishDate).toBe("2026-03-14T08:00:00Z");
    expect(article.tags).toEqual(["sports", "championship", "overtime"]);
    expect(article.metaDescription).toBe("A last-second goal sealed the win.");
  });

  it("finds an Article node wrapped in @graph alongside unrelated types", async () => {
    const article = await goose().extract({
      rawHtml: GRAPH_WRAPPED_JSON_LD,
      url: "https://example.com/b",
    });

    expect(article.title).toBe("Why Static Site Generators Are Having a Moment");
    expect(article.cleanedText).toContain("Static site generators have quietly become");
    expect(article.publishDate).toBe("2026-01-05");
  });

  it("does not override a substantial DOM-scored result", async () => {
    const article = await goose().extract({
      rawHtml: NORMAL_ARTICLE_WITH_UNRELATED_JSON_LD,
      url: "https://example.com/c",
    });

    expect(article.cleanedText).toContain("small team of engineers");
    expect(article.cleanedText).not.toContain("should NOT win");
    expect(article.title).not.toBe("This headline should NOT win");
  });

  it("fails gracefully on malformed JSON-LD instead of throwing", async () => {
    const article = await goose().extract({
      rawHtml: MALFORMED_JSON_LD,
      url: "https://example.com/d",
    });
    expect(article.cleanedText).toBe("");
  });

  it("can be disabled via enableJsonLdFallback: false", async () => {
    const article = await goose({ enableJsonLdFallback: false }).extract({
      rawHtml: CSR_SHELL_WITH_JSON_LD,
      url: "https://example.com/e",
    });
    expect(article.cleanedText).toBe("");
    // TitleExtractor always finds *something* (its last resort is the raw
    // <title> tag) independent of this fallback -- disabling the fallback
    // means we don't override that with the better JSON-LD headline, not
    // that title goes back to empty.
    expect(article.title).toBe("Loading...");
  });
});
