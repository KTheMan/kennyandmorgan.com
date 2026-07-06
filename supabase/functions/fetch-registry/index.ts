// ============================================================
// OPTIONAL: Third-party scraping services as fallbacks
// ============================================================
// SCRAPEDO_KEY     - scrape.do API key (https://scrape.do) — used as fallback for Akamai-blocked sites
// SCRAPINGBEE_KEY  - ScrapingBee API key (https://scrapingbee.com) — used as a third-tier fallback
// These are OPTIONAL. If unset, the function falls back to native scraping + cached data.

import { createSupabaseClient } from "./lib/supabase.ts";
import type { SupabaseClient } from "./lib/supabase.ts";
import { createFallbackStrategies } from "./scrapers/registry.ts";
import type { RegistryItem, ScraperConfig } from "./types.ts";
import {
  DEFAULT_BACKGROUND_ENRICHMENT_LIMIT,
  myRegistryScraper,
  parseBackgroundEnrichmentLimit,
  selectBackgroundEnrichmentCandidates,
  upgradeImagesFromMyRegistryLinks,
} from "./scrapers/myregistry.ts";
import {
  getDisplayImageUrl,
  toInt,
  toNumber,
  toTextValue,
} from "./lib/normalize.ts";

// Default cache TTL aligns with the frontend's 10-minute refresh cadence.
const CACHE_TTL_SECONDS = parseInt(
  Deno.env.get("REGISTRY_CACHE_TTL_SECONDS") ?? "600",
  10,
);

function parseRegistryUrls(envValue: string | null | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeProductUrlKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${host}${path}`;
  } catch {
    return null;
  }
}

function normalizeImageUrlKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    // Use host + first 2 path segments to allow some query-string variation
    // but still be product-specific.
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const path = pathParts.slice(0, 2).join("/");
    return `${host}/${path}`;
  } catch {
    return null;
  }
}

const DEFAULT_REGISTRY_URLS = parseRegistryUrls(Deno.env.get("REGISTRY_URL"));

const DEFAULT_MYREGISTRY_URL = Deno.env.get("MYREGISTRY_URL") ??
  "https://www.myregistry.com/giftlist/morganandkenny";

const OPTIONAL_REGISTRY_COLUMNS = [
  "item_type",
  "action_label",
  "source_product_url",
  "registry_image_url",
  "resolved_image_url",
  "image_marked_for_retry",
  "image_manually_cleared",
  "image_blacklisted",
  "image_suspicious",
  "image_low_confidence",
  "registry_url",
] as const;
const MAX_SCHEMA_COMPATIBILITY_ATTEMPTS = OPTIONAL_REGISTRY_COLUMNS.length + 1;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function getMissingRegistrySchemaCacheColumns(
  message: string,
): Set<(typeof OPTIONAL_REGISTRY_COLUMNS)[number]> {
  const unsupportedColumns = new Set<
    (typeof OPTIONAL_REGISTRY_COLUMNS)[number]
  >();
  for (const column of OPTIONAL_REGISTRY_COLUMNS) {
    if (
      message.includes(
        `Could not find the '${column}' column of 'registry_items' in the schema cache`,
      ) ||
      message.includes(`'${column}'`) ||
      message.includes(`"${column}"`)
    ) {
      unsupportedColumns.add(column);
    }
  }
  return unsupportedColumns;
}

function stripUnsupportedRegistryColumns(
  items: RegistryItem[],
  unsupportedColumns: Set<(typeof OPTIONAL_REGISTRY_COLUMNS)[number]>,
): Record<string, unknown>[] {
  return items.map((item) => {
    const row = { ...item } as Record<string, unknown>;
    for (const column of unsupportedColumns) {
      delete row[column];
    }
    return row;
  });
}

function normalizeCachedItem(raw: unknown): RegistryItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const id = toTextValue(record.id);
  const name = toTextValue(record.name);
  if (!id || !name) return null;

  const itemType = record.item_type === "fund" || record.item_type === "product"
    ? record.item_type
    : undefined;

  return {
    id,
    name,
    description: toTextValue(record.description),
    price: toNumber(record.price),
    quantity_requested: toInt(record.quantity_requested),
    quantity_purchased: toInt(record.quantity_purchased),
    image_url: toTextValue(record.image_url),
    registry_image_url: toTextValue(record.registry_image_url),
    resolved_image_url: toTextValue(record.resolved_image_url),
    store_name: toTextValue(record.store_name),
    product_url: toTextValue(record.product_url),
    source_product_url: toTextValue(record.source_product_url),
    category: toTextValue(record.category),
    is_purchased: Boolean(record.is_purchased),
    fetched_at: toTextValue(record.fetched_at) ?? new Date().toISOString(),
    item_type: itemType,
    action_label: toTextValue(record.action_label),
    image_marked_for_retry: Boolean(record.image_marked_for_retry),
    image_manually_cleared: Boolean(record.image_manually_cleared),
    image_blacklisted: Boolean(record.image_blacklisted),
    image_suspicious: Boolean(record.image_suspicious),
    image_low_confidence: Boolean(record.image_low_confidence),
    registry_url: toTextValue(record.registry_url) ?? undefined,
  };
}

function normalizeCachedItems(
  rawItems: unknown[] | null | undefined,
): RegistryItem[] {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .map((raw) => normalizeCachedItem(raw))
    .filter((item): item is RegistryItem => Boolean(item));
}

async function getCachedRegistryItems(
  supabase: SupabaseClient,
): Promise<RegistryItem[]> {
  const { data, error } = await supabase
    .from("registry_items")
    .select("*")
    .order("is_purchased", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return normalizeCachedItems(data as unknown[] | null | undefined);
}

function buildFastSyncPayload(
  freshItems: RegistryItem[],
  existingItemsById: Map<string, RegistryItem>,
): RegistryItem[] {
  return freshItems.map((item) => {
    const existing = existingItemsById.get(item.id);
    const preservedResolvedImage = existing?.resolved_image_url ?? null;
    const registryImage = item.registry_image_url ?? item.image_url ?? null;
    const displayImage = preservedResolvedImage ?? existing?.image_url ??
      registryImage;
    return {
      ...item,
      registry_image_url: registryImage,
      resolved_image_url: preservedResolvedImage,
      image_url: displayImage,
      image_marked_for_retry: existing?.image_marked_for_retry ?? false,
      image_manually_cleared: existing?.image_manually_cleared ?? false,
      image_blacklisted: existing?.image_blacklisted ?? false,
      image_suspicious: existing?.image_suspicious ?? false,
      image_low_confidence: existing?.image_low_confidence ?? false,
      registry_url: item.registry_url ?? existing?.registry_url ?? undefined,
    };
  });
}

async function upsertRegistryItems(
  supabase: SupabaseClient,
  payload: RegistryItem[],
): Promise<void> {
  if (payload.length === 0) return;

  const unsupportedColumns = new Set<
    (typeof OPTIONAL_REGISTRY_COLUMNS)[number]
  >();
  for (
    let retryAttempt = 0;
    retryAttempt < MAX_SCHEMA_COMPATIBILITY_ATTEMPTS;
    retryAttempt += 1
  ) {
    const upsertPayload = stripUnsupportedRegistryColumns(
      payload,
      unsupportedColumns,
    );
    const { error } = await supabase
      .from("registry_items")
      .upsert(upsertPayload, { onConflict: "id" });
    if (!error) break;
    const missingColumns = getMissingRegistrySchemaCacheColumns(error.message);
    const newUnsupportedColumns = [...missingColumns].filter((column) =>
      !unsupportedColumns.has(column)
    );
    if (newUnsupportedColumns.length === 0) {
      throw new Error(`Failed to upsert registry items: ${error.message}`);
    }
    newUnsupportedColumns.forEach((column) => unsupportedColumns.add(column));
  }
}

async function deleteStaleRegistryItems(
  supabase: SupabaseClient,
  freshItems: RegistryItem[],
  existingItems: RegistryItem[],
): Promise<void> {
  // Compute IDs of items that came from any of the native URLs being synced.
  // We identify "same source" by registry_url match.
  const syncedRegistryUrls = new Set(
    freshItems.map((item) => item.registry_url).filter((u): u is string =>
      Boolean(u)
    ),
  );

  const incomingIds = new Set(freshItems.map((item) => item.id));
  const staleIds = existingItems
    .filter((item) => {
      if (!item.registry_url) return false;
      if (!syncedRegistryUrls.has(item.registry_url)) return false;
      return !incomingIds.has(item.id);
    })
    .map((item) => item.id);

  if (staleIds.length === 0) return;

  const { error } = await supabase
    .from("registry_items")
    .delete()
    .in("id", staleIds);
  if (error) {
    throw new Error(
      `Failed to delete stale registry items: ${error.message}`,
    );
  }
}

async function runBackgroundImageEnrichment(
  supabase: SupabaseClient,
  limit: number = DEFAULT_BACKGROUND_ENRICHMENT_LIMIT,
): Promise<{
  total: number;
  upgraded: number;
  skipped: number;
  total_cached_items: number;
  total_eligible_items: number;
  attempted_this_run: number;
  upgraded_this_run: number;
  skipped_already_good: number;
  configured_limit_used: number;
}> {
  const cachedItems = await getCachedRegistryItems(supabase);
  const configuredLimit = Number.isFinite(limit) && limit > 0
    ? Math.floor(limit)
    : DEFAULT_BACKGROUND_ENRICHMENT_LIMIT;
  const { candidates, totalEligible, skippedAlreadyGood } =
    selectBackgroundEnrichmentCandidates(cachedItems, configuredLimit);
  const attemptedItems = candidates.map((candidate) => candidate.item);
  const upgradedItems = attemptedItems.length > 0
    ? await upgradeImagesFromMyRegistryLinks(attemptedItems)
    : [];
  let upgraded = 0;
  const updates = upgradedItems.filter((item, index) => {
    const before = attemptedItems[index];
    const beforeResolved = before?.resolved_image_url ?? null;
    const afterResolved = item.resolved_image_url ?? null;
    if (afterResolved && afterResolved !== beforeResolved) {
      upgraded += 1;
      return true;
    }
    return false;
  });

  if (updates.length > 0) {
    const unsupportedColumns = new Set<
      (typeof OPTIONAL_REGISTRY_COLUMNS)[number]
    >();
    for (
      let retryAttempt = 0;
      retryAttempt < MAX_SCHEMA_COMPATIBILITY_ATTEMPTS;
      retryAttempt += 1
    ) {
      const payload = stripUnsupportedRegistryColumns(
        updates,
        unsupportedColumns,
      );
      const { error } = await supabase.from("registry_items").upsert(payload, {
        onConflict: "id",
      });
      if (!error) break;
      const missingColumns = getMissingRegistrySchemaCacheColumns(
        error.message,
      );
      const newUnsupportedColumns = [...missingColumns].filter((column) =>
        !unsupportedColumns.has(column)
      );
      if (newUnsupportedColumns.length === 0) {
        throw new Error(
          `Failed to persist enriched registry images: ${error.message}`,
        );
      }
      newUnsupportedColumns.forEach((column) => unsupportedColumns.add(column));
    }
  }

  const skipped = Math.max(cachedItems.length - upgraded, 0);
  console.info(
    `[fetch-registry] Background image enrichment complete; total=${cachedItems.length} eligible=${totalEligible} attempted=${attemptedItems.length} upgraded=${upgraded} skipped_good=${skippedAlreadyGood} limit=${configuredLimit}`,
  );
  return {
    total: cachedItems.length,
    upgraded,
    skipped,
    total_cached_items: cachedItems.length,
    total_eligible_items: totalEligible,
    attempted_this_run: attemptedItems.length,
    upgraded_this_run: upgraded,
    skipped_already_good: skippedAlreadyGood,
    configured_limit_used: configuredLimit,
  };
}

async function resolveExplicitUrls(req: Request): Promise<string[]> {
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (
        Array.isArray(body?.urls) &&
        body.urls.every((u: unknown) => typeof u === "string")
      ) {
        return body.urls as string[];
      }
      if (typeof body?.url === "string") {
        return [body.url];
      }
    } catch {
      // Invalid or empty body; fall back to the env registry list.
    }
  }

  return DEFAULT_REGISTRY_URLS;
}

async function resolveTargetUrls(req: Request): Promise<string[]> {
  const explicit = await resolveExplicitUrls(req);
  const myRegistryUrl = DEFAULT_MYREGISTRY_URL;
  const all = [...explicit];
  if (myRegistryUrl && !all.includes(myRegistryUrl)) {
    all.push(myRegistryUrl);
  }
  return all;
}

if (import.meta.main) {
  Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: CORS_HEADERS });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Supabase environment not configured.",
          items: [],
        }),
        {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        },
      );
    }

    const supabase = createSupabaseClient(supabaseUrl, serviceRoleKey);
    const requestUrl = new URL(req.url);

    try {
      const mode = requestUrl.searchParams.get("mode") ?? "";
      const isBackgroundEnrichmentRequest = mode === "enrich" ||
        (req.method === "POST" &&
          requestUrl.searchParams.get("background") === "image-enrichment");
      if (isBackgroundEnrichmentRequest) {
        const enrichmentLimit = parseBackgroundEnrichmentLimit(requestUrl);
        const enrichment = await runBackgroundImageEnrichment(
          supabase,
          enrichmentLimit,
        );
        return new Response(
          JSON.stringify({
            success: true,
            mode: "background-enrichment",
            enrichment,
          }),
          {
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          },
        );
      }

      const urls = await resolveTargetUrls(req);

      const { data: latestRow } = await supabase
        .from("registry_items")
        .select("fetched_at")
        .order("fetched_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const latestFetchedAt = toTextValue(
        (latestRow as Record<string, unknown> | null)?.fetched_at,
      );
      const ageMs = latestFetchedAt
        ? Date.now() - new Date(latestFetchedAt).getTime()
        : Infinity;
      const isStale = ageMs > CACHE_TTL_SECONDS * 1000;
      let didSync = false;

      if (!isStale) {
        console.info(
          `[fetch-registry] Returning cached registry items; cache_age_ms=${ageMs}`,
        );
      } else if (urls.length > 0) {
        console.info(
          `[fetch-registry] Cache stale (age_ms=${ageMs}); running multi-registry sync for ${
            urls.join(", ")
          }`,
        );

        const freshItems: RegistryItem[] = [];
        for (const url of urls) {
          const strategies = createFallbackStrategies(url);
          let items: RegistryItem[] = [];
          let lastError: string | null = null;
          const config: ScraperConfig & { excludeStores?: string[] } = {};
          if (myRegistryScraper.matches(url)) {
            config.excludeStores = ["Crate & Barrel"];
          }
          for (const strategy of strategies) {
            try {
              items = await strategy.fetchItems(url, config);
              if (items.length > 0) {
                console.info(
                  `[fetch-registry] ${url} succeeded with ${strategy.name}`,
                );
                break;
              }
            } catch (error) {
              const message = error instanceof Error
                ? error.message
                : String(error);
              lastError = message;
              console.warn(
                `[fetch-registry] ${strategy.name} failed for ${url}: ${message}`,
              );
            }
          }
          if (items.length === 0 && lastError) {
            console.error(
              `[fetch-registry] All strategies failed for ${url}: ${lastError}`,
            );
          }
          for (const item of items) {
            freshItems.push({ ...item, registry_url: url });
          }
        }

        const existingItems = await getCachedRegistryItems(supabase);
        const existingItemsById = new Map(
          existingItems.map((item) => [item.id, item]),
        );

        const nativeRegistryUrls = new Set(urls);
        const nativeSourceKeys = new Set<string>();
        const nativeProductKeys = new Set<string>();
        const nativeImageKeys = new Set<string>();
        for (const item of freshItems) {
          const sk = normalizeProductUrlKey(item.source_product_url);
          const pk = normalizeProductUrlKey(item.product_url);
          const ik = normalizeImageUrlKey(item.image_url);
          if (sk) nativeSourceKeys.add(sk);
          if (pk) nativeProductKeys.add(pk);
          if (ik) nativeImageKeys.add(ik);
        }

        const foreignItemsToRemove = existingItems.filter((item) => {
          if (nativeRegistryUrls.has(item.registry_url ?? "")) return false;
          const sk = normalizeProductUrlKey(item.source_product_url);
          const pk = normalizeProductUrlKey(item.product_url);
          const ik = normalizeImageUrlKey(item.image_url);
          return (sk !== null && nativeSourceKeys.has(sk)) ||
            (pk !== null && nativeProductKeys.has(pk)) ||
            (ik !== null && nativeImageKeys.has(ik));
        });

        if (foreignItemsToRemove.length > 0) {
          const ids = foreignItemsToRemove.map((item) => item.id);
          const { error } = await supabase
            .from("registry_items")
            .delete()
            .in("id", ids);
          if (error) {
            throw new Error(
              `Failed to delete superseded registry items: ${error.message}`,
            );
          }
        }

        const payload = buildFastSyncPayload(freshItems, existingItemsById);
        await upsertRegistryItems(supabase, payload);

        for (const url of urls) {
          const itemsForUrl = freshItems.filter((item) =>
            item.registry_url === url
          );
          await deleteStaleRegistryItems(
            supabase,
            itemsForUrl,
            existingItems,
          );
        }

        didSync = true;
        console.info(
          `[fetch-registry] Multi-registry sync completed; deferred image enrichment to background path`,
        );
      }

      const items = await getCachedRegistryItems(supabase);
      const responseItems = items.map((item) => ({
        ...item,
        image_url: getDisplayImageUrl(item),
      }));

      return new Response(
        JSON.stringify({
          success: true,
          mode: didSync ? "fast-sync" : "cached",
          enrichment: "deferred",
          cache_age_ms: ageMs,
          items: responseItems,
        }),
        {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[fetch-registry]", message);

      // On error, try to return whatever is cached rather than an empty response
      const cachedItems = await getCachedRegistryItems(supabase).catch(
        () => [],
      );

      return new Response(
        JSON.stringify({
          success: false,
          error: message,
          items: cachedItems ?? [],
        }),
        {
          status: 200,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        },
      );
    }
  });
}
