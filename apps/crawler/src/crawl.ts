import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { documents, pages, entities, crawlRuns } from "@blueport/db/schema";
import type { MediaType, DocStatus } from "@blueport/db/schema";
import {
  CONNECTORS,
  isHostAllowed,
  type Connector,
} from "@blueport/db/connectors";
import { ocrPdf } from "./ocr.js";
import { extract } from "./extract.js";
import type { Env } from "./index.js";

export interface ConnectorResult {
  sourceId: string;
  runId: number;
  newDocuments: number;
  updatedDocuments: number;
  errors: string[];
}

export interface CrawlResult {
  newDocuments: number;
  updatedDocuments: number;
  errors: string[];
  connectors: ConnectorResult[];
}

/** One item a connector found and queued for ingestion. */
export interface DiscoveredAsset {
  url: string;
  title: string | null;
  mediaType: MediaType;
  status: DocStatus;
  /** Download + store the original in R2 (only meaningful for pdf/image). */
  download: boolean;
  /** HTTP status to record when not downloading (e.g. of the referencing page). */
  refHttpStatus?: number;
}

export async function runCrawl(env: Env): Promise<CrawlResult> {
  const db = drizzle(env.DB);
  const connectors: ConnectorResult[] = [];

  for (const connector of CONNECTORS) {
    connectors.push(await crawlConnector(env, db, connector));
  }

  return {
    newDocuments: sum(connectors, (c) => c.newDocuments),
    updatedDocuments: sum(connectors, (c) => c.updatedDocuments),
    errors: connectors.flatMap((c) => c.errors.map((e) => `[${c.sourceId}] ${e}`)),
    connectors,
  };
}

async function crawlConnector(
  env: Env,
  db: ReturnType<typeof drizzle>,
  connector: Connector,
): Promise<ConnectorResult> {
  const startedAt = new Date();
  const [run] = await db
    .insert(crawlRuns)
    .values({
      startedAt,
      sourceId: connector.id,
      sourceDomain: hostOf(connector.startUrls[0]) ?? connector.id,
    })
    .returning();

  const errors: string[] = [];
  let newDocuments = 0;
  let updatedDocuments = 0;

  try {
    const assets = await discover(env, connector);
    for (const asset of assets) {
      try {
        const result = await ingestAsset(env, db, connector, asset);
        if (result === "new") newDocuments++;
        else if (result === "updated") updatedDocuments++;
      } catch (err) {
        errors.push(`${asset.url}: ${errMessage(err)}`);
      }
    }
  } catch (err) {
    errors.push(`discover: ${errMessage(err)}`);
  }

  await db
    .update(crawlRuns)
    .set({
      finishedAt: new Date(),
      newDocuments,
      updatedDocuments,
      errors: errors.length ? JSON.stringify(errors) : null,
    })
    .where(eq(crawlRuns.id, run!.id));

  return { sourceId: connector.id, runId: run!.id, newDocuments, updatedDocuments, errors };
}

/** Resolve a connector's start pages into a deduped list of assets to ingest. */
async function discover(env: Env, connector: Connector): Promise<DiscoveredAsset[]> {
  if (connector.kind === "browser") {
    // Loaded lazily: @cloudflare/puppeteer is Workers-only, so keeping it out of
    // the static graph lets the fetch path + unit tests run without it.
    const { discoverViaBrowser } = await import("./browser.js");
    const rendered = await discoverViaBrowser(env, connector);
    const seeds: DiscoveredAsset[] = (connector.seedReferenced ?? []).map((s) => ({
      url: s.sourceUrl,
      title: s.title,
      mediaType: s.mediaType,
      status: "referenced_withheld" as const,
      download: false,
      refHttpStatus: 0,
    }));
    return dedupeByUrl([...rendered, ...seeds]);
  }

  const out: DiscoveredAsset[] = [];
  for (const startUrl of connector.startUrls) {
    const html = await fetchPolitely(startUrl, env.USER_AGENT);
    for (const url of extractPdfUrls(html, startUrl, connector.allowedHosts)) {
      out.push({ url, title: null, mediaType: "pdf", status: "released", download: true });
    }
  }
  return dedupeByUrl(out);
}

async function ingestAsset(
  env: Env,
  db: ReturnType<typeof drizzle>,
  connector: Connector,
  asset: DiscoveredAsset,
): Promise<"new" | "updated" | "unchanged"> {
  if (asset.status === "referenced_withheld") {
    return ingestReferenced(env, db, connector, asset);
  }
  if (asset.download && (asset.mediaType === "pdf" || asset.mediaType === "image")) {
    return ingestFile(env, db, connector, asset);
  }
  return ingestLinked(db, connector, asset);
}

/** PDF/image we download, hash, store in R2, and (for PDFs) OCR + extract. */
async function ingestFile(
  env: Env,
  db: ReturnType<typeof drizzle>,
  connector: Connector,
  asset: DiscoveredAsset,
): Promise<"new" | "updated" | "unchanged"> {
  const res = await fetch(asset.url, { headers: { "user-agent": env.USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const sha = await sha256(buf);

  if (await exists(db, sha)) return "unchanged";

  const ext = asset.mediaType === "pdf" ? "pdf" : "bin";
  const r2Key = `docs/${sha}.${ext}`;
  await env.DOCS.put(r2Key, buf, {
    httpMetadata: { contentType: res.headers.get("content-type") ?? "application/octet-stream" },
    customMetadata: { sourceUrl: asset.url, fetchedAt: new Date().toISOString() },
  });

  let pageData: Awaited<ReturnType<typeof ocrPdf>> = [];
  let extraction: Awaited<ReturnType<typeof extract>> | null = null;
  if (asset.mediaType === "pdf") {
    pageData = await ocrPdf(env, buf);
    extraction = await extract(env, pageData.map((p) => p.text).join("\n\n"));
  }

  await db.insert(documents).values({
    sha256: sha,
    sourceId: connector.id,
    sourceUrl: asset.url,
    sourceDomain: hostOf(asset.url) ?? connector.id,
    country: connector.country,
    mediaType: asset.mediaType,
    status: "released",
    title: extraction?.title ?? asset.title,
    docType: extraction?.docType ?? null,
    pageCount: asset.mediaType === "pdf" ? pageData.length : null,
    fetchedAt: new Date(),
    documentDate: extraction?.documentDate ?? null,
    incidentDate: extraction?.incidentDate ?? null,
    httpStatus: res.status,
    r2Key,
    summary: extraction?.summary ?? null,
  });

  if (pageData.length > 0) {
    await db.insert(pages).values(
      pageData.map((p) => ({
        docSha: sha,
        pageNumber: p.pageNumber,
        text: p.text,
        ocrModel: p.ocrModel,
        ocrConfidence: p.ocrConfidence,
        hasRedactions: p.hasRedactions,
      })),
    );
  }

  if (extraction && extraction.entities.length > 0) {
    await db.insert(entities).values(
      extraction.entities.map((e) => ({
        docSha: sha,
        pageNumber: null,
        kind: e.kind,
        value: e.value,
        normalized: e.normalized,
      })),
    );
  }

  return "new";
}

/** Released media we link to rather than store (audio/video/webpage). */
async function ingestLinked(
  db: ReturnType<typeof drizzle>,
  connector: Connector,
  asset: DiscoveredAsset,
): Promise<"new" | "updated" | "unchanged"> {
  const sha = await syntheticSha([connector.id, asset.url]);
  if (await exists(db, sha)) return "unchanged";

  await db.insert(documents).values({
    sha256: sha,
    sourceId: connector.id,
    sourceUrl: asset.url,
    sourceDomain: hostOf(asset.url) ?? connector.id,
    country: connector.country,
    mediaType: asset.mediaType,
    status: "released",
    title: asset.title,
    pageCount: null,
    fetchedAt: new Date(),
    httpStatus: asset.refHttpStatus ?? 0,
    r2Key: "",
  });
  return "new";
}

/** Known-but-unreleased item: recorded with no stored original. */
async function ingestReferenced(
  _env: Env,
  db: ReturnType<typeof drizzle>,
  connector: Connector,
  asset: DiscoveredAsset,
): Promise<"new" | "updated" | "unchanged"> {
  const sha = await syntheticSha([connector.id, asset.title ?? "", asset.url]);
  if (await exists(db, sha)) return "unchanged";

  await db.insert(documents).values({
    sha256: sha,
    sourceId: connector.id,
    sourceUrl: asset.url,
    sourceDomain: hostOf(asset.url) ?? connector.id,
    country: connector.country,
    mediaType: asset.mediaType,
    status: "referenced_withheld",
    title: asset.title,
    pageCount: null,
    fetchedAt: new Date(),
    httpStatus: asset.refHttpStatus ?? 0,
    r2Key: "",
  });
  return "new";
}

async function exists(db: ReturnType<typeof drizzle>, sha: string): Promise<boolean> {
  const rows = await db
    .select({ sha256: documents.sha256 })
    .from(documents)
    .where(eq(documents.sha256, sha))
    .limit(1);
  return rows.length > 0;
}

async function fetchPolitely(url: string, userAgent: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": userAgent } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export function extractPdfUrls(
  html: string,
  baseUrl: string,
  allowedHostSuffixes: readonly string[],
): string[] {
  const base = new URL(baseUrl);
  const matches = html.matchAll(/href="([^"]+\.pdf[^"]*)"/gi);
  const urls = new Set<string>();
  for (const match of matches) {
    if (!match[1]) continue;
    try {
      const candidate = new URL(match[1], base);
      if (candidate.protocol !== "https:" && candidate.protocol !== "http:") continue;
      if (!isHostAllowed(candidate.hostname, allowedHostSuffixes)) continue;
      urls.add(candidate.toString());
    } catch {
      // skip malformed URL
    }
  }
  return Array.from(urls);
}

function dedupeByUrl(assets: DiscoveredAsset[]): DiscoveredAsset[] {
  const seen = new Map<string, DiscoveredAsset>();
  for (const a of assets) if (!seen.has(a.url)) seen.set(a.url, a);
  return Array.from(seen.values());
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((n, item) => n + pick(item), 0);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function sha256(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return hex(new Uint8Array(hash));
}

/** Deterministic id for items with no file content (linked/referenced). */
export async function syntheticSha(parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join(" "));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return hex(new Uint8Array(hash));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
