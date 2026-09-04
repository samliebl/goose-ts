import { describe, expect, it } from "vitest";
import type { Article } from "../../src/Article.js";
import { extractFixture } from "../helpers/fixtures.js";

// name -> python-goose field names to assert, mirroring
// python-goose/tests/extractors/content.py exactly. test_guardian1 is
// omitted because it's disabled upstream too (a known unicode issue).
// test_bbc_chinese is omitted because it fails against real python-goose
// as well (verified empirically): with the default (non-Chinese-aware)
// StopWords class, space-less Chinese text never clears the >2 stopword
// threshold, so calculateBestNode() returns null for both ports.
const FIXTURES: Record<string, string[]> = {
  test_allnewlyrics1: ["title", "cleaned_text"],
  test_cnn1: ["title", "cleaned_text"],
  test_businessWeek1: ["title", "cleaned_text"],
  test_businessWeek2: ["title", "cleaned_text"],
  test_businessWeek3: ["cleaned_text"],
  test_cbslocal: ["cleaned_text"],
  test_elmondo1: ["cleaned_text"],
  test_elpais: ["cleaned_text"],
  test_liberation: ["cleaned_text"],
  test_lefigaro: ["cleaned_text"],
  test_techcrunch1: ["title", "cleaned_text"],
  test_foxNews: ["cleaned_text"],
  test_aolNews: ["cleaned_text"],
  test_huffingtonPost2: ["cleaned_text"],
  test_testHuffingtonPost: ["cleaned_text", "meta_description", "title"],
  test_espn: ["cleaned_text"],
  test_engadget: ["cleaned_text"],
  test_msn1: ["cleaned_text"],
  test_time: ["cleaned_text", "title"],
  test_time2: ["cleaned_text"],
  test_cnet: ["cleaned_text"],
  test_yahoo: ["cleaned_text"],
  test_politico: ["cleaned_text"],
  test_businessinsider3: ["cleaned_text"],
  test_cnbc1: ["cleaned_text"],
  test_marketplace: ["cleaned_text"],
  test_issue24: ["cleaned_text"],
  test_issue25: ["cleaned_text"],
  test_issue28: ["cleaned_text"],
  test_issue32: ["cleaned_text"],
  test_issue4: ["cleaned_text"],
  test_gizmodo1: ["cleaned_text", "meta_description", "meta_keywords"],
  test_mashable_issue_74: ["cleaned_text"],
  test_usatoday_issue_74: ["cleaned_text"],
  test_okaymarketing: ["cleaned_text"],
  test_issue129: ["cleaned_text"],
  test_issue115: ["cleaned_text"],
  test_articlebody_itemprop: ["cleaned_text"],
  test_articlebody_attribute: ["cleaned_text"],
  test_articlebody_tag: ["cleaned_text"],
  test_get_canonical_url: ["cleaned_text", "canonical_link"],
  test_cnn_arabic: ["cleaned_text"],
  test_donga_korean: ["cleaned_text", "meta_description", "meta_keywords"],
};

const FIELD_MAP: Record<string, keyof Article> = {
  title: "title",
  cleaned_text: "cleanedText",
  meta_description: "metaDescription",
  meta_keywords: "metaKeywords",
  canonical_link: "canonicalLink",
};

function assertField(article: Article, field: string, expected: unknown): void {
  const key = FIELD_MAP[field];
  if (!key) throw new Error(`Unmapped field: ${field}`);
  const actual = article[key];

  if (field === "cleaned_text") {
    // python-goose's tests assert a PREFIX match on cleaned_text (result
    // must be at least as long as expected, and start with it) rather than
    // exact equality -- see tests/extractors/base.py assert_cleaned_text.
    const expectedText = expected as string;
    expect((actual as string).length).toBeGreaterThanOrEqual(expectedText.length);
    expect((actual as string).slice(0, expectedText.length)).toBe(expectedText);
  } else {
    expect(actual).toBe(expected);
  }
}

describe("ContentExtractor (fixtures)", () => {
  for (const [name, fields] of Object.entries(FIXTURES)) {
    it(name, async () => {
      const { article, data } = await extractFixture("content", name);
      for (const field of fields) {
        assertField(article, field, data.expected[field]);
      }
    });
  }
});
