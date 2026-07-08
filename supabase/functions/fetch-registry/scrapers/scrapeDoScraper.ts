import { fetchViaScrapeDo } from "../lib/scrapeDo.ts";
import { amazonScraper } from "./amazon.ts";
import { crateAndBarrelScraper } from "./crateandbarrel.ts";
import { theKnotScraper } from "./theknot.ts";
import { RegistryItem, RegistryScraper, ScraperConfig } from "../types.ts";

const SCRAPE_DO_HOSTS = [
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

export class ScrapeDoScraper implements RegistryScraper {
  readonly name = "scrape.do";
  readonly key = "scrape.do";

  // Match anything that we want to try scrape.do on
  matches(url: string): boolean {
    const hostname = getHostname(url);
    if (!hostname) return false;
    return SCRAPE_DO_HOSTS.some((host) =>
      hostname === host || hostname.endsWith(`.${host}`)
    );
  }

  async fetchItems(
    url: string,
    _config: ScraperConfig = {},
  ): Promise<RegistryItem[]> {
    const host = new URL(url).hostname.toLowerCase();
    // C&B serves products in static HTML — skip JS rendering to avoid rotation errors
    const isCB = host.includes("crateandbarrel.com") || host.includes("cb2.com");
    const html = await fetchViaScrapeDo(url, {
      render: !isCB,
      premium: !isCB, // premium only when we need JS rendering
      timeout: 60_000,
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

export const scrapeDoScraper = new ScrapeDoScraper();
