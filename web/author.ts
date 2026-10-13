/**
 * Content for /author. Everything marked as a placeholder is meant to be
 * replaced; the admin overview lists what’s still unfinished.
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
  tagline: "Developer and job seeker.",
  bio: [
    "I like simplicity and I don’t like clutter. I’ve believed for a long time that the internet is the richest source of information in human history, and that it’s hidden behind bad design, popups, videos and ads.",
    "If I could, I’d make the internet plain text. Since I can’t, I take tools that already exist and update them for 2026. regoose is one of them.",
  ],
  photos: [{ src: "sam.jpg", alt: "Sam Liebl smiling, in a gray hooded sweatshirt" }] as Array<{
    src: string;
    alt: string;
  }>,
  links: [
    { label: "linkedin.com/in/samliebl", url: "https://www.linkedin.com/in/samliebl" },
    { label: "samliebl.com", url: "https://samliebl.com" },
    { label: "github.com/samliebl", url: "https://github.com/samliebl" },
  ] as AuthorLink[],
  projects: [
    {
      label: "tohode.com",
      url: "https://tohode.com",
      about: "find local events in Raleigh, Durham and Chapel Hill",
    },
    {
      label: "truyne.com",
      url: "https://truyne.com",
      about: "see how your videos come across before you post them",
    },
  ],
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
