import puppeteer from "@cloudflare/puppeteer";
import type { Connector } from "@blueport/db/connectors";
import { extractAssetLinks } from "./assets.js";
import type { DiscoveredAsset } from "./crawl.js";
import type { Env } from "./index.js";

const NAV_TIMEOUT_MS = 30_000;

/**
 * Render each of a connector's start pages with Cloudflare Browser Rendering
 * and harvest the document/asset links the JS exposes. Used for sources that a
 * plain `fetch()` can't read (SIAN's archive UI, Corbell's JS sites).
 *
 * Defensive by design: a page that fails to load or yields nothing is logged as
 * an error on its connector run and skipped, never aborting the others.
 */
export async function discoverViaBrowser(
  env: Env,
  connector: Connector,
): Promise<DiscoveredAsset[]> {
  const browser = await puppeteer.launch(env.BROWSER);
  const found = new Map<string, DiscoveredAsset>();
  try {
    for (const startUrl of connector.startUrls) {
      const page = await browser.newPage();
      try {
        await page.goto(startUrl, { waitUntil: "networkidle0", timeout: NAV_TIMEOUT_MS });
        const html = await page.content();
        for (const asset of extractAssetLinks(html, startUrl, connector.allowedHosts)) {
          if (!found.has(asset.url)) found.set(asset.url, asset);
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return Array.from(found.values());
}
