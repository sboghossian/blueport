import { Hono } from "hono";
import { runCrawl } from "./crawl.js";

export interface Env {
  DB: D1Database;
  DOCS: R2Bucket;
  VECTORS: VectorizeIndex;
  AI: Ai;
  USER_AGENT: string;
  SOURCE_INDEX_URL: string;
  ANTHROPIC_API_KEY: string;
  CRAWL_ADMIN_TOKEN: string;
  ALLOWED_SOURCE_HOSTS: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("blueport crawler — alive"));

app.get("/healthz", (c) => c.json({ ok: true, ts: Date.now() }));

app.post("/admin/crawl", async (c) => {
  const auth = c.req.header("authorization") ?? "";
  const expected = `Bearer ${c.env.CRAWL_ADMIN_TOKEN}`;
  if (!constantTimeEqual(auth, expected)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const result = await runCrawl(c.env);
  return c.json(result);
});

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCrawl(env));
  },
} satisfies ExportedHandler<Env>;
