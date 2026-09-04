import { BaseExtractor } from "./BaseExtractor.js";

/** Port of goose.extractors.tweets.TweetsExtractor. */
export class TweetsExtractor extends BaseExtractor {
  extract(): string[] {
    const tweets: string[] = [];
    const items = this.parser.getElementsByTag(this.article.topNode!, {
      tag: "blockquote",
      attr: "class",
      value: "twitter-tweet",
    });

    for (const item of items) {
      this.parser.delAttribute(item, "gravityScore");
      this.parser.delAttribute(item, "gravityNodes");
      tweets.push(this.parser.nodeToString(item));
    }

    return tweets;
  }
}
