import type { Article } from "../Article.js";
import type { Configuration } from "../Configuration.js";
import { Image } from "../Image.js";
import type { LocallyStoredImage } from "../Image.js";
import type { DomElement, Parser } from "../dom/Parser.js";
import { loadResourceFile } from "../utils/fileHelper.js";
import { ImageUtils } from "../utils/images.js";
import { BaseExtractor } from "./BaseExtractor.js";

const KNOWN_IMG_DOM_NAMES = [
  "yn-story-related-media",
  "cnn_strylccimg300cntr",
  "big_photo",
  "ap-smallphoto-a",
];

const BAD_IMAGES_NAMES_RE =
  /\.html|\.gif|\.ico|button|twitter\.jpg|facebook\.jpg|ap_buy_photo|digg\.jpg|digg\.png|delicious\.png|facebook\.png|reddit\.jpg|doubleclick|diggthis|diggThis|adserver|\/ads\/|ec\.atdmt\.com|mediaplex\.com|adsatt|view\.atdmt/;

interface DepthTraversal {
  node: DomElement;
  parentDepth: number;
  siblingDepth: number;
}

function loadCustomSiteMapping(): Map<string, string> {
  const mapping = new Map<string, string>();
  const data = loadResourceFile("images/known-image-css.txt");
  for (const line of data.split(/\r?\n/)) {
    if (!line) continue;
    const [domain, css] = line.split("^");
    if (domain && css) mapping.set(domain, css);
  }
  return mapping;
}

/** Port of goose.extractors.images.ImageExtractor -- picks the article's main image. */
export class ImagesExtractor extends BaseExtractor {
  private readonly customSiteMapping = loadCustomSiteMapping();
  private readonly knownImgDomNames = [...KNOWN_IMG_DOM_NAMES];
  private readonly imagesMinBytes = 4000;
  private readonly targetUrl: string;

  constructor(config: Configuration, article: Article, parser: Parser) {
    super(config, article, parser);
    this.targetUrl = this.article.finalUrl;
  }

  async getBestImage(topNode: DomElement): Promise<Image> {
    const known = await this.checkKnownElements();
    if (known) return known;

    const large = await this.checkLargeImages(topNode, 0, 0);
    if (large) return large;

    const meta = await this.checkMetaTag();
    if (meta) return meta;

    return new Image();
  }

  private async checkMetaTag(): Promise<Image | null> {
    return (await this.checkLinkTag()) ?? (await this.checkOpengraphTag());
  }

  private async checkLargeImages(
    node: DomElement,
    parentDepthLevel: number,
    siblingDepthLevel: number,
  ): Promise<Image | null> {
    const goodImages = await this.getImageCandidates(node);

    if (goodImages.length) {
      const scoredImages = await this.fetchImages(goodImages, parentDepthLevel);
      if (scoredImages.length) {
        const [highscoreImage] = scoredImages.sort((a, b) => b.score - a.score);
        const main = new Image();
        main.src = highscoreImage!.image.src;
        main.width = highscoreImage!.image.width;
        main.height = highscoreImage!.image.height;
        main.extractionType = "bigimage";
        main.confidenceScore = scoredImages.length > 0 ? 100 / scoredImages.length : 0;
        return main;
      }
    }

    const depthObj = this.getDepthLevel(node, parentDepthLevel, siblingDepthLevel);
    if (depthObj) {
      return this.checkLargeImages(depthObj.node, depthObj.parentDepth, depthObj.siblingDepth);
    }

    return null;
  }

  private getDepthLevel(
    node: DomElement | null,
    parentDepth: number,
    siblingDepth: number,
  ): DepthTraversal | null {
    const MAX_PARENT_DEPTH = 2;
    if (parentDepth > MAX_PARENT_DEPTH) return null;
    if (node === null) return null;

    const siblingNode = this.parser.previousSibling(node);
    if (siblingNode !== null) {
      return { node: siblingNode, parentDepth, siblingDepth: siblingDepth + 1 };
    }
    const parent = this.parser.getParent(node) as DomElement | null;
    if (parent !== null) {
      return { node: parent, parentDepth: parentDepth + 1, siblingDepth: 0 };
    }
    return null;
  }

  /**
   * Downloads candidate images and scores them: images higher up in the DOM
   * and closer to the article's original size carry more weight, and
   * banner-shaped images are penalized.
   */
  private async fetchImages(
    images: DomElement[],
    depthLevel: number,
  ): Promise<Array<{ image: LocallyStoredImage; score: number }>> {
    const results: Array<{ image: LocallyStoredImage; score: number }> = [];
    let initialArea = 0;
    let cnt = 1;
    const MIN_WIDTH = 50;

    for (const image of images.slice(0, 30)) {
      const src = this.buildImagePath(this.parser.getAttribute(image, "src") ?? "");
      const localImage = await ImageUtils.fetchImageInfo(src, this.config);
      if (!localImage) continue;

      const { width, height, fileExtension } = localImage;

      // Tautology preserved from python-goose (always true regardless of
      // fileExtension) -- kept for behavioral parity rather than "fixed".
      // The `as string` defeats TS's (correct!) narrowing, which would
      // otherwise flag this as an impossible comparison.
      if (fileExtension !== ".gif" || (fileExtension as string) !== "NA") {
        if ((depthLevel >= 1 && width > 300) || depthLevel < 1) {
          if (!this.isBannerDimensions(width, height) && width > MIN_WIDTH) {
            const sequenceScore = 1.0 / cnt;
            const area = width * height;
            let totalScore: number;

            if (initialArea === 0) {
              initialArea = area * 1.48;
              totalScore = 1;
            } else {
              const areaDifference = area / initialArea;
              totalScore = sequenceScore * areaDifference;
            }

            results.push({ image: localImage, score: totalScore });
            cnt += 1;
          }
        }
      }
    }
    return results;
  }

  private async getImage(src: string, score = 100, extractionType = "N/A"): Promise<Image> {
    const image = new Image();
    image.src = this.buildImagePath(src);
    image.extractionType = extractionType;
    image.confidenceScore = score;

    const localImage = await ImageUtils.fetchImageInfo(image.src, this.config);
    if (localImage) {
      image.bytes = localImage.bytes;
      image.height = localImage.height;
      image.width = localImage.width;
    }

    return image;
  }

  private isBannerDimensions(width: number, height: number): boolean {
    if (width === height) return false;
    if (width > height && width / height > 5) return true;
    if (height > width && height / width > 5) return true;
    return false;
  }

  private getNodeImages(node: DomElement): DomElement[] {
    return this.parser.getElementsByTag(node, { tag: "img" });
  }

  private filterBadNames(images: DomElement[]): DomElement[] {
    return images.filter((image) => this.isValidFilename(image));
  }

  private isValidFilename(imageNode: DomElement): boolean {
    const src = this.parser.getAttribute(imageNode, "src");
    if (!src) return false;
    return !BAD_IMAGES_NAMES_RE.test(src);
  }

  private async getImageCandidates(node: DomElement): Promise<DomElement[]> {
    const images = this.getNodeImages(node);
    if (!images.length) return [];
    const filtered = this.filterBadNames(images);
    if (!filtered.length) return [];
    return this.getImagesBytesizeMatch(filtered);
  }

  private async getImagesBytesizeMatch(images: DomElement[]): Promise<DomElement[]> {
    const MAX_BYTES_SIZE = 15_728_640;
    const good: DomElement[] = [];
    let cnt = 0;
    for (const image of images) {
      if (cnt > 30) return good;
      const src = this.buildImagePath(this.parser.getAttribute(image, "src") ?? "");
      const localImage = await ImageUtils.fetchImageInfo(src, this.config);
      if (localImage) {
        const { bytes } = localImage;
        if ((bytes === 0 || bytes > this.imagesMinBytes) && bytes < MAX_BYTES_SIZE) {
          good.push(image);
        }
      }
      cnt += 1;
    }
    return good;
  }

  private async checkLinkTag(): Promise<Image | null> {
    const node = this.article.rawDoc!;
    const meta = this.parser.getElementsByTag(node, {
      tag: "link",
      attr: "rel",
      value: "image_src",
    });
    for (const item of meta) {
      const src = this.parser.getAttribute(item, "href");
      if (src) return this.getImage(src, undefined, "linktag");
    }
    return null;
  }

  private async checkOpengraphTag(): Promise<Image | null> {
    const node = this.article.rawDoc!;
    const meta = this.parser.getElementsByTag(node, {
      tag: "meta",
      attr: "property",
      value: "og:image",
    });
    for (const item of meta) {
      const src = this.parser.getAttribute(item, "content");
      if (src) return this.getImage(src, undefined, "opengraph");
    }
    return null;
  }

  private getCleanDomain(): string | null {
    return this.article.domain ? this.article.domain.replace("www.", "") : null;
  }

  /**
   * Looks for known image containers from specific sites goose has
   * hardcoded knowledge of (yahoo, cnn, techcrunch, etc.).
   */
  private async checkKnownElements(): Promise<Image | null> {
    const domain = this.getCleanDomain();
    if (domain && this.customSiteMapping.has(domain)) {
      for (const className of this.customSiteMapping.get(domain)!.split("|")) {
        this.knownImgDomNames.push(className);
      }
    }

    const doc = this.article.rawDoc!;

    const checkElements = (elements: DomElement[]): DomElement | null => {
      for (const element of elements) {
        if (element.name === "img") return element;
        const images = this.parser.getElementsByTag(element, { tag: "img" });
        if (images.length) return images[0]!;
      }
      return null;
    };

    for (const css of this.knownImgDomNames) {
      const elements = this.parser.getElementsByTag(doc, { attr: "id", value: css });
      const image = checkElements(elements);
      if (image) {
        const src = this.parser.getAttribute(image, "src");
        if (src) return this.getImage(src, 90, "known");
      }
    }

    for (const css of this.knownImgDomNames) {
      const elements = this.parser.getElementsByTag(doc, { attr: "class", value: css });
      const image = checkElements(elements);
      if (image) {
        const src = this.parser.getAttribute(image, "src");
        if (src) return this.getImage(src, 90, "known");
      }
    }

    return null;
  }

  private buildImagePath(src: string): string {
    try {
      const parsed = new URL(src);
      if (parsed.hostname) return parsed.toString();
    } catch {
      // relative URL -- fall through to resolve against targetUrl
    }
    try {
      return new URL(src, this.targetUrl).toString();
    } catch {
      return src;
    }
  }
}
