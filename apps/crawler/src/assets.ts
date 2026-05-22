import { isHostAllowed, mediaTypeForExtension } from "@blueport/db/connectors";
import type { DiscoveredAsset } from "./crawl.js";

// Capture <a href="…">visible text</a>. Browser-rendered HTML is messy, so we
// parse the post-render string the same way the fetch path parses static HTML —
// no DOM types, identical SSRF + extension rules across both ingestion kinds.
const ANCHOR_RE = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

/**
 * Harvest downloadable/linkable assets from a page's HTML. Accepts any media
 * type the registry recognises (pdf/image/audio/video); ignores everything else
 * (nav links, anchors, off-host URLs).
 */
export function extractAssetLinks(
  html: string,
  baseUrl: string,
  allowedHosts: readonly string[],
): DiscoveredAsset[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const found = new Map<string, DiscoveredAsset>();
  for (const match of html.matchAll(ANCHOR_RE)) {
    const href = match[1];
    if (!href) continue;
    const title = stripTags(match[2] ?? "").trim().slice(0, 200) || null;
    const asset = classifyAssetUrl(href, title, base, allowedHosts);
    if (asset && !found.has(asset.url)) found.set(asset.url, asset);
  }
  return Array.from(found.values());
}

export function classifyAssetUrl(
  href: string,
  title: string | null,
  base: URL,
  allowedHosts: readonly string[],
): DiscoveredAsset | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!isHostAllowed(url.hostname, allowedHosts)) return null;

  const ext = extensionOf(url.pathname);
  const mediaType = ext ? mediaTypeForExtension(ext) : null;
  if (!mediaType) return null;

  // We store PDFs/images in R2; audio/video are large, so we link to them.
  const download = mediaType === "pdf" || mediaType === "image";
  return { url: url.toString(), title, mediaType, status: "released", download };
}

function extensionOf(pathname: string): string | null {
  const last = pathname.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  if (dot < 0 || dot === last.length - 1) return null;
  return last.slice(dot + 1);
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}
