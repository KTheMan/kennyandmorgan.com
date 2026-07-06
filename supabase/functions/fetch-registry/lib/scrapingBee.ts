/**
 * ScrapingBee API client.
 * Third-tier fallback for anti-bot sites when native and scrape.do both fail.
 * Docs: https://www.scrapingbee.com/documentation/
 *
 * API call shape:
 *   GET https://app.scrapingbee.com/api/v1/?api_key={KEY}&url={URL}&render_js=true
 *
 * Free tier: 1000 API credits/month. JS rendering consumes extra credits.
 */

const SCRAPING_BEE_BASE = "https://app.scrapingbee.com/api/v1/";
const DEFAULT_RENDER_JS = true;
const DEFAULT_PREMIUM = false;

export interface ScrapingBeeOptions {
  /** Render JavaScript before returning HTML (default: true) */
  renderJs?: boolean;
  /** Use premium proxy pool for harder-to-scrape sites */
  premiumProxy?: boolean;
  /** Block ads to reduce payload size and credit usage */
  blockAds?: boolean;
  /** Wait for a specific CSS selector before returning */
  waitFor?: string;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
}

export async function fetchViaScrapingBee(
  url: string,
  options: ScrapingBeeOptions = {},
): Promise<string> {
  const key = Deno.env.get("SCRAPINGBEE_KEY");
  if (!key) {
    throw new Error("SCRAPINGBEE_KEY env var not set");
  }
  const params = new URLSearchParams({
    api_key: key,
    url,
    render_js: String(options.renderJs ?? DEFAULT_RENDER_JS),
    premium_proxy: String(options.premiumProxy ?? DEFAULT_PREMIUM),
    block_ads: String(options.blockAds ?? true),
  });
  if (options.waitFor) params.set("wait_for", options.waitFor);
  if (options.timeout) params.set("timeout", String(options.timeout));

  const scrapeUrl = `${SCRAPING_BEE_BASE}?${params.toString()}`;
  const response = await fetch(scrapeUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(
      `ScrapingBee failed: ${response.status} ${response.statusText}`,
    );
  }
  return await response.text();
}
