import { Configuration } from "./Configuration.js";
import { Parser } from "./dom/Parser.js";
import { HtmlFetcher } from "./Network.js";

/**
 * Event extraction: a separate mode from Article extraction (see Goose.ts),
 * purpose-built for pulling schema.org Event data out of a page rather than
 * article prose. Deliberately doesn't go through Crawler/BaseExtractor --
 * none of that machinery (DOM content-scoring, image-best-guess, article
 * cleaning) applies here. This is just: fetch, parse, read the JSON-LD.
 *
 * This is Tier 1 of a larger plan (structured data first, since it's free
 * and instant; an LLM-extraction fallback and site-specific adapters are
 * the harder, not-yet-built tiers for pages with no Event markup at all).
 */

export interface EventLocation {
  name: string | null;
  address: string | null;
  /** Set for VirtualLocation (online events), or when a Place has its own url. */
  url: string | null;
}

export interface EventOffer {
  price: string | null;
  priceCurrency: string | null;
  url: string | null;
}

export interface EventInfo {
  title: string | null;
  description: string | null;
  /** ISO 8601 as published -- not reparsed/validated here. */
  startDate: string | null;
  endDate: string | null;
  /** Normalized from schema.org's EventScheduled/EventCancelled/EventPostponed/EventRescheduled -- "scheduled" | "cancelled" | "postponed" | "rescheduled" | null. */
  eventStatus: string | null;
  location: EventLocation | null;
  imageUrl: string | null;
  /** The event's own info/ticket page, if the JSON-LD gives one (may differ from sourceUrl). */
  url: string | null;
  organizer: string | null;
  performers: string[];
  offers: EventOffer[];
  /** The page this event was found on. */
  sourceUrl: string;
}

export interface ExtractEventsOptions {
  url?: string;
  rawHtml?: string;
}

// schema.org Event and the subtypes likely to show up on real listing/venue
// pages. Not exhaustive (schema.org has more, e.g. DeliveryEvent,
// PublicationEvent, that don't fit a public events aggregator).
const EVENT_TYPES = new Set([
  "event",
  "musicevent",
  "sportsevent",
  "theaterevent",
  "comedyevent",
  "festival",
  "exhibitionevent",
  "foodevent",
  "literaryevent",
  "socialevent",
  "educationevent",
  "businessevent",
  "childrensevent",
  "dancevent",
  "screeningevent",
  "visualartsevent",
  "broadcastevent",
  "courseinstance",
]);

type JsonRecord = Record<string, unknown>;

function typeMatches(type: unknown): boolean {
  if (typeof type === "string") return EVENT_TYPES.has(type.toLowerCase());
  if (Array.isArray(type)) return type.some(typeMatches);
  return false;
}

function asString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

function namesFrom(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(namesFrom);
  if (typeof value === "string") return [value];
  if (typeof value === "object") {
    const name = (value as JsonRecord)["name"];
    return typeof name === "string" ? [name] : [];
  }
  return [];
}

function imageUrlFrom(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) return imageUrlFrom(value[0]);
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const url = (value as JsonRecord)["url"];
    return typeof url === "string" ? url : null;
  }
  return null;
}

function addressFrom(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const obj = value as JsonRecord;
    const parts = [
      asString(obj["streetAddress"]),
      asString(obj["addressLocality"]),
      asString(obj["addressRegion"]),
      asString(obj["postalCode"]),
    ].filter((p): p is string => p !== null);
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

function locationFrom(value: unknown): EventLocation | null {
  if (value == null) return null;
  if (Array.isArray(value)) return locationFrom(value[0]);
  if (typeof value === "string") return { name: value, address: null, url: null };
  if (typeof value === "object") {
    const obj = value as JsonRecord;
    const location: EventLocation = {
      name: asString(obj["name"]),
      address: addressFrom(obj["address"]),
      url: asString(obj["url"]),
    };
    return location.name || location.address || location.url ? location : null;
  }
  return null;
}

function offersFrom(value: unknown): EventOffer[] {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter((v): v is JsonRecord => v !== null && typeof v === "object")
    .map((offer) => ({
      price: asString(offer["price"]),
      priceCurrency: asString(offer["priceCurrency"]),
      url: asString(offer["url"]),
    }));
}

/** "https://schema.org/EventScheduled" (or just "EventScheduled") -> "scheduled". */
function eventStatusFrom(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const last = raw.split("/").pop() ?? raw;
  const normalized = last.replace(/^Event/, "").toLowerCase();
  return normalized || null;
}

/** Walks arrays, @graph wrappers, and ItemList/ListItem shapes (the common "calendar page listing several events" pattern) to find every candidate node. */
function* flatten(value: unknown): Generator<JsonRecord> {
  if (Array.isArray(value)) {
    for (const item of value) yield* flatten(item);
    return;
  }
  if (value && typeof value === "object") {
    const obj = value as JsonRecord;
    yield obj;
    if (Array.isArray(obj["@graph"])) yield* flatten(obj["@graph"]);
    if (Array.isArray(obj["itemListElement"])) yield* flatten(obj["itemListElement"]);
    if (obj["item"] && typeof obj["item"] === "object") yield* flatten(obj["item"]);
  }
}

function findEventNodes(value: unknown): JsonRecord[] {
  const nodes: JsonRecord[] = [];
  for (const candidate of flatten(value)) {
    if (typeMatches(candidate["@type"])) nodes.push(candidate);
  }
  return nodes;
}

function toEventInfo(node: JsonRecord, sourceUrl: string): EventInfo {
  return {
    title: asString(node["name"]),
    description: asString(node["description"]),
    startDate: asString(node["startDate"]),
    endDate: asString(node["endDate"]),
    eventStatus: eventStatusFrom(node["eventStatus"]),
    location: locationFrom(node["location"]),
    imageUrl: imageUrlFrom(node["image"]),
    url: asString(node["url"]),
    organizer: namesFrom(node["organizer"])[0] ?? null,
    performers: namesFrom(node["performer"]),
    offers: offersFrom(node["offers"]),
    sourceUrl,
  };
}

function describeNetworkError(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "network error";
}

/**
 * Reads every schema.org Event (or subtype) out of a page's
 * `<script type="application/ld+json">` blocks. Returns an empty array for
 * a page with no Event markup -- that's a normal, valid result, not an
 * error. A fetch failure (network error or non-2xx status) throws instead
 * of returning empty, since those two cases must never look the same here:
 * unlike Article extraction (which preserves python-goose's historical
 * silent-failure behavior via article.fetchError), this has no equivalent
 * always-present object to hang that signal off, and "we don't know" must
 * never be silently reported as "there's nothing here" for something whose
 * whole point is not letting events slip through unnoticed.
 */
export async function extractEvents(
  options: ExtractEventsOptions,
  config: Configuration = new Configuration(),
): Promise<EventInfo[]> {
  let html: string;
  const sourceUrl = options.url ?? "";

  if (options.rawHtml) {
    html = options.rawHtml;
  } else if (options.url) {
    const fetcher = new HtmlFetcher(config);
    const fetched = await fetcher.getHtml(options.url);
    if (fetched === null) {
      const reason = fetcher.response
        ? `HTTP ${fetcher.response.status} ${fetcher.response.statusText}`.trim()
        : describeNetworkError(fetcher.error);
      throw new Error(`Could not fetch ${options.url}: ${reason}`);
    }
    html = fetched;
  } else {
    throw new Error("extractEvents needs a url or rawHtml.");
  }

  const parser = new Parser(html);
  const scripts = parser.getElementsByTag(parser.doc, {
    tag: "script",
    attr: "type",
    value: "^application/ld\\+json$",
  });

  const events: EventInfo[] = [];
  for (const script of scripts) {
    const raw = parser.getRawText(script);
    if (!raw.trim()) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    for (const node of findEventNodes(parsed)) {
      events.push(toEventInfo(node, sourceUrl));
    }
  }

  return events;
}
