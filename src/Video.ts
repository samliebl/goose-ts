/** Port of goose.video.Video -- an embedded video (YouTube, Vimeo, etc.) found in an article. */
export class Video {
  embedType: string | null = null;
  provider: string | null = null;
  width: string | null = null;
  height: string | null = null;
  embedCode: string | null = null;
  src: string | null = null;
}
