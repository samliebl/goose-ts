import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractEvents } from "../src/events.js";

// Event extraction (Tier 1 -- see src/events.ts) reads schema.org Event
// JSON-LD, a separate mode from Article extraction. These tests cover the
// JSON-LD shapes real listing/venue pages actually use.

function htmlWithJsonLd(json: unknown): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(json)}</script></head><body></body></html>`;
}

describe("extractEvents", () => {
  it("reads a single Event with location, offers, performer, and image", async () => {
    const html = htmlWithJsonLd({
      "@context": "https://schema.org",
      "@type": "MusicEvent",
      name: "Friday Night Jazz",
      description: "An evening of live jazz.",
      startDate: "2026-10-02T20:00:00-04:00",
      endDate: "2026-10-02T23:00:00-04:00",
      eventStatus: "https://schema.org/EventScheduled",
      url: "https://venue.example/events/friday-jazz",
      image: "https://venue.example/images/jazz.jpg",
      performer: { "@type": "MusicGroup", name: "The Somebodies" },
      organizer: { "@type": "Organization", name: "Venue Presents" },
      location: {
        "@type": "Place",
        name: "The Blue Room",
        address: {
          "@type": "PostalAddress",
          streetAddress: "123 Main St",
          addressLocality: "Springfield",
          addressRegion: "IL",
          postalCode: "62701",
        },
      },
      offers: {
        "@type": "Offer",
        price: "15",
        priceCurrency: "USD",
        url: "https://tickets.example/jazz",
      },
    });

    const [event] = await extractEvents({ rawHtml: html, url: "https://venue.example/calendar" });

    expect(event).toEqual({
      title: "Friday Night Jazz",
      description: "An evening of live jazz.",
      startDate: "2026-10-02T20:00:00-04:00",
      endDate: "2026-10-02T23:00:00-04:00",
      eventStatus: "scheduled",
      location: {
        name: "The Blue Room",
        address: "123 Main St, Springfield, IL, 62701",
        url: null,
      },
      imageUrl: "https://venue.example/images/jazz.jpg",
      url: "https://venue.example/events/friday-jazz",
      organizer: "Venue Presents",
      performers: ["The Somebodies"],
      offers: [{ price: "15", priceCurrency: "USD", url: "https://tickets.example/jazz" }],
      sourceUrl: "https://venue.example/calendar",
    });
  });

  it("finds every event in an ItemList (the common calendar-page pattern)", async () => {
    const html = htmlWithJsonLd({
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          item: { "@type": "Event", name: "Trivia Night", startDate: "2026-10-01" },
        },
        {
          "@type": "ListItem",
          position: 2,
          item: { "@type": "Event", name: "Open Mic", startDate: "2026-10-03" },
        },
      ],
    });

    const events = await extractEvents({ rawHtml: html });

    expect(events.map((e) => e.title)).toEqual(["Trivia Night", "Open Mic"]);
  });

  it("finds an event wrapped in @graph", async () => {
    const html = htmlWithJsonLd({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebPage", name: "Venue site" },
        { "@type": "Event", name: "Graph Event", startDate: "2026-11-01" },
      ],
    });

    const events = await extractEvents({ rawHtml: html });

    expect(events.map((e) => e.title)).toEqual(["Graph Event"]);
  });

  it("normalizes a cancelled event's status", async () => {
    const html = htmlWithJsonLd({
      "@type": "Event",
      name: "Rained Out",
      eventStatus: "https://schema.org/EventCancelled",
    });

    const [event] = await extractEvents({ rawHtml: html });
    expect(event!.eventStatus).toBe("cancelled");
  });

  it("captures a VirtualLocation's url for an online event", async () => {
    const html = htmlWithJsonLd({
      "@type": "Event",
      name: "Online Q&A",
      location: { "@type": "VirtualLocation", url: "https://stream.example/qa" },
    });

    const [event] = await extractEvents({ rawHtml: html });
    expect(event!.location).toEqual({
      name: null,
      address: null,
      url: "https://stream.example/qa",
    });
  });

  it("returns an empty array for a page with no Event markup -- not an error", async () => {
    const html = htmlWithJsonLd({ "@type": "Article", headline: "Just an article" });
    await expect(extractEvents({ rawHtml: html })).resolves.toEqual([]);
  });

  it("skips a malformed JSON-LD block instead of throwing", async () => {
    const html = `<html><head><script type="application/ld+json">{ not valid json</script></head><body></body></html>`;
    await expect(extractEvents({ rawHtml: html })).resolves.toEqual([]);
  });
});

describe("extractEvents url fetching", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and extracts events from a live URL", async () => {
    const html = htmlWithJsonLd({
      "@type": "Event",
      name: "Fetched Event",
      startDate: "2026-12-01",
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
    );

    const events = await extractEvents({ url: "https://venue.example/" });
    expect(events).toEqual([expect.objectContaining({ title: "Fetched Event" })]);
  });

  it("throws (doesn't return empty) when the fetch fails -- must not look like 'no events found'", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
    await expect(extractEvents({ url: "https://venue.example/unreachable" })).rejects.toThrow(
      "Could not fetch https://venue.example/unreachable: fetch failed",
    );
  });

  it("throws with the status on a non-2xx response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("blocked", { status: 403, statusText: "Forbidden" }),
    );
    await expect(extractEvents({ url: "https://venue.example/blocked" })).rejects.toThrow(
      "HTTP 403 Forbidden",
    );
  });
});
