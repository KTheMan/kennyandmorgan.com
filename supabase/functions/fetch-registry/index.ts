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
    category: string | null;
    is_purchased: boolean;
    fetched_at: string;
    item_type?: 'product' | 'fund';
    action_label?: string | null;
}

const OPTIONAL_REGISTRY_COLUMNS = ['item_type', 'action_label'] as const;

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
    const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    const imgMatch = html.match(/<img[^>]*src=["']([^"']+)["'][^>]*>/i);
    if (imgMatch?.[1]) return imgMatch[1].trim() || null;
    return getBackgroundImageUrl(html);
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

function normalizeItem(raw: Record<string, unknown>, fetchedAt: string): RegistryItem | null {
    const id = String(
        raw.id ?? raw.itemId ?? raw.giftItemId ?? raw.productId ?? raw.registryItemId ?? '',
    );
    const name = String(raw.name ?? raw.title ?? raw.productName ?? raw.itemName ?? '').trim();

    if (!id || !name) return null;

    const itemType = inferItemType(raw);
    const quantityRequested = toInt(raw.quantityRequested ?? raw.qtyRequested ?? raw.quantity ?? raw.qty);
    const quantityPurchased = toInt(
        raw.quantityPurchased ?? raw.qtyFulfilled ?? raw.purchased ?? raw.fulfilled ?? raw.qtyReceived,
    );

    let isPurchased = Boolean(raw.isPurchased ?? raw.isFulfilled ?? raw.fulfilled ?? false);
    if (!isPurchased && quantityRequested !== null && quantityPurchased !== null && quantityRequested > 0) {
        isPurchased = quantityPurchased >= quantityRequested;
    }

    const imageUrl = String(
        raw.imageUrl ?? raw.image ?? raw.imgUrl ?? raw.thumbnailUrl ?? raw.thumbnail ?? raw.productImageUrl ?? '',
    ).trim() || null;

    const productUrl = String(
        raw.productUrl ?? raw.url ?? raw.link ?? raw.itemUrl ?? raw.purchaseUrl ?? '',
    ).trim() || null;

    return {
        id,
        name,
        description: String(raw.description ?? raw.notes ?? raw.itemDescription ?? '').trim() || null,
        price: toNumber(raw.price ?? raw.priceAmount ?? raw.currentPrice ?? raw.retailPrice),
        quantity_requested: quantityRequested,
        quantity_purchased: quantityPurchased,
        image_url: imageUrl,
        store_name:
            String(raw.storeName ?? raw.retailer ?? raw.store ?? raw.retailerName ?? '').trim() || null,
        product_url: productUrl,
        category: String(raw.category ?? raw.categoryName ?? raw.department ?? '').trim() || null,
        is_purchased: isPurchased,
        fetched_at: fetchedAt,
        item_type: itemType,
        action_label:
            String(raw.action_label ?? raw.actionLabel ?? '').trim() || (itemType === 'fund' ? 'Contribute' : null),
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

function parseItemsFromNextData(html: string, fetchedAt: string): RegistryItem[] {
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
    return normalizeItems(rawItems as Record<string, unknown>[], fetchedAt);
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

function parseItemsFromJsonLd(html: string, fetchedAt: string): RegistryItem[] {
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
            const node = (entryRecord.item && typeof entryRecord.item === 'object')
                ? entryRecord.item as Record<string, unknown>
                : entryRecord;
            const offers = (node.offers && typeof node.offers === 'object') ? node.offers as Record<string, unknown> : {};
            const seller = (offers.seller && typeof offers.seller === 'object')
                ? offers.seller as Record<string, unknown>
                : {};
            const imageValue = Array.isArray(node.image) ? node.image[0] : node.image;
            generatedId += 1;
            const fallbackId = `jsonld-${generatedId}`;
            const inferredType = inferItemType({
                ...node,
                category: node.category,
                action_label: node.potentialAction ? 'Contribute' : null,
            });
            items.push({
                id: toTextValue(node.identifier ?? node.sku ?? node['@id'] ?? node.url) ?? fallbackId,
                name: toTextValue(node.name) ?? toTextValue(entryRecord.name) ?? '',
                description: toTextValue(node.description ?? entryRecord.description),
                price: offers.price ?? offers.lowPrice ?? offers.highPrice ?? node.price,
                imageUrl: toTextValue(imageValue),
                productUrl: toTextValue(node.url ?? offers.url),
                storeName: toTextValue(seller.name),
                category: toTextValue(node.category),
                item_type: inferredType,
                action_label: inferredType === 'fund' ? 'Contribute' : null,
            });
        }
    }
    return normalizeItems(items, fetchedAt);
}

function parseItemsFromHtmlMarkup(html: string, fetchedAt: string): RegistryItem[] {
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
        const storeName = getTagText(block, 'gift-store');
        const priceText = getTagText(block, 'gift-price');
        const rawItem: Record<string, unknown> = {
            id,
            name,
            description: getTagText(block, 'gift-description'),
            price: priceText,
            quantityRequested: null,
            quantityPurchased: null,
            imageUrl: getImageUrlFromHtml(block),
            storeName,
            productUrl: getFirstHref(block),
            category: getTagText(block, 'gift-category'),
            isPurchased: /\bpurchased\b/i.test(block) && !/\bnot purchased\b/i.test(block),
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

    const nextDataItems = parseItemsFromNextData(htmlForParsing, fetchedAt);
    if (nextDataItems.length > 0) {
        return nextDataItems;
    }

    const jsonLdItems = parseItemsFromJsonLd(htmlForParsing, fetchedAt);
    if (jsonLdItems.length > 0) {
        return jsonLdItems;
    }

    const htmlMarkupItems = parseItemsFromHtmlMarkup(htmlForParsing, fetchedAt);
    if (htmlMarkupItems.length > 0) {
        return htmlMarkupItems;
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

    for (let attempt = 0; attempt <= OPTIONAL_REGISTRY_COLUMNS.length; attempt += 1) {
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

    throw new Error('Failed to cache registry items: exhausted compatibility retries.');
}

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

        return new Response(JSON.stringify({ success: true, items: items ?? [] }), {
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
