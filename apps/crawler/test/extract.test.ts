import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extract, stripJsonFence } from "../src/extract.js";
import type { Env } from "../src/index.js";

// Capture the most recent OpenRouter request body so each test can assert on
// its shape without a real network call.
interface CapturedBody {
  model: string;
  max_tokens: number;
  messages: Array<{ role: string; content: string }>;
}

const capture: { last: CapturedBody | null; reply: string } = {
  last: null,
  reply: "",
};

function makeEnv(): Env {
  // Only OPENROUTER_API_KEY / LLM_MODEL are read by the LLM layer; cast through
  // unknown to satisfy the full Env shape without cloudflare bindings.
  return { OPENROUTER_API_KEY: "test-key" } as unknown as Env;
}

beforeEach(() => {
  capture.last = null;
  capture.reply = "";
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    capture.last = JSON.parse(init.body) as CapturedBody;
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: capture.reply } }] }),
      text: async () => "",
    } as unknown as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extract", () => {
  it("sends the default Haiku-4.5 OpenRouter model id", async () => {
    capture.reply = JSON.stringify({
      title: "t",
      docType: "memo",
      documentDate: null,
      incidentDate: null,
      summary: "s",
      entities: [],
    });
    await extract(makeEnv(), "hello");
    expect(capture.last?.model).toBe("anthropic/claude-haiku-4.5");
  });

  it("parses well-formed JSON into Extraction with Date conversion", async () => {
    capture.reply = JSON.stringify({
      title: "Nimitz Encounter",
      docType: "incident_report",
      documentDate: "2004-11-14",
      incidentDate: "2004-11-10",
      summary: "Two F/A-18 pilots observed an unidentified aerial object.",
      entities: [
        { kind: "craft", value: "Tic Tac", normalized: "tic-tac" },
        { kind: "unit", value: "VFA-41", normalized: null },
      ],
    });
    const result = await extract(makeEnv(), "doc text");
    expect(result.title).toBe("Nimitz Encounter");
    expect(result.docType).toBe("incident_report");
    expect(result.documentDate).toBeInstanceOf(Date);
    expect(result.documentDate?.toISOString().slice(0, 10)).toBe("2004-11-14");
    expect(result.incidentDate).toBeInstanceOf(Date);
    expect(result.incidentDate?.toISOString().slice(0, 10)).toBe("2004-11-10");
    expect(result.entities).toHaveLength(2);
    expect(result.entities[0]?.kind).toBe("craft");
    expect(result.entities[0]?.normalized).toBe("tic-tac");
    expect(result.entities[1]?.normalized).toBeNull();
  });

  it("throws a clean error on empty response content", async () => {
    capture.reply = "";
    await expect(extract(makeEnv(), "x")).rejects.toThrow(/empty response from LLM/);
  });

  it("truncates input over MAX_INPUT_CHARS (50_000)", async () => {
    capture.reply = JSON.stringify({
      title: null,
      docType: "other",
      documentDate: null,
      incidentDate: null,
      summary: "",
      entities: [],
    });
    const SENTINEL = "Z";
    const huge = SENTINEL.repeat(60_000);
    await extract(makeEnv(), huge);
    const sent = capture.last?.messages.at(-1)?.content ?? "";
    const sentinelCount = (sent.match(/Z/g) ?? []).length;
    expect(sentinelCount).toBeLessThanOrEqual(50_000);
    expect(sentinelCount).toBeGreaterThan(0);
    expect(sent.length).toBeLessThan(60_000);
  });

  it("sends a system message plus the user prompt", async () => {
    capture.reply = JSON.stringify({
      title: null,
      docType: "other",
      documentDate: null,
      incidentDate: null,
      summary: "",
      entities: [],
    });
    await extract(makeEnv(), "doc");
    expect(capture.last?.messages[0]?.role).toBe("system");
    expect(capture.last?.messages.at(-1)?.role).toBe("user");
  });

  it("parses fenced JSON wrapped in ```json ... ```", async () => {
    capture.reply = '```json\n' + JSON.stringify({
      title: "Fenced",
      docType: "memo",
      documentDate: null,
      incidentDate: null,
      summary: "wrapped in a fence",
      entities: [],
    }) + '\n```';
    const result = await extract(makeEnv(), "doc");
    expect(result.title).toBe("Fenced");
    expect(result.summary).toBe("wrapped in a fence");
  });

  it("preserves entities array and normalizes nullable date fields", async () => {
    capture.reply = JSON.stringify({
      title: null,
      docType: "memo",
      documentDate: null,
      incidentDate: null,
      summary: "no dates",
      entities: [
        { kind: "person", value: "Cmdr. Fravor", normalized: null },
        { kind: "location", value: "off the coast of San Diego", normalized: "San Diego, CA" },
        { kind: "sensor", value: "ATFLIR", normalized: "AN/ASQ-228" },
      ],
    });
    const result = await extract(makeEnv(), "doc");
    expect(result.title).toBeNull();
    expect(result.documentDate).toBeNull();
    expect(result.incidentDate).toBeNull();
    expect(result.entities).toHaveLength(3);
    expect(result.entities.map((e) => e.kind)).toEqual(["person", "location", "sensor"]);
    expect(result.entities[0]?.normalized).toBeNull();
    expect(result.entities[1]?.normalized).toBe("San Diego, CA");
  });
});

describe("stripJsonFence", () => {
  it("strips ```json ... ```", () => {
    expect(stripJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("strips bare ``` ... ``` without language tag", () => {
    expect(stripJsonFence('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("returns trimmed input unchanged when no fence present", () => {
    expect(stripJsonFence('  {"a":1}  ')).toBe('{"a":1}');
  });
});
