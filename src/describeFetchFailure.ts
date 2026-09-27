import type { Article } from "./Article.js";

/**
 * Turns Article.fetchError / Article.timedOut into a message safe to show
 * directly to a user, distinguishing "this site is (probably) blocking
 * automated tools" from other, non-blocking reasons -- a timeout, a down
 * server, too many slow images to score in time. Shared by the CLI, the
 * API, and the web dashboard (see export.ts for the same pattern applied to
 * downloads) so the three don't drift into giving different explanations
 * for the same failure.
 *
 * Returns null if the article didn't actually fail (no fetchError, not
 * timedOut).
 */
export function describeFetchFailure(article: Article): string | null {
  if (article.fetchError) {
    // fetchError always starts with "HTTP " when we got a real response
    // back (see Crawler.getHtml) -- a status in that response is the only
    // case we can call "blocking" with any confidence. No response at all
    // (DNS failure, connection refused, our own timeout) just means the
    // site couldn't be reached, which is a different, usually non-blocking,
    // problem.
    const statusMatch = article.fetchError.match(/^HTTP (\d+)/);
    const status = statusMatch ? Number(statusMatch[1]) : null;
    const looksBlocked = status !== null && [403, 406, 429, 451].includes(status);

    const explanation = looksBlocked
      ? `This site is blocking automated tools like regoose -- it returned HTTP ${status}, a status commonly used for that.`
      : status !== null
        ? `The site responded with HTTP ${status}, which usually isn't blocking -- more likely a temporary server-side issue.`
        : `The site couldn't be reached (${article.fetchError}) -- not necessarily blocking, it may just be slow, down, or unreachable from here right now.`;

    return `Extraction failed. ${explanation}`;
  }

  if (article.timedOut) {
    return "Extraction failed. The page fetched fine, but processing it (most likely scoring a large number of images) took too long. This isn't blocking -- try again with image fetching turned off.";
  }

  return null;
}
