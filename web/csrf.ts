/**
 * Whether a state-changing browser request came from this site.
 *
 * Browsers send `Origin: null` on same-origin form posts when the page's
 * Referrer-Policy is `no-referrer`, so a null origin can't be judged on its
 * own; Sec-Fetch-Site (sent by every current browser) settles it.
 */
export function isSameSiteRequest(request: {
  origin: string | undefined;
  host: string | undefined;
  secFetchSite: string | undefined;
}): boolean {
  const { origin, host, secFetchSite } = request;
  if (origin && origin !== "null") {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  if (origin === "null") return secFetchSite === "same-origin" || secFetchSite === "none";
  return secFetchSite !== "cross-site";
}
