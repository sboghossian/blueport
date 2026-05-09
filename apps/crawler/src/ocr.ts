import Anthropic from "@anthropic-ai/sdk";
import { extractText, getDocumentProxy } from "unpdf";
import type { Env } from "./index.js";

export interface OcrPage {
  pageNumber: number;
  text: string;
  ocrModel: string;
  ocrConfidence: number | null;
  hasRedactions: boolean;
}

const TEXT_LAYER_MIN_AVG_CHARS = 50;

export async function ocrPdf(env: Env, pdf: ArrayBuffer): Promise<OcrPage[]> {
  const textLayer = await tryTextLayer(pdf);
  if (textLayer) return textLayer;
  return claudePdfOcr(env, pdf);
}

async function tryTextLayer(pdf: ArrayBuffer): Promise<OcrPage[] | null> {
  try {
    const doc = await getDocumentProxy(new Uint8Array(pdf));
    const result = await extractText(doc, { mergePages: false });
    const pageTexts = Array.isArray(result.text) ? result.text : [result.text];

    const totalChars = pageTexts.reduce((sum, p) => sum + (p?.length ?? 0), 0);
    const avgChars = pageTexts.length > 0 ? totalChars / pageTexts.length : 0;
    if (avgChars < TEXT_LAYER_MIN_AVG_CHARS) return null;

    return pageTexts.map((text, i) => ({
      pageNumber: i + 1,
      text: (text ?? "").trim(),
      ocrModel: "unpdf-textlayer",
      ocrConfidence: null,
      hasRedactions: detectRedactions(text ?? ""),
    }));
  } catch {
    return null;
  }
}

async function claudePdfOcr(env: Env, pdf: ArrayBuffer): Promise<OcrPage[]> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const data = arrayBufferToBase64(pdf);

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data },
          },
          {
            type: "text",
            text: [
              "Transcribe this document page by page.",
              "Output exactly:",
              "<page n=\"1\">\nfull text of page 1\n</page>\n<page n=\"2\">\n...",
              "Preserve original layout where reasonable.",
              "Mark any redacted spans inline as [REDACTED] (black bars, classification stamps, [REDACTED] markers).",
              "Output ONLY the <page> tags. No commentary.",
            ].join("\n"),
          },
        ],
      },
    ],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  return parsePageTags(text);
}

function parsePageTags(text: string): OcrPage[] {
  const pages: OcrPage[] = [];
  const pattern = /<page n="(\d+)">([\s\S]*?)<\/page>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const body = (match[2] ?? "").trim();
    pages.push({
      pageNumber: Number(match[1]),
      text: body,
      ocrModel: "claude-haiku-4-5",
      ocrConfidence: null,
      hasRedactions: detectRedactions(body),
    });
  }
  return pages;
}

function detectRedactions(text: string): boolean {
  return /\[REDACTED\]|████|■■■/.test(text);
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}
