import sharp from "sharp";
import type { Configuration } from "../Configuration.js";
import { LocallyStoredImage } from "../Image.js";
import { guardedFetch } from "../safeFetch.js";

const MIME_EXTENSIONS: Record<string, string> = {
  png: ".png",
  jpeg: ".jpg",
  gif: ".gif",
  webp: ".webp",
  avif: ".avif",
  tiff: ".tiff",
  svg: ".svg",
};

/**
 * Replaces python-goose's utils.images.ImageUtils, which downloaded images
 * to a local cache directory and shelled out to ImageMagick's `identify`.
 * We fetch straight into memory and read dimensions with sharp, so there's
 * no local_storage_path / imagemagick_path configuration to manage.
 */
export class ImageUtils {
  static async fetchImageInfo(
    src: string,
    config: Configuration,
  ): Promise<LocallyStoredImage | null> {
    // Image scoring fetches candidates one at a time (see ImagesExtractor) --
    // once the overall extraction budget is spent, stop starting new
    // requests rather than let a slow/image-heavy page run indefinitely.
    if (config.remainingMs() <= 0) return null;

    let buffer: Buffer;
    try {
      const { response, bytes } = await guardedFetch(src, config, {
        headers: { "User-Agent": config.browserUserAgent },
        maxBytes: config.maxImageBytes,
      });
      if (!response.ok) return null;
      buffer = bytes;
    } catch {
      return null;
    }

    try {
      const metadata = await sharp(buffer).metadata();
      const fileExtension = metadata.format ? (MIME_EXTENSIONS[metadata.format] ?? "NA") : "NA";
      return new LocallyStoredImage(
        src,
        buffer.byteLength,
        fileExtension,
        metadata.height ?? 0,
        metadata.width ?? 0,
      );
    } catch {
      return null;
    }
  }
}
