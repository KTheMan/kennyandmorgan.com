import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    timeout: 60_000,
    expect: {
        timeout: 10_000
    },
    use: {
        baseURL: 'http://127.0.0.1:4173',
        headless: true,
        viewport: { width: 1280, height: 720 },
        actionTimeout: 0,
        ignoreHTTPSErrors: true,
        trace: 'on-first-retry'
    },
    webServer: {
        command: 'npx http-server . -p 4173 -c-1',
        port: 4173,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000
    }
});
