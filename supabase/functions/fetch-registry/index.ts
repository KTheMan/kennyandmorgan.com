import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Default cache TTL aligns with the frontend's 10-minute refresh cadence.
const CACHE_TTL_SECONDS = parseInt(Deno.env.get('REGISTRY_CACHE_TTL_SECONDS') ?? '600', 10);
// Cap parser input to avoid expensive regex work on unexpectedly large pages.
const MAX_PARSABLE_HTML_BYTES = 2_000_000;
// JSON-LD scripts are typically near the top of the page; scan only an initial chunk.
const JSON_LD_SCAN_BYTES = 500_000;
const CLASS_TEXT_CAPTURE_TEMPLATE = `<[^>]*class=["'][^"']*\\b%s\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`;
const HREF_ATTR_REGEX = /<a[^>]*href=["']([^"']+)["'][^>]*>/gi;
const ITEM_TYPE_HINTS = ['fund', 'cash gift', 'contribute'];
const MYREGISTRY_ORIGIN = 'https://www.myregistry.com';
const MYREGISTRY_IMAGE_HOST_SUFFIXES = ['myregistry.com', 'blob.core.windows.net'];
const SOURCE_IMAGE_HINTS = ['source', 'original', 'large', 'full', 'zoom', 'hires', 'highres'];
const THUMBNAIL_IMAGE_HINTS = ['thumb', 'thumbnail', 'small', 'icon', 'mini'];
const MYREGISTRY_IMAGE_UPGRADE_CONCURRENCY = 4;
const REGISTRY_URL =
    Deno.env.get('MYREGISTRY_URL') ?? 'https://www.myregistry.com/giftlist/morganandkenny';

interface RegistryItem {
    id: string;
    name: string;
    description: string | null;
    price: number | null;
    quantity_requested: number | null;
    quantity_purchased: number | null;
    image_url: string | null;
    store_name: string | null;
    product_url: string | null;
    source_product_url?: string | null;
    category: string | null;
    is_purchased: boolean;
    fetched_at: string;
    item_type?: 'product' | 'fund';
    action_label?: string | null;
}

const OPTIONAL_REGISTRY_COLUMNS = ['item_type', 'action_label', 'source_product_url'] as const;
const MAX_SCHEMA_COMPATIBILITY_ATTEMPTS = OPTIONAL_REGISTRY_COLUMNS.length + 1;

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Recursively search for an array within a JSON object that looks like registry items.
// Returns the first array that contains objects with at least `name` and a price/id field.
function findItemsArray(obj: unknown, depth = 0): unknown[] | null {
    if (depth > 10 || obj === null || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) {
        if (obj.length > 0) {
            const sample = obj[0];
            if (
                sample &&
                typeof sample === 'object' &&
                !Array.isArray(sample) &&
                ('name' in sample || 'title' in sample || 'productName' in sample) &&
                ('id' in sample || 'itemId' in sample || 'giftItemId' in sample || 'productId' in sample)
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
    const priorityKeys = ['items', 'giftItems', 'giftListItems', 'products', 'gifts', 'registryItems'];
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
    if (typeof value === 'number' && isFinite(value)) return value;
    if (typeof value === 'string') {
        const cleaned = value.replace(/[^0-9.]/g, '');
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
        .replace(/&#(\d+);/g, (_full, code) => String.fromCharCode(parseInt(code, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_full, code) => String.fromCharCode(parseInt(code, 16)))
        .replace(/&nbsp;/gi, ' ')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'");
}

function stripHtml(value: string | null): string | null {
    if (!value) return null;
    const stripped = decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    return stripped || null;
}

function getTagText(html: string, className: string): string | null {
    const escaped = className.replace(/[|\\{}()[\]^$+*?.\-]/g, '\\$&');
    const pattern = CLASS_TEXT_CAPTURE_TEMPLATE.replace('%s', escaped);
    const match = html.match(new RegExp(pattern, 'i'));
    return stripHtml(match?.[1] ?? null);
}

function getBackgroundImageUrl(html: string): string | null {
    const match = html.match(
        /background-image\s*:\s*url\((['"]?)([^'")]+)\1\)/i,
    );
    return (match?.[2] || '').trim() || null;
}

function getImageUrlFromHtml(html: string): string | null {
    // Product cards use CSS background images for the item photo and nested <img> tags for store logos.
    const backgroundImageUrl = getBackgroundImageUrl(html);
    if (backgroundImageUrl) return backgroundImageUrl;

    const imgMatch = html.match(/<img[^>]*src=["']([^"']+)["'][^>]*>/i);
    if (imgMatch?.[1]) return imgMatch[1].trim() || null;
    return null;
}

function getImageAltTextByClassName(html: string, className: string): string | null {
    const escaped = className.replace(/[|\\{}()[\]^$+*?.\-]/g, '\\$&');
    const containerMatch = html.match(
        new RegExp(`<[^>]*class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>([\\s\\S]*?)</[^>]+>`, 'i'),
    );
    const imgAltMatch = containerMatch?.[1]?.match(/<img[^>]*alt=["']([^"']+)["']/i);
    return stripHtml(imgAltMatch?.[1] ?? null);
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function getUrlSearchParamCaseInsensitive(url: URL, paramName: string): string | null {
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
        return getUrlSearchParamCaseInsensitive(url, 'giftid') ||
            getUrlSearchParamCaseInsensitive(url, 'cashgiftid');
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
        const searchParamValue = getUrlSearchParamCaseInsensitive(url, 'registryid');
        if (searchParamValue) return searchParamValue;
        const pathSegments = url.pathname.split('/').filter(Boolean);
        for (let segmentIndex = pathSegments.length - 1; segmentIndex >= 0; segmentIndex -= 1) {
            if (/^\d+$/.test(pathSegments[segmentIndex])) return pathSegments[segmentIndex];
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
    itemType: 'product' | 'fund',
    registryId: string | null,
    itemId: string | null,
): string | null {
    if (!registryId || !itemId) return null;
    const path = itemType === 'fund'
        ? '/Visitors/Giftlist/CashGiftProcess.aspx'
        : '/Visitors/Giftlist/PurchaseAssistant.aspx';
    const itemKey = itemType === 'fund' ? 'cashGiftId' : 'giftId';
    const url = new URL(path, MYREGISTRY_ORIGIN);
    url.searchParams.set(itemKey, itemId);
    url.searchParams.set('registryId', registryId);
    return url.toString();
}

function isMyRegistryFlowUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.origin === MYREGISTRY_ORIGIN &&
            /\/Visitors\/Giftlist\/(?:PurchaseAssistant|CashGiftProcess)\.aspx$/i.test(url.pathname);
    } catch {
        return false;
    }
}

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function extractEmbeddedUrlCandidates(value: string): string[] {
    try {
        const url = new URL(value);
        const embeddedCandidates: string[] = [];
        for (const [key, paramValue] of url.searchParams.entries()) {
            if (!/(url|target|redirect|dest|retailer|product|item|link)/i.test(key)) continue;
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
    itemType: 'product' | 'fund',
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
        .flatMap(value => [value, ...extractEmbeddedUrlCandidates(value)]);
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
        const itemId = itemType === 'fund'
            ? toTextValue(raw.cashGiftId ?? raw.cashgiftid ?? raw.id)
            : toTextValue(raw.giftId ?? raw.giftid ?? raw.id);
        productUrl = buildMyRegistryFlowUrl(itemType, registryId, itemId) ?? urlCandidates[0] ?? null;
    }

    const sourceProductUrl = uniqueSourceUrlCandidates.find(candidate =>
        candidate !== productUrl && !isMyRegistryFlowUrl(candidate)
    ) ?? null;

    return { productUrl, sourceProductUrl };
}

function getFirstHref(html: string): string | null {
    HREF_ATTR_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null = HREF_ATTR_REGEX.exec(html);
    while (match) {
        const href = (match[1] || '').trim();
        if (href && href !== '#' && !/^(javascript|data|vbscript|file):/i.test(href)) {
            return href;
        }
        match = HREF_ATTR_REGEX.exec(html);
    }
    return null;
}

function inferItemType(raw: Record<string, unknown>): 'product' | 'fund' {
    const explicit = String(raw.item_type ?? raw.itemType ?? raw.type ?? '').toLowerCase();
    const hints = [
        explicit,
        String(raw.action_label ?? raw.actionLabel ?? '').toLowerCase(),
        String(raw.category ?? '').toLowerCase(),
        String(raw.storeName ?? raw.store_name ?? '').toLowerCase(),
        String(raw.name ?? raw.title ?? '').toLowerCase(),
    ];
    if ('cashgiftid' in raw || 'cashGiftId' in raw) return 'fund';
    if (hints.some(value => ITEM_TYPE_HINTS.some(hint => value.includes(hint)))) {
        return 'fund';
    }
    return 'product';
}

function isMyRegistryImageHost(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    return MYREGISTRY_IMAGE_HOST_SUFFIXES.some(suffix => lower === suffix || lower.endsWith(`.${suffix}`));
}

function isProbablyImageUrl(value: string): boolean {
    const lower = value.toLowerCase();
    if (/\.(avif|bmp|gif|heic|jpeg|jpg|png|svg|webp)(?:[?#]|$)/i.test(lower)) return true;
    return lower.includes('/image') || lower.includes('giftimages');
}

function scoreImageUrlCandidate(value: string): number {
    let score = 0;
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        const urlText = `${host}${url.pathname}${url.search}`.toLowerCase();
        if (url.protocol === 'https:') score += 5;
        if (!isMyRegistryImageHost(host)) score += 50;
        if (SOURCE_IMAGE_HINTS.some(hint => urlText.includes(hint))) score += 20;
        if (THUMBNAIL_IMAGE_HINTS.some(hint => urlText.includes(hint))) score -= 35;
        if (url.pathname.toLowerCase().includes('_large')) score += 15;
    } catch {
        score -= 100;
    }
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
        if (depth > 2 || !node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const child of node) {
                scanForNestedImages(child, depth + 1);
            }
            return;
        }
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            if (/(image|img|photo|thumbnail|thumb)/i.test(key)) {
                if (typeof value === 'string') {
                    addCandidate(value);
                } else if (Array.isArray(value)) {
                    for (const entry of value) addCandidate(entry);
                }
            }
            if (value && typeof value === 'object') {
                scanForNestedImages(value, depth + 1);
            }
        }
    };
    scanForNestedImages(raw);

    const uniqueCandidates = [...new Set(candidates)];
    uniqueCandidates.sort((left, right) => scoreImageUrlCandidate(right) - scoreImageUrlCandidate(left));
    return uniqueCandidates;
}

function resolveBestImageUrl(raw: Record<string, unknown>): string | null {
    return collectImageCandidates(raw)[0] ?? null;
}

function shouldAttemptMyRegistryImageUpgrade(item: RegistryItem): boolean {
    if (item.item_type === 'fund') return false;
    const enrichmentUrls = [item.source_product_url, item.product_url]
        .filter((value): value is string => Boolean(value) && isHttpUrl(value));
    if (enrichmentUrls.length === 0) return false;
    if (!item.image_url) return true;
    if (THUMBNAIL_IMAGE_HINTS.some(hint => item.image_url?.toLowerCase().includes(hint))) return true;
    try {
        const url = new URL(item.image_url);
        if (isMyRegistryImageHost(url.hostname)) return true;
    } catch {
        return true;
    }
    return false;
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

    const metaRegex = /<meta[^>]+(?:property|name|itemprop)=["'](?:og:image|twitter:image|image)["'][^>]*content=["']([^"']+)["'][^>]*>/gi;
    for (const match of html.matchAll(metaRegex)) addCandidate(match[1]);

    const attrRegex =
        /<(?:img|source|a)[^>]*(?:src|srcset|data-src|data-srcset|data-original|data-image|data-zoom-image|href)=["']([^"']+)["'][^>]*>/gi;
    for (const match of html.matchAll(attrRegex)) {
        const [firstSrcset] = String(match[1] ?? '').split(',');
        const srcsetCandidate = firstSrcset?.trim().split(/\s+/)[0] ?? '';
        addCandidate(srcsetCandidate || match[1]);
    }

    const backgroundImageRegex = /background-image\s*:\s*url\((['"]?)([^'")]+)\1\)/gi;
    for (const match of html.matchAll(backgroundImageRegex)) addCandidate(match[2]);

    const unique = [...new Set(candidates)];
    unique.sort((left, right) => scoreImageUrlCandidate(right) - scoreImageUrlCandidate(left));
    return unique;
}

async function fetchBestImageFromMyRegistryFlowUrl(
    pageUrl: string,
    currentImageUrl: string | null,
): Promise<string | null> {
    const response = await fetch(pageUrl, {
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
    });

    if (!response.ok) return null;
    const html = await response.text();
    const bestLinkedImage = collectImageCandidatesFromHtml(
        html.length > MAX_PARSABLE_HTML_BYTES ? html.slice(0, MAX_PARSABLE_HTML_BYTES) : html,
        response.url || pageUrl,
    )[0];
    if (!bestLinkedImage) return null;

    const currentScore = currentImageUrl ? scoreImageUrlCandidate(currentImageUrl) : Number.NEGATIVE_INFINITY;
    const linkedScore = scoreImageUrlCandidate(bestLinkedImage);
    return linkedScore > currentScore ? bestLinkedImage : null;
}

async function upgradeImagesFromMyRegistryLinks(items: RegistryItem[]): Promise<RegistryItem[]> {
    const upgradedItems = [...items];
    let upgradeCount = 0;
    const candidates = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => shouldAttemptMyRegistryImageUpgrade(item));

    for (let start = 0; start < candidates.length; start += MYREGISTRY_IMAGE_UPGRADE_CONCURRENCY) {
        const batch = candidates.slice(start, start + MYREGISTRY_IMAGE_UPGRADE_CONCURRENCY);
        await Promise.all(batch.map(async ({ item, index }) => {
            try {
                const enrichmentUrls = [item.source_product_url, item.product_url]
                    .filter((value): value is string => Boolean(value) && isHttpUrl(value));
                let upgradedImageUrl: string | null = null;
                for (const enrichmentUrl of enrichmentUrls) {
                    upgradedImageUrl = await fetchBestImageFromMyRegistryFlowUrl(
                        enrichmentUrl,
                        item.image_url,
                    );
                    if (upgradedImageUrl) break;
                }
                if (!upgradedImageUrl) return;
                upgradedItems[index] = { ...item, image_url: upgradedImageUrl };
                upgradeCount += 1;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.warn(`[fetch-registry] Failed to enrich image for ${item.id}: ${message}`);
            }
        }));
    }

    if (upgradeCount > 0) {
        console.info(`[fetch-registry] Upgraded ${upgradeCount} item image(s) using direct-first URL enrichment.`);
    }
    return upgradedItems;
}

function normalizeItem(raw: Record<string, unknown>, fetchedAt: string): RegistryItem | null {
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
            '',
    );
    const name = String(raw.name ?? raw.title ?? raw.productName ?? raw.itemName ?? '').trim();

    if (!id || !name) return null;

    const itemType = inferItemType(raw);
    const quantityRequested = toInt(
        raw.quantityRequested ?? raw.quantity_requested ?? raw.qtyRequested ?? raw.quantity ?? raw.qty,
    );
    const quantityPurchased = toInt(
        raw.quantityPurchased ??
            raw.quantity_purchased ??
            raw.qtyFulfilled ??
            raw.purchased ??
            raw.fulfilled ??
            raw.qtyReceived,
    );

    let isPurchased = Boolean(raw.isPurchased ?? raw.is_purchased ?? raw.isFulfilled ?? raw.fulfilled ?? false);
    if (!isPurchased && quantityRequested !== null && quantityPurchased !== null && quantityRequested > 0) {
        isPurchased = quantityPurchased >= quantityRequested;
    }

    const imageUrl = resolveBestImageUrl(raw);

    const rawActionLabel = String(raw.action_label ?? raw.actionLabel ?? '').trim() || null;
    const { productUrl, sourceProductUrl } = resolveRegistryProductUrls(raw, itemType);

    return {
        id,
        name,
        description: String(raw.description ?? raw.notes ?? raw.itemDescription ?? '').trim() || null,
        price: toNumber(raw.price ?? raw.priceAmount ?? raw.currentPrice ?? raw.retailPrice),
        quantity_requested: quantityRequested,
        quantity_purchased: quantityPurchased,
        image_url: imageUrl,
        store_name:
            String(raw.storeName ?? raw.store_name ?? raw.retailer ?? raw.store ?? raw.retailerName ?? '').trim() ||
            null,
        product_url: productUrl,
        source_product_url: sourceProductUrl,
        category: String(raw.category ?? raw.categoryName ?? raw.department ?? '').trim() || null,
        is_purchased: isPurchased,
        fetched_at: fetchedAt,
        item_type: itemType,
        action_label: itemType === 'fund' ? rawActionLabel ?? 'Contribute' : null,
    };
}

function normalizeItems(rawItems: Record<string, unknown>[], fetchedAt: string): RegistryItem[] {
    const items: RegistryItem[] = [];
    for (const raw of rawItems) {
        const normalized = normalizeItem(raw, fetchedAt);
        if (normalized) items.push(normalized);
    }
    return items;
}

function parseItemsFromNextData(html: string, fetchedAt: string, registryId: string | null): RegistryItem[] {
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!nextDataMatch) return [];

    let nextData: unknown;
    try {
        nextData = JSON.parse(nextDataMatch[1]);
    } catch (error) {
        const parseMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to parse __NEXT_DATA__ JSON from MyRegistry page: ${parseMessage}`);
    }

    const rawItems = findItemsArray(nextData);
    if (!rawItems || rawItems.length === 0) return [];
    return normalizeItems(
        (rawItems as Record<string, unknown>[]).map(item => ({ ...item, registryId })),
        fetchedAt,
    );
}

function toTextValue(value: unknown): string | null {
    if (typeof value === 'string') return value.trim() || null;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return null;
}

function normalizeCachedItems(rawItems: unknown[] | null | undefined): RegistryItem[] {
    if (!Array.isArray(rawItems)) return [];

    const items: RegistryItem[] = [];
    for (const raw of rawItems) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const fetchedAt = toTextValue((raw as Record<string, unknown>).fetched_at) ?? new Date().toISOString();
        const normalized = normalizeItem(raw as Record<string, unknown>, fetchedAt);
        if (normalized) items.push(normalized);
    }
    return items;
}

function getMissingRegistrySchemaCacheColumns(message: string): Set<(typeof OPTIONAL_REGISTRY_COLUMNS)[number]> {
    const unsupportedColumns = new Set<(typeof OPTIONAL_REGISTRY_COLUMNS)[number]>();
    for (const column of OPTIONAL_REGISTRY_COLUMNS) {
        if (message.includes(`Could not find the '${column}' column of 'registry_items' in the schema cache`)) {
            unsupportedColumns.add(column);
        }
    }
    return unsupportedColumns;
}

function stripUnsupportedRegistryColumns(
    items: RegistryItem[],
    unsupportedColumns: Set<(typeof OPTIONAL_REGISTRY_COLUMNS)[number]>,
): Record<string, unknown>[] {
    return items.map(item => {
        const row = { ...item } as Record<string, unknown>;
        for (const column of unsupportedColumns) {
            delete row[column];
        }
        return row;
    });
}

function parseItemsFromJsonLd(html: string, fetchedAt: string, registryId: string | null): RegistryItem[] {
    const items: Record<string, unknown>[] = [];
    const htmlChunk = html.slice(0, JSON_LD_SCAN_BYTES);
    const matches = [...htmlChunk.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    let generatedId = 0;

    const collectNodes = (node: unknown, output: unknown[]) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const child of node) collectNodes(child, output);
            return;
        }
        const record = node as Record<string, unknown>;
        const list = record.itemListElement;
        if (Array.isArray(list)) output.push(...list);
        for (const value of Object.values(record)) {
            if (value && typeof value === 'object') collectNodes(value, output);
        }
    };

    for (const match of matches) {
        let parsed: unknown;
        try {
            parsed = JSON.parse((match[1] || '').trim());
        } catch {
            continue;
        }
        const itemListElements: unknown[] = [];
        collectNodes(parsed, itemListElements);
        for (const entry of itemListElements) {
            if (!entry || typeof entry !== 'object') continue;
            const entryRecord = entry as Record<string, unknown>;
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
                        node['@id'] ??
                        node.url,
                ) ?? fallbackId,
                name: toTextValue(node.name ?? itemOffered.name) ?? toTextValue(entryRecord.name) ?? '',
                description: toTextValue(node.description ?? entryRecord.description),
                price: offers.price ?? offers.lowPrice ?? offers.highPrice ?? itemOffered.price ?? node.price,
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
                action_label: inferredType === 'fund' ? 'Contribute' : null,
            });
        }
    }
    return normalizeItems(items, fetchedAt);
}

function parseItemsFromHtmlMarkup(html: string, fetchedAt: string, registryId: string | null): RegistryItem[] {
    const openTagRegex =
        /<div[^>]*class=["'][^"']*\bitemGiftVisitorList\b[^"']*["'][^>]*>/gi;
    const matches = [...html.matchAll(openTagRegex)];
    const rawItems: Record<string, unknown>[] = [];

    for (let i = 0; i < matches.length; i++) {
        const current = matches[i];
        const blockStart = current.index ?? 0;
        const blockEnd = i + 1 < matches.length ? (matches[i + 1].index ?? html.length) : html.length;
        const block = html.slice(blockStart, blockEnd);
        const openingTag = current[0];
        const giftId = openingTag.match(/\bgiftid=["']?([^"'\s>]+)["']?/i)?.[1] || null;
        const cashGiftId = openingTag.match(/\bcashgiftid=["']?([^"'\s>]+)["']?/i)?.[1] || null;
        const isFund = /\bcashgift\b/i.test(openingTag) || Boolean(cashGiftId);
        const id = cashGiftId || giftId;
        const name = getTagText(block, 'gift-title');
        if (!id || !name) continue;

        const actionLabel = getTagText(block, 'btnGiveCash') ?? getTagText(block, 'btn-give-cash') ?? null;
        const storeName = getTagText(block, 'gift-store') ?? getImageAltTextByClassName(block, 'gift-websitelogo');
        const priceText = getTagText(block, 'gift-price');
        const desiredQtyText = getTagText(block, 'desiredQty');
        const receivedQtyText = getTagText(block, 'receivedQty');
        const rawItem: Record<string, unknown> = {
            id,
            name,
            description: getTagText(block, 'gift-description'),
            price: priceText,
            quantityRequested: desiredQtyText,
            quantityPurchased: receivedQtyText,
            imageUrl: getImageUrlFromHtml(block),
            storeName,
            productUrl: getFirstHref(block),
            category: getTagText(block, 'gift-category'),
            isPurchased: /\bpurchased\b/i.test(block) && !/\bnot purchased\b/i.test(block),
            registryId,
            item_type: isFund ? 'fund' : null,
            action_label: actionLabel,
            cashgiftid: cashGiftId,
        };
        const inferredType = inferItemType(rawItem);
        rawItem.item_type = inferredType;
        if (inferredType === 'fund' && !rawItem.action_label) {
            rawItem.action_label = 'Contribute';
        }
        rawItems.push(rawItem);
    }

    return normalizeItems(rawItems, fetchedAt);
}

function mergeRegistryItems(primaryItems: RegistryItem[], fallbackItems: RegistryItem[]): RegistryItem[] {
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
        const actionLabel = itemType === 'fund'
            ? current.action_label ?? fallback.action_label ?? 'Contribute'
            : null;

        merged.set(fallback.id, {
            id: current.id,
            name: current.name ?? fallback.name,
            description: current.description ?? fallback.description,
            price: current.price ?? fallback.price,
            quantity_requested: current.quantity_requested ?? fallback.quantity_requested,
            quantity_purchased: current.quantity_purchased ?? fallback.quantity_purchased,
            image_url: current.image_url ?? fallback.image_url,
            store_name: current.store_name ?? fallback.store_name,
            product_url: current.product_url ?? fallback.product_url,
            source_product_url: current.source_product_url ?? fallback.source_product_url ?? null,
            category: current.category ?? fallback.category,
            is_purchased: current.is_purchased,
            fetched_at: current.fetched_at || fallback.fetched_at,
            item_type: itemType,
            action_label: actionLabel,
        });
    }

    return [...merged.values()];
}

async function fetchFromMyRegistry(): Promise<RegistryItem[]> {
    const response = await fetch(REGISTRY_URL, {
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) {
        throw new Error(`MyRegistry responded with ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const htmlForParsing = html.length > MAX_PARSABLE_HTML_BYTES ? html.slice(0, MAX_PARSABLE_HTML_BYTES) : html;
    const fetchedAt = new Date().toISOString();
    const registryId = getRegistryPageIdFromHtml(htmlForParsing);

    const nextDataItems = parseItemsFromNextData(htmlForParsing, fetchedAt, registryId);
    const jsonLdItems = parseItemsFromJsonLd(htmlForParsing, fetchedAt, registryId);
    const htmlMarkupItems = parseItemsFromHtmlMarkup(htmlForParsing, fetchedAt, registryId);

    let parsedItems: RegistryItem[] = [];
    if (nextDataItems.length > 0) {
        parsedItems = nextDataItems;
    } else if (jsonLdItems.length > 0) {
        parsedItems = mergeRegistryItems(jsonLdItems, htmlMarkupItems);
    } else if (htmlMarkupItems.length > 0) {
        parsedItems = htmlMarkupItems;
    }

    if (parsedItems.length > 0) {
        return await upgradeImagesFromMyRegistryLinks(parsedItems);
    }

    throw new Error(
        'No registry items found from __NEXT_DATA__, JSON-LD, or HTML markup. The MyRegistry page structure may have changed.',
    );
}

async function getCachedRegistryItems(supabase: ReturnType<typeof createClient>): Promise<RegistryItem[]> {
    const { data, error } = await supabase
        .from('registry_items')
        .select('*')
        .order('is_purchased', { ascending: true })
        .order('name', { ascending: true });

    if (error) {
        throw new Error(error.message);
    }

    return normalizeCachedItems(data as unknown[] | null | undefined);
}

async function cacheRegistryItems(
    supabase: ReturnType<typeof createClient>,
    items: RegistryItem[],
): Promise<void> {
    const unsupportedColumns = new Set<(typeof OPTIONAL_REGISTRY_COLUMNS)[number]>();

    for (let retryAttempt = 0; retryAttempt < MAX_SCHEMA_COMPATIBILITY_ATTEMPTS; retryAttempt += 1) {
        const payload = stripUnsupportedRegistryColumns(items, unsupportedColumns);
        const { error } = await supabase.from('registry_items').insert(payload);
        if (!error) {
            if (unsupportedColumns.size > 0) {
                console.warn(
                    `[fetch-registry] Cached registry items without optional columns: ${Array.from(unsupportedColumns).join(', ')}`,
                );
            }
            return;
        }

        const missingColumns = getMissingRegistrySchemaCacheColumns(error.message);
        const newUnsupportedColumns = [...missingColumns].filter(column => !unsupportedColumns.has(column));
        if (newUnsupportedColumns.length === 0) {
            throw new Error(`Failed to cache registry items: ${error.message}`);
        }

        for (const column of newUnsupportedColumns) {
            unsupportedColumns.add(column);
        }
    }

    const unsupportedColumnList = Array.from(unsupportedColumns).join(', ') || 'none';
    throw new Error(
        `Failed to cache registry items: exhausted ${MAX_SCHEMA_COMPATIBILITY_ATTEMPTS} compatibility retries (unsupported columns: ${unsupportedColumnList}).`,
    );
}

export const __test = {
    resolveRegistryProductUrls,
    shouldAttemptMyRegistryImageUpgrade,
    upgradeImagesFromMyRegistryLinks,
};

if (import.meta.main) {
    Deno.serve(async (req: Request) => {
        if (req.method === 'OPTIONS') {
            return new Response('ok', { headers: CORS_HEADERS });
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!supabaseUrl || !serviceRoleKey) {
            return new Response(
                JSON.stringify({ success: false, error: 'Supabase environment not configured.', items: [] }),
                { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
            );
        }

        const supabase = createClient(supabaseUrl, serviceRoleKey);

        try {
            // Check whether cached data is fresh enough
            const { data: latestRow } = await supabase
                .from('registry_items')
                .select('fetched_at')
                .order('fetched_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            const ageMs = latestRow?.fetched_at
                ? Date.now() - new Date(latestRow.fetched_at).getTime()
                : Infinity;
            const isStale = ageMs > CACHE_TTL_SECONDS * 1000;
            let items: RegistryItem[] = [];

            if (isStale) {
                const freshItems = await fetchFromMyRegistry();

                // Replace all cached items with the freshly fetched set
                await supabase.from('registry_items').delete().lte('fetched_at', new Date().toISOString());
                await cacheRegistryItems(supabase, freshItems);
                items = freshItems;
            } else {
                items = await getCachedRegistryItems(supabase);
            }

            return new Response(JSON.stringify({ success: true, items }), {
                headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            console.error('[fetch-registry]', message);

            // On error, try to return whatever is cached rather than an empty response
            const cachedItems = await getCachedRegistryItems(supabase).catch(() => []);

            return new Response(
                JSON.stringify({
                    success: false,
                    error: message,
                    items: cachedItems ?? [],
                }),
                { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
            );
        }
    });
}
