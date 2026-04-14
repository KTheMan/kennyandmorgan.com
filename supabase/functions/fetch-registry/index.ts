import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CACHE_TTL_SECONDS = parseInt(Deno.env.get('REGISTRY_CACHE_TTL_SECONDS') ?? '3600', 10);
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
}

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

function normalizeItem(raw: Record<string, unknown>, fetchedAt: string): RegistryItem | null {
    const id = String(
        raw.id ?? raw.itemId ?? raw.giftItemId ?? raw.productId ?? raw.registryItemId ?? '',
    );
    const name = String(raw.name ?? raw.title ?? raw.productName ?? raw.itemName ?? '').trim();

    if (!id || !name) return null;

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
    };
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

    // Primary: Next.js embedded JSON state
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!nextDataMatch) {
        throw new Error('Could not find __NEXT_DATA__ in the MyRegistry page. The site structure may have changed.');
    }

    let nextData: unknown;
    try {
        nextData = JSON.parse(nextDataMatch[1]);
    } catch {
        throw new Error('Failed to parse __NEXT_DATA__ JSON from MyRegistry page.');
    }

    const rawItems = findItemsArray(nextData);
    if (!rawItems || rawItems.length === 0) {
        throw new Error(
            'No registry items found in MyRegistry page data. The data structure may have changed.',
        );
    }

    const fetchedAt = new Date().toISOString();
    const items: RegistryItem[] = [];
    for (const raw of rawItems) {
        const normalized = normalizeItem(raw as Record<string, unknown>, fetchedAt);
        if (normalized) items.push(normalized);
    }

    if (items.length === 0) {
        throw new Error('Registry items were found in page data but none could be normalized.');
    }

    return items;
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

        if (isStale) {
            const freshItems = await fetchFromMyRegistry();

            // Replace all cached items with the freshly fetched set
            await supabase.from('registry_items').delete().lte('fetched_at', new Date().toISOString());
            const { error: insertError } = await supabase.from('registry_items').insert(freshItems);
            if (insertError) {
                throw new Error(`Failed to cache registry items: ${insertError.message}`);
            }
        }

        // Return all items from the cache
        const { data: items, error: selectError } = await supabase
            .from('registry_items')
            .select('*')
            .order('is_purchased', { ascending: true })
            .order('name', { ascending: true });

        if (selectError) throw new Error(selectError.message);

        return new Response(JSON.stringify({ success: true, items: items ?? [] }), {
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[fetch-registry]', message);

        // On error, try to return whatever is cached rather than an empty response
        const { data: cachedItems } = await supabase
            .from('registry_items')
            .select('*')
            .order('is_purchased', { ascending: true })
            .order('name', { ascending: true });

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
