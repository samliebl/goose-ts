import { loadResourceFile } from "./utils/fileHelper.js";

const TABSSPACE = /[\s\t]+/g;

/**
 * Collapses whitespace runs (including newlines/tabs) to single spaces and trims.
 * Port of goose.text.innerTrim.
 */
export function innerTrim(value: string): string {
  if (typeof value !== "string") return "";
  return value.replace(TABSSPACE, " ").trim();
}

export class WordStats {
  stopWordCount = 0;
  wordCount = 0;
  stopWords: string[] = [];

  getStopwordCount(): number {
    return this.stopWordCount;
  }

  setStopwordCount(count: number): void {
    this.stopWordCount = count;
  }

  getWordCount(): number {
    return this.wordCount;
  }

  setWordCount(count: number): void {
    this.wordCount = count;
  }

  getStopWords(): string[] {
    return this.stopWords;
  }

  setStopWords(words: string[]): void {
    this.stopWords = words;
  }
}

// Mirrors Python's string.punctuation exactly (ASCII punctuation only) so
// accented/CJK letters survive removePunctuation, matching python-goose.
const PUNCTUATION_CHARS = new Set([
  "!",
  '"',
  "#",
  "$",
  "%",
  "&",
  "'",
  "(",
  ")",
  "*",
  "+",
  ",",
  "-",
  ".",
  "/",
  ":",
  ";",
  "<",
  "=",
  ">",
  "?",
  "@",
  "[",
  "\\",
  "]",
  "^",
  "_",
  "`",
  "{",
  "|",
  "}",
  "~",
]);

const stopWordsCache = new Map<string, Set<string>>();

function loadStopWords(language: string): Set<string> {
  const cached = stopWordsCache.get(language);
  if (cached) return cached;

  let words: string[] = [];
  try {
    const content = loadResourceFile(`text/stopwords-${language}.txt`);
    words = content.split(/\r?\n/).filter(Boolean);
  } catch {
    words = [];
  }
  const set = new Set(words);
  stopWordsCache.set(language, set);
  return set;
}

/**
 * Port of goose.text.StopWords. Scores a chunk of text by how many of its
 * words are "stopwords" for the given language -- goose's proxy for "this
 * looks like real prose, not a link list or boilerplate".
 */
export class StopWords {
  protected readonly STOP_WORDS: Set<string>;

  constructor(language = "en") {
    this.STOP_WORDS = loadStopWords(language);
  }

  removePunctuation(content: string): string {
    let out = "";
    for (const ch of content) {
      if (!PUNCTUATION_CHARS.has(ch)) out += ch;
    }
    return out;
  }

  candidateWords(strippedInput: string): string[] {
    return strippedInput.split(" ");
  }

  getStopwordCount(content: string | null | undefined): WordStats {
    const ws = new WordStats();
    if (!content) return ws;

    const strippedInput = this.removePunctuation(content);
    const candidateWords = this.candidateWords(strippedInput);
    const overlappingStopwords: string[] = [];
    let c = 0;
    for (const w of candidateWords) {
      c += 1;
      if (this.STOP_WORDS.has(w.toLowerCase())) {
        overlappingStopwords.push(w.toLowerCase());
      }
    }

    ws.setWordCount(c);
    ws.setStopwordCount(overlappingStopwords.length);
    ws.setStopWords(overlappingStopwords);
    return ws;
  }
}

/** Chinese segmentation, using Intl.Segmenter in place of python-goose's jieba dependency. */
export class StopWordsChinese extends StopWords {
  constructor() {
    super("zh");
  }

  override candidateWords(strippedInput: string): string[] {
    const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
    return Array.from(segmenter.segment(strippedInput), (s) => s.segment);
  }
}

/**
 * Arabic segmentation. python-goose stems words with nltk's ISRI stemmer
 * before matching; we approximate with plain word tokenization since a
 * faithful ISRI port is out of scope, so results may vary slightly from
 * python-goose on Arabic-specific stemming edge cases.
 */
export class StopWordsArabic extends StopWords {
  constructor() {
    super("ar");
  }

  override removePunctuation(content: string): string {
    return content;
  }

  override candidateWords(strippedInput: string): string[] {
    return strippedInput.match(/[\w']+|[^\s\w]+/gu) ?? [];
  }
}

/**
 * Korean segmentation. Faithfully reproduces python-goose's
 * StopWordsKorean.get_stopword_count, which (due to an upstream bug) counts
 * every stopword for every candidate word rather than only overlapping
 * ones -- kept as-is for output parity with python-goose.
 */
export class StopWordsKorean extends StopWords {
  constructor() {
    super("ko");
  }

  override getStopwordCount(content: string | null | undefined): WordStats {
    const ws = new WordStats();
    if (!content) return ws;

    const strippedInput = this.removePunctuation(content);
    const candidateWords = this.candidateWords(strippedInput);
    const overlappingStopwords: string[] = [];
    let c = 0;
    for (const _w of candidateWords) {
      c += 1;
      for (const stopWord of this.STOP_WORDS) {
        overlappingStopwords.push(stopWord);
      }
    }

    ws.setWordCount(c);
    ws.setStopwordCount(overlappingStopwords.length);
    ws.setStopWords(overlappingStopwords);
    return ws;
  }
}

export type StopWordsClass = new (language?: string) => StopWords;
