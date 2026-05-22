import type { Env } from "./index.js";

// Blueport talks to LLMs through OpenRouter (OpenAI-compatible). One key, one
// endpoint, swappable models. Default model is Haiku-class for cheap extraction
// + OCR fallback; override per-deploy with the LLM_MODEL var.
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";

export function llmModel(env: Env): string {
  return env.LLM_MODEL && env.LLM_MODEL.length > 0 ? env.LLM_MODEL : DEFAULT_MODEL;
}

/** Whether an LLM is configured. When false, callers degrade gracefully. */
export function hasLlm(env: Env): boolean {
  return Boolean(env.OPENROUTER_API_KEY && env.OPENROUTER_API_KEY.length > 0);
}

type TextPart = { type: "text"; text: string };
type FilePart = { type: "file"; file: { filename: string; file_data: string } };
export type ContentPart = TextPart | FilePart;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

interface ChatOptions {
  system?: string;
  messages: ChatMessage[];
  maxTokens: number;
  /** OpenRouter plugins, e.g. PDF parsing engine selection. */
  plugins?: unknown[];
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

/** Low-level OpenRouter chat call. Throws on transport / API error. */
export async function chat(env: Env, opts: ChatOptions): Promise<string> {
  if (!hasLlm(env)) throw new Error("llm: OPENROUTER_API_KEY not configured");

  const messages: ChatMessage[] = opts.system
    ? [{ role: "system", content: opts.system }, ...opts.messages]
    : opts.messages;

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "content-type": "application/json",
      // OpenRouter attribution headers (optional but recommended).
      "http-referer": "https://github.com/sboghossian/blueport",
      "x-title": "Blueport",
    },
    body: JSON.stringify({
      model: llmModel(env),
      max_tokens: opts.maxTokens,
      messages,
      ...(opts.plugins ? { plugins: opts.plugins } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as ChatResponse;
  if (json.error?.message) throw new Error(`OpenRouter: ${json.error.message}`);
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("OpenRouter: no content in response");
  return content;
}

/** Text-in / text-out convenience wrapper. */
export function chatText(
  env: Env,
  opts: { system?: string; prompt: string; maxTokens: number },
): Promise<string> {
  return chat(env, {
    ...(opts.system !== undefined ? { system: opts.system } : {}),
    messages: [{ role: "user", content: opts.prompt }],
    maxTokens: opts.maxTokens,
  });
}

/** PDF-in / text-out: sends the PDF via OpenRouter's file content part. */
export function chatPdf(
  env: Env,
  opts: { prompt: string; pdfBase64: string; filename: string; maxTokens: number },
): Promise<string> {
  return chat(env, {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: opts.prompt },
          {
            type: "file",
            file: {
              filename: opts.filename,
              file_data: `data:application/pdf;base64,${opts.pdfBase64}`,
            },
          },
        ],
      },
    ],
    maxTokens: opts.maxTokens,
    // Use the model's native PDF understanding (Claude) rather than a paid OCR engine.
    plugins: [{ id: "file-parser", pdf: { engine: "native" } }],
  });
}
