import { assertEquals } from 'https://deno.land/std@0.224.0/assert/assert_equals.ts';
import { __test } from './index.ts';

Deno.test('resolveRegistryProductUrls keeps MyRegistry flow URL for CTA and preserves direct listing URL', () => {
    const raw = {
        productUrl: 'https://www.target.com/p/some-listing/-/A-12345',
        purchaseUrl: 'https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=111&registryId=222',
    };
    const result = __test.resolveRegistryProductUrls(raw, 'product');

    assertEquals(
        result.productUrl,
        'https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=111&registryId=222',
    );
    assertEquals(result.sourceProductUrl, 'https://www.target.com/p/some-listing/-/A-12345');
});

Deno.test('resolveRegistryProductUrls extracts direct listing URL from flow query params when needed', () => {
    const raw = {
        purchaseUrl:
            'https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=111&registryId=222&url=https%3A%2F%2Fwww.amazon.com%2Fdp%2FB000TEST',
    };
    const result = __test.resolveRegistryProductUrls(raw, 'product');

    assertEquals(result.productUrl?.includes('PurchaseAssistant.aspx'), true);
    assertEquals(result.sourceProductUrl, 'https://www.amazon.com/dp/B000TEST');
});

Deno.test('upgradeImagesFromMyRegistryLinks tries source URL before CTA URL and falls back when needed', async () => {
    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | URL | Request): Promise<Response> => {
        const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        fetchCalls.push(requestUrl);
        const parsedUrl = new URL(requestUrl);

        if (parsedUrl.hostname === 'www.target.com') {
            return new Response('<html><head></head><body>No images here</body></html>', { status: 200 });
        }
        if (parsedUrl.pathname.endsWith('/PurchaseAssistant.aspx')) {
            return new Response(
                '<html><head><meta property="og:image" content="https://cdn.retailer.com/images/product-large.jpg"></head></html>',
                { status: 200 },
            );
        }
        return new Response('', { status: 404 });
    };

    try {
        const [item] = await __test.upgradeImagesFromMyRegistryLinks([{
            id: '1',
            name: 'Item',
            description: null,
            price: null,
            quantity_requested: null,
            quantity_purchased: null,
            image_url: 'https://www.myregistry.com/images/thumb.jpg',
            store_name: null,
            product_url: 'https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=111&registryId=222',
            source_product_url: 'https://www.target.com/p/some-listing/-/A-12345',
            category: null,
            is_purchased: false,
            fetched_at: new Date().toISOString(),
            item_type: 'product',
            action_label: null,
        }]);

        assertEquals(fetchCalls, [
            'https://www.target.com/p/some-listing/-/A-12345',
            'https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=111&registryId=222',
        ]);
        assertEquals(item.image_url, 'https://cdn.retailer.com/images/product-large.jpg');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

Deno.test('upgradeImagesFromMyRegistryLinks skips enrichment for fund items', async () => {
    let called = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (): Promise<Response> => {
        called = true;
        return new Response('', { status: 200 });
    };

    try {
        const [item] = await __test.upgradeImagesFromMyRegistryLinks([{
            id: 'fund-1',
            name: 'Cash Fund',
            description: null,
            price: null,
            quantity_requested: null,
            quantity_purchased: null,
            image_url: 'https://www.myregistry.com/images/thumb.jpg',
            store_name: null,
            product_url: 'https://www.myregistry.com/Visitors/Giftlist/CashGiftProcess.aspx?cashGiftId=111&registryId=222',
            source_product_url: 'https://www.example.com/fund',
            category: null,
            is_purchased: false,
            fetched_at: new Date().toISOString(),
            item_type: 'fund',
            action_label: 'Contribute',
        }]);

        assertEquals(called, false);
        assertEquals(item.image_url, 'https://www.myregistry.com/images/thumb.jpg');
    } finally {
        globalThis.fetch = originalFetch;
    }
});
