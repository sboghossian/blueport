import { extractText, getDocumentProxy } from "unpdf";
import { chatPdf, hasLlm, llmModel } from "./llm.js";
import type { Env } from "./index.js";

export interface OcrPage {
  pageNumber: number;
  text: string;
  ocrModel: string;
  ocrConfidence: number | null;
  hasRedactions: boolean;
}

const TEXT_LAYER_MIN_AVG_CHARS = 50;

/**
 * OCR a PDF. Strategy: free `unpdf` text-layer first; if it's too sparse and an
 * LLM is configured, fall back to a vision pass via OpenRouter. Never throws —
 * on fallback failure (or no LLM) it returns whatever the text layer yielded,
 * so the document still ingests rather than orphaning its R2 object.
 */
export async function ocrPdf(env: Env, pdf: ArrayBuffer): Promise<OcrPage[]> {
  const textLayer = await extractTextLayer(pdf);
  if (avgChars(textLayer) >= TEXT_LAYER_MIN_AVG_CHARS) return textLayer;

  if (hasLlm(env)) {
    try {
      const vision = await claudePdfOcr(env, pdf);
      if (vision.length > 0) return vision;
    } catch {
      // fall through to the (sparse) text layer
    }
  }
  return textLayer;
}

async function extractTextLayer(pdf: ArrayBuffer): Promise<OcrPage[]> {
  try {
    const doc = await getDocumentProxy(new Uint8Array(pdf));
    const result = await extractText(doc, { mergePages: false });
    const pageTexts = Array.isArray(result.text) ? result.text : [result.text];
    return pageTexts.map((text, i) => ({
      pageNumber: i + 1,
      text: (text ?? "").trim(),
      ocrModel: "unpdf-textlayer",
      ocrConfidence: null,
      hasRedactions: detectRedactions(text ?? ""),
    }));
  } catch {
    return [];
  }
}

function avgChars(pages: OcrPage[]): number {
  if (pages.length === 0) return 0;
  const total = pages.reduce((sum, p) => sum + p.text.length, 0);
  return total / pages.length;
}

async function claudePdfOcr(env: Env, pdf: ArrayBuffer): Promise<OcrPage[]> {
  const text = await chatPdf(env, {
    maxTokens: 8000,
    filename: "document.pdf",
    pdfBase64: arrayBufferToBase64(pdf),
    prompt: [
      "Transcribe this document page by page.",
      "Output exactly:",
      '<page n="1">\nfull text of page 1\n</page>\n<page n="2">\n...',
      "Preserve original layout where reasonable.",
      "Mark any redacted spans inline as [REDACTED] (black bars, classification stamps, [REDACTED] markers).",
      "Output ONLY the <page> tags. No commentary.",
    ].join("\n"),
  });
  return parsePageTags(text, llmModel(env));
}

export function parsePageTags(text: string, ocrModel = "claude-haiku-4.5"): OcrPage[] {
  const pages: OcrPage[] = [];
  const pattern = /<page n="(\d+)">([\s\S]*?)<\/page>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const body = (match[2] ?? "").trim();
    pages.push({
      pageNumber: Number(match[1]),
      text: body,
      ocrModel,
      ocrConfidence: null,
      hasRedactions: detectRedactions(body),
    });
  }
  return pages;
}

export function detectRedactions(text: string): boolean {
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
