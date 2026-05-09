import type { DrizzleD1Database } from "drizzle-orm/d1";
import { and, desc, eq, gte, like, lte, or } from "drizzle-orm";
import { documents, pages } from "@blueport/db/schema";

export type SearchParams = {
  q: string;
  docType?: string | undefined;
  fromDate?: Date | undefined;
  toDate?: Date | undefined;
  limit?: number | undefined;
};

export type SearchResult = {
  doc: typeof documents.$inferSelect;
  snippet: string;
  pageNumber: number | null;
};

const SNIPPET_RADIUS = 120;

function buildSnippet(text: string, q: string): string {
  if (!q.trim()) return text.slice(0, SNIPPET_RADIUS * 2);
  const lower = text.toLowerCase();
  const needle = q.toLowerCase().split(/\s+/).filter(Boolean)[0] ?? "";
  if (!needle) return text.slice(0, SNIPPET_RADIUS * 2);
  const idx = lower.indexOf(needle);
  if (idx < 0) return text.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + needle.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

// TODO(v0.2): swap to FTS5 virtual table once migration adds it.
export async function searchDocuments(
  db: DrizzleD1Database,
  { q, docType, fromDate, toDate, limit = 25 }: SearchParams,
): Promise<SearchResult[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const pattern = `%${trimmed}%`;

  const filters = [
    or(
      like(documents.title, pattern),
      like(documents.summary, pattern),
      like(pages.text, pattern),
    ),
  ];
  if (docType && docType !== "any") filters.push(eq(documents.docType, docType));
  if (fromDate) filters.push(gte(documents.fetchedAt, fromDate));
  if (toDate) filters.push(lte(documents.fetchedAt, toDate));

  const rows = await db
    .select({
      doc: documents,
      pageNumber: pages.pageNumber,
      pageText: pages.text,
    })
    .from(documents)
    .leftJoin(pages, eq(pages.docSha, documents.sha256))
    .where(and(...filters))
    .orderBy(desc(documents.fetchedAt))
    .limit(limit * 4);

  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const row of rows) {
    if (seen.has(row.doc.sha256)) continue;
    seen.add(row.doc.sha256);
    const source =
      row.pageText ?? row.doc.summary ?? row.doc.title ?? "";
    results.push({
      doc: row.doc,
      snippet: buildSnippet(source, trimmed),
      pageNumber: row.pageNumber,
    });
    if (results.length >= limit) break;
  }
  return results;
}

export function highlight(text: string, q: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const tokens = q
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (tokens.length === 0) return escaped;
  const re = new RegExp(`(${tokens.join("|")})`, "gi");
  return escaped.replace(re, "<mark class=\"bg-amber-300/30 text-amber-100 rounded px-0.5\">$1</mark>");
}

export const DOC_TYPES = ["any", "incident_report", "memo", "hearing", "other"] as const;
export type DocType = (typeof DOC_TYPES)[number];
