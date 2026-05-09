/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type Runtime = import("@astrojs/cloudflare").Runtime<{
  DB: D1Database;
  DOCS: R2Bucket;
  VECTORS: VectorizeIndex;
  AI: Ai;
}>;

declare namespace App {
  interface Locals extends Runtime {}
}
