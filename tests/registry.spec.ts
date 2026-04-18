import { test, expect } from '@playwright/test';

const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD_ADMIN || 'local-preview-password';

test.describe('Registry rendering', () => {
    test('renders fund items and uses contribute CTA for cash gifts', async ({ page }) => {
        await page.route('**/site.config.json', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    registryPageUrl: 'https://www.myregistry.com/giftlist/morganandkenny',
                    supabase: {
                        url: 'https://example.supabase.co',
                        anonKey: 'public-anon-key',
                        sessionTtlMs: 3600000
                    }
                })
            });
        });

        await page.route('**/functions/v1/fetch-registry', async route => {
            await route.fulfill({
                status: 200,
                headers: {
                    'access-control-allow-origin': '*',
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    success: true,
                    items: [
                        {
                            id: 'fund-1',
                            name: 'Honeymoon Fund',
                            description: 'Help us make memories',
                            image_url: null,
                            store_name: null,
                            product_url: 'https://www.myregistry.com/giftlist/morganandkenny',
                            category: null,
                            is_purchased: true,
                            fetched_at: new Date().toISOString()
                        },
                        {
                            id: 'item-1',
                            name: 'Toaster',
                            price: 49.99,
                            quantity_requested: 1,
                            quantity_purchased: 0,
                            image_url: 'https://example.com/toaster.jpg',
                            store_name: 'Target',
                            product_url: 'https://example.com/toaster',
                            category: null,
                            is_purchased: false,
                            fetched_at: new Date().toISOString(),
                            item_type: 'product'
                        },
                        {
                            id: 'item-2',
                            name: 'Mixer',
                            price: 199.99,
                            quantity_requested: 1,
                            quantity_purchased: 1,
                            image_url: null,
                            store_name: 'Target',
                            product_url: 'https://example.com/mixer',
                            category: null,
                            is_purchased: true,
                            fetched_at: new Date().toISOString(),
                            item_type: 'product'
                        }
                    ]
                })
            });
        });

        await page.goto('/index.html');
        await page.fill('#accessPassword', ACCESS_PASSWORD);
        await page.click('#accessForm button[type="submit"]');
        await expect(page.locator('#accessOverlay')).toBeHidden({ timeout: 5000 });
        await page.click('a[href="#registry"]');
        await expect(page.locator('#registry')).toBeVisible();

        const registryCards = page.locator('#registryGrid .registry-card');
        await expect(registryCards).toHaveCount(2);

        const fundCard = page.locator('#registryGrid .registry-card').filter({ hasText: 'Honeymoon Fund' });
        await expect(fundCard).toBeVisible();
        await expect(fundCard.locator('.registry-card-btn')).toHaveText('Contribute');
        await expect(fundCard.locator('.registry-card-store')).toHaveText('Cash Fund');
        await expect(fundCard.locator('.registry-card-qty-wrap')).toHaveCount(0);

        const productCard = page.locator('#registryGrid .registry-card').filter({ hasText: 'Toaster' });
        await expect(productCard).toBeVisible();
        await expect(productCard.locator('.registry-card-store')).toHaveText('Target');
        await expect(productCard.locator('.registry-card-price')).toHaveText('$49.99');
        await expect(productCard.locator('.registry-card-qty')).toHaveText('1 still needed');
        await expect(productCard.locator('.registry-card-qty-detail')).toHaveText('0 purchased / 1 desired');
        await expect(productCard.locator('.registry-card-img')).toHaveAttribute('src', 'https://example.com/toaster.jpg');
    });
});
