import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";
import { BaseRegistryScraper, normalizeScraperItems } from "./base.ts";
import { fetchTextWithAntiBotHeaders } from "../lib/http.ts";
import { normalizeHttpUrlCandidate } from "../lib/normalize.ts";
import { RawItem, RegistryItem, ScraperConfig } from "../types.ts";

export class CrateAndBarrelScraper extends BaseRegistryScraper {
  readonly name = "Crate & Barrel";
  readonly key = "crateandbarrel";
  private readonly baseUrl = "https://www.crateandbarrel.com";

  matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return (
        (host === "crateandbarrel.com" ||
          host.endsWith(".crateandbarrel.com")) &&
        parsed.pathname.toLowerCase().startsWith("/gift-registry/")
      );
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

    $('article[data-testid="registry-item"]').each((index, element) => {
      const $item = $(element);

      const name = (
        $item.find('[data-testid="registry-item-details-btn"]').attr("title") ||
        $item.find(".title_1ycQU").first().text().trim() ||
        $item.attr("aria-label") ||
        ""
      ).trim();

      if (!name) return;
      if (name === "Free Shipping Eligible - View Details") return;

      const skuText = $item.find('[data-testid="registry-item-sku"]')
        .text().trim();
      const skuMatch = skuText.match(/(\d{4,})/);
      const sku = skuMatch ? skuMatch[1] : "";

      const salePriceText = $item.find(".salePrice").first().text().trim();
      const regPriceText = $item.find(".regPrice").first().text().trim();
      const priceText = salePriceText || regPriceText;

      let imageUrl =
        $item.find('[data-testid="registry-item-image-btn"] img').first()
          .attr("src") || "";
      if (imageUrl && !imageUrl.startsWith("http")) {
        imageUrl = `${this.baseUrl}${imageUrl}`;
      }

      const qtyText = $item.find('[data-testid="registry-item-qty-purchased"]')
        .text().trim();
      const qtyMatch = qtyText.match(/(\d+)\s+of\s+(\d+)\s+purchased/i);
      const qtyPurchased = qtyMatch ? parseInt(qtyMatch[1], 10) : 0;
      const qtyRequested = qtyMatch ? parseInt(qtyMatch[2], 10) : 1;

      const productUrl = normalizeHttpUrlCandidate(
        $item.find('[data-testid="registry-item-image-btn"]').attr(
          "data-href",
        ) || "",
        pageUrl,
      ) ?? pageUrl;

      rawItems.push({
        id: `${this.key}-${sku || index}`,
        name,
        store: this.key,
        price: this.parsePrice(priceText),
        image: imageUrl || null,
        url: productUrl,
        isPurchased: qtyPurchased >= qtyRequested && qtyRequested > 0,
        quantityRequested: qtyRequested,
        quantityPurchased: qtyPurchased,
      });
    });

    return rawItems;
  }

  private parsePrice(priceStr: string): number | null {
    if (!priceStr) return null;
    const cleaned = priceStr.replace(/[^0-9.]/g, "");
    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

export const crateAndBarrelScraper = new CrateAndBarrelScraper();
