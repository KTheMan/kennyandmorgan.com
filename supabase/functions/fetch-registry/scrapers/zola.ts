import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";
import { BaseRegistryScraper, normalizeScraperItems } from "./base.ts";
import { fetchTextWithAntiBotHeaders } from "../lib/http.ts";
import { normalizeHttpUrlCandidate } from "../lib/normalize.ts";
import { RawItem, RegistryItem, ScraperConfig } from "../types.ts";

export class ZolaScraper extends BaseRegistryScraper {
  readonly name = "Zola";
  readonly key = "zola";
  private readonly baseUrl = "https://www.zola.com";

  matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return (
        (host === "zola.com" || host.endsWith(".zola.com")) &&
        parsed.pathname.toLowerCase().includes("/registry/")
      );
    } catch {
      return false;
    }
  }

  async fetchItems(url: string, config: ScraperConfig = {}): Promise<RegistryItem[]> {
    const { text } = await fetchTextWithAntiBotHeaders(url, config);
    const rawItems = this.parseHtml(text, url);

    const fetchedAt = new Date().toISOString();
    return rawItems.map((raw) => {
      const base = normalizeScraperItems([raw], this.key, fetchedAt)[0];
      if (!base) return null;

      return {
        ...base,
        item_type: raw.isVariablePrice ? "fund" : "product",
        action_label: raw.isVariablePrice ? "Contribute" : null,
      };
    }).filter((item): item is RegistryItem => item !== null);
  }

  parseHtml(html: string, pageUrl: string): RawItem[] {
    const $ = cheerio.load(html);
    const rawItems: RawItem[] = [];

    $("#all-panel .product-tile").each((index, element) => {
      const $item = $(element);
      const name = $item.find(".single-product-name").text().trim();
      if (!name) return;

      const productId = $item.find(".single-product").attr("id") || "";
      const priceData = $item.find("[data-price]").attr("data-price") || "";
      const priceText = $item.find(".product-price").text().trim();
      const isVariablePrice = priceText.includes("Contribute what you wish");

      let imageUrl = $item.find("[data-image-url]").attr("data-image-url") || "";
      if (imageUrl && !imageUrl.startsWith("http")) {
        imageUrl = `${this.baseUrl}${imageUrl}`;
      }

      const productHref = $item.find(".content a").first().attr("href") || "";
      const productUrl = normalizeHttpUrlCandidate(productHref, pageUrl) ??
        pageUrl;

      const neededText = $item.find(".needed").text().trim();
      const remainingMatch = neededText.match(/Still Needs:\s*(\d+)/i);
      const desiredMatch = neededText.match(/Requested:\s*(\d+)/i);
      const remaining = remainingMatch ? parseInt(remainingMatch[1], 10) : 0;
      const desired = desiredMatch ? parseInt(desiredMatch[1], 10) : 0;

      const price = isVariablePrice && Number(priceData) > 0
        ? parseFloat(priceData)
        : this.parsePrice(priceData);

      rawItems.push({
        id: `${this.key}-${productId || index}`,
        name,
        store: this.key,
        price: Number.isFinite(price) ? price : null,
        image: imageUrl || null,
        url: productUrl,
        quantityRequested: desired,
        quantityPurchased: desired - remaining,
        isPurchased: isVariablePrice ? price <= 0 : remaining <= 0,
        isVariablePrice,
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

export const zolaScraper = new ZolaScraper();
