/** Port of goose.image.Image -- the best-guess main image for an article. */
export class Image {
  src = "";
  confidenceScore = 0;
  height = 0;
  width = 0;
  extractionType = "NA";
  bytes = 0;

  getSrc(): string {
    return this.src;
  }
}

export class ImageDetails {
  width = 0;
  height = 0;
  mimeType: string | null = null;
}

export class LocallyStoredImage {
  constructor(
    public src = "",
    public bytes = 0,
    public fileExtension = "",
    public height = 0,
    public width = 0,
  ) {}
}
