import { fetchViaScrapingBee } from "../lib/scrapingBee.ts";
import { amazonScraper } from "./amazon.ts";
import { crateAndBarrelScraper } from "./crateandbarrel.ts";
import { theKnotScraper } from "./theknot.ts";
import { RegistryItem, RegistryScraper, ScraperConfig } from "../types.ts";

const SCRAPING_BEE_HOSTS = [
  "theknot.com",
  "crateandbarrel.com",
  "amazon.com",
  "cb2.com",
  "westelm.com",
];

function getHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostMatches(url: string, host: string): boolean {
  const hostname = getHostname(url);
  return hostname === host || (hostname?.endsWith(`.${host}`) ?? false);
}

export class ScrapingBeeScraper implements RegistryScraper {
  readonly name = "ScrapingBee";
  readonly key = "scrapingbee";

  // Match anything that we want to try ScrapingBee on
  matches(url: string): boolean {
    const hostname = getHostname(url);
    if (!hostname) return false;
    return SCRAPING_BEE_HOSTS.some((host) =>
      hostname === host || hostname.endsWith(`.${host}`)
    );
  }

  async fetchItems(
    url: string,
    _config: ScraperConfig = {},
  ): Promise<RegistryItem[]> {
    const html = await fetchViaScrapingBee(url, {
      renderJs: true,
      premiumProxy: true,
    });
    // Dispatch to the retailer-specific parser based on hostname
    if (hostMatches(url, "amazon.com")) {
      return amazonScraper.parseAndNormalize(html, url);
    }
    if (
      hostMatches(url, "crateandbarrel.com") || hostMatches(url, "cb2.com")
    ) {
      return crateAndBarrelScraper.parseAndNormalize(html, url);
    }
    if (hostMatches(url, "theknot.com")) {
      return theKnotScraper.parseAndNormalize(html, url);
    }
    throw new Error(`No retailer-specific parser for ${getHostname(url)}`);
  }
}

export const scrapingBeeScraper = new ScrapingBeeScraper();
