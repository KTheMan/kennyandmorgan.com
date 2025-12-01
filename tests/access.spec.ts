import { test, expect } from '@playwright/test';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8000';
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD_ADMIN || 'Binx123!';

test.describe('Access overlay', () => {
    test('unlocks site with admin password', async ({ page }) => {
        await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
        const overlay = page.locator('#accessOverlay');
        await expect(overlay).toBeVisible();

        await page.fill('#accessPassword', ACCESS_PASSWORD);
        await page.click('#accessForm button[type="submit"]');

        await expect(overlay).toBeHidden({ timeout: 5000 });
    });
});
