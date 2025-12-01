import { test, expect } from '@playwright/test';

const MAP_CONTAINER = '#accommodationMap';

async function waitForLeaflet(page) {
    await page.waitForFunction(
        selector => document.querySelector(selector)?.classList.contains('leaflet-container'),
        MAP_CONTAINER
    );
    await page.waitForFunction(
        selector => document.querySelector(selector)?.querySelectorAll('.leaflet-interactive').length,
        MAP_CONTAINER
    );
}

test.describe('Accommodations map', () => {
    test('renders the Leaflet map and creates a marker for every accommodation', async ({ page }) => {
        await page.goto('/index.html');
        await waitForLeaflet(page);

        const tile = page.locator(`${MAP_CONTAINER} .leaflet-tile`).first();
        await expect(tile).toBeVisible();

        const cardCount = await page.locator('.accommodation-item').count();
        const venueCount = await page.locator('[data-venue-card="hollins-house"]').count();
        const markerCount = await page.locator(`${MAP_CONTAINER} .leaflet-interactive`).count();
        expect(markerCount).toBeGreaterThan(0);
        expect(markerCount).toBe(cardCount + venueCount);
    });
});
