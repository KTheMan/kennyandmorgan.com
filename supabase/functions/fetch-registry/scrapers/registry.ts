import type { RegistryItem, RegistryScraper, ScraperConfig } from "../types.ts";
import { myRegistryScraper } from "./myregistry.ts";
import { amazonScraper } from "./amazon.ts";
import { crateAndBarrelScraper } from "./crateandbarrel.ts";
import { zolaScraper } from "./zola.ts";
import { theKnotScraper } from "./theknot.ts";
import { scrapeDoScraper } from "./scrapeDoScraper.ts";
import { scrapingBeeScraper } from "./scrapingBeeScraper.ts";

export const registryScrapers: RegistryScraper[] = [
  amazonScraper,
  crateAndBarrelScraper,
  zolaScraper,
  theKnotScraper,
];

const ANTI_BOT_HOSTS = [
  "amazon.com",
  "crateandbarrel.com",
  "cb2.com",
  "theknot.com",
  "westelm.com",
];

function isAntiBotHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ANTI_BOT_HOSTS.some((host) =>
      hostname === host || hostname.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}

/**
 * Create the appropriate scraper for a registry URL.
 * Tries native/direct scrapers first, then falls back to remote proxy scrapers
 * (scrape.do, ScrapingBee) for known anti-bot sites, and finally to the
 * MyRegistry scraper when no direct retailer matches.
 */
export function createScraper(url: string): RegistryScraper {
  for (const scraper of registryScrapers) {
    if (scraper.matches(url)) return scraper;
  }
  if (isAntiBotHost(url)) return scrapeDoScraper;
  return myRegistryScraper;
}

/**
 * Build the ordered fallback strategy list for a URL.
 * Tier 1: native scraper (fast, free).
 * Tier 2: scrape.do proxy when the site is known to block bots.
 * Tier 3: ScrapingBee proxy as a last resort.
 */
export function createFallbackStrategies(url: string): RegistryScraper[] {
  const primary = createScraper(url);
  const strategies: RegistryScraper[] = [primary];

  if (!isAntiBotHost(url)) return strategies;

  if (primary !== scrapeDoScraper) {
    strategies.push(scrapeDoScraper);
  }
  if (!strategies.includes(scrapingBeeScraper)) {
    strategies.push(scrapingBeeScraper);
  }

  return strategies;
}

/**
 * Convenience wrapper that selects and runs the right scraper for a URL.
 */
export async function scrapeRegistry(
  url: string,
  config: ScraperConfig = {},
): Promise<RegistryItem[]> {
  const scraper = createScraper(url);
  return await scraper.fetchItems(url, config);
}

export {
  amazonScraper,
  crateAndBarrelScraper,
  myRegistryScraper,
  scrapeDoScraper,
  scrapingBeeScraper,
  theKnotScraper,
  zolaScraper,
};
