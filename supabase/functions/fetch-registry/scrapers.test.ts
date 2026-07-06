import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { assertEquals as assertEq } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import {
  amazonScraper,
  crateAndBarrelScraper,
  createFallbackStrategies,
  createScraper,
  myRegistryScraper,
  scrapeDoScraper,
  scrapingBeeScraper,
  theKnotScraper,
  zolaScraper,
} from "./scrapers/registry.ts";

const FIXTURES_DIR = "./__fixtures__";

async function loadFixture(name: string): Promise<string> {
  return await Deno.readTextFile(`${FIXTURES_DIR}/${name}`);
}

function mockFetch(html: string, url: string) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (
    input: string | URL | Request,
  ): Promise<Response> => {
    const requestUrl = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;

    // We only return the mock HTML if the URL matches what we expect
    // In a real test we might check the URL more specifically
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html" },
      url: url,
    });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

Deno.test("createScraper routes URLs to correct scrapers", () => {
  assertEquals(
    createScraper("https://www.amazon.com/wedding/registry/123").key,
    "amazon",
  );
  assertEquals(
    createScraper(
      "https://www.crateandbarrel.com/gift-registry/view-registry/123",
    ).key,
    "crateandbarrel",
  );
  assertEquals(createScraper("https://www.zola.com/registry/123").key, "zola");
  assertEquals(
    createScraper("https://www.myregistry.com/giftlist/123").key,
    "myregistry",
  );
  assertEquals(
    createScraper("https://www.theknot.com/us/jordan-and-casey/registry").key,
    "theknot",
  );
  assertEquals(
    createScraper("https://www.unknown.com/registry/123").key,
    "myregistry",
  ); // Fallback
});

Deno.test("AmazonScraper parses items correctly", async () => {
  const html = await loadFixture("amazon-registry.html");
  const url = "https://www.amazon.com/wedding/registry/123";
  const restore = mockFetch(html, url);

  try {
    const items = await amazonScraper.fetchItems(url);
    assertEquals(items.length, 2);

    assertEquals(items[0].name, "High-End Toaster");
    assertEquals(items[0].price, 99.99);
    assertEquals(items[0].store_name, "amazon");
    assertEquals(items[0].product_url, "https://www.amazon.com/dp/B012345678");

    assertEquals(items[1].name, "Luxury Blender");
    assertEquals(items[1].price, 299.00);
  } finally {
    restore();
  }
});

Deno.test("CrateAndBarrelScraper parses items correctly", async () => {
  const html = await loadFixture("crateandbarrel-registry.html");
  const url = "https://www.crateandbarrel.com/gift-registry/view-registry/123";
  const restore = mockFetch(html, url);

  try {
    const items = await crateAndBarrelScraper.fetchItems(url);
    assertEquals(items.length, 2); // Should ignore the emptyCategoryRow

    assertEquals(items[0].name, "Set of Plates");
    assertEquals(items[0].price, 45.00);
    assertEquals(items[0].quantity_requested, 2);
    assertEquals(items[0].quantity_purchased, 1);
    assertEquals(items[0].is_purchased, false);

    assertEquals(items[1].name, "Wine Glasses");
    assertEquals(items[1].price, 30.00);
    assertEquals(items[1].quantity_requested, 4);
    assertEquals(items[1].quantity_purchased, 4);
    assertEquals(items[1].is_purchased, true);
  } finally {
    restore();
  }
});

Deno.test("ZolaScraper parses items correctly", async () => {
  const html = await loadFixture("zola-registry.html");
  const url = "https://www.zola.com/registry/123";
  const restore = mockFetch(html, url);

  try {
    const items = await zolaScraper.fetchItems(url);
    assertEquals(items.length, 2);

    assertEquals(items[0].name, "Cozy Throw Blanket");
    assertEquals(items[0].price, 50.00);
    assertEquals(items[0].item_type, "product");
    assertEquals(items[0].quantity_requested, 1);
    assertEquals(items[0].quantity_purchased, 0);

    assertEquals(items[1].name, "Honeymoon Fund");
    assertEquals(items[1].price, 1000.00);
    assertEquals(items[1].item_type, "fund");
    assertEquals(items[1].action_label, "Contribute");
  } finally {
    restore();
  }
});

Deno.test("MyRegistryScraper parses items from JSON-LD and HTML markup", async () => {
  const html = await loadFixture("myregistry-registry.html");
  const url = "https://www.myregistry.com/giftlist/123";
  const restore = mockFetch(html, url);

  try {
    const items = await myRegistryScraper.fetchItems(url);
    // It should merge JSON-LD and HTML items
    assertEquals(items.length, 3);

    const jsonItem = items.find((i) => i.id === "myreg-json-1");
    assertEquals(jsonItem?.name, "JSON-LD Item");
    assertEquals(jsonItem?.price, 120.00);

    const htmlItem = items.find((i) => i.id === "myreg-html-1");
    assertEquals(htmlItem?.name, "HTML Markup Item");
    assertEquals(htmlItem?.price, 75.00);
    assertEquals(htmlItem?.store_name, "Amazon");

    const fundItem = items.find((i) => i.id === "myreg-cash-1");
    assertEquals(fundItem?.name, "Cash Fund");
    assertEquals(fundItem?.item_type, "fund");
    assertEquals(fundItem?.action_label, "Contribute");
  } finally {
    restore();
  }
});

Deno.test("TheKnotScraper parses items from __NEXT_DATA__", async () => {
  const html = await loadFixture("theknot-registry.html");
  const url = "https://www.theknot.com/us/jordan-and-casey/registry";
  const restore = mockFetch(html, url);

  try {
    const items = await theKnotScraper.fetchItems(url);
    assertEquals(items.length, 2);

    assertEquals(items[0].name, "Stand Mixer");
    assertEquals(items[0].price, 299.99);
    assertEquals(items[0].store_name, "Amazon");
    assertEquals(items[0].product_url, "https://www.amazon.com/dp/B012345678");
    assertEquals(items[0].is_purchased, false);

    assertEquals(items[1].name, "Wine Glasses");
    assertEquals(items[1].price, 45);
    assertEquals(items[1].store_name, "Crate & Barrel");
    assertEquals(items[1].is_purchased, true);
  } finally {
    restore();
  }
});

Deno.test("parseAndNormalize bypasses fetch for retailer scrapers", async () => {
  const html = await loadFixture("amazon-registry.html");
  const url = "https://www.amazon.com/wedding/registry/123";
  const items = amazonScraper.parseAndNormalize(html, url);

  assertEquals(items.length, 2);
  assertEquals(items[0].name, "High-End Toaster");
  assertEquals(items[0].price, 99.99);
  assertEquals(items[0].store_name, "amazon");
});

Deno.test("createFallbackStrategies uses native + proxy tiers for anti-bot hosts", () => {
  const amazonStrategies = createFallbackStrategies(
    "https://www.amazon.com/wedding/registry/123",
  );
  assertEquals(amazonStrategies.map((s) => s.key), [
    "amazon",
    "scrape.do",
    "scrapingbee",
  ]);

  const knotStrategies = createFallbackStrategies(
    "https://www.theknot.com/us/jordan-and-casey/registry",
  );
  assertEquals(knotStrategies.map((s) => s.key), [
    "theknot",
    "scrape.do",
    "scrapingbee",
  ]);
});

Deno.test("createFallbackStrategies does not add proxy tiers for non-anti-bot hosts", () => {
  const strategies = createFallbackStrategies(
    "https://www.myregistry.com/giftlist/123",
  );
  assertEquals(strategies.map((s) => s.key), ["myregistry"]);
});

Deno.test("scrapeDoScraper matches known anti-bot hosts", () => {
  assertEquals(
    scrapeDoScraper.matches("https://www.amazon.com/wedding/registry/123"),
    true,
  );
  assertEquals(
    scrapeDoScraper.matches(
      "https://www.crateandbarrel.com/gift-registry/view-registry/123",
    ),
    true,
  );
  assertEquals(
    scrapeDoScraper.matches(
      "https://www.theknot.com/us/jordan-and-casey/registry",
    ),
    true,
  );
  assertEquals(
    scrapeDoScraper.matches("https://www.zola.com/registry/123"),
    false,
  );
});

Deno.test("scrapingBeeScraper matches known anti-bot hosts", () => {
  assertEquals(
    scrapingBeeScraper.matches("https://www.amazon.com/wedding/registry/123"),
    true,
  );
  assertEquals(
    scrapingBeeScraper.matches(
      "https://www.crateandbarrel.com/gift-registry/view-registry/123",
    ),
    true,
  );
  assertEquals(
    scrapingBeeScraper.matches(
      "https://www.theknot.com/us/jordan-and-casey/registry",
    ),
    true,
  );
  assertEquals(
    scrapingBeeScraper.matches("https://www.zola.com/registry/123"),
    false,
  );
});
