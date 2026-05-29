import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { __test } from "./index.ts";

Deno.test("resolveRegistryProductUrls keeps MyRegistry flow URL for CTA and preserves direct listing URL", () => {
  const raw = {
    productUrl: "https://www.target.com/p/some-listing/-/A-12345",
    purchaseUrl:
      "https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=111&registryId=222",
  };
  const result = __test.resolveRegistryProductUrls(raw, "product");

  assertEquals(
    result.productUrl,
    "https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=111&registryId=222",
  );
  assertEquals(
    result.sourceProductUrl,
    "https://www.target.com/p/some-listing/-/A-12345",
  );
});

Deno.test("resolveRegistryProductUrls extracts direct listing URL from flow query params when needed", () => {
  const raw = {
    purchaseUrl:
      "https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=111&registryId=222&url=https%3A%2F%2Fwww.amazon.com%2Fdp%2FB000TEST",
  };
  const result = __test.resolveRegistryProductUrls(raw, "product");

  assertEquals(result.productUrl?.includes("PurchaseAssistant.aspx"), true);
  assertEquals(result.sourceProductUrl, "https://www.amazon.com/dp/B000TEST");
});

Deno.test("upgradeImagesFromMyRegistryLinks tries source URL before CTA URL and falls back when needed", async () => {
  const fetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (
    input: string | URL | Request,
  ): Promise<Response> => {
    const requestUrl = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    fetchCalls.push(requestUrl);
    const parsedUrl = new URL(requestUrl);

    if (parsedUrl.hostname === "www.target.com") {
      return new Response(
        "<html><head></head><body>No images here</body></html>",
        { status: 200 },
      );
    }
    if (parsedUrl.pathname.endsWith("/PurchaseAssistant.aspx")) {
      return new Response(
        '<html><head><meta property="og:image" content="https://cdn.retailer.com/images/product-large.jpg"></head></html>',
        { status: 200 },
      );
    }
    return new Response("", { status: 404 });
  };

  try {
    const [item] = await __test.upgradeImagesFromMyRegistryLinks([{
      id: "1",
      name: "Item",
      description: null,
      price: null,
      quantity_requested: null,
      quantity_purchased: null,
      image_url: "https://www.myregistry.com/images/thumb.jpg",
      store_name: null,
      product_url:
        "https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=111&registryId=222",
      source_product_url: "https://www.target.com/p/some-listing/-/A-12345",
      category: null,
      is_purchased: false,
      fetched_at: new Date().toISOString(),
      item_type: "product",
      action_label: null,
    }]);

    assertEquals(fetchCalls, [
      "https://www.target.com/p/some-listing/-/A-12345",
      "https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=111&registryId=222",
    ]);
    assertEquals(
      item.image_url,
      "https://cdn.retailer.com/images/product-large.jpg",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("upgradeImagesFromMyRegistryLinks crawls deeper follow-up retailer pages for better images", async () => {
  const fetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (
    input: string | URL | Request,
  ): Promise<Response> => {
    const requestUrl = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    fetchCalls.push(requestUrl);

    if (requestUrl === "https://www.target.com/p/some-listing/-/A-12345") {
      return new Response(
        '<html><body><a href="https://www.target.com/routing-page">Continue</a></body></html>',
        { status: 200 },
      );
    }

    if (requestUrl === "https://www.target.com/routing-page") {
      return new Response(
        '<html><body><a href="https://www.amazon.com/dp/B000TEST">Amazon PDP</a></body></html>',
        { status: 200 },
      );
    }

    if (requestUrl === "https://www.amazon.com/dp/B000TEST") {
      return new Response(
        '<html><head><meta property="og:image" content="https://images.amazon.com/images/I/hires-main.jpg"></head></html>',
        { status: 200 },
      );
    }

    return new Response("", { status: 404 });
  };

  try {
    const [item] = await __test.upgradeImagesFromMyRegistryLinks([{
      id: "deep-1",
      name: "Deep Item",
      description: null,
      price: null,
      quantity_requested: null,
      quantity_purchased: null,
      image_url: "https://www.myregistry.com/images/thumb.jpg",
      store_name: null,
      product_url:
        "https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=111&registryId=222",
      source_product_url: "https://www.target.com/p/some-listing/-/A-12345",
      category: null,
      is_purchased: false,
      fetched_at: new Date().toISOString(),
      item_type: "product",
      action_label: null,
    }]);

    const calledUrls = new Set(fetchCalls);
    assertEquals(calledUrls.has("https://www.target.com/routing-page"), true);
    assertEquals(calledUrls.has("https://www.amazon.com/dp/B000TEST"), true);
    assertEquals(
      item.image_url,
      "https://images.amazon.com/images/I/hires-main.jpg",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("upgradeImagesFromMyRegistryLinks prioritizes PDP follow-up links before generic links", async () => {
  const fetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (
    input: string | URL | Request,
  ): Promise<Response> => {
    const requestUrl = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    fetchCalls.push(requestUrl);

    if (requestUrl === "https://www.amazon.com/gp/registry-item") {
      return new Response(
        "<html><body>" +
          '<a href="https://www.amazon.com/s?k=test">Search</a>' +
          '<a href="https://www.amazon.com/dp/B000TEST">PDP</a>' +
          "</body></html>",
        { status: 200 },
      );
    }
    if (requestUrl === "https://www.amazon.com/dp/B000TEST") {
      return new Response(
        '<html><head><meta property="og:image" content="https://images.amazon.com/images/I/pdp-large.jpg"></head></html>',
        { status: 200 },
      );
    }
    if (requestUrl === "https://www.amazon.com/s?k=test") {
      return new Response("<html><body>Search results</body></html>", {
        status: 200,
      });
    }

    return new Response("", { status: 404 });
  };

  try {
    const [item] = await __test.upgradeImagesFromMyRegistryLinks([{
      id: "priority-1",
      name: "Priority Item",
      description: null,
      price: null,
      quantity_requested: null,
      quantity_purchased: null,
      image_url: "https://www.myregistry.com/images/thumb.jpg",
      store_name: null,
      product_url:
        "https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=111&registryId=222",
      source_product_url: "https://www.amazon.com/gp/registry-item",
      category: null,
      is_purchased: false,
      fetched_at: new Date().toISOString(),
      item_type: "product",
      action_label: null,
    }]);

    assertEquals(fetchCalls[1], "https://www.amazon.com/dp/B000TEST");
    assertEquals(
      item.image_url,
      "https://images.amazon.com/images/I/pdp-large.jpg",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("upgradeImagesFromMyRegistryLinks prefers largest srcset candidate", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (
    input: string | URL | Request,
  ): Promise<Response> => {
    const requestUrl = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    if (requestUrl === "https://www.target.com/p/some-listing/-/A-12345") {
      return new Response(
        '<html><body><img srcset="https://cdn.retailer.com/images/item-small.jpg 300w, https://cdn.retailer.com/images/item-large.jpg 1200w"></body></html>',
        { status: 200 },
      );
    }
    return new Response("", { status: 404 });
  };

  try {
    const [item] = await __test.upgradeImagesFromMyRegistryLinks([{
      id: "srcset-1",
      name: "Srcset Item",
      description: null,
      price: null,
      quantity_requested: null,
      quantity_purchased: null,
      image_url: "https://www.myregistry.com/images/thumb.jpg",
      store_name: null,
      product_url:
        "https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=111&registryId=222",
      source_product_url: "https://www.target.com/p/some-listing/-/A-12345",
      category: null,
      is_purchased: false,
      fetched_at: new Date().toISOString(),
      item_type: "product",
      action_label: null,
    }]);

    assertEquals(
      item.image_url,
      "https://cdn.retailer.com/images/item-large.jpg",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("upgradeImagesFromMyRegistryLinks treats duplicate image candidates as reranking penalty", async () => {
  const fetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (
    input: string | URL | Request,
  ): Promise<Response> => {
    const requestUrl = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    fetchCalls.push(requestUrl);

    if (requestUrl === "https://www.target.com/p/some-listing/-/A-12345") {
      return new Response(
        '<html><head><meta property="og:image" content="https://cdn.retailer.com/images/item.jpg?size=small"></head></html>',
        { status: 200 },
      );
    }
    if (
      requestUrl ===
        "https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=111&registryId=222"
    ) {
      return new Response(
        '<html><head><meta property="og:image" content="https://cdn.retailer.com/images/item_large.jpg"></head></html>',
        { status: 200 },
      );
    }
    return new Response("", { status: 404 });
  };

  try {
    const [item] = await __test.upgradeImagesFromMyRegistryLinks([{
      id: "dup-1",
      name: "Duplicate Item",
      description: null,
      price: null,
      quantity_requested: null,
      quantity_purchased: null,
      image_url: "https://cdn.retailer.com/images/item.jpg",
      store_name: null,
      product_url:
        "https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=111&registryId=222",
      source_product_url: "https://www.target.com/p/some-listing/-/A-12345",
      category: null,
      is_purchased: false,
      fetched_at: new Date().toISOString(),
      item_type: "product",
      action_label: null,
    }]);

    assertEquals(fetchCalls, [
      "https://www.target.com/p/some-listing/-/A-12345",
      "https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=111&registryId=222",
    ]);
    assertEquals(
      item.image_url,
      "https://cdn.retailer.com/images/item_large.jpg",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("upgradeImagesFromMyRegistryLinks skips enrichment for fund items", async () => {
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (): Promise<Response> => {
    called = true;
    return new Response("", { status: 200 });
  };

  try {
    const [item] = await __test.upgradeImagesFromMyRegistryLinks([{
      id: "fund-1",
      name: "Cash Fund",
      description: null,
      price: null,
      quantity_requested: null,
      quantity_purchased: null,
      image_url: "https://www.myregistry.com/images/thumb.jpg",
      store_name: null,
      product_url:
        "https://www.myregistry.com/Visitors/Giftlist/CashGiftProcess.aspx?cashGiftId=111&registryId=222",
      source_product_url: "https://www.example.com/fund",
      category: null,
      is_purchased: false,
      fetched_at: new Date().toISOString(),
      item_type: "fund",
      action_label: "Contribute",
    }]);

    assertEquals(called, false);
    assertEquals(item.image_url, "https://www.myregistry.com/images/thumb.jpg");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("selectBackgroundEnrichmentCandidates prioritizes neediest items and respects limit", () => {
  const fetchedAt = new Date().toISOString();
  const { candidates, totalEligible, skippedAlreadyGood } = __test
    .selectBackgroundEnrichmentCandidates([
      {
        id: "good",
        name: "Already Good",
        description: null,
        price: null,
        quantity_requested: null,
        quantity_purchased: null,
        image_url: "https://www.myregistry.com/images/thumb.jpg",
        registry_image_url: "https://www.myregistry.com/images/thumb.jpg",
        resolved_image_url: "https://cdn.retailer.com/images/main.jpg",
        store_name: null,
        product_url:
          "https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=1&registryId=1",
        source_product_url: "https://www.target.com/p/item/-/A-1",
        category: null,
        is_purchased: false,
        fetched_at: fetchedAt,
        item_type: "product",
        action_label: null,
        image_marked_for_retry: false,
        image_manually_cleared: false,
        image_blacklisted: false,
        image_suspicious: false,
        image_low_confidence: false,
      },
      {
        id: "missing-resolved",
        name: "Missing Resolved",
        description: null,
        price: null,
        quantity_requested: null,
        quantity_purchased: null,
        image_url: "https://www.myregistry.com/images/thumb.jpg",
        registry_image_url: "https://www.myregistry.com/images/thumb.jpg",
        resolved_image_url: null,
        store_name: null,
        product_url:
          "https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=2&registryId=1",
        source_product_url: "https://www.target.com/p/item/-/A-2",
        category: null,
        is_purchased: false,
        fetched_at: fetchedAt,
        item_type: "product",
        action_label: null,
        image_marked_for_retry: false,
        image_manually_cleared: false,
        image_blacklisted: false,
        image_suspicious: false,
        image_low_confidence: false,
      },
      {
        id: "retry",
        name: "Retry Flagged",
        description: null,
        price: null,
        quantity_requested: null,
        quantity_purchased: null,
        image_url: "https://www.myregistry.com/images/thumb.jpg",
        registry_image_url: "https://www.myregistry.com/images/thumb.jpg",
        resolved_image_url: "https://www.myregistry.com/images/source.jpg",
        store_name: null,
        product_url:
          "https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=3&registryId=1",
        source_product_url: "https://www.target.com/p/item/-/A-3",
        category: null,
        is_purchased: false,
        fetched_at: fetchedAt,
        item_type: "product",
        action_label: null,
        image_marked_for_retry: true,
        image_manually_cleared: false,
        image_blacklisted: false,
        image_suspicious: false,
        image_low_confidence: false,
      },
      {
        id: "low-confidence",
        name: "Low Confidence",
        description: null,
        price: null,
        quantity_requested: null,
        quantity_purchased: null,
        image_url: "https://cdn.retailer.com/images/main.jpg",
        registry_image_url: "https://cdn.retailer.com/images/main.jpg",
        resolved_image_url: "https://cdn.retailer.com/images/main.jpg",
        store_name: null,
        product_url:
          "https://www.myregistry.com/Visitors/Giftlist/PurchaseAssistant.aspx?giftId=4&registryId=1",
        source_product_url: "https://www.target.com/p/item/-/A-4",
        category: null,
        is_purchased: false,
        fetched_at: fetchedAt,
        item_type: "product",
        action_label: null,
        image_marked_for_retry: false,
        image_manually_cleared: false,
        image_blacklisted: false,
        image_suspicious: false,
        image_low_confidence: true,
      },
      {
        id: "fund",
        name: "Fund",
        description: null,
        price: null,
        quantity_requested: null,
        quantity_purchased: null,
        image_url: "https://www.myregistry.com/images/thumb.jpg",
        registry_image_url: "https://www.myregistry.com/images/thumb.jpg",
        resolved_image_url: null,
        store_name: null,
        product_url:
          "https://www.myregistry.com/Visitors/Giftlist/CashGiftProcess.aspx?cashGiftId=111&registryId=222",
        source_product_url: "https://www.example.com/fund",
        category: null,
        is_purchased: false,
        fetched_at: fetchedAt,
        item_type: "fund",
        action_label: "Contribute",
        image_marked_for_retry: false,
        image_manually_cleared: false,
        image_blacklisted: false,
        image_suspicious: false,
        image_low_confidence: false,
      },
    ], 2);

  assertEquals(totalEligible, 3);
  assertEquals(skippedAlreadyGood, 1);
  assertEquals(candidates.map((candidate) => candidate.item.id), [
    "missing-resolved",
    "retry",
  ]);
});

Deno.test("parseBackgroundEnrichmentLimit uses default for unset or invalid values", () => {
  assertEquals(
    __test.parseBackgroundEnrichmentLimit(
      new URL("https://example.com/functions/v1/fetch-registry?mode=enrich"),
    ),
    5,
  );
  assertEquals(
    __test.parseBackgroundEnrichmentLimit(
      new URL(
        "https://example.com/functions/v1/fetch-registry?mode=enrich&limit=0",
      ),
    ),
    5,
  );
  assertEquals(
    __test.parseBackgroundEnrichmentLimit(
      new URL(
        "https://example.com/functions/v1/fetch-registry?mode=enrich&limit=abc",
      ),
    ),
    5,
  );
  assertEquals(
    __test.parseBackgroundEnrichmentLimit(
      new URL(
        "https://example.com/functions/v1/fetch-registry?mode=enrich&limit=7",
      ),
    ),
    7,
  );
});
