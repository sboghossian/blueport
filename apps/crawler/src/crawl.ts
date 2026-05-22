import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { documents, pages, entities, crawlRuns } from "@blueport/db/schema";
import type { MediaType, DocStatus } from "@blueport/db/schema";
import {
  CONNECTORS,
  isHostAllowed,
  type Connector,
} from "@blueport/db/connectors";
import { ocrPdf, detectRedactions } from "./ocr.js";
import { extract } from "./extract.js";
import { hasLlm } from "./llm.js";
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
    if (connector.kind === "github-corpus") {
      const r = await ingestGithubCorpus(env, db, connector);
      newDocuments = r.newDocuments;
      updatedDocuments = r.updatedDocuments;
      errors.push(...r.errors);
    } else {
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
  if (connector.kind === "wayback") {
    const assets = await discoverWayback(env, connector);
    return connector.maxDocs ? assets.slice(0, connector.maxDocs) : assets;
  }

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

/**
 * Discover archived PDFs for a `wayback` connector via the Internet Archive CDX
 * API. Each `startUrls` entry is a CDX url-match pattern; we keep one capture
 * per content digest and fetch raw bytes through the `id_` raw endpoint.
 */
async function discoverWayback(env: Env, connector: Connector): Promise<DiscoveredAsset[]> {
  const out = new Map<string, DiscoveredAsset>();
  const limit = connector.maxDocs ?? 25;

  for (const pattern of connector.startUrls) {
    const cdx = new URL("https://web.archive.org/cdx/search/cdx");
    cdx.searchParams.set("url", pattern);
    cdx.searchParams.set("output", "json");
    cdx.searchParams.set("fl", "timestamp,original");
    cdx.searchParams.append("filter", "mimetype:application/pdf");
    cdx.searchParams.append("filter", "statuscode:200");
    cdx.searchParams.set("collapse", "digest");
    cdx.searchParams.set("limit", String(limit));

    const res = await fetch(cdx.toString(), { headers: { "user-agent": env.USER_AGENT } });
    if (!res.ok) continue;
    const rows = (await res.json()) as string[][];

    // Row 0 is the [timestamp, original] header; data rows follow.
    for (const row of rows.slice(1)) {
      const timestamp = row[0];
      const original = row[1];
      if (!timestamp || !original) continue;
      const url = `https://web.archive.org/web/${timestamp}id_/${original}`;
      if (out.has(url)) continue;
      out.set(url, {
        url,
        title: waybackTitle(original),
        mediaType: "pdf",
        status: "released",
        download: true,
      });
    }
  }
  return Array.from(out.values());
}

function waybackTitle(original: string): string | null {
  try {
    const base = decodeURIComponent(new URL(original).pathname.split("/").pop() ?? "");
    const name = base
      .replace(/\.pdf$/i, "")
      .replace(/[_%]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return name || null;
  } catch {
    return null;
  }
}

interface CorpusRecord {
  id: string;
  slug?: string;
  title?: string;
  agency?: string;
  release_date?: string;
  incident_date?: string;
  incident_location?: string;
  redaction?: string;
  document_type?: string;
  description?: string;
}
interface FulltextHit {
  record_id: string;
  page: number;
  text: string;
}

/**
 * Ingest a `github-corpus` connector: a JSON mirror that already supplies OCR
 * text + metadata (e.g. Pump-OS/alien-files, the war.gov PURSUE release). No
 * per-doc fetch or OCR — we read [indexUrl, fulltextUrl] once and build rows.
 */
async function ingestGithubCorpus(
  env: Env,
  db: ReturnType<typeof drizzle>,
  connector: Connector,
): Promise<{ newDocuments: number; updatedDocuments: number; errors: string[] }> {
  const errors: string[] = [];
  let newDocuments = 0;
  let updatedDocuments = 0;

  const indexUrl = connector.startUrls[0];
  const fulltextUrl = connector.startUrls[1];
  if (!indexUrl || !fulltextUrl) {
    errors.push("github-corpus: startUrls must be [indexUrl, fulltextUrl]");
    return { newDocuments, updatedDocuments, errors };
  }

  const index = (await fetchJson(env, indexUrl)) as CorpusRecord[];
  const fulltext = (await fetchJson(env, fulltextUrl)) as { hits?: FulltextHit[] };

  const pagesByRecord = new Map<string, FulltextHit[]>();
  for (const hit of fulltext.hits ?? []) {
    const arr = pagesByRecord.get(hit.record_id) ?? [];
    arr.push(hit);
    pagesByRecord.set(hit.record_id, arr);
  }

  const limit = connector.maxDocs ?? index.length;
  for (const rec of index.slice(0, limit)) {
    try {
      const result = await ingestCorpusRecord(db, connector, rec, pagesByRecord.get(rec.id) ?? []);
      if (result === "new") newDocuments++;
      else if (result === "updated") updatedDocuments++;
    } catch (err) {
      errors.push(`${rec.id}: ${errMessage(err)}`);
    }
  }
  return { newDocuments, updatedDocuments, errors };
}

async function ingestCorpusRecord(
  db: ReturnType<typeof drizzle>,
  connector: Connector,
  rec: CorpusRecord,
  hits: FulltextHit[],
): Promise<"new" | "updated" | "unchanged"> {
  const sha = await syntheticSha([connector.id, rec.id]);
  if (await exists(db, sha)) return "unchanged";

  const agency = rec.agency?.trim();
  const baseTitle = rec.title?.trim() || rec.slug || rec.id;
  const title = agency ? `[${agency}] ${baseTitle}` : baseTitle;
  const redactionFlag = (rec.redaction ?? "").trim().length > 0;

  // One row per page, sorted, deduped on page number (the unique index requires it).
  const seenPages = new Set<number>();
  const pageRows = hits
    .slice()
    .sort((a, b) => a.page - b.page)
    .filter((h) => (seenPages.has(h.page) ? false : (seenPages.add(h.page), true)))
    .map((h) => ({
      docSha: sha,
      pageNumber: h.page,
      text: h.text,
      ocrModel: "pursue-mirror",
      ocrConfidence: null,
      hasRedactions: redactionFlag || detectRedactions(h.text),
    }));

  await db.insert(documents).values({
    sha256: sha,
    sourceId: connector.id,
    sourceUrl: connector.startUrls[0] ?? "",
    sourceDomain: "github.com/Pump-OS/alien-files",
    country: connector.country,
    mediaType: "pdf",
    status: "released",
    title,
    docType: "other",
    pageCount: pageRows.length || null,
    fetchedAt: new Date(),
    documentDate: parseLooseDate(rec.release_date),
    incidentDate: parseLooseDate(rec.incident_date),
    httpStatus: 200,
    r2Key: "",
    summary: rec.description?.trim() || null,
  });

  await chunkedInsert(pageRows, PAGE_CHUNK, (rows) => db.insert(pages).values(rows));
  return "new";
}

async function fetchJson(env: Env, url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "user-agent": env.USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/** Lenient date parse for mirror metadata ("5/8/26", "1947", "N/A", ""). */
export function parseLooseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const t = s.trim();
  if (!t || t.toUpperCase() === "N/A") return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
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
    if (hasLlm(env)) {
      try {
        extraction = await extract(env, pageData.map((p) => p.text).join("\n\n"));
      } catch {
        // Best-effort: keep the document (with OCR text) even if extraction
        // fails, so the R2 object isn't orphaned. A missing summary is the signal.
      }
    }
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

  // D1 caps bound variables per statement, so batch inserts must be chunked
  // (a long PDF would otherwise blow the limit: "too many SQL variables").
  await chunkedInsert(
    pageData.map((p) => ({
      docSha: sha,
      pageNumber: p.pageNumber,
      text: p.text,
      ocrModel: p.ocrModel,
      ocrConfidence: p.ocrConfidence,
      hasRedactions: p.hasRedactions,
    })),
    PAGE_CHUNK,
    (rows) => db.insert(pages).values(rows),
  );

  if (extraction) {
    await chunkedInsert(
      extraction.entities.map((e) => ({
        docSha: sha,
        pageNumber: null,
        kind: e.kind,
        value: e.value,
        normalized: e.normalized,
      })),
      ENTITY_CHUNK,
      (rows) => db.insert(entities).values(rows),
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

// pages have 6 columns, entities 5 — keep each statement's bound-variable count
// well under D1's per-statement cap.
const PAGE_CHUNK = 15;
const ENTITY_CHUNK = 20;

async function chunkedInsert<Row>(
  rows: Row[],
  chunkSize: number,
  insert: (rows: Row[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await insert(rows.slice(i, i + chunkSize));
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
