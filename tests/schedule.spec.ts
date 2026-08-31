import { test, expect } from '@playwright/test';

test('shows the updated rehearsal schedule', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const briefing = page.locator('.party-briefing-strip');
    const rehearsal = briefing.getByText('Rehearsal', { exact: true }).locator('..');
    const lunch = briefing.getByText('Rehearsal Lunch', { exact: true }).locator('..');

    await expect(rehearsal.locator('.brief-sub')).toHaveText('11 AM · The Hollins House');
    await expect(lunch.locator('.brief-sub')).toHaveText('~12:30–3 PM · Fri Sept 11');
    await expect(page.locator('.party-rehearsal-rsvp-section .party-hmu-copy')).toContainText(
        'September 11 at ~12:30-3 PM'
    );
});
