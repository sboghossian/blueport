import type { DrizzleD1Database } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";

export interface SourceStat {
  sourceId: string;
  country: string | null;
  total: number;
  released: number;
  withheld: number;
  newThisWeek: number;
  lastFetched: Date | null;
}

export interface CountryStat {
  country: string;
  total: number;
}

export interface TimelinePoint {
  day: string; // YYYY-MM-DD
  sourceId: string;
  count: number;
}

export interface ActivitySummary {
  totalReleased: number;
  totalWithheld: number;
  bySource: SourceStat[];
  byCountry: CountryStat[];
  timeline: TimelinePoint[];
}

const WEEK_SECONDS = 7 * 24 * 60 * 60;

// fetched_at is stored as Unix seconds (drizzle integer timestamp mode), so
// SQLite date funcs use 'unixepoch' and the week cutoff is in seconds.
export async function getActivitySummary(db: DrizzleD1Database): Promise<ActivitySummary> {
  const weekAgo = Math.floor(Date.now() / 1000) - WEEK_SECONDS;

  const sourceRows = await db.all<{
    sourceId: string;
    country: string | null;
    total: number;
    released: number;
    withheld: number;
    newThisWeek: number;
    lastFetched: number | null;
  }>(sql`
    SELECT source_id AS sourceId,
           country AS country,
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'released' THEN 1 ELSE 0 END) AS released,
           SUM(CASE WHEN status = 'referenced_withheld' THEN 1 ELSE 0 END) AS withheld,
           SUM(CASE WHEN fetched_at >= ${weekAgo} THEN 1 ELSE 0 END) AS newThisWeek,
           MAX(fetched_at) AS lastFetched
    FROM documents
    GROUP BY source_id, country
    ORDER BY total DESC
  `);

  const countryRows = await db.all<{ country: string | null; total: number }>(sql`
    SELECT country AS country, COUNT(*) AS total
    FROM documents
    WHERE country IS NOT NULL
    GROUP BY country
    ORDER BY total DESC
  `);

  const timelineRows = await db.all<{ day: string; sourceId: string; count: number }>(sql`
    SELECT strftime('%Y-%m-%d', fetched_at, 'unixepoch') AS day,
           source_id AS sourceId,
           COUNT(*) AS count
    FROM documents
    WHERE status = 'released'
    GROUP BY day, source_id
    ORDER BY day ASC
  `);

  const bySource: SourceStat[] = sourceRows.map((r) => ({
    sourceId: r.sourceId,
    country: r.country,
    total: Number(r.total),
    released: Number(r.released),
    withheld: Number(r.withheld),
    newThisWeek: Number(r.newThisWeek),
    lastFetched: r.lastFetched != null ? new Date(Number(r.lastFetched) * 1000) : null,
  }));

  return {
    totalReleased: bySource.reduce((n, s) => n + s.released, 0),
    totalWithheld: bySource.reduce((n, s) => n + s.withheld, 0),
    bySource,
    byCountry: countryRows
      .filter((r): r is { country: string; total: number } => r.country !== null)
      .map((r) => ({ country: r.country, total: Number(r.total) })),
    timeline: timelineRows.map((r) => ({
      day: r.day,
      sourceId: r.sourceId,
      count: Number(r.count),
    })),
  };
}

/** Stable color per source for charts + map (kept here so chart and map agree). */
export const SOURCE_COLORS: Readonly<Record<string, string>> = {
  "us-war-gov": "#60a5fa", // blue-400
  "us-nara": "#34d399", // emerald-400
  "br-sian": "#fbbf24", // amber-400
  "corbell-sleeping-dog": "#f472b6", // pink-400
};

export const FALLBACK_COLOR = "#a1a1aa"; // zinc-400

export function sourceColor(sourceId: string): string {
  return SOURCE_COLORS[sourceId] ?? FALLBACK_COLOR;
}
