import type { documents } from "@blueport/db/schema";
import { getConnector } from "@blueport/db/connectors";

type Doc = typeof documents.$inferSelect;

export interface CredFactor {
  label: string;
  points: number;
  max: number;
}

export type CredTier = "Strong" | "Moderate" | "Weak";

export interface Credibility {
  score: number; // 0-100
  tier: CredTier;
  factors: CredFactor[];
}

// Issuing authority of a document. PURSUE docs carry an "[Agency]" title prefix;
// AARO docs come in under their connector id.
export function agencyOf(doc: Doc): string {
  const m = /^\[([^\]]+)\]/.exec(doc.title ?? "");
  if (m?.[1]) return m[1];
  if (doc.sourceId === "us-aaro") return "AARO";
  return getConnector(doc.sourceId)?.label ?? doc.sourceDomain;
}

// Authority weight (0-35). Primary DoD/intelligence sources rank highest; an
// unattributed mirror ranks lowest.
const AUTHORITY: Readonly<Record<string, number>> = {
  AARO: 35,
  "Department of War": 33,
  FBI: 30,
  NASA: 28,
  "Department of State": 24,
};

// Summaries the extractor produced for blank / image-only / unreadable docs.
const BLANK =
  /\bno (?:readable )?(?:text|content|document content|machine-readable)\b|appears to be blank|unable to (?:identify|process|extract)|no document content/i;

function authorityPoints(doc: Doc): number {
  return AUTHORITY[agencyOf(doc)] ?? 15;
}

function contentPoints(doc: Doc): number {
  const pc = doc.pageCount ?? 0;
  if (pc <= 0) return 4; // referenced/withheld or empty
  if (doc.summary && BLANK.test(doc.summary)) return 6; // image-only / blank slide
  if (pc >= 5) return 30;
  if (pc >= 2) return 22;
  return 15;
}

function specificityPoints(doc: Doc): number {
  let p = 0;
  if (doc.incidentDate) p += 12; // a dated incident is verifiable
  if (doc.documentDate) p += 8;
  return Math.min(20, p);
}

function provenancePoints(doc: Doc): number {
  // Every doc is hash-anchored with a recorded source.
  let p = 10;
  if (doc.status === "released") p += 5; // referenced-but-withheld can't be verified
  return p;
}

export function scoreDocument(doc: Doc): Credibility {
  const factors: CredFactor[] = [
    { label: `Source authority (${agencyOf(doc)})`, points: authorityPoints(doc), max: 35 },
    { label: "Primary content", points: contentPoints(doc), max: 30 },
    { label: "Specificity (dates)", points: specificityPoints(doc), max: 20 },
    { label: "Provenance", points: provenancePoints(doc), max: 15 },
  ];
  const score = factors.reduce((n, f) => n + f.points, 0);
  return { score, tier: tierFor(score), factors };
}

export function tierFor(score: number): CredTier {
  if (score >= 70) return "Strong";
  if (score >= 40) return "Moderate";
  return "Weak";
}

export const TIER_STYLES: Readonly<Record<CredTier, string>> = {
  Strong: "bg-emerald-900/40 text-emerald-300",
  Moderate: "bg-amber-900/40 text-amber-300",
  Weak: "bg-zinc-800 text-zinc-400",
};
