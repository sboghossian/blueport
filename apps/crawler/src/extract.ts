import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./index.js";

export type DocType = "incident_report" | "memo" | "hearing" | "other";

export type EntityKind = "person" | "location" | "unit" | "craft" | "sensor" | "date";

export interface ExtractedEntity {
  kind: EntityKind;
  value: string;
  normalized: string | null;
}

export interface Extraction {
  title: string | null;
  docType: DocType;
  documentDate: Date | null;
  incidentDate: Date | null;
  summary: string;
  entities: ExtractedEntity[];
}

const MAX_INPUT_CHARS = 50_000;

export function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  if (fenced && fenced[1]) return fenced[1].trim();
  return trimmed;
}

export async function extract(env: Env, fullText: string): Promise<Extraction> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const truncated = fullText.slice(0, MAX_INPUT_CHARS);

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    system:
      "You extract structured metadata from declassified UAP/UFO documents. Output ONLY valid JSON matching the schema. No commentary, no markdown fence.",
    messages: [
      {
        role: "user",
        content: `Extract metadata from this document:\n\n${truncated}\n\nOutput JSON with this exact schema:\n{\n  "title": string | null,\n  "docType": "incident_report" | "memo" | "hearing" | "other",\n  "documentDate": "YYYY-MM-DD" | null,\n  "incidentDate": "YYYY-MM-DD" | null,\n  "summary": string,\n  "entities": [\n    { "kind": "person" | "location" | "unit" | "craft" | "sensor" | "date", "value": string, "normalized": string | null }\n  ]\n}\n\nRules:\n- title: from the doc itself, or null if unclear\n- documentDate: when the doc was authored\n- incidentDate: when the UAP event occurred (may equal documentDate or be null)\n- summary: 2-3 sentences, factual, no editorial framing or speculation\n- entities: up to 30 most important; "value" as it appears, "normalized" canonical (e.g. "USS Nimitz" not "the Nimitz")`,
      },
    ],
  });

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) throw new Error("extract: empty response from Claude");

  const json = JSON.parse(stripJsonFence(textBlock.text)) as {
    title: string | null;
    docType: DocType;
    documentDate: string | null;
    incidentDate: string | null;
    summary: string;
    entities: ExtractedEntity[];
  };

  return {
    title: json.title,
    docType: json.docType,
    documentDate: json.documentDate ? new Date(json.documentDate) : null,
    incidentDate: json.incidentDate ? new Date(json.incidentDate) : null,
    summary: json.summary,
    entities: json.entities,
  };
}
