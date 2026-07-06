import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=denonext&deps=undici@6";
import { createScraper } from "./scrapers/registry.ts";
import type { RegistryItem, SyncMeta } from "./types.ts";
import {
  DEFAULT_BACKGROUND_ENRICHMENT_LIMIT,
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

const DEFAULT_REGISTRY_URL = Deno.env.get("MYREGISTRY_URL") ??
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
    registry_url: toTextValue(record.registry_url),
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
  supabase: ReturnType<typeof createClient>,
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
  registryUrl: string,
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
      registry_url: registryUrl,
    };
  });
}

async function syncRegistryItemsFast(
  supabase: ReturnType<typeof createClient>,
  freshItems: RegistryItem[],
  registryUrl: string,
): Promise<void> {
  const existingItems = await getCachedRegistryItems(supabase);
  const existingItemsById = new Map(
    existingItems.map((item) => [item.id, item]),
  );
  const payload = buildFastSyncPayload(freshItems, existingItemsById, registryUrl);

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

  if (freshItems.length === 0) {
    await supabase.from("registry_items").delete().eq("registry_url", registryUrl);
    return;
  }

  const incomingIds = new Set(freshItems.map((item) => item.id));
  const staleIds = existingItems.filter((item) =>
    item.registry_url === registryUrl && !incomingIds.has(item.id)
  ).map((item) => item.id);
  if (staleIds.length > 0) {
    const { error } = await supabase.from("registry_items").delete().in(
      "id",
      staleIds,
    );
    if (error) {
      throw new Error(
        `Failed to delete stale registry items: ${error.message}`,
      );
    }
  }
}

async function ensureFastRegistrySyncIfStale(
  supabase: ReturnType<typeof createClient>,
  url: string,
): Promise<SyncMeta> {
  const { data: latestRow } = await supabase
    .from("registry_items")
    .select("fetched_at")
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ageMs = latestRow?.fetched_at
    ? Date.now() - new Date(latestRow.fetched_at).getTime()
    : Infinity;
  const isStale = ageMs > CACHE_TTL_SECONDS * 1000;
  if (!isStale) {
    console.info(
      `[fetch-registry] Returning cached registry items; cache_age_ms=${ageMs}`,
    );
    return { didSync: false, wasStale: false, cacheAgeMs: ageMs };
  }

  console.info(
    `[fetch-registry] Cache stale (age_ms=${ageMs}); running fast registry sync for ${url}`,
  );
  const scraper = createScraper(url);
  const freshItems = await scraper.fetchItems(url);
  await syncRegistryItemsFast(supabase, freshItems, url);
  console.info(
    `[fetch-registry] Fast registry sync completed; deferred image enrichment to background path`,
  );
  return { didSync: true, wasStale: true, cacheAgeMs: ageMs };
}

async function runBackgroundImageEnrichment(
  supabase: ReturnType<typeof createClient>,
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

async function resolveTargetUrl(req: Request): Promise<string> {
  if (req.method !== "POST") return DEFAULT_REGISTRY_URL;

  try {
    const body = await req.json();
    if (body && typeof body === "object" && typeof body.url === "string") {
      return body.url;
    }
  } catch {
    // Invalid or empty body; fall back to the default registry URL.
  }

  return DEFAULT_REGISTRY_URL;
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

    const supabase = createClient(supabaseUrl, serviceRoleKey);
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

      const url = await resolveTargetUrl(req);
      const syncMeta = await ensureFastRegistrySyncIfStale(supabase, url);
      const items = await getCachedRegistryItems(supabase);
      const responseItems = items.map((item) => ({
        ...item,
        image_url: getDisplayImageUrl(item),
      }));

      return new Response(
        JSON.stringify({
          success: true,
          mode: syncMeta.didSync ? "fast-sync" : "cached",
          enrichment: "deferred",
          cache_age_ms: syncMeta.cacheAgeMs,
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
