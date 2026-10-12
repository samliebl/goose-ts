/**
 * Content for /author. Everything marked as a placeholder is meant to be
 * replaced; the admin overview lists what's still unfinished.
 *
 * Photos: put image files in web/public/author/ and list them under `photos`
 * (src is relative to that folder). With no photos the page shows a simple
 * monogram instead.
 */
export interface AuthorLink {
  label: string;
  /** Empty means "not set up yet": shown as "coming soon" rather than as a dead link. */
  url: string;
}

export const AUTHOR = {
  name: "Sam Liebl",
  tagline: "[Placeholder] A one-line description of what you do.",
  bio: [
    "[Placeholder] A short paragraph about you: your background, what you're working on, and what you care about.",
    "[Placeholder] A second paragraph about why you built regoose and what you hope people take from it.",
  ],
  photos: [] as Array<{ src: string; alt: string }>,
  links: [
    { label: "GitHub", url: "https://github.com/samliebl" },
    { label: "regoose on GitHub", url: "https://github.com/samliebl/goose-ts" },
    { label: "LinkedIn", url: "" },
    { label: "Personal site", url: "" },
    { label: "Email", url: "" },
  ] as AuthorLink[],
};

/** What on the page is still placeholder, for the admin checklist. */
export function authorPlaceholders(): string[] {
  const todo: string[] = [];
  if (
    AUTHOR.tagline.includes("[Placeholder]") ||
    AUTHOR.bio.some((p) => p.includes("[Placeholder]"))
  ) {
    todo.push("bio text");
  }
  if (AUTHOR.photos.length === 0) todo.push("photos");
  const unset = AUTHOR.links.filter((l) => !l.url).map((l) => l.label);
  if (unset.length) todo.push(`links (${unset.join(", ")})`);
  return todo;
}
