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

    $(".jsItemRow:not(.emptyCategoryRow)").each((index, element) => {
      const $item = $(element);
      const name = $item.find(".itemTitle").text().trim();
      if (!name) return;

      const skuText = $item.find(".skuNum").text().trim();
      const skuMatch = skuText.match(/SKU\s+(\S+)/i);
      const sku = skuMatch ? skuMatch[1] : "";

      const salePriceText = $item.find(".salePrice").text().trim();
      const regPriceText = $item.find(".regPrice").text().trim();
      const priceText = salePriceText || regPriceText;

      let imageUrl = $item.find("img").first().attr("src") || "";
      if (imageUrl && imageUrl.includes("$web_itembasket$")) {
        imageUrl = imageUrl.replace(
          /\$web_itembasket\$/,
          "&$web_popup_zoom$&wid=379&hei=379",
        );
      }
      if (imageUrl && !imageUrl.startsWith("http")) {
        imageUrl = `${this.baseUrl}${imageUrl}`;
      }

      const cells = $item.find("td");
      const desired = parseInt(
        cells.eq(4).find(".itemHas").text().trim(),
        10,
      ) || 0;
      const fulfilled = parseInt(
        cells.eq(5).find(".itemHas").text().trim(),
        10,
      ) || 0;
      const remaining = Math.max(desired - fulfilled, 0);

      const productUrl = normalizeHttpUrlCandidate(
        $item.find(".itemTitle a").attr("href") || "",
        pageUrl,
      ) ?? pageUrl;

      rawItems.push({
        id: `${this.key}-${sku || index}`,
        name,
        store: this.key,
        price: this.parsePrice(priceText),
        image: imageUrl || null,
        url: productUrl,
        isPurchased: remaining <= 0,
        quantityRequested: desired,
        quantityPurchased: fulfilled,
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
