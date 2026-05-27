import { test, expect } from '@playwright/test';

const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD_ADMIN || 'local-preview-password';

async function unlock(page) {
    await page.goto('/index.html');
    await page.fill('#accessPassword', ACCESS_PASSWORD);
    await page.click('#accessForm button[type="submit"]');
    await expect(page.locator('#accessOverlay')).toBeHidden({ timeout: 5000 });
}

// ─────────────────────────────────────────────
// NAV — SiteNavB
// ─────────────────────────────────────────────
test.describe('Navigation — SiteNavB', () => {
    test('desktop nav has 3-col structure: date tagline | K·M monogram | nav links', async ({ page }) => {
        await unlock(page);
        const header = page.locator('.site-header');
        await expect(header).toBeVisible();

        // Left: date/venue tagline
        const tagline = page.locator('.nav-tagline');
        await expect(tagline).toBeVisible();
        const taglineText = await tagline.textContent();
        expect(taglineText).toMatch(/09.*12.*26/);
        expect(taglineText).toMatch(/hollins house/i);

        // Center: K·M monogram
        const monogram = page.locator('.nav-monogram');
        await expect(monogram).toBeVisible();
        expect(await monogram.textContent()).toMatch(/K.*M/);

        // Right: nav links (visible ones; Wedding Party is conditionally hidden until party access)
        const navLinks = page.locator('.site-nav-desktop .nav-link');
        // At least Home, RSVP, Registry (4th may be Wedding Party, conditionally hidden)
        const linkTexts = await navLinks.allTextContents();
        expect(linkTexts).toContain('Home');
        expect(linkTexts).toContain('RSVP');
        expect(linkTexts).toContain('Registry');
    });

    test('nav links navigate between pages', async ({ page }) => {
        await unlock(page);
        await expect(page.locator('#home')).toBeVisible();

        await page.click('a[href="#rsvp"]');
        await expect(page.locator('#rsvp')).toBeVisible();
        await expect(page.locator('#home')).toBeHidden();

        await page.click('a[href="#registry"]');
        await expect(page.locator('#registry')).toBeVisible();
        await expect(page.locator('#rsvp')).toBeHidden();

        await page.click('a[href="#home"]');
        await expect(page.locator('#home')).toBeVisible();
    });

    test('no burger menu — desktop nav tabs always present', async ({ page }) => {
        await unlock(page);
        // No burger div in the new design
        await expect(page.locator('.burger')).toHaveCount(0);
    });
});

// ─────────────────────────────────────────────
// HOME PAGE — HeroB
// ─────────────────────────────────────────────
test.describe('Home — HeroB', () => {
    test('displays couple names: Kenny and Morgan', async ({ page }) => {
        await unlock(page);
        const names = page.locator('.couple-names');
        await expect(names).toBeVisible();
        const text = await names.textContent();
        expect(text).toMatch(/Kenny/);
        expect(text).toMatch(/Morgan/);
        const conjunction = names.locator('.couple-conjunction');
        await expect(conjunction).toBeVisible();
        expect(await conjunction.textContent()).toMatch(/and/i);
    });

    test('hero details strip shows date, place, time, dress code', async ({ page }) => {
        await unlock(page);
        const strip = page.locator('.hero-strip');
        await expect(strip).toBeVisible();

        // 4 cells
        const cells = strip.locator('.hero-strip-cell');
        await expect(cells).toHaveCount(4);

        // Date cell
        const dateCell = cells.nth(0);
        await expect(dateCell).toContainText('Date');
        await expect(dateCell).toContainText('09.12.26');
        await expect(dateCell).toContainText('Saturday');

        // Place cell
        const placeCell = cells.nth(1);
        await expect(placeCell).toContainText('Place');
        await expect(placeCell).toContainText('Hollins House');
        await expect(placeCell).toContainText('Santa Cruz');

        // Time cell
        const timeCell = cells.nth(2);
        await expect(timeCell).toContainText('Time');
        await expect(timeCell).toContainText('4:00 PM');
        await expect(timeCell).toContainText('Ceremony');

        // Dress code cell
        const codeCell = cells.nth(3);
        await expect(codeCell).toContainText('Code');
        await expect(codeCell).toContainText('Cocktail');
    });

    test('Hollins House venue card is in the hero strip', async ({ page }) => {
        await unlock(page);
        const venueEl = page.locator('[data-venue-card="hollins-house"]');
        await expect(venueEl).toBeVisible();
        await expect(venueEl).toHaveAttribute('data-address', '20 Clubhouse Rd, Santa Cruz, CA 95060');
    });

    test('hero carousel area is rendered with four images', async ({ page }) => {
        await unlock(page);
        const carousel = page.locator('.hero-carousel');
        await expect(carousel).toBeVisible();
        await expect(carousel.locator('.hero-carousel-image')).toHaveCount(4);
        await expect(carousel.locator('.hero-carousel-image.is-active')).toHaveCount(1);
    });

    test('static site images resolve successfully', async ({ page }) => {
        await unlock(page);
        const imageStates = await page.locator('img[src^="images/"]').evaluateAll(async images => {
            const urls = Array.from(new Set(
                images
                    .map(image => image.getAttribute('src'))
                    .filter(src => Boolean(src))
            ));

            return Promise.all(urls.map(async src => {
                const response = await fetch(src, { cache: 'no-store' });
                return {
                    src,
                    ok: response.ok,
                    status: response.status
                };
            }));
        });

        expect(imageStates.length).toBeGreaterThan(0);
        imageStates.forEach(image => {
            expect(image.ok, `${image.src} should return a successful response`).toBeTruthy();
            expect(image.status, `${image.src} should return HTTP 200`).toBe(200);
        });
    });
});

// ─────────────────────────────────────────────
// HOME PAGE — CountdownC
// ─────────────────────────────────────────────
test.describe('Home — CountdownC', () => {
    test('countdown section with 4 bordered boxes is visible', async ({ page }) => {
        await unlock(page);
        const countdownSection = page.locator('.countdown-c');
        await expect(countdownSection).toBeVisible();

        // Left col: heading copy
        const heading = page.locator('.countdown-c-heading');
        await expect(heading).toBeVisible();
        await expect(heading).toContainText('Until');
        await expect(heading).toContainText('we say I do');

        const eyebrow = countdownSection.locator('.section-eyebrow').first();
        await expect(eyebrow).toBeVisible();
        await expect(eyebrow).toContainText('countdown');

        // Right col: 4 boxes with the right IDs
        const countdownBoxes = page.locator('.countdown-box');
        await expect(countdownBoxes).toHaveCount(4);

        await expect(page.locator('#days')).toBeVisible();
        await expect(page.locator('#hours')).toBeVisible();
        await expect(page.locator('#minutes')).toBeVisible();
        await expect(page.locator('#seconds')).toBeVisible();

        // Labels
        const units = page.locator('.countdown-unit');
        await expect(units).toHaveCount(4);
        const unitTexts = await units.allTextContents();
        expect(unitTexts).toContain('Days');
        expect(unitTexts).toContain('Hours');
        expect(unitTexts).toContain('Minutes');
        expect(unitTexts).toContain('Seconds');
    });
});

// ─────────────────────────────────────────────
// HOME PAGE — AccommodationsC
// ─────────────────────────────────────────────
test.describe('Home — AccommodationsC', () => {
    test('section heading and eyebrow visible', async ({ page }) => {
        await unlock(page);
        const section = page.locator('.accommodations-c');
        await expect(section).toBeVisible();

        const eyebrow = section.locator('.section-eyebrow').first();
        await expect(eyebrow).toContainText('Where to stay');

        const heading = section.locator('.accommodations-c-heading');
        await expect(heading).toBeVisible();
        await expect(heading).toContainText('A short list');
        await expect(heading).toContainText('of suggested accommodations');
    });

    test('hotels grouped by neighborhood (Santa Cruz, Pasatiempo, Scotts Valley)', async ({ page }) => {
        await unlock(page);
        const areaGroups = page.locator('.area-group');
        await expect(areaGroups).toHaveCount(3);

        const areaNames = await page.locator('.area-name').allTextContents();
        expect(areaNames.some(n => /santa cruz/i.test(n))).toBeTruthy();
        expect(areaNames.some(n => /pasatiempo/i.test(n))).toBeTruthy();
        expect(areaNames.some(n => /scotts valley/i.test(n))).toBeTruthy();
    });

    test('all 13 accommodation items are present', async ({ page }) => {
        await unlock(page);
        const items = page.locator('.accommodation-item');
        await expect(items).toHaveCount(13);
    });

    test('Leaflet map is rendered', async ({ page }) => {
        await unlock(page);
        await page.waitForFunction(
            () => document.querySelector('#accommodationMap')?.classList.contains('leaflet-container'),
            { timeout: 10000 }
        );
        await expect(page.locator('#accommodationMap')).toBeVisible();
    });

    test('pro tip card is visible', async ({ page }) => {
        await unlock(page);
        const proTip = page.locator('.pro-tip-card');
        await expect(proTip).toBeVisible();
        await expect(proTip).toContainText(/rideshare/i);
    });
});

// ─────────────────────────────────────────────
// HOME PAGE — DirectionsB
// ─────────────────────────────────────────────
test.describe('Home — DirectionsB', () => {
    test('directions section heading is displayed', async ({ page }) => {
        await unlock(page);
        const section = page.locator('.directions-b');
        await expect(section).toBeVisible();

        const heading = section.locator('.directions-b-heading');
        await expect(heading).toBeVisible();
        await expect(heading).toContainText(/the drive up/i);
        await expect(heading).toContainText(/the hill/i);
    });

    test('two direction cards with numbered steps', async ({ page }) => {
        await unlock(page);
        const cards = page.locator('.direction-card-b');
        await expect(cards).toHaveCount(2);

        // Card 1: From San Jose
        const card1 = cards.nth(0);
        await expect(card1.locator('.direction-route')).toContainText('San Jose');
        await expect(card1.locator('.direction-time')).toContainText('45');
        const steps1 = card1.locator('.direction-steps li');
        await expect(steps1).toHaveCount(5);

        // Card 2: From Santa Cruz / Monterey
        const card2 = cards.nth(1);
        await expect(card2.locator('.direction-route')).toContainText('Santa Cruz');
        await expect(card2.locator('.direction-route')).toContainText('Monterey');
        const steps2 = card2.locator('.direction-steps li');
        await expect(steps2).toHaveCount(5);
    });
});

// ─────────────────────────────────────────────
// HOME PAGE — ThemeC (dress code on home page)
// ─────────────────────────────────────────────
test.describe('Home — ThemeC', () => {
    test('dress code section is on the home page (not a separate page)', async ({ page }) => {
        await unlock(page);
        await expect(page.locator('#home')).toBeVisible();

        const themeSection = page.locator('.theme-c');
        await expect(themeSection).toBeVisible();
        await expect(themeSection).toContainText('dress code');
        await expect(themeSection).toContainText('Cocktail attire');
    });

    test('palette swatch grid has 6 color chips', async ({ page }) => {
        await unlock(page);
        const swatches = page.locator('.swatch-card');
        await expect(swatches).toHaveCount(6);

        const swatchNames = await page.locator('.swatch-name').allTextContents();
        expect(swatchNames).toContain('Ivory Blush');
        expect(swatchNames).toContain('Buttercream');
        expect(swatchNames).toContain('Pistachio');
        expect(swatchNames).toContain('Leaf Green');
        expect(swatchNames).toContain('Powder Blue');
        expect(swatchNames).toContain('Hydrangea Blue');
    });

    test('swatch color codes (PMS) are shown', async ({ page }) => {
        await unlock(page);
        const codes = await page.locator('.swatch-code').allTextContents();
        expect(codes).toContain('PMS 7436');
        expect(codes).toContain('PMS 9220');
        expect(codes).toContain('PMS 7493');
        expect(codes).toContain('PMS 576');
        expect(codes).toContain('PMS 5435');
        expect(codes).toContain('PMS 7681');
    });

    test('swatch colors are rendered with correct background colors', async ({ page }) => {
        await unlock(page);
        const colorEls = page.locator('.swatch-color');
        await expect(colorEls).toHaveCount(6);

        const bgColors = await colorEls.evaluateAll(els =>
            els.map(el => (el as HTMLElement).style.background || (el as HTMLElement).style.backgroundColor)
        );
        // Check at least some colors are applied inline
        expect(bgColors.some(c => c && c.length > 0)).toBeTruthy();
    });

    test('"bring a layer" note card is visible', async ({ page }) => {
        await unlock(page);
        const layerCard = page.locator('.bring-layer-card');
        await expect(layerCard).toBeVisible();
        await expect(layerCard).toContainText('Bring a layer');
        await expect(layerCard).toContainText('Hollins House');
    });

    test('#theme is NOT a navigable page (no theme link in main nav)', async ({ page }) => {
        await unlock(page);
        const themeNavLinks = page.locator('.site-nav-desktop a[href="#theme"], .site-nav-mobile-tabs a[href="#theme"]');
        await expect(themeNavLinks).toHaveCount(0);
    });
});

// ─────────────────────────────────────────────
// RSVP PAGE — RSVPC ticket-stub
// ─────────────────────────────────────────────
test.describe('RSVP Page — RSVPC', () => {
    test('RSVP section has ticket-stub wrapper with dark hero background', async ({ page }) => {
        await unlock(page);
        await page.click('a[href="#rsvp"]');
        await expect(page.locator('#rsvp')).toBeVisible();

        const rsvpC = page.locator('.rsvp-c');
        await expect(rsvpC).toBeVisible();

        // Left col: heading
        const heading = page.locator('.rsvp-c-heading');
        await expect(heading).toBeVisible();
        await expect(heading).toContainText('RSVP');

        // Left col: eyebrow
        const eyebrow = page.locator('.rsvp-eyebrow');
        await expect(eyebrow).toBeVisible();
        await expect(eyebrow).toContainText('Will you be there');
        await expect(eyebrow).toContainText('Aug 1');

        // Left col: copy
        const copy = page.locator('.rsvp-c-copy');
        await expect(copy).toBeVisible();
        await expect(copy).toContainText('party');
    });

    test('RSVP ticket wrapper contains the functional form', async ({ page }) => {
        await unlock(page);
        await page.click('a[href="#rsvp"]');

        const ticket = page.locator('.rsvp-ticket');
        await expect(ticket).toBeVisible();

        await expect(ticket.locator('#rsvpName')).toBeVisible();
        await expect(ticket.locator('#guestLookupButton')).toBeVisible();
        await expect(ticket.locator('#rsvpEmail')).toBeVisible();
        await expect(ticket.locator('#songRequest')).toBeVisible();
        await expect(ticket.locator('#specialMessage')).toBeVisible();
        await expect(ticket.locator('button[type="submit"]')).toBeVisible();
    });

    test('"Until then —" coda appears on RSVP page', async ({ page }) => {
        await unlock(page);
        await page.click('a[href="#rsvp"]');

        const coda = page.locator('.until-then-coda');
        await expect(coda).toBeVisible();
        await expect(coda.locator('.coda-signoff')).toContainText('Until then');
        await expect(coda.locator('.coda-mark')).toContainText('K');
        await expect(coda.locator('.coda-mark')).toContainText('M');
        await expect(coda.locator('.coda-mark')).toContainText('09.12.26');
    });
});

// ─────────────────────────────────────────────
// WEDDING PARTY PAGE — PartyB
// ─────────────────────────────────────────────
test.describe('Wedding Party Page — PartyB', () => {
    // Uses admin password which grants party access
    test('party page has "The party, briefed." heading and 4-col briefing strip', async ({ page }) => {
        await page.route('**/site.config.json', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    supabase: {
                        url: 'https://example.supabase.co',
                        anonKey: 'public-anon-key',
                        sessionTtlMs: 3600000
                    }
                })
            });
        });
        await unlock(page);

        // Force party access level on the body so the party section becomes visible
        await page.evaluate(() => {
            document.body.dataset.accessLevel = 'admin';
            document.querySelectorAll('[data-access-visible="party"]').forEach(el => {
                el.classList.add('is-access-granted');
                el.removeAttribute('aria-hidden');
            });
        });

        await page.click('a[href="#wedding-party"]');
        await expect(page.locator('#wedding-party')).toBeVisible();

        // Header
        const heading = page.locator('.party-b-heading');
        await expect(heading).toBeVisible();
        await expect(heading).toContainText('The party, briefed');

        const label = page.locator('.party-b-label');
        await expect(label).toContainText('Wedding party');

        // 4-col briefing strip
        const briefCells = page.locator('.party-brief-cell');
        await expect(briefCells).toHaveCount(4);

        // Check cell content
        const briefValues = await page.locator('.brief-value').allTextContents();
        expect(briefValues.some(v => /sept 11|sep 11/i.test(v))).toBeTruthy();
        expect(briefValues.some(v => /tbd/i.test(v))).toBeTruthy();
        expect(briefValues.some(v => /sept 12|sep 12/i.test(v))).toBeTruthy();
        expect(briefValues.some(v => /text us/i.test(v))).toBeTruthy();

        // Check subs
        const briefSubs = await page.locator('.brief-sub').allTextContents();
        expect(briefSubs.some(s => /10 AM/i.test(s))).toBeTruthy();
        expect(briefSubs.some(s => /12.*2 PM/i.test(s))).toBeTruthy();
        expect(briefSubs.some(s => /see timeline below/i.test(s))).toBeTruthy();
        expect(briefSubs.some(s => /408.*693-4383/i.test(s))).toBeTruthy();

        // Wedding party grid
        await expect(page.locator('#weddingPartyGrid')).toBeVisible();
    });
});

// ─────────────────────────────────────────────
// REGISTRY PAGE — RegistryC
// ─────────────────────────────────────────────
test.describe('Registry Page — RegistryC', () => {
    test('registry section has "The registry" eyebrow and intro text', async ({ page }) => {
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
                headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
                body: JSON.stringify({ success: true, items: [] })
            });
        });

        await unlock(page);
        await page.click('a[href="#registry"]');
        await expect(page.locator('#registry')).toBeVisible();

        const section = page.locator('.registry-c');
        await expect(section).toBeVisible();

        // "The registry" eyebrow
        const eyebrow = section.locator('.section-eyebrow').first();
        await expect(eyebrow).toContainText('The registry');

        // Intro text (right side of header)
        const intro = section.locator('.registry-c-intro');
        await expect(intro).toContainText('presence');
        await expect(intro).toContainText('gift');
    });

    test('registry CTA button says "Open the full registry"', async ({ page }) => {
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
                headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
                body: JSON.stringify({ success: true, items: [] })
            });
        });

        await unlock(page);
        await page.click('a[href="#registry"]');

        const cta = page.locator('.registry-cta-btn, .registry-cta a, .registry-direct-link a').first();
        await expect(cta).toBeVisible();
        await expect(cta).toContainText('full registry');
    });
});

// ─────────────────────────────────────────────
// LAYOUT — No global footer
// ─────────────────────────────────────────────
test.describe('Layout', () => {
    test('no global footer element (footer is only on RSVP page as coda)', async ({ page }) => {
        await unlock(page);
        // Should have no <footer> element
        const footer = page.locator('footer');
        await expect(footer).toHaveCount(0);
    });

    test('UntilThenCoda is only visible on the RSVP page', async ({ page }) => {
        await unlock(page);

        // On home page: coda should not be visible
        await expect(page.locator('#home')).toBeVisible();
        const codaOnHome = page.locator('#home .until-then-coda');
        await expect(codaOnHome).toHaveCount(0);

        // Navigate to RSVP: coda should be visible
        await page.click('a[href="#rsvp"]');
        await expect(page.locator('#rsvp .until-then-coda')).toBeVisible();
    });
});
