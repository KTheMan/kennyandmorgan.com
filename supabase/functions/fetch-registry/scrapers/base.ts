import type { RawItem, RegistryItem, RegistryScraper, ScraperConfig } from "../types.ts";
import { toInt, toNumber, toTextValue } from "../lib/normalize.ts";

export abstract class BaseRegistryScraper implements RegistryScraper {
  abstract readonly name: string;
  abstract readonly key: string;

  abstract matches(url: string): boolean;
  abstract fetchItems(
    url: string,
    config?: ScraperConfig,
  ): Promise<RegistryItem[]>;

  protected buildRegistryItem(
    raw: RawItem,
    fetchedAt: string,
    retailerKey: string,
  ): RegistryItem | null {
    const id = String(raw.id ?? "").trim();
    const name = String(raw.name ?? "").trim();

    if (!id || !name) return null;

    const quantityRequested = toInt(raw.quantityRequested);
    const quantityPurchased = toInt(raw.quantityPurchased);

    let isPurchased = Boolean(raw.isPurchased ?? false);
    if (
      !isPurchased && quantityRequested !== null && quantityPurchased !== null &&
      quantityRequested > 0
    ) {
      isPurchased = quantityPurchased >= quantityRequested;
    }

    const price = toNumber(raw.price);

    return {
      id,
      name,
      description: toTextValue(raw.description),
      price,
      quantity_requested: quantityRequested,
      quantity_purchased: quantityPurchased,
      image_url: toTextValue(raw.image) ?? toTextValue(raw.imageUrl) ?? null,
      store_name: String(raw.store ?? raw.storeName ?? retailerKey).trim() ||
        retailerKey,
      product_url: toTextValue(raw.url) ?? toTextValue(raw.productUrl) ?? null,
      category: toTextValue(raw.category),
      is_purchased: isPurchased,
      fetched_at: fetchedAt,
    };
  }
}

export function normalizeScraperItems(
  rawItems: RawItem[],
  retailerKey: string,
  fetchedAt?: string,
): RegistryItem[] {
  const fetchedAtValue = fetchedAt ?? new Date().toISOString();
  const items: RegistryItem[] = [];

  for (const raw of rawItems) {
    const id = String(raw.id ?? "").trim();
    const name = String(raw.name ?? "").trim();
    if (!id || !name) continue;

    const quantityRequested = toInt(raw.quantityRequested);
    const quantityPurchased = toInt(raw.quantityPurchased);

    let isPurchased = Boolean(raw.isPurchased ?? false);
    if (
      !isPurchased && quantityRequested !== null && quantityPurchased !== null &&
      quantityRequested > 0
    ) {
      isPurchased = quantityPurchased >= quantityRequested;
    }

    items.push({
      id,
      name,
      description: toTextValue(raw.description),
      price: toNumber(raw.price),
      quantity_requested: quantityRequested,
      quantity_purchased: quantityPurchased,
      image_url: toTextValue(raw.image) ?? toTextValue(raw.imageUrl) ?? null,
      store_name: String(raw.store ?? raw.storeName ?? retailerKey).trim() ||
        retailerKey,
      product_url: toTextValue(raw.url) ?? toTextValue(raw.productUrl) ?? null,
      category: toTextValue(raw.category),
      is_purchased: isPurchased,
      fetched_at: fetchedAtValue,
    });
  }

  return items;
}
