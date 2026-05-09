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
}

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("blueport crawler — alive"));

app.get("/healthz", (c) => c.json({ ok: true, ts: Date.now() }));

app.post("/admin/crawl", async (c) => {
  const auth = c.req.header("authorization");
  if (auth !== `Bearer ${c.env.ANTHROPIC_API_KEY}`) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const result = await runCrawl(c.env);
  return c.json(result);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCrawl(env));
  },
} satisfies ExportedHandler<Env>;
