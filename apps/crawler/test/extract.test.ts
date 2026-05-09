import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the most recent request payload sent to messages.create() so each
// test can assert on its shape without standing up a real SDK.
interface CapturedRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: string; content: string }>;
}

const capture: { last: CapturedRequest | null; reply: string } = {
  last: null,
  reply: "",
};

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = {
      create: async (req: CapturedRequest) => {
        capture.last = req;
        return {
          content: capture.reply
            ? [{ type: "text" as const, text: capture.reply }]
            : [],
        };
      },
    };
    constructor(_opts: { apiKey: string }) {
      // no-op
    }
  }
  return { default: MockAnthropic };
});

// Import AFTER vi.mock so the mock is applied.
import { extract, stripJsonFence } from "../src/extract.js";
import type { Env } from "../src/index.js";

function makeEnv(): Env {
  // Only ANTHROPIC_API_KEY is read by extract(); cast through unknown to satisfy
  // the full Env shape without pulling cloudflare bindings into a unit test.
  return { ANTHROPIC_API_KEY: "test-key" } as unknown as Env;
}

beforeEach(() => {
  capture.last = null;
  capture.reply = "";
});

describe("extract", () => {
  it("sends the Haiku model id", async () => {
    capture.reply = JSON.stringify({
      title: "t",
      docType: "memo",
      documentDate: null,
      incidentDate: null,
      summary: "s",
      entities: [],
    });
    await extract(makeEnv(), "hello");
    expect(capture.last?.model).toBe("claude-haiku-4-5-20251001");
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

  it("throws a clean error on empty content blocks", async () => {
    capture.reply = "";
    await expect(extract(makeEnv(), "x")).rejects.toThrow(
      /empty response from Claude/,
    );
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
    // Use a sentinel char that doesn't appear in the prompt text so we can
    // count occurrences without false positives from the surrounding prose.
    const SENTINEL = "Z";
    const huge = SENTINEL.repeat(60_000);
    await extract(makeEnv(), huge);
    const sent = capture.last?.messages[0]?.content ?? "";
    const sentinelCount = (sent.match(/Z/g) ?? []).length;
    expect(sentinelCount).toBeLessThanOrEqual(50_000);
    expect(sentinelCount).toBeGreaterThan(0);
    // Total payload length should not include the original 60k of input.
    expect(sent.length).toBeLessThan(60_000);
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
