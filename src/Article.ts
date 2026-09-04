import type { DomElement } from "./dom/Parser.js";
import type { Image } from "./Image.js";
import type { Video } from "./Video.js";

export interface ArticleInfos {
  meta: {
    description: string;
    lang: string | null;
    keywords: string;
    favicon: string;
    canonical: string;
  };
  image: { url: string; width: number; height: number; type: "image" } | null;
  domain: string | null;
  title: string;
  cleanedText: string;
  opengraph: Record<string, string>;
  tags: string[];
  tweets: string[];
  movies: Array<{
    embedType: string | null;
    provider: string | null;
    width: string | null;
    height: string | null;
    embedCode: string | null;
    src: string | null;
  }>;
  links: string[];
  authors: string[];
  publishDate: string | null;
}

/** Port of goose.article.Article -- the result object returned by Goose.extract(). */
export class Article {
  title = "";
  cleanedText = "";
  metaDescription = "";
  metaLang: string | null = null;
  metaFavicon = "";
  metaKeywords = "";
  canonicalLink = "";
  domain: string | null = null;
  topNode: DomElement | null = null;
  topImage: Image | null = null;
  tags: string[] = [];
  opengraph: Record<string, string> = {};
  tweets: string[] = [];
  movies: Video[] = [];
  links: string[] = [];
  authors: string[] = [];
  finalUrl = "";
  linkHash = "";
  rawHtml = "";
  doc: DomElement | null = null;
  rawDoc: DomElement | null = null;
  publishDate: string | null = null;
  additionalData: Record<string, unknown> = {};

  get infos(): ArticleInfos {
    return {
      meta: {
        description: this.metaDescription,
        lang: this.metaLang,
        keywords: this.metaKeywords,
        favicon: this.metaFavicon,
        canonical: this.canonicalLink,
      },
      image: this.topImage
        ? {
            url: this.topImage.src,
            width: this.topImage.width,
            height: this.topImage.height,
            type: "image",
          }
        : null,
      domain: this.domain,
      title: this.title,
      cleanedText: this.cleanedText,
      opengraph: this.opengraph,
      tags: this.tags,
      tweets: this.tweets,
      movies: this.movies.map((movie) => ({
        embedType: movie.embedType,
        provider: movie.provider,
        width: movie.width,
        height: movie.height,
        embedCode: movie.embedCode,
        src: movie.src,
      })),
      links: this.links,
      authors: this.authors,
      publishDate: this.publishDate,
    };
  }
}
