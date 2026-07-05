/**
 * Shared types and contracts for the pluggable registry scraper system.
 */

export interface RegistryItem {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  quantity_requested: number | null;
  quantity_purchased: number | null;
  image_url: string | null;
  registry_image_url?: string | null;
  resolved_image_url?: string | null;
  store_name: string | null;
  product_url: string | null;
  source_product_url?: string | null;
  category: string | null;
  is_purchased: boolean;
  fetched_at: string;
  item_type?: "product" | "fund";
  action_label?: string | null;
  image_marked_for_retry?: boolean;
  image_manually_cleared?: boolean;
  image_blacklisted?: boolean;
  image_suspicious?: boolean;
  image_low_confidence?: boolean;
  registry_url?: string;
}

export type SyncMeta = {
  didSync: boolean;
  wasStale: boolean;
  cacheAgeMs: number;
};

export type RawItem = Record<string, unknown>;

export interface ScraperConfig {
  requestTimeoutMs?: number;
  userAgent?: string;
  fetch?: typeof fetch;
}

export interface RegistryScraper {
  readonly name: string;
  readonly key: string;
  matches(url: string): boolean;
  fetchItems(url: string, config?: ScraperConfig): Promise<RegistryItem[]>;
}

export type RetailerKey = "myregistry" | "amazon" | "crateandbarrel" | "zola";
