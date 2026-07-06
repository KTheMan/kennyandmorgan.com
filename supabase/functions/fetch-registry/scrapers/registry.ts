import type { RegistryItem, RegistryScraper, ScraperConfig } from "../types.ts";
import { myRegistryScraper } from "./myregistry.ts";
import { amazonScraper } from "./amazon.ts";
import { crateAndBarrelScraper } from "./crateandbarrel.ts";
import { zolaScraper } from "./zola.ts";
import { theKnotScraper } from "./theknot.ts";

export const registryScrapers: RegistryScraper[] = [
  amazonScraper,
  crateAndBarrelScraper,
  zolaScraper,
  theKnotScraper,
];

/**
 * Create the appropriate scraper for a registry URL.
 * Falls back to the MyRegistry scraper when no direct retailer matches.
 */
export function createScraper(url: string): RegistryScraper {
  for (const scraper of registryScrapers) {
    if (scraper.matches(url)) return scraper;
  }
  return myRegistryScraper;
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
  theKnotScraper,
  zolaScraper,
};
