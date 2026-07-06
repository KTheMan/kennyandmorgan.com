/**
 * scrape.do API client.
 * Uses real browsers with residential IPs to bypass Akamai/Honeybadger bot detection.
 * Docs: https://scrape.do/docs/
 *
 * API call shape:
 *   GET https://api.scrape.do?token={KEY}&url={URL}&render=true&timeout=30
 *
 * Free tier: 1000 credits/month. JS rendering costs more credits.
 */

const SCRAPE_DO_BASE = "https://api.scrape.do";
const DEFAULT_RENDER = true;
const DEFAULT_TIMEOUT_SECONDS = 30;

export interface ScrapeDoOptions {
  /** Render JavaScript before returning HTML (default: true for most cases) */
  render?: boolean;
  /** Custom headers to send */
  headers?: Record<string, string>;
  /** Timeout in seconds (default: 30) */
  timeout?: number;
  /** Use premium proxy for harder-to-scrape sites */
  premium?: boolean;
}

export async function fetchViaScrapeDo(
  url: string,
  options: ScrapeDoOptions = {},
): Promise<string> {
  const key = Deno.env.get("SCRAPEDO_KEY");
  if (!key) {
    throw new Error("SCRAPEDO_KEY env var not set");
  }
  const params = new URLSearchParams({
    token: key,
    url,
    render: String(options.render ?? DEFAULT_RENDER),
    timeout: String(options.timeout ?? DEFAULT_TIMEOUT_SECONDS),
  });
  if (options.premium) params.set("premium", "true");

  const scrapeUrl = `${SCRAPE_DO_BASE}?${params.toString()}`;
  const response = await fetch(scrapeUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(
      `scrape.do failed: ${response.status} ${response.statusText}`,
    );
  }
  return await response.text();
}
