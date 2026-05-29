import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Default cache TTL aligns with the frontend's 10-minute refresh cadence.
const CACHE_TTL_SECONDS = parseInt(
  Deno.env.get("REGISTRY_CACHE_TTL_SECONDS") ?? "600",
  10,
);
// Cap parser input to avoid expensive regex work on unexpectedly large pages.
const MAX_PARSABLE_HTML_BYTES = 2_000_000;
// JSON-LD scripts are typically near the top of the page; scan only an initial chunk.
const JSON_LD_SCAN_BYTES = 500_000;
const CLASS_TEXT_CAPTURE_TEMPLATE =
  `<[^>]*class=["'][^"']*\\b%s\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`;
const HREF_ATTR_REGEX = /<a[^>]*href=["']([^"']+)["'][^>]*>/gi;
const ITEM_TYPE_HINTS = ["fund", "cash gift", "contribute"];
const MYREGISTRY_ORIGIN = "https://www.myregistry.com";
const MYREGISTRY_IMAGE_HOST_SUFFIXES = [
  "myregistry.com",
  "blob.core.windows.net",
];
const SOURCE_IMAGE_HINTS = [
  "source",
  "original",
  "large",
  "full",
  "zoom",
  "hires",
  "highres",
];
const THUMBNAIL_IMAGE_HINTS = ["thumb", "thumbnail", "small", "icon", "mini"];
const RETAILER_PDP_HINTS = [
  "/dp/",
  "/gp/product/",
  "/product/",
  "/products/",
  "/p/",
  "/itm/",
];
const MYREGISTRY_IMAGE_UPGRADE_CONCURRENCY = 4;
const MAX_IMAGE_ENRICHMENT_FETCH_PAGES = 5;
const MAX_IMAGE_ENRICHMENT_FOLLOW_UP_DEPTH = 2;
const MAX_RETAILER_CANDIDATES_PER_PAGE = 12;
const DEFAULT_BACKGROUND_ENRICHMENT_LIMIT = 5;
const REGISTRY_URL = Deno.env.get("MYREGISTRY_URL") ??
  "https://www.myregistry.com/giftlist/morganandkenny";

interface RegistryItem {
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
}

type SyncMeta = {
  didSync: boolean;
  wasStale: boolean;
  cacheAgeMs: number;
};

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
] as const;
const MAX_SCHEMA_COMPATIBILITY_ATTEMPTS = OPTIONAL_REGISTRY_COLUMNS.length + 1;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Recursively search for an array within a JSON object that looks like registry items.
// Returns the first array that contains objects with at least `name` and a price/id field.
function findItemsArray(obj: unknown, depth = 0): unknown[] | null {
  if (depth > 10 || obj === null || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    if (obj.length > 0) {
      const sample = obj[0];
      if (
        sample &&
        typeof sample === "object" &&
        !Array.isArray(sample) &&
        ("name" in sample || "title" in sample || "productName" in sample) &&
        ("id" in sample || "itemId" in sample || "giftItemId" in sample ||
          "productId" in sample)
      ) {
        return obj as unknown[];
      }
    }
    // Search within array elements
    for (const el of obj as unknown[]) {
      const found = findItemsArray(el, depth + 1);
      if (found) return found;
    }
    return null;
  }
  // Search object values – check shallow keys first (lower depth is better)
  const record = obj as Record<string, unknown>;
  const priorityKeys = [
    "items",
    "giftItems",
    "giftListItems",
    "products",
    "gifts",
    "registryItems",
  ];
  for (const key of priorityKeys) {
    if (key in record) {
      const found = findItemsArray(record[key], depth + 1);
      if (found) return found;
    }
  }
  for (const value of Object.values(record)) {
    const found = findItemsArray(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.]/g, "");
    const parsed = parseFloat(cleaned);
    return isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toInt(value: unknown): number | null {
  const n = toNumber(value);
  return n !== null ? Math.round(n) : null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(
      /&#(\d+);/g,
      (_full, code) => String.fromCharCode(parseInt(code, 10)),
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_full, code) => String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function stripHtml(value: string | null): string | null {
  if (!value) return null;
  const stripped = decodeHtmlEntities(value.replace(/<[^>]+>/g, " ")).replace(
    /\s+/g,
    " ",
  ).trim();
  return stripped || null;
}

function getTagText(html: string, className: string): string | null {
  const escaped = className.replace(/[|\\{}()[\]^$+*?.\-]/g, "\\$&");
  const pattern = CLASS_TEXT_CAPTURE_TEMPLATE.replace("%s", escaped);
  const match = html.match(new RegExp(pattern, "i"));
  return stripHtml(match?.[1] ?? null);
}

function getBackgroundImageUrl(html: string): string | null {
  const match = html.match(
    /background-image\s*:\s*url\((['"]?)([^'")]+)\1\)/i,
  );
  return (match?.[2] || "").trim() || null;
}

function getImageUrlFromHtml(html: string): string | null {
  // Product cards use CSS background images for the item photo and nested <img> tags for store logos.
  const backgroundImageUrl = getBackgroundImageUrl(html);
  if (backgroundImageUrl) return backgroundImageUrl;

  const imgMatch = html.match(/<img[^>]*src=["']([^"']+)["'][^>]*>/i);
  if (imgMatch?.[1]) return imgMatch[1].trim() || null;
  return null;
}

function getImageAltTextByClassName(
  html: string,
  className: string,
): string | null {
  const escaped = className.replace(/[|\\{}()[\]^$+*?.\-]/g, "\\$&");
  const containerMatch = html.match(
    new RegExp(
      `<[^>]*class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)</[^>]+>`,
      "i",
    ),
  );
  const imgAltMatch = containerMatch?.[1]?.match(
    /<img[^>]*alt=["']([^"']+)["']/i,
  );
  return stripHtml(imgAltMatch?.[1] ?? null);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getUrlSearchParamCaseInsensitive(
  url: URL,
  paramName: string,
): string | null {
  const target = paramName.toLowerCase();
  for (const [key, value] of url.searchParams.entries()) {
    if (key.toLowerCase() === target) return value;
  }
  return null;
}

function getRegistryItemIdFromUrl(value: unknown): string | null {
  const urlText = toTextValue(value);
  if (!urlText) return null;

  try {
    const url = new URL(urlText);
    return getUrlSearchParamCaseInsensitive(url, "giftid") ||
      getUrlSearchParamCaseInsensitive(url, "cashgiftid");
  } catch {
    return null;
  }
}

function getRegistryIdFromUrl(value: unknown): string | null {
  const urlText = toTextValue(value);
  if (!urlText) return null;

  try {
    const url = new URL(urlText);
    if (url.origin !== MYREGISTRY_ORIGIN) return null;
    const searchParamValue = getUrlSearchParamCaseInsensitive(
      url,
      "registryid",
    );
    if (searchParamValue) return searchParamValue;
    const pathSegments = url.pathname.split("/").filter(Boolean);
    for (
      let segmentIndex = pathSegments.length - 1;
      segmentIndex >= 0;
      segmentIndex -= 1
    ) {
      if (/^\d+$/.test(pathSegments[segmentIndex])) {
        return pathSegments[segmentIndex];
      }
    }
  } catch {
    return null;
  }
  return null;
}

function getRegistryPageIdFromHtml(html: string): string | null {
  const registryIdMatch = html.match(/[?&]registryId=(\d+)/i);
  return registryIdMatch?.[1] ?? null;
}

function buildMyRegistryFlowUrl(
  itemType: "product" | "fund",
  registryId: string | null,
  itemId: string | null,
): string | null {
  if (!registryId || !itemId) return null;
  const path = itemType === "fund"
    ? "/Visitors/Giftlist/CashGiftProcess.aspx"
    : "/Visitors/Giftlist/PurchaseAssistant.aspx";
  const itemKey = itemType === "fund" ? "cashGiftId" : "giftId";
  const url = new URL(path, MYREGISTRY_ORIGIN);
  url.searchParams.set(itemKey, itemId);
  url.searchParams.set("registryId", registryId);
  return url.toString();
}

function isMyRegistryFlowUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === MYREGISTRY_ORIGIN &&
      /\/Visitors\/Giftlist\/(?:PurchaseAssistant|CashGiftProcess)\.aspx$/i
        .test(url.pathname);
  } catch {
    return false;
  }
}

function isMyRegistryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === MYREGISTRY_ORIGIN;
  } catch {
    return false;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeHttpUrlCandidate(
  value: string,
  baseUrl: string,
): string | null {
  const trimmed = value.trim();
  if (
    !trimmed || trimmed === "#" ||
    /^(javascript|data|vbscript|file):/i.test(trimmed)
  ) return null;
  try {
    const url = new URL(trimmed, baseUrl);
    return isHttpUrl(url.toString()) ? url.toString() : null;
  } catch {
    return null;
  }
}

function extractEmbeddedUrlCandidates(value: string): string[] {
  try {
    const url = new URL(value);
    const embeddedCandidates: string[] = [];
    for (const [key, paramValue] of url.searchParams.entries()) {
      if (!/(url|target|redirect|dest|retailer|product|item|link)/i.test(key)) {
        continue;
      }
      const normalizedValue = paramValue.trim();
      if (!normalizedValue) continue;
      if (isHttpUrl(normalizedValue)) embeddedCandidates.push(normalizedValue);
    }
    return embeddedCandidates;
  } catch {
    return [];
  }
}

function collectProductUrlCandidates(raw: Record<string, unknown>): string[] {
  const candidates = [
    raw.productUrl,
    raw.product_url,
    raw.purchaseUrl,
    raw.url,
    raw.link,
    raw.itemUrl,
  ]
    .map(toTextValue)
    .filter((value): value is string => Boolean(value) && isHttpUrl(value));
  return [...new Set(candidates)];
}

function resolveRegistryProductUrls(
  raw: Record<string, unknown>,
  itemType: "product" | "fund",
): { productUrl: string | null; sourceProductUrl: string | null } {
  const urlCandidates = collectProductUrlCandidates(raw);

  const flowUrl = urlCandidates.find(isMyRegistryFlowUrl);
  const sourceUrlCandidates = [
    raw.sourceProductUrl,
    raw.source_product_url,
    raw.retailerUrl,
    raw.retailer_url,
    ...urlCandidates,
  ]
    .map(toTextValue)
    .filter((value): value is string => Boolean(value) && isHttpUrl(value))
    .flatMap((value) => [value, ...extractEmbeddedUrlCandidates(value)]);
  const uniqueSourceUrlCandidates = [...new Set(sourceUrlCandidates)];

  let productUrl: string | null = null;
  if (flowUrl) {
    const registryId = getRegistryIdFromUrl(flowUrl);
    const itemId = getRegistryItemIdFromUrl(flowUrl);
    productUrl = buildMyRegistryFlowUrl(itemType, registryId, itemId) ??
      flowUrl;
  }
  if (!productUrl) {
    let registryId = toTextValue(raw.registryId ?? raw.registry_id) || null;
    if (!registryId) {
      for (const urlCandidate of urlCandidates) {
        registryId = getRegistryIdFromUrl(urlCandidate);
        if (registryId) break;
      }
    }
    const itemId = itemType === "fund"
      ? toTextValue(raw.cashGiftId ?? raw.cashgiftid ?? raw.id)
      : toTextValue(raw.giftId ?? raw.giftid ?? raw.id);
    productUrl = buildMyRegistryFlowUrl(itemType, registryId, itemId) ??
      urlCandidates[0] ?? null;
  }

  const sourceProductUrl =
    uniqueSourceUrlCandidates.find((candidate) =>
      candidate !== productUrl && !isMyRegistryFlowUrl(candidate)
    ) ?? null;

  return { productUrl, sourceProductUrl };
}

function getHrefCandidates(html: string, baseUrl: string): string[] {
  const hrefs: string[] = [];
  for (const match of html.matchAll(HREF_ATTR_REGEX)) {
    const normalized = normalizeHttpUrlCandidate(match[1] ?? "", baseUrl);
    if (normalized) hrefs.push(normalized);
  }
  return hrefs;
}

function collectRetailerPageCandidatesFromHtml(
  html: string,
  pageUrl: string,
): string[] {
  const candidates: string[] = [];
  const addCandidate = (value: string | null) => {
    if (!value) return;
    const normalized = normalizeHttpUrlCandidate(value, pageUrl);
    if (normalized) candidates.push(normalized);
  };

  const canonicalRegex =
    /<link[^>]+rel=["'][^"']*\bcanonical\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(canonicalRegex)) addCandidate(match[1]);

  const ogUrlRegex =
    /<meta[^>]+property=["']og:url["'][^>]*content=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(ogUrlRegex)) addCandidate(match[1]);

  const hrefCandidates = getHrefCandidates(html, pageUrl);
  for (const href of hrefCandidates) {
    addCandidate(href);
    for (const embedded of extractEmbeddedUrlCandidates(href)) {
      addCandidate(embedded);
    }
  }

  const unique = [...new Set(candidates)];
  unique.sort((left, right) => {
    const leftRank = isMyRegistryUrl(left) ? 1 : 0;
    const rightRank = isMyRegistryUrl(right) ? 1 : 0;
    return leftRank - rightRank;
  });
  return unique;
}

function inferItemType(raw: Record<string, unknown>): "product" | "fund" {
  const explicit = String(raw.item_type ?? raw.itemType ?? raw.type ?? "")
    .toLowerCase();
  const hints = [
    explicit,
    String(raw.action_label ?? raw.actionLabel ?? "").toLowerCase(),
    String(raw.category ?? "").toLowerCase(),
    String(raw.storeName ?? raw.store_name ?? "").toLowerCase(),
    String(raw.name ?? raw.title ?? "").toLowerCase(),
  ];
  if ("cashgiftid" in raw || "cashGiftId" in raw) return "fund";
  if (
    hints.some((value) => ITEM_TYPE_HINTS.some((hint) => value.includes(hint)))
  ) {
    return "fund";
  }
  return "product";
}

function isMyRegistryImageHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return MYREGISTRY_IMAGE_HOST_SUFFIXES.some((suffix) =>
    lower === suffix || lower.endsWith(`.${suffix}`)
  );
}

function isProbablyImageUrl(value: string): boolean {
  const lower = value.toLowerCase();
  if (/\.(avif|bmp|gif|heic|jpeg|jpg|png|svg|webp)(?:[?#]|$)/i.test(lower)) {
    return true;
  }
  return lower.includes("/image") || lower.includes("giftimages");
}

function getHostName(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLikelyRetailerPdpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const lowerPath = url.pathname.toLowerCase();
    if (RETAILER_PDP_HINTS.some((hint) => lowerPath.includes(hint))) {
      return true;
    }
    return /(asin|sku|item|product(?:id)?|pid)/i.test(url.search);
  } catch {
    return false;
  }
}

function scoreRetailerPageCandidate(
  value: string,
  preferredHost: string | null,
): number {
  let score = 0;
  if (!isMyRegistryUrl(value)) score += 40;
  if (isLikelyRetailerPdpUrl(value)) score += 50;
  const host = getHostName(value);
  if (preferredHost && host === preferredHost) score += 30;
  if (/redirect|signin|login|account|wishlist|cart|search|\/s\//i.test(value)) {
    score -= 20;
  }
  if (isMyRegistryFlowUrl(value)) score -= 100;
  return score;
}

function prioritizeRetailerPageCandidates(
  candidates: string[],
  preferredHost: string | null,
  excluded: Set<string>,
): string[] {
  const unique = [...new Set(candidates)].filter((candidate) =>
    !excluded.has(candidate)
  );
  unique.sort((left, right) =>
    scoreRetailerPageCandidate(right, preferredHost) -
    scoreRetailerPageCandidate(left, preferredHost)
  );
  return unique.slice(0, MAX_RETAILER_CANDIDATES_PER_PAGE);
}

function scoreImageUrlCandidate(value: string): number {
  let score = 0;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const urlText = `${host}${url.pathname}${url.search}`.toLowerCase();
    if (url.protocol === "https:") score += 5;
    if (!isMyRegistryImageHost(host)) score += 50;
    if (SOURCE_IMAGE_HINTS.some((hint) => urlText.includes(hint))) score += 20;
    if (THUMBNAIL_IMAGE_HINTS.some((hint) => urlText.includes(hint))) {
      score -= 35;
    }
    if (url.pathname.toLowerCase().includes("_large")) score += 15;
  } catch {
    score -= 100;
  }
  return score;
}

function normalizeImageIdentity(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.hostname.toLowerCase()}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function isDuplicateImageCandidate(
  value: string,
  currentImageUrl: string | null,
): boolean {
  if (!currentImageUrl) return false;
  const candidateIdentity = normalizeImageIdentity(value);
  const currentIdentity = normalizeImageIdentity(currentImageUrl);
  if (!candidateIdentity || !currentIdentity) return value === currentImageUrl;
  return candidateIdentity === currentIdentity;
}

function scoreImageSelectionCandidate(
  value: string,
  currentImageUrl: string | null,
  seenImageIdentities: Set<string>,
): number {
  let score = scoreImageUrlCandidate(value);
  if (isDuplicateImageCandidate(value, currentImageUrl)) score -= 80;
  const identity = normalizeImageIdentity(value);
  if (identity && seenImageIdentities.has(identity)) score -= 25;
  return score;
}

function collectImageCandidates(raw: Record<string, unknown>): string[] {
  const candidates: string[] = [];
  const addCandidate = (value: unknown) => {
    const text = toTextValue(value);
    if (!text) return;
    const trimmed = text.trim();
    if (!trimmed || /^(javascript|data|vbscript|file):/i.test(trimmed)) return;
    if (!isProbablyImageUrl(trimmed)) return;
    candidates.push(trimmed);
  };

  addCandidate(raw.sourceImageUrl ?? raw.source_image_url);
  addCandidate(raw.originalImageUrl ?? raw.original_image_url);
  addCandidate(raw.primaryImageUrl ?? raw.primary_image_url);
  addCandidate(raw.productImageUrl ?? raw.product_image_url);
  addCandidate(raw.imageUrl ?? raw.image_url ?? raw.image ?? raw.imgUrl);
  addCandidate(raw.thumbnailUrl ?? raw.thumbnail_url ?? raw.thumbnail);

  const scanForNestedImages = (node: unknown, depth = 0) => {
    if (depth > 2 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) {
        scanForNestedImages(child, depth + 1);
      }
      return;
    }
    for (
      const [key, value] of Object.entries(node as Record<string, unknown>)
    ) {
      if (/(image|img|photo|thumbnail|thumb)/i.test(key)) {
        if (typeof value === "string") {
          addCandidate(value);
        } else if (Array.isArray(value)) {
          for (const entry of value) addCandidate(entry);
        }
      }
      if (value && typeof value === "object") {
        scanForNestedImages(value, depth + 1);
      }
    }
  };
  scanForNestedImages(raw);

  const uniqueCandidates = [...new Set(candidates)];
  uniqueCandidates.sort((left, right) =>
    scoreImageUrlCandidate(right) - scoreImageUrlCandidate(left)
  );
  return uniqueCandidates;
}

function resolveBestImageUrl(raw: Record<string, unknown>): string | null {
  return collectImageCandidates(raw)[0] ?? null;
}

function isMyRegistryHostedImage(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return isMyRegistryImageHost(new URL(value).hostname);
  } catch {
    return true;
  }
}

function isLowQualityImageUrl(value: string | null | undefined): boolean {
  if (!value) return true;
  const lower = value.toLowerCase();
  if (THUMBNAIL_IMAGE_HINTS.some((hint) => lower.includes(hint))) return true;
  const tinySizeMatch = lower.match(
    /(?:[?&](?:w|width|h|height)=)(\d{1,3})(?:[&#]|$)/,
  );
  if (tinySizeMatch) {
    const size = parseInt(tinySizeMatch[1], 10);
    if (Number.isFinite(size) && size <= 160) return true;
  }
  return false;
}

function getDisplayImageUrl(item: RegistryItem): string | null {
  return item.resolved_image_url ?? item.registry_image_url ?? item.image_url ??
    null;
}

function buildSuspiciousImageIdentitySet(items: RegistryItem[]): Set<string> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const identity = normalizeImageIdentity(
      item.resolved_image_url ?? item.image_url ?? null,
    );
    if (!identity) continue;
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  return new Set(
    Array.from(counts.entries()).filter(([, count]) => count > 1).map((
      [identity],
    ) => identity),
  );
}

function hasGoodResolvedImage(
  item: RegistryItem,
  suspiciousImageIdentities: Set<string>,
): boolean {
  const resolvedImage = item.resolved_image_url ?? null;
  if (!resolvedImage) return false;
  if (
    item.image_marked_for_retry || item.image_manually_cleared ||
    item.image_blacklisted
  ) return false;
  if (item.image_suspicious || item.image_low_confidence) return false;
  if (
    isMyRegistryHostedImage(resolvedImage) ||
    isLowQualityImageUrl(resolvedImage)
  ) return false;
  const identity = normalizeImageIdentity(resolvedImage);
  if (identity && suspiciousImageIdentities.has(identity)) return false;
  return true;
}

function shouldAttemptMyRegistryImageUpgrade(
  item: RegistryItem,
  suspiciousImageIdentities: Set<string> = new Set(),
): boolean {
  if (item.item_type === "fund") return false;
  const enrichmentUrls = [item.source_product_url, item.product_url]
    .filter((value): value is string => Boolean(value) && isHttpUrl(value));
  if (enrichmentUrls.length === 0) return false;
  if (hasGoodResolvedImage(item, suspiciousImageIdentities)) return false;
  return true;
}

function scoreBackgroundEnrichmentPriority(
  item: RegistryItem,
  suspiciousImageIdentities: Set<string>,
): number {
  let score = 0;
  const resolvedImage = item.resolved_image_url ?? null;
  const displayImage = getDisplayImageUrl(item);
  if (!resolvedImage) score += 1_000;
  if (
    item.image_marked_for_retry || item.image_manually_cleared ||
    item.image_blacklisted
  ) score += 400;
  if (item.image_suspicious || item.image_low_confidence) score += 300;
  if (displayImage && isMyRegistryHostedImage(displayImage)) score += 250;
  if (resolvedImage && isMyRegistryHostedImage(resolvedImage)) score += 250;
  if (isLowQualityImageUrl(displayImage)) score += 100;
  const resolvedIdentity = normalizeImageIdentity(resolvedImage);
  if (resolvedIdentity && suspiciousImageIdentities.has(resolvedIdentity)) {
    score += 200;
  }
  return score;
}

function selectBackgroundEnrichmentCandidates(
  items: RegistryItem[],
  limit: number,
): {
  totalEligible: number;
  skippedAlreadyGood: number;
  candidates: Array<{ item: RegistryItem; index: number }>;
} {
  const suspiciousImageIdentities = buildSuspiciousImageIdentitySet(items);
  const normalizedLimit = Number.isFinite(limit) && limit > 0
    ? Math.floor(limit)
    : DEFAULT_BACKGROUND_ENRICHMENT_LIMIT;
  const rankedCandidates: Array<
    { item: RegistryItem; index: number; score: number }
  > = [];
  let skippedAlreadyGood = 0;

  for (const [index, item] of items.entries()) {
    const enrichmentUrls = [item.source_product_url, item.product_url]
      .filter((value): value is string => Boolean(value) && isHttpUrl(value));
    if (item.item_type === "fund" || enrichmentUrls.length === 0) continue;
    if (hasGoodResolvedImage(item, suspiciousImageIdentities)) {
      skippedAlreadyGood += 1;
      continue;
    }
    rankedCandidates.push({
      item,
      index,
      score: scoreBackgroundEnrichmentPriority(item, suspiciousImageIdentities),
    });
  }

  rankedCandidates.sort((left, right) =>
    right.score - left.score || left.index - right.index
  );
  return {
    totalEligible: rankedCandidates.length,
    skippedAlreadyGood,
    candidates: rankedCandidates.slice(0, normalizedLimit).map((
      { item, index },
    ) => ({ item, index })),
  };
}

function parseBackgroundEnrichmentLimit(requestUrl: URL): number {
  const rawLimit = requestUrl.searchParams.get("limit");
  if (!rawLimit) return DEFAULT_BACKGROUND_ENRICHMENT_LIMIT;
  const parsed = parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_BACKGROUND_ENRICHMENT_LIMIT;
  }
  return parsed;
}

function collectImageCandidatesFromHtml(
  html: string,
  baseUrl: string,
): string[] {
  const candidates: string[] = [];
  const addCandidate = (value: unknown) => {
    const text = toTextValue(value);
    if (!text) return;
    const trimmed = decodeHtmlEntities(text).trim();
    if (!trimmed || /^(javascript|data|vbscript|file):/i.test(trimmed)) return;
    try {
      const resolved = new URL(trimmed, baseUrl).toString();
      if (isProbablyImageUrl(resolved)) candidates.push(resolved);
    } catch {
      // Ignore malformed URLs extracted from page markup.
    }
  };

  const metaRegex =
    /<meta[^>]+(?:property|name|itemprop)=["'](?:og:image|twitter:image|image)["'][^>]*content=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(metaRegex)) addCandidate(match[1]);

  const getBestSrcsetCandidate = (srcsetValue: string): string | null => {
    const entries = srcsetValue.split(",").map((entry) => entry.trim()).filter(
      Boolean,
    );
    let bestUrl: string | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const entry of entries) {
      const [candidateUrl, descriptor] = entry.split(/\s+/, 2);
      if (!candidateUrl) continue;
      let descriptorScore = 0;
      if (descriptor?.endsWith("w")) {
        const width = parseInt(descriptor.slice(0, -1), 10);
        if (Number.isFinite(width)) descriptorScore = width;
      } else if (descriptor?.endsWith("x")) {
        const multiplier = parseFloat(descriptor.slice(0, -1));
        if (Number.isFinite(multiplier)) {
          descriptorScore = Math.round(multiplier * 1000);
        }
      }
      if (descriptorScore >= bestScore) {
        bestScore = descriptorScore;
        bestUrl = candidateUrl;
      }
    }

    return bestUrl;
  };

  const attrRegex =
    /<(?:img|source|a)[^>]*\b(src|srcset|data-src|data-srcset|data-original|data-image|data-zoom-image|href)=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(attrRegex)) {
    const attributeName = String(match[1] ?? "").toLowerCase();
    const attributeValue = String(match[2] ?? "");
    if (attributeName.includes("srcset")) {
      const srcsetCandidate = getBestSrcsetCandidate(attributeValue);
      addCandidate(srcsetCandidate ?? attributeValue);
      continue;
    }
    addCandidate(attributeValue);
  }

  const backgroundImageRegex =
    /background-image\s*:\s*url\((['"]?)([^'")]+)\1\)/gi;
  for (const match of html.matchAll(backgroundImageRegex)) {
    addCandidate(match[2]);
  }

  const unique = [...new Set(candidates)];
  unique.sort((left, right) =>
    scoreImageUrlCandidate(right) - scoreImageUrlCandidate(left)
  );
  return unique;
}

async function fetchBestImageFromMyRegistryFlowUrl(
  pageUrl: string,
  currentImageUrl: string | null,
): Promise<string | null> {
  const sourceHost = getHostName(pageUrl);
  const preferredHost = sourceHost && !isMyRegistryUrl(pageUrl)
    ? sourceHost
    : null;
  const attemptedUrls: string[] = [];
  const queuedUrls = new Set<string>([pageUrl]);
  const visitedUrls = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{
    url: pageUrl,
    depth: 0,
  }];
  const imageCandidates: string[] = [];

  while (
    queue.length > 0 && visitedUrls.size < MAX_IMAGE_ENRICHMENT_FETCH_PAGES
  ) {
    const current = queue.shift();
    if (!current) break;
    if (visitedUrls.has(current.url)) continue;
    visitedUrls.add(current.url);
    attemptedUrls.push(current.url);

    try {
      const response = await fetch(current.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      });
      if (!response.ok) continue;
      const finalUrl = response.url || current.url;
      queuedUrls.add(finalUrl);
      const html = await response.text();
      const parsedHtml = html.length > MAX_PARSABLE_HTML_BYTES
        ? html.slice(0, MAX_PARSABLE_HTML_BYTES)
        : html;

      imageCandidates.push(
        ...collectImageCandidatesFromHtml(parsedHtml, finalUrl),
      );

      if (current.depth >= MAX_IMAGE_ENRICHMENT_FOLLOW_UP_DEPTH) continue;
      const followUpCandidates = prioritizeRetailerPageCandidates(
        collectRetailerPageCandidatesFromHtml(parsedHtml, finalUrl).filter(
          (candidate) => !isMyRegistryFlowUrl(candidate),
        ),
        preferredHost,
        queuedUrls,
      );
      for (const candidate of followUpCandidates) {
        if (queuedUrls.has(candidate)) continue;
        queuedUrls.add(candidate);
        queue.push({ url: candidate, depth: current.depth + 1 });
        if (queuedUrls.size >= MAX_IMAGE_ENRICHMENT_FETCH_PAGES + 1) break;
      }
    } catch {
      // Preserve existing behavior when optional follow-up fetch fails.
    }
  }

  const uniqueImageCandidates = [...new Set(imageCandidates)];
  const seenImageIdentities = new Set<string>();
  let bestLinkedImage: string | null = null;
  let bestLinkedScore = Number.NEGATIVE_INFINITY;
  for (const candidate of uniqueImageCandidates) {
    const score = scoreImageSelectionCandidate(
      candidate,
      currentImageUrl,
      seenImageIdentities,
    );
    const identity = normalizeImageIdentity(candidate);
    if (identity) seenImageIdentities.add(identity);
    if (score > bestLinkedScore) {
      bestLinkedScore = score;
      bestLinkedImage = candidate;
    }
  }

  if (!bestLinkedImage) {
    console.info(`[fetch-registry] Image enrichment trace ${
      JSON.stringify({
        startUrl: pageUrl,
        attemptedUrls,
        candidateCount: 0,
        selectedImage: null,
        reason: "no-candidates",
      })
    }`);
    return null;
  }
  const currentScore = currentImageUrl
    ? scoreImageUrlCandidate(currentImageUrl)
    : Number.NEGATIVE_INFINITY;
  const selectedImage = bestLinkedScore > currentScore ? bestLinkedImage : null;
  console.info(`[fetch-registry] Image enrichment trace ${
    JSON.stringify({
      startUrl: pageUrl,
      attemptedUrls,
      candidateCount: uniqueImageCandidates.length,
      bestCandidate: bestLinkedImage,
      bestCandidateScore: bestLinkedScore,
      currentScore,
      selectedImage,
      reason: selectedImage ? "selected" : "not-better-than-current",
    })
  }`);
  return selectedImage;
}

async function upgradeImagesFromMyRegistryLinks(
  items: RegistryItem[],
): Promise<RegistryItem[]> {
  const upgradedItems = [...items];
  let upgradeCount = 0;
  const suspiciousImageIdentities = buildSuspiciousImageIdentitySet(items);
  const candidates = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) =>
      shouldAttemptMyRegistryImageUpgrade(item, suspiciousImageIdentities)
    );

  for (
    let start = 0;
    start < candidates.length;
    start += MYREGISTRY_IMAGE_UPGRADE_CONCURRENCY
  ) {
    const batch = candidates.slice(
      start,
      start + MYREGISTRY_IMAGE_UPGRADE_CONCURRENCY,
    );
    await Promise.all(batch.map(async ({ item, index }) => {
      try {
        const enrichmentUrls = [item.source_product_url, item.product_url]
          .filter((value): value is string =>
            Boolean(value) && isHttpUrl(value)
          );
        let upgradedImageUrl: string | null = null;
        for (const enrichmentUrl of enrichmentUrls) {
          upgradedImageUrl = await fetchBestImageFromMyRegistryFlowUrl(
            enrichmentUrl,
            item.resolved_image_url ?? item.registry_image_url ??
              item.image_url,
          );
          if (upgradedImageUrl) break;
        }
        if (!upgradedImageUrl) return;
        upgradedItems[index] = {
          ...item,
          resolved_image_url: upgradedImageUrl,
          image_url: upgradedImageUrl,
          image_marked_for_retry: false,
          image_manually_cleared: false,
          image_blacklisted: false,
          image_suspicious: false,
          image_low_confidence: isLowQualityImageUrl(upgradedImageUrl),
        };
        upgradeCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[fetch-registry] Failed to enrich image for ${item.id}: ${message}`,
        );
      }
    }));
  }

  if (upgradeCount > 0) {
    console.info(
      `[fetch-registry] Upgraded ${upgradeCount} item image(s) using direct-first URL enrichment.`,
    );
  }
  return upgradedItems;
}

function normalizeItem(
  raw: Record<string, unknown>,
  fetchedAt: string,
): RegistryItem | null {
  const id = String(
    raw.id ??
      raw.itemId ??
      raw.giftItemId ??
      raw.productId ??
      raw.registryItemId ??
      getRegistryItemIdFromUrl(raw.productUrl) ??
      getRegistryItemIdFromUrl(raw.product_url) ??
      getRegistryItemIdFromUrl(raw.url) ??
      getRegistryItemIdFromUrl(raw.purchaseUrl) ??
      "",
  );
  const name = String(
    raw.name ?? raw.title ?? raw.productName ?? raw.itemName ?? "",
  ).trim();

  if (!id || !name) return null;

  const itemType = inferItemType(raw);
  const quantityRequested = toInt(
    raw.quantityRequested ?? raw.quantity_requested ?? raw.qtyRequested ??
      raw.quantity ?? raw.qty,
  );
  const quantityPurchased = toInt(
    raw.quantityPurchased ??
      raw.quantity_purchased ??
      raw.qtyFulfilled ??
      raw.purchased ??
      raw.fulfilled ??
      raw.qtyReceived,
  );

  let isPurchased = Boolean(
    raw.isPurchased ?? raw.is_purchased ?? raw.isFulfilled ?? raw.fulfilled ??
      false,
  );
  if (
    !isPurchased && quantityRequested !== null && quantityPurchased !== null &&
    quantityRequested > 0
  ) {
    isPurchased = quantityPurchased >= quantityRequested;
  }

  const imageUrl = resolveBestImageUrl(raw);
  const registryImageUrl = toTextValue(raw.registry_image_url) ?? imageUrl;
  const resolvedImageUrl = toTextValue(raw.resolved_image_url);
  const displayImageUrl = resolvedImageUrl ?? registryImageUrl ?? imageUrl;

  const rawActionLabel =
    String(raw.action_label ?? raw.actionLabel ?? "").trim() || null;
  const { productUrl, sourceProductUrl } = resolveRegistryProductUrls(
    raw,
    itemType,
  );

  return {
    id,
    name,
    description:
      String(raw.description ?? raw.notes ?? raw.itemDescription ?? "")
        .trim() || null,
    price: toNumber(
      raw.price ?? raw.priceAmount ?? raw.currentPrice ?? raw.retailPrice,
    ),
    quantity_requested: quantityRequested,
    quantity_purchased: quantityPurchased,
    image_url: displayImageUrl,
    registry_image_url: registryImageUrl,
    resolved_image_url: resolvedImageUrl,
    store_name: String(
      raw.storeName ?? raw.store_name ?? raw.retailer ?? raw.store ??
        raw.retailerName ?? "",
    ).trim() ||
      null,
    product_url: productUrl,
    source_product_url: sourceProductUrl,
    category:
      String(raw.category ?? raw.categoryName ?? raw.department ?? "").trim() ||
      null,
    is_purchased: isPurchased,
    fetched_at: fetchedAt,
    item_type: itemType,
    action_label: itemType === "fund" ? rawActionLabel ?? "Contribute" : null,
    image_marked_for_retry: Boolean(raw.image_marked_for_retry),
    image_manually_cleared: Boolean(raw.image_manually_cleared),
    image_blacklisted: Boolean(raw.image_blacklisted),
    image_suspicious: Boolean(raw.image_suspicious),
    image_low_confidence: Boolean(raw.image_low_confidence),
  };
}

function normalizeItems(
  rawItems: Record<string, unknown>[],
  fetchedAt: string,
): RegistryItem[] {
  const items: RegistryItem[] = [];
  for (const raw of rawItems) {
    const normalized = normalizeItem(raw, fetchedAt);
    if (normalized) items.push(normalized);
  }
  return items;
}

function parseItemsFromNextData(
  html: string,
  fetchedAt: string,
  registryId: string | null,
): RegistryItem[] {
  const nextDataMatch = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!nextDataMatch) return [];

  let nextData: unknown;
  try {
    nextData = JSON.parse(nextDataMatch[1]);
  } catch (error) {
    const parseMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse __NEXT_DATA__ JSON from MyRegistry page: ${parseMessage}`,
    );
  }

  const rawItems = findItemsArray(nextData);
  if (!rawItems || rawItems.length === 0) return [];
  return normalizeItems(
    (rawItems as Record<string, unknown>[]).map((item) => ({
      ...item,
      registryId,
    })),
    fetchedAt,
  );
}

function toTextValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function normalizeCachedItems(
  rawItems: unknown[] | null | undefined,
): RegistryItem[] {
  if (!Array.isArray(rawItems)) return [];

  const items: RegistryItem[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const fetchedAt =
      toTextValue((raw as Record<string, unknown>).fetched_at) ??
        new Date().toISOString();
    const normalized = normalizeItem(raw as Record<string, unknown>, fetchedAt);
    if (normalized) items.push(normalized);
  }
  return items;
}

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

function parseItemsFromJsonLd(
  html: string,
  fetchedAt: string,
  registryId: string | null,
): RegistryItem[] {
  const items: Record<string, unknown>[] = [];
  const htmlChunk = html.slice(0, JSON_LD_SCAN_BYTES);
  const matches = [
    ...htmlChunk.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  let generatedId = 0;

  const collectNodes = (node: unknown, output: unknown[]) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) collectNodes(child, output);
      return;
    }
    const record = node as Record<string, unknown>;
    const list = record.itemListElement;
    if (Array.isArray(list)) output.push(...list);
    for (const value of Object.values(record)) {
      if (value && typeof value === "object") collectNodes(value, output);
    }
  };

  for (const match of matches) {
    let parsed: unknown;
    try {
      parsed = JSON.parse((match[1] || "").trim());
    } catch {
      continue;
    }
    const itemListElements: unknown[] = [];
    collectNodes(parsed, itemListElements);
    for (const entry of itemListElements) {
      if (!entry || typeof entry !== "object") continue;
      const entryRecord = entry as Record<string, unknown>;
      const node = asRecord(entryRecord.item) ?? entryRecord;
      const itemOffered = asRecord(node.itemOffered) ?? {};
      const offers = asRecord(node.offers) ?? asRecord(itemOffered.offers) ??
        {};
      const seller = asRecord(offers.seller) ?? {};
      const eligibleQuantity = asRecord(node.eligibleQuantity) ?? {};
      const imageSource = itemOffered.image ?? node.image;
      const imageValue = Array.isArray(imageSource)
        ? imageSource[0]
        : imageSource;
      generatedId += 1;
      const fallbackId = `jsonld-${generatedId}`;
      const inferredType = inferItemType({
        ...node,
        ...itemOffered,
        category: node.category,
      });
      items.push({
        id: toTextValue(
          node.identifier ??
            itemOffered.identifier ??
            node.sku ??
            itemOffered.sku ??
            getRegistryItemIdFromUrl(offers.url) ??
            getRegistryItemIdFromUrl(node.url) ??
            node["@id"] ??
            node.url,
        ) ?? fallbackId,
        name: toTextValue(node.name ?? itemOffered.name) ??
          toTextValue(entryRecord.name) ?? "",
        description: toTextValue(node.description ?? entryRecord.description),
        price: offers.price ?? offers.lowPrice ?? offers.highPrice ??
          itemOffered.price ?? node.price,
        quantityRequested: eligibleQuantity.maxValue ?? null,
        quantityPurchased: eligibleQuantity.value ?? null,
        imageUrl: toTextValue(imageValue),
        // Preserve both URLs: keep CTA behavior on MyRegistry flow while retaining a
        // direct source URL for image enrichment quality.
        productUrl: toTextValue(node.url ?? offers.url),
        sourceProductUrl: toTextValue(offers.url ?? node.url),
        storeName: toTextValue(seller.name),
        category: toTextValue(node.category ?? itemOffered.category),
        registryId,
        item_type: inferredType,
        action_label: inferredType === "fund" ? "Contribute" : null,
      });
    }
  }
  return normalizeItems(items, fetchedAt);
}

function parseItemsFromHtmlMarkup(
  html: string,
  fetchedAt: string,
  registryId: string | null,
): RegistryItem[] {
  const openTagRegex =
    /<div[^>]*class=["'][^"']*\bitemGiftVisitorList\b[^"']*["'][^>]*>/gi;
  const matches = [...html.matchAll(openTagRegex)];
  const rawItems: Record<string, unknown>[] = [];

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const blockStart = current.index ?? 0;
    const blockEnd = i + 1 < matches.length
      ? (matches[i + 1].index ?? html.length)
      : html.length;
    const block = html.slice(blockStart, blockEnd);
    const openingTag = current[0];
    const giftId = openingTag.match(/\bgiftid=["']?([^"'\s>]+)["']?/i)?.[1] ||
      null;
    const cashGiftId =
      openingTag.match(/\bcashgiftid=["']?([^"'\s>]+)["']?/i)?.[1] || null;
    const isFund = /\bcashgift\b/i.test(openingTag) || Boolean(cashGiftId);
    const id = cashGiftId || giftId;
    const name = getTagText(block, "gift-title");
    if (!id || !name) continue;

    const actionLabel = getTagText(block, "btnGiveCash") ??
      getTagText(block, "btn-give-cash") ?? null;
    const storeName = getTagText(block, "gift-store") ??
      getImageAltTextByClassName(block, "gift-websitelogo");
    const priceText = getTagText(block, "gift-price");
    const desiredQtyText = getTagText(block, "desiredQty");
    const receivedQtyText = getTagText(block, "receivedQty");
    const hrefCandidates = getHrefCandidates(block, MYREGISTRY_ORIGIN);
    const sourceHrefCandidates = hrefCandidates.flatMap(
      (href) => [href, ...extractEmbeddedUrlCandidates(href)],
    );
    const productUrl = hrefCandidates.find(isMyRegistryFlowUrl) ??
      hrefCandidates[0] ?? null;
    const sourceProductUrl = sourceHrefCandidates.find((candidate) =>
      candidate !== productUrl && !isMyRegistryFlowUrl(candidate)
    ) ?? null;
    const rawItem: Record<string, unknown> = {
      id,
      name,
      description: getTagText(block, "gift-description"),
      price: priceText,
      quantityRequested: desiredQtyText,
      quantityPurchased: receivedQtyText,
      imageUrl: getImageUrlFromHtml(block),
      storeName,
      productUrl,
      sourceProductUrl,
      category: getTagText(block, "gift-category"),
      isPurchased: /\bpurchased\b/i.test(block) &&
        !/\bnot purchased\b/i.test(block),
      registryId,
      item_type: isFund ? "fund" : null,
      action_label: actionLabel,
      cashgiftid: cashGiftId,
    };
    const inferredType = inferItemType(rawItem);
    rawItem.item_type = inferredType;
    if (inferredType === "fund" && !rawItem.action_label) {
      rawItem.action_label = "Contribute";
    }
    rawItems.push(rawItem);
  }

  return normalizeItems(rawItems, fetchedAt);
}

function mergeRegistryItems(
  primaryItems: RegistryItem[],
  fallbackItems: RegistryItem[],
): RegistryItem[] {
  const merged = new Map<string, RegistryItem>();

  for (const item of primaryItems) {
    merged.set(item.id, item);
  }

  for (const fallback of fallbackItems) {
    const current = merged.get(fallback.id);
    if (!current) {
      merged.set(fallback.id, fallback);
      continue;
    }

    const itemType = current.item_type ?? fallback.item_type;
    const actionLabel = itemType === "fund"
      ? current.action_label ?? fallback.action_label ?? "Contribute"
      : null;

    merged.set(fallback.id, {
      id: current.id,
      name: current.name ?? fallback.name,
      description: current.description ?? fallback.description,
      price: current.price ?? fallback.price,
      quantity_requested: current.quantity_requested ??
        fallback.quantity_requested,
      quantity_purchased: current.quantity_purchased ??
        fallback.quantity_purchased,
      image_url: getDisplayImageUrl(current) ?? getDisplayImageUrl(fallback),
      registry_image_url: current.registry_image_url ??
        fallback.registry_image_url ?? current.image_url ?? fallback.image_url,
      resolved_image_url: current.resolved_image_url ??
        fallback.resolved_image_url ?? null,
      store_name: current.store_name ?? fallback.store_name,
      product_url: current.product_url ?? fallback.product_url,
      source_product_url: current.source_product_url ??
        fallback.source_product_url ?? null,
      category: current.category ?? fallback.category,
      is_purchased: current.is_purchased,
      fetched_at: current.fetched_at || fallback.fetched_at,
      item_type: itemType,
      action_label: actionLabel,
      image_marked_for_retry: current.image_marked_for_retry ??
        fallback.image_marked_for_retry ?? false,
      image_manually_cleared: current.image_manually_cleared ??
        fallback.image_manually_cleared ?? false,
      image_blacklisted: current.image_blacklisted ??
        fallback.image_blacklisted ?? false,
      image_suspicious: current.image_suspicious ?? fallback.image_suspicious ??
        false,
      image_low_confidence: current.image_low_confidence ??
        fallback.image_low_confidence ?? false,
    });
  }

  return [...merged.values()];
}

async function fetchFromMyRegistry(): Promise<RegistryItem[]> {
  const response = await fetch(REGISTRY_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(
      `MyRegistry responded with ${response.status} ${response.statusText}`,
    );
  }

  const html = await response.text();
  const htmlForParsing = html.length > MAX_PARSABLE_HTML_BYTES
    ? html.slice(0, MAX_PARSABLE_HTML_BYTES)
    : html;
  const fetchedAt = new Date().toISOString();
  const registryId = getRegistryPageIdFromHtml(htmlForParsing);

  const nextDataItems = parseItemsFromNextData(
    htmlForParsing,
    fetchedAt,
    registryId,
  );
  const jsonLdItems = parseItemsFromJsonLd(
    htmlForParsing,
    fetchedAt,
    registryId,
  );
  const htmlMarkupItems = parseItemsFromHtmlMarkup(
    htmlForParsing,
    fetchedAt,
    registryId,
  );

  let parsedItems: RegistryItem[] = [];
  if (nextDataItems.length > 0) {
    parsedItems = nextDataItems;
  } else if (jsonLdItems.length > 0) {
    parsedItems = mergeRegistryItems(jsonLdItems, htmlMarkupItems);
  } else if (htmlMarkupItems.length > 0) {
    parsedItems = htmlMarkupItems;
  }

  if (parsedItems.length > 0) return parsedItems;

  throw new Error(
    "No registry items found from __NEXT_DATA__, JSON-LD, or HTML markup. The MyRegistry page structure may have changed.",
  );
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

async function cacheRegistryItems(
  supabase: ReturnType<typeof createClient>,
  items: RegistryItem[],
): Promise<void> {
  const unsupportedColumns = new Set<
    (typeof OPTIONAL_REGISTRY_COLUMNS)[number]
  >();

  for (
    let retryAttempt = 0;
    retryAttempt < MAX_SCHEMA_COMPATIBILITY_ATTEMPTS;
    retryAttempt += 1
  ) {
    const payload = stripUnsupportedRegistryColumns(items, unsupportedColumns);
    const { error } = await supabase.from("registry_items").insert(payload);
    if (!error) {
      if (unsupportedColumns.size > 0) {
        console.warn(
          `[fetch-registry] Cached registry items without optional columns: ${
            Array.from(unsupportedColumns).join(", ")
          }`,
        );
      }
      return;
    }

    const missingColumns = getMissingRegistrySchemaCacheColumns(error.message);
    const newUnsupportedColumns = [...missingColumns].filter((column) =>
      !unsupportedColumns.has(column)
    );
    if (newUnsupportedColumns.length === 0) {
      throw new Error(`Failed to cache registry items: ${error.message}`);
    }

    for (const column of newUnsupportedColumns) {
      unsupportedColumns.add(column);
    }
  }

  const unsupportedColumnList = Array.from(unsupportedColumns).join(", ") ||
    "none";
  throw new Error(
    `Failed to cache registry items: exhausted ${MAX_SCHEMA_COMPATIBILITY_ATTEMPTS} compatibility retries (unsupported columns: ${unsupportedColumnList}).`,
  );
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
    };
  });
}

async function syncRegistryItemsFast(
  supabase: ReturnType<typeof createClient>,
  freshItems: RegistryItem[],
): Promise<void> {
  const existingItems = await getCachedRegistryItems(supabase);
  const existingItemsById = new Map(
    existingItems.map((item) => [item.id, item]),
  );
  const payload = buildFastSyncPayload(freshItems, existingItemsById);

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
    await supabase.from("registry_items").delete().neq("id", "");
    return;
  }

  const incomingIds = new Set(freshItems.map((item) => item.id));
  const staleIds = existingItems.filter((item) => !incomingIds.has(item.id))
    .map((item) => item.id);
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
    `[fetch-registry] Cache stale (age_ms=${ageMs}); running fast MyRegistry sync`,
  );
  const freshItems = await fetchFromMyRegistry();
  await syncRegistryItemsFast(supabase, freshItems);
  console.info(
    `[fetch-registry] Fast MyRegistry sync completed; deferred image enrichment to background path`,
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

export const __test = {
  resolveRegistryProductUrls,
  shouldAttemptMyRegistryImageUpgrade,
  upgradeImagesFromMyRegistryLinks,
  selectBackgroundEnrichmentCandidates,
  parseBackgroundEnrichmentLimit,
};

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

      const syncMeta = await ensureFastRegistrySyncIfStale(supabase);
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
