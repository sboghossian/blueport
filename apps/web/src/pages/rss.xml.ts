import type { APIRoute } from "astro";
import { desc } from "drizzle-orm";
import { documents } from "@blueport/db/schema";
import { getDb } from "../lib/db";

export const prerender = false;

const SITE = "https://blueport.dashable.dev";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const GET: APIRoute = async ({ locals }) => {
  const db = getDb(locals.runtime.env);
  const rows = await db
    .select()
    .from(documents)
    .orderBy(desc(documents.fetchedAt))
    .limit(50);

  const items = rows
    .map((d) => {
      const link = `${SITE}/doc/${d.sha256}`;
      const pubDate = new Date(d.fetchedAt).toUTCString();
      const title = escapeXml(d.title ?? "(untitled)");
      const description = escapeXml(d.summary ?? "(no summary)");
      return `    <item>
      <title>${title}</title>
      <link>${link}</link>
      <guid isPermaLink="false">${d.sha256}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${description}</description>
    </item>`;
    })
    .join("\n");

  const lastBuild = rows[0]
    ? new Date(rows[0].fetchedAt).toUTCString()
    : new Date().toUTCString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Blueport — newly archived UAP documents</title>
    <link>${SITE}</link>
    <description>Every UAP document declassified by governments. Page-cited. Hash-anchored.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
    },
  });
};
