import { fetchTextWithAntiBotHeaders } from "../lib/http.ts";
import {
  asRecord,
  decodeHtmlEntities,
  extractEmbeddedUrlCandidates,
  getDisplayImageUrl,
  getHostName,
  isDuplicateImageCandidate,
  isHttpUrl,
  isLikelyRetailerPdpUrl,
  isLowQualityImageUrl,
  isMyRegistryFlowUrl,
  isMyRegistryUrl,
  isProbablyImageUrl,
  MYREGISTRY_ORIGIN,
  normalizeHttpUrlCandidate,
  normalizeImageIdentity,
  stripHtml,
  THUMBNAIL_IMAGE_HINTS,
  toInt,
  toNumber,
  toTextValue,
} from "../lib/normalize.ts";
import { BaseRegistryScraper } from "./base.ts";
import type { RawItem, RegistryItem, ScraperConfig } from "../types.ts";

// Default cache TTL aligns with the frontend's 10-minute refresh cadence.
const CACHE_TTL_SECONDS = parseInt(
  Deno.env.get("REGISTRY_CACHE_TTL_SECONDS") ?? "600",
  10,
);

// Cap parser input to avoid expensive regex work on unexpectedly large pages.
export const MAX_PARSABLE_HTML_BYTES = 2_000_000;

// JSON-LD scripts are typically near the top of the page; scan only an initial chunk.
const JSON_LD_SCAN_BYTES = 500_000;

const CLASS_TEXT_CAPTURE_TEMPLATE = `<[^>]*class=["'][^"']*\\b%s\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`;
const HREF_ATTR_REGEX = /<a[^>]*href=["']([^"']+)["'][^>]*>/gi;

const ITEM_TYPE_HINTS = ["fund", "cash gift", "contribute"];
const SOURCE_IMAGE_HINTS = [
  "source",
  "original",
  "large",
  "full",
  "zoom",
  "hires",
  "highres",
];
const MYREGISTRY_IMAGE_HOST_SUFFIXES = [
  "myregistry.com",
  "blob.core.windows.net",
];
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
export const DEFAULT_BACKGROUND_ENRICHMENT_LIMIT = 5;

export class MyRegistryScraper extends BaseRegistryScraper {
  readonly name = "MyRegistry";
  readonly key = "myregistry";

  private registryUrl: string;

  /** Stores to exclude from the output (e.g., ["Crate & Barrel"] when we have a native C&B scraper). */
  excludeStores: string[] = [];

  constructor(registryUrl?: string) {
    super();
    this.registryUrl = registryUrl ??
      Deno.env.get("MYREGISTRY_URL") ??
      "https://www.myregistry.com/giftlist/morganandkenny";
  }

  matches(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return host === "myregistry.com" || host.endsWith(".myregistry.com");
    } catch {
      return false;
    }
  }

  async fetchItems(
    url: string,
    config: ScraperConfig & { excludeStores?: string[] } = {},
  ): Promise<RegistryItem[]> {
    const items = await fetchFromMyRegistry(url, config);
    const excludedStores = config.excludeStores ?? this.excludeStores;
    if (excludedStores.length === 0) return items;

    const excluded = excludedStores.map((store) => store.toLowerCase());
    return items.filter((item) => {
      const store = (item.store_name ?? "").toLowerCase();
      return !excluded.some((excludedStore) => store.includes(excludedStore));
    });
  }

  get registryUrlValue(): string {
    return this.registryUrl;
  }
}

export const myRegistryScraper = new MyRegistryScraper();

function getRegistryPageIdFromHtml(html: string): string | null {
  const registryIdMatch = html.match(/[?&]registryId=(\d+)/i);
  return registryIdMatch?.[1] ?? null;
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
    for (let i = pathSegments.length - 1; i >= 0; i -= 1) {
      if (/^\d+$/.test(pathSegments[i])) {
        return pathSegments[i];
      }
    }
  } catch {
    return null;
  }
  return null;
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

function collectProductUrlCandidates(raw: RawItem): string[] {
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

export function resolveRegistryProductUrls(
  raw: RawItem,
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
    productUrl = buildMyRegistryFlowUrl(itemType, registryId, itemId) ?? flowUrl;
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

  const sourceProductUrl = uniqueSourceUrlCandidates.find((candidate) =>
    candidate !== productUrl && !isMyRegistryFlowUrl(candidate)
  ) ?? null;

  return { productUrl, sourceProductUrl };
}

function inferItemType(raw: RawItem): "product" | "fund" {
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

function collectImageCandidates(raw: RawItem): string[] {
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
      for (const child of node) scanForNestedImages(child, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
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

function resolveBestImageUrl(raw: RawItem): string | null {
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

function getHrefCandidates(html: string, baseUrl: string): string[] {
  const hrefs: string[] = [];
  for (const match of html.matchAll(HREF_ATTR_REGEX)) {
    const normalized = normalizeHttpUrlCandidate(match[1] ?? "", baseUrl);
    if (normalized) hrefs.push(normalized);
  }
  return hrefs;
}

function collectImageCandidatesFromHtml(html: string, baseUrl: string): string[] {
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
    const entries = srcsetValue.split(",").map((entry) => entry.trim()).filter(Boolean);
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

function collectRetailerPageCandidatesFromHtml(html: string, pageUrl: string): string[] {
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

function scoreRetailerPageCandidate(value: string, preferredHost: string | null): number {
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

async function fetchBestImageFromMyRegistryFlowUrl(
  pageUrl: string,
  currentImageUrl: string | null,
): Promise<string | null> {
  const sourceHost = getHostName(pageUrl);
  const preferredHost = sourceHost && !isMyRegistryUrl(pageUrl) ? sourceHost : null;
  const attemptedUrls: string[] = [];
  const queuedUrls = new Set<string>([pageUrl]);
  const visitedUrls = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [{ url: pageUrl, depth: 0 }];
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

  if (!bestLinkedImage) return null;
  const currentScore = currentImageUrl
    ? scoreImageUrlCandidate(currentImageUrl)
    : Number.NEGATIVE_INFINITY;
  return bestLinkedScore > currentScore ? bestLinkedImage : null;
}

export async function upgradeImagesFromMyRegistryLinks(
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
            item.resolved_image_url ?? item.registry_image_url ?? item.image_url,
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
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([identity]) => identity),
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

export function shouldAttemptMyRegistryImageUpgrade(
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

export function selectBackgroundEnrichmentCandidates(
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
    candidates: rankedCandidates.slice(0, normalizedLimit).map(
      ({ item, index }) => ({ item, index }),
    ),
  };
}

export function parseBackgroundEnrichmentLimit(requestUrl: URL): number {
  const rawLimit = requestUrl.searchParams.get("limit");
  if (!rawLimit) return DEFAULT_BACKGROUND_ENRICHMENT_LIMIT;
  const parsed = parseInt(rawLimit, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_BACKGROUND_ENRICHMENT_LIMIT;
  }
  return parsed;
}

function normalizeItem(raw: RawItem, fetchedAt: string): RegistryItem | null {
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
  const { productUrl, sourceProductUrl } = resolveRegistryProductUrls(raw, itemType);

  return {
    id,
    name,
    description:
      String(raw.description ?? raw.notes ?? raw.itemDescription ?? "").trim() ||
        null,
    price: toNumber(raw.price ?? raw.priceAmount ?? raw.currentPrice ?? raw.retailPrice),
    quantity_requested: quantityRequested,
    quantity_purchased: quantityPurchased,
    image_url: displayImageUrl,
    registry_image_url: registryImageUrl,
    resolved_image_url: resolvedImageUrl,
    store_name: String(
      raw.storeName ?? raw.store_name ?? raw.retailer ?? raw.store ??
        raw.retailerName ?? "",
    ).trim() || null,
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

function normalizeItems(rawItems: RawItem[], fetchedAt: string): RegistryItem[] {
  const items: RegistryItem[] = [];
  for (const raw of rawItems) {
    const normalized = normalizeItem(raw, fetchedAt);
    if (normalized) items.push(normalized);
  }
  return items;
}

function getTagText(html: string, className: string): string | null {
  const escaped = className.replace(/[|\\{}()\[\]^$+*?.\-]/g, "\\$&");
  const pattern = CLASS_TEXT_CAPTURE_TEMPLATE.replace("%s", escaped);
  const match = html.match(new RegExp(pattern, "i"));
  return stripHtml(match?.[1] ?? null);
}

function getBackgroundImageUrl(html: string): string | null {
  const match = html.match(
    /background-image\s*:\s*url\((['"]?)([^'"]+)\1\)/i,
  );
  return (match?.[2] || "").trim() || null;
}

function getImageUrlFromHtml(html: string): string | null {
  const backgroundImageUrl = getBackgroundImageUrl(html);
  if (backgroundImageUrl) return backgroundImageUrl;

  const imgMatch = html.match(/<img[^>]*src=["']([^"']+)["'][^>]*>/i);
  if (imgMatch?.[1]) return imgMatch[1].trim() || null;
  return null;
}

function getImageAltTextByClassName(html: string, className: string): string | null {
  const escaped = className.replace(/[|\\{}()\[\]^$+*?.\-]/g, "\\$&");
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
    for (const el of obj as unknown[]) {
      const found = findItemsArray(el, depth + 1);
      if (found) return found;
    }
    return null;
  }
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
    (rawItems as RawItem[]).map((item) => ({ ...item, registryId })),
    fetchedAt,
  );
}

function parseItemsFromJsonLd(
  html: string,
  fetchedAt: string,
  registryId: string | null,
): RegistryItem[] {
  const items: RawItem[] = [];
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
      const entryRecord = entry as RawItem;
      const node = asRecord(entryRecord.item) ?? entryRecord;
      const itemOffered = asRecord(node.itemOffered) ?? {};
      const offers = asRecord(node.offers) ?? asRecord(itemOffered.offers) ?? {};
      const seller = asRecord(offers.seller) ?? {};
      const eligibleQuantity = asRecord(node.eligibleQuantity) ?? {};
      const imageSource = itemOffered.image ?? node.image;
      const imageValue = Array.isArray(imageSource) ? imageSource[0] : imageSource;
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
  const rawItems: RawItem[] = [];

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

    const rawItem: RawItem = {
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
      quantity_requested: current.quantity_requested ?? fallback.quantity_requested,
      quantity_purchased: current.quantity_purchased ?? fallback.quantity_purchased,
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
      image_suspicious: current.image_suspicious ?? fallback.image_suspicious ?? false,
      image_low_confidence: current.image_low_confidence ??
        fallback.image_low_confidence ?? false,
    });
  }

  return [...merged.values()];
}

async function fetchFromMyRegistry(
  registryUrl: string,
  config: ScraperConfig = {},
): Promise<RegistryItem[]> {
  const { text } = await fetchTextWithAntiBotHeaders(registryUrl, config);
  const htmlForParsing = text.length > MAX_PARSABLE_HTML_BYTES
    ? text.slice(0, MAX_PARSABLE_HTML_BYTES)
    : text;
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
