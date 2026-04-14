import { test, expect } from '@playwright/test';

const MAP_CONTAINER = '#accommodationMap';
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD_ADMIN || 'Binx123!';

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
        await page.fill('#accessPassword', ACCESS_PASSWORD);
        await page.click('#accessForm button[type="submit"]');
        await expect(page.locator('#accessOverlay')).toBeHidden({ timeout: 5000 });
        await waitForLeaflet(page);

        await expect(page.locator(MAP_CONTAINER)).toBeVisible();

        const cardCount = await page.locator('.accommodation-item').count();
        const venueCount = await page.locator('[data-venue-card="hollins-house"]').count();
        const markerCount = await page.locator(`${MAP_CONTAINER} .leaflet-interactive`).count();
        expect(markerCount).toBeGreaterThan(0);
        expect(markerCount).toBe(cardCount + venueCount);
    });
});
