import type { DomElement } from "../dom/Parser.js";
import { Video } from "../Video.js";
import { BaseExtractor } from "./BaseExtractor.js";

const VIDEOS_TAGS = ["iframe", "embed", "object", "video"];
const VIDEO_PROVIDERS = ["youtube", "vimeo", "dailymotion", "kewego"];

/** Port of goose.extractors.videos.VideoExtractor. */
export class VideosExtractor extends BaseExtractor {
  private candidates: DomElement[] = [];
  private movies: Video[] = [];

  private getEmbedCode(node: DomElement): string {
    return this.parser
      .nodeToString(node)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .join("");
  }

  private getEmbedType(node: DomElement): string {
    return this.parser.getTag(node);
  }

  private getWidth(node: DomElement): string | null {
    return this.parser.getAttribute(node, "width");
  }

  private getHeight(node: DomElement): string | null {
    return this.parser.getAttribute(node, "height");
  }

  private getSrc(node: DomElement): string | null {
    return this.parser.getAttribute(node, "src");
  }

  private getProvider(src: string | null): string | null {
    if (src) {
      for (const provider of VIDEO_PROVIDERS) {
        if (src.includes(provider)) return provider;
      }
    }
    return null;
  }

  private getVideo(node: DomElement): Video {
    const video = new Video();
    video.embedCode = this.getEmbedCode(node);
    video.embedType = this.getEmbedType(node);
    video.width = this.getWidth(node);
    video.height = this.getHeight(node);
    video.src = this.getSrc(node);
    video.provider = this.getProvider(video.src);
    return video;
  }

  private getIframeTag(node: DomElement): Video | null {
    return this.getVideo(node);
  }

  private getVideoTag(_node: DomElement): Video | null {
    return new Video();
  }

  private getEmbedTag(node: DomElement): Video | null {
    const parent = this.parser.getParent(node) as DomElement | null;
    if (parent !== null && parent.name === "object") {
      // python-goose passes the embed node itself here (not `parent`),
      // which means getObjectTag's descendant search for <param> never
      // matches (params are object children, siblings of embed) -- kept
      // as-is for output parity rather than "fixed".
      return this.getObjectTag(node);
    }
    return this.getVideo(node);
  }

  private getObjectTag(node: DomElement): Video | null {
    const childEmbedTag = this.parser.getElementsByTag(node, { tag: "embed" });
    if (childEmbedTag.length && this.candidates.includes(childEmbedTag[0]!)) {
      this.candidates = this.candidates.filter((c) => c !== childEmbedTag[0]);
    }

    const srcNode = this.parser.getElementsByTag(node, {
      tag: "param",
      attr: "name",
      value: "movie",
    });
    if (!srcNode.length) return null;

    const src = this.parser.getAttribute(srcNode[0]!, "value");
    const provider = this.getProvider(src);
    if (!provider) return null;

    const video = this.getVideo(node);
    video.provider = provider;
    video.src = src;
    return video;
  }

  getVideos(): void {
    this.candidates = this.parser.getElementsByTags(this.article.topNode!, VIDEOS_TAGS);

    for (const candidate of this.candidates) {
      const tag = this.parser.getTag(candidate);
      let movie: Video | null = null;
      if (tag === "iframe") movie = this.getIframeTag(candidate);
      else if (tag === "video") movie = this.getVideoTag(candidate);
      else if (tag === "embed") movie = this.getEmbedTag(candidate);
      else if (tag === "object") movie = this.getObjectTag(candidate);

      if (movie !== null && movie.provider !== null) {
        this.movies.push(movie);
      }
    }

    this.article.movies = [...this.movies];
  }
}
