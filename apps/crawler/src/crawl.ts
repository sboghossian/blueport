import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { documents, pages, entities, crawlRuns } from "@blueport/db/schema";
import { ocrPdf } from "./ocr.js";
import { extract } from "./extract.js";
import type { Env } from "./index.js";

export interface CrawlResult {
  runId: number;
  newDocuments: number;
  updatedDocuments: number;
  errors: string[];
}

export async function runCrawl(env: Env): Promise<CrawlResult> {
  const db = drizzle(env.DB);
  const startedAt = new Date();

  const [run] = await db
    .insert(crawlRuns)
    .values({ startedAt, sourceDomain: "war.gov" })
    .returning();

  const errors: string[] = [];
  let newDocuments = 0;
  let updatedDocuments = 0;

  try {
    const indexHtml = await fetchPolitely(env.SOURCE_INDEX_URL, env.USER_AGENT);
    const pdfUrls = extractPdfUrls(indexHtml, env.SOURCE_INDEX_URL);

    for (const url of pdfUrls) {
      try {
        const result = await ingestDocument(env, db, url);
        if (result === "new") newDocuments++;
        else if (result === "updated") updatedDocuments++;
      } catch (err) {
        errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    errors.push(`index: ${err instanceof Error ? err.message : String(err)}`);
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

  return { runId: run!.id, newDocuments, updatedDocuments, errors };
}

async function fetchPolitely(url: string, userAgent: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": userAgent } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function extractPdfUrls(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const matches = html.matchAll(/href="([^"]+\.pdf[^"]*)"/gi);
  const urls = new Set<string>();
  for (const match of matches) {
    if (!match[1]) continue;
    try {
      urls.add(new URL(match[1], base).toString());
    } catch {
      // skip malformed URL
    }
  }
  return Array.from(urls);
}

async function ingestDocument(
  env: Env,
  db: ReturnType<typeof drizzle>,
  url: string,
): Promise<"new" | "updated" | "unchanged"> {
  const res = await fetch(url, { headers: { "user-agent": env.USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const sha = await sha256(buf);

  const existing = await db
    .select({ sha256: documents.sha256 })
    .from(documents)
    .where(eq(documents.sha256, sha))
    .limit(1);

  if (existing.length > 0) return "unchanged";

  const r2Key = `docs/${sha}.pdf`;
  await env.DOCS.put(r2Key, buf, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: { sourceUrl: url, fetchedAt: new Date().toISOString() },
  });

  const pageData = await ocrPdf(env, buf);
  const fullText = pageData.map((p) => p.text).join("\n\n");
  const extraction = await extract(env, fullText);

  await db.insert(documents).values({
    sha256: sha,
    sourceUrl: url,
    sourceDomain: new URL(url).hostname,
    title: extraction.title,
    docType: extraction.docType,
    pageCount: pageData.length,
    fetchedAt: new Date(),
    documentDate: extraction.documentDate,
    incidentDate: extraction.incidentDate,
    httpStatus: res.status,
    r2Key,
    summary: extraction.summary,
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

  if (extraction.entities.length > 0) {
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

async function sha256(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
