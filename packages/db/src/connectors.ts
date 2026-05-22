import type { MediaType } from "./schema.js";

/**
 * How a source is ingested.
 * - `fetch`: a static HTML index whose `.pdf` links we follow with plain
 *   `fetch()`. Cheapest path; works for static government portals.
 * - `browser`: a JS-rendered / session-gated site that needs a real headless
 *   browser (Cloudflare Browser Rendering) to expose its document links.
 * - `wayback`: an anti-bot or JS-only source we reach through the Internet
 *   Archive's Wayback Machine. `startUrls` hold CDX url-match patterns (not
 *   real URLs); discovery queries the CDX API for archived PDFs and fetches the
 *   raw bytes via web.archive.org. Robust against 403s and JS-only portals.
 * - `github-corpus`: a community GitHub mirror that already provides OCR text +
 *   metadata as JSON. `startUrls` = [indexUrl, fulltextUrl] (raw.githubusercontent
 *   URLs). No fetch/OCR per doc — text is supplied. Used to ingest the war.gov
 *   PURSUE release via the Pump-OS/alien-files mirror.
 */
export type ConnectorKind = "fetch" | "browser" | "wayback" | "github-corpus";

/** ISO-3166 alpha-2 of the releasing government. */
export type Country = "US" | "BR";

/** A known-but-unreleased item to seed as a `referenced_withheld` document. */
export interface ReferencedSeed {
  title: string;
  mediaType: MediaType;
  /** The public page/source that referenced this withheld item. */
  sourceUrl: string;
}

export interface Connector {
  /** Stable id stored on every document (`documents.source_id`). */
  id: string;
  label: string;
  country: Country;
  kind: ConnectorKind;
  /** Pages the crawler starts from. Fetch: HTML indexes. Browser: pages to render. */
  startUrls: readonly string[];
  /**
   * Hostname suffixes whose asset URLs we are willing to ingest (SSRF guard).
   * A discovered URL is accepted iff its host equals or ends with `.<suffix>`.
   */
  allowedHosts: readonly string[];
  /**
   * Known-but-unreleased items to record as `referenced_withheld`.
   * IMPORTANT: only add entries with a verifiable public reference — never
   * fabricate filenames. Empty until real items are sourced.
   */
  seedReferenced?: readonly ReferencedSeed[];
  /** Cap on documents ingested per run (keeps a crawl inside Worker limits). */
  maxDocs?: number;
}

/**
 * The source registry. Adding a government release = adding one entry here.
 *
 * Verification status (2026-05-22):
 * - us-war-gov / us-nara: static portals, `.pdf` links — fetch path is exercised.
 * - br-sian / corbell-sleeping-dog: `startUrls` + DOM structure must be
 *   confirmed against the live sites at first browser-render run. The browser
 *   connector harvests asset links generically, so it degrades gracefully if a
 *   page changes, but the deep-link entry points below are best-known, not yet
 *   DOM-verified end to end.
 */
export const CONNECTORS: readonly Connector[] = [
  {
    id: "us-war-gov",
    label: "U.S. Dept. of War — war.gov/UFO (PURSUE)",
    country: "US",
    kind: "fetch",
    startUrls: ["https://www.war.gov/UFO/"],
    allowedHosts: ["war.gov"],
  },
  {
    id: "us-nara",
    label: "U.S. National Archives — UAP records",
    country: "US",
    kind: "fetch",
    startUrls: ["https://www.archives.gov/research/topics/uaps"],
    allowedHosts: ["archives.gov"],
  },
  {
    id: "br-sian",
    label: "Brazil — Arquivo Nacional (SIAN)",
    country: "BR",
    kind: "browser",
    // SIAN is a JS app; this is the public entry to the UFO collection.
    // Confirm the exact fundo deep-link on first render.
    startUrls: ["https://sian.an.gov.br/sianex/Consulta/Pesquisa_Livre.asp"],
    allowedHosts: ["an.gov.br", "gov.br"],
  },
  {
    id: "corbell-sleeping-dog",
    label: "Jeremy Corbell — Sleeping Dog leak set",
    country: "US",
    kind: "browser",
    startUrls: [
      "https://www.extraordinarybeliefs.com/",
      "https://www.weaponizedpodcast.com/",
    ],
    allowedHosts: ["extraordinarybeliefs.com", "weaponizedpodcast.com"],
    // Corbell + Knapp named ~46 unreleased UAP videos to Congress. The exact
    // filenames are not yet public; seed them here ONLY when each is verifiable.
    seedReferenced: [],
  },
  {
    id: "us-aaro",
    label: "U.S. AARO — DoD All-domain Anomaly Resolution Office",
    country: "US",
    kind: "wayback",
    // CDX url-match patterns (NOT live URLs). aaro.mil hard-403s direct fetches,
    // so we pull its archived UAP PDFs from the Wayback Machine. UAP trend
    // reports first, then briefings/records.
    startUrls: ["aaro.mil/Portals/136/Images/UAP*", "aaro.mil/Portals/136/PDFs*"],
    allowedHosts: ["web.archive.org", "aaro.mil"],
    maxDocs: 15,
  },
  {
    id: "pursue-archive",
    label: "PURSUE Release — war.gov mirror (DoW · FBI · NASA · State)",
    country: "US",
    kind: "github-corpus",
    // [indexUrl, fulltextUrl] — OCR'd JSON mirror of the May 2026 PURSUE release.
    startUrls: [
      "https://raw.githubusercontent.com/Pump-OS/alien-files/main/data/json/index.json",
      "https://raw.githubusercontent.com/Pump-OS/alien-files/main/data/json/fulltext.json",
    ],
    allowedHosts: ["raw.githubusercontent.com"],
    maxDocs: 161,
  },
] as const;

export function getConnector(id: string): Connector | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

/** SSRF guard: is `host` allowed by one of `suffixes` (exact or subdomain)? */
export function isHostAllowed(host: string, suffixes: readonly string[]): boolean {
  const h = host.toLowerCase();
  return suffixes.some((suffix) => h === suffix || h.endsWith(`.${suffix}`));
}

/** Map a file extension (no dot) to a media type, or null if not a known asset. */
export function mediaTypeForExtension(ext: string): MediaType | null {
  return EXTENSION_MEDIA_TYPE[ext.toLowerCase()] ?? null;
}

const EXTENSION_MEDIA_TYPE: Readonly<Record<string, MediaType>> = {
  pdf: "pdf",
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  tif: "image",
  tiff: "image",
  webp: "image",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  ogg: "audio",
  mp4: "video",
  mov: "video",
  avi: "video",
  webm: "video",
  mkv: "video",
};
