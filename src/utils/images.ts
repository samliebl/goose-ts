import sharp from "sharp";
import type { Configuration } from "../Configuration.js";
import { LocallyStoredImage } from "../Image.js";

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
    let buffer: Buffer;
    try {
      const res = await fetch(src, {
        headers: { "User-Agent": config.browserUserAgent },
        signal: AbortSignal.timeout(config.httpTimeout),
      });
      if (!res.ok) return null;
      buffer = Buffer.from(await res.arrayBuffer());
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
