import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";
import { BaseRegistryScraper, normalizeScraperItems } from "./base.ts";
import { fetchTextWithAntiBotHeaders } from "../lib/http.ts";
import { normalizeHttpUrlCandidate } from "../lib/normalize.ts";
import { RawItem, RegistryItem, ScraperConfig } from "../types.ts";

export class AmazonScraper extends BaseRegistryScraper {
  readonly name = "Amazon";
  readonly key = "amazon";
  private readonly baseUrl = "https://www.amazon.com";

  matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const isAmazonHost = host === "amazon.com" ||
        host.endsWith(".amazon.com") ||
        /^amazon\.\w+$/.test(host) ||
        /^www\.amazon\.\w+$/.test(host);
      return isAmazonHost &&
        (parsed.pathname.toLowerCase().includes("/wedding/") ||
          parsed.pathname.toLowerCase().includes("/wedding/registry/"));
    } catch {
      return false;
    }
  }

  async fetchItems(
    url: string,
    config: ScraperConfig = {},
  ): Promise<RegistryItem[]> {
    const { text } = await fetchTextWithAntiBotHeaders(url, config);
    return this.parseAndNormalize(text, url);
  }

  parseAndNormalize(html: string, pageUrl: string): RegistryItem[] {
    const rawItems = this.parseHtml(html, pageUrl);
    return normalizeScraperItems(rawItems, this.key);
  }

  parseHtml(html: string, pageUrl: string): RawItem[] {
    const $ = cheerio.load(html);
    const rawItems: RawItem[] = [];

    $(".registry-item, .a-spacing-base, [data-wr-component='item']").each(
      (index, element) => {
        const $item = $(element);

        const name = $item.find(".a-link-normal[title]").attr("title") ??
          $item.find("h5, h3, .a-size-base-plus").first().text().trim() ?? "";
        if (!name) return;

        const priceStr =
          $item.find(".a-price .a-offscreen").first().text().trim() ||
          $item.find(".a-price-whole").first().text().trim() || "";

        let imageUrl = $item.find("img").first().attr("src") || "";
        if (imageUrl && !imageUrl.startsWith("http")) {
          imageUrl = `${this.baseUrl}${imageUrl}`;
        }

        let productUrl = normalizeHttpUrlCandidate(
          $item.find(".a-link-normal").first().attr("href") || "",
          pageUrl,
        ) ?? pageUrl;

        // Amazon product links often contain an embedded direct URL; prefer it
        // when the href is not obviously a PDP.
        const rawHref = $item.find(".a-link-normal").first().attr("href") || "";
        const directCandidate = normalizeHttpUrlCandidate(rawHref, pageUrl);
        if (directCandidate) productUrl = directCandidate;

        rawItems.push({
          id: `${this.key}-${index}`,
          name,
          store: this.key,
          price: this.parsePrice(priceStr),
          image: imageUrl || null,
          url: productUrl,
          quantityRequested: 1,
          quantityPurchased: 0,
          isPurchased: false,
        });
      },
    );

    return rawItems;
  }

  private parsePrice(priceStr: string): number | null {
    if (!priceStr) return null;
    const cleaned = priceStr.replace(/[^0-9.]/g, "");
    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

export const amazonScraper = new AmazonScraper();
