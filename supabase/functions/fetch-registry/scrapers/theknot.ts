import { BaseRegistryScraper, normalizeScraperItems } from "./base.ts";
import { fetchTextWithAntiBotHeaders } from "../lib/http.ts";
import { RawItem, RegistryItem, ScraperConfig } from "../types.ts";

export class TheKnotScraper extends BaseRegistryScraper {
  readonly name = "The Knot";
  readonly key = "theknot";

  matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return host === "theknot.com" || host.endsWith(".theknot.com");
    } catch {
      return false;
    }
  }

  async fetchItems(
    url: string,
    config: ScraperConfig = {},
  ): Promise<RegistryItem[]> {
    const { text } = await fetchTextWithAntiBotHeaders(url, config);
    const rawItems = this.parseHtml(text, url);
    return normalizeScraperItems(rawItems, this.key);
  }

  parseHtml(html: string, pageUrl: string): RawItem[] {
    const nextData = this.extractNextData(html);
    if (!nextData) return [];
    return this.findRegistryItems(nextData, pageUrl);
  }

  private extractNextData(html: string): unknown | null {
    const match = html.match(
      /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
    );
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }

  /**
   * Walk the Next.js data tree to find registry items.
   * The Knot's data shape can change, so we look for any arrays of objects
   * that look like registry items (have a name/title, a price, and a url).
   */
  private findRegistryItems(data: unknown, pageUrl: string): RawItem[] {
    const items: RawItem[] = [];
    const seen = new Set<string>();

    const visit = (node: unknown) => {
      if (Array.isArray(node)) {
        for (const child of node) visit(child);
        return;
      }
      if (!node || typeof node !== "object") return;

      const record = node as Record<string, unknown>;

      // Heuristic: if this object has name/title + price/url, treat as item
      const name = (record.name ?? record.title ?? record.productName ??
        record.itemName) as unknown;
      if (typeof name === "string" && name.length > 0) {
        const price = record.price ?? record.currentPrice ??
          record.retailPrice ??
          record.amount;
        const url = record.url ?? record.productUrl ?? record.link ??
          record.purchaseUrl;
        const image = record.image ?? record.imageUrl ?? record.thumbnail ??
          record.thumbnailUrl;
        if (price !== undefined || url !== undefined) {
          const idCandidate = record.id ?? record.sku ?? record.asin ??
            record.itemId;
          const id =
            (typeof idCandidate === "string" || typeof idCandidate === "number")
              ? String(idCandidate)
              : `theknot-${items.length}`;
          if (!seen.has(id)) {
            seen.add(id);
            items.push({
              id,
              name,
              price: typeof price === "number" ? price : this.parsePrice(price),
              image: this.normalizeImageUrl(image, pageUrl),
              url: this.normalizeUrl(url, pageUrl),
              store: this.detectStore(record),
              quantityRequested: 1,
              quantityPurchased: 0,
              isPurchased: Boolean(
                record.isPurchased ?? record.purchased ?? false,
              ),
            });
          }
        }
      }

      for (const value of Object.values(record)) {
        if (value && typeof value === "object") visit(value);
      }
    };

    visit(data);
    return items;
  }

  private parsePrice(value: unknown): number | null {
    if (typeof value === "number" && isFinite(value)) return value;
    if (typeof value === "string") {
      const cleaned = value.replace(/[^0-9.]/g, "");
      const parsed = parseFloat(cleaned);
      return isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private normalizeUrl(value: unknown, baseUrl: string): string | null {
    if (typeof value !== "string" || !value) return null;
    try {
      return new URL(value, baseUrl).toString();
    } catch {
      return null;
    }
  }

  private normalizeImageUrl(value: unknown, baseUrl: string): string | null {
    const url = this.normalizeUrl(value, baseUrl);
    if (!url) return null;
    if (url.startsWith("//")) return `https:${url}`;
    return url;
  }

  private detectStore(record: Record<string, unknown>): string {
    // Try to detect which retailer this item came from based on URL or retailer field
    const url = String(record.url ?? record.productUrl ?? "");
    if (/amazon\.com/i.test(url)) return "Amazon";
    if (/crateandbarrel\.com/i.test(url)) return "Crate & Barrel";
    if (/cb2\.com/i.test(url)) return "CB2";
    if (/westelm\.com/i.test(url)) return "West Elm";
    if (/potterybarn\.com/i.test(url)) return "Pottery Barn";
    if (/williams-sonoma\.com/i.test(url)) return "Williams Sonoma";
    if (/zola\.com/i.test(url)) return "Zola";
    if (/target\.com/i.test(url)) return "Target";
    if (/bedbathandbeyond\.com/i.test(url)) return "Bed Bath & Beyond";
    if (/anthropologie\.com/i.test(url)) return "Anthropologie";
    if (/macys\.com/i.test(url)) return "Macy's";
    if (typeof record.retailer === "string") return record.retailer;
    if (typeof record.storeName === "string") return record.storeName;
    if (typeof record.store === "string") return record.store;
    return this.key;
  }
}

export const theKnotScraper = new TheKnotScraper();
