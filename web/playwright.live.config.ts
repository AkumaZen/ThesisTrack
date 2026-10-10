import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Opt-in: the dedicated local server has live providers and isolated browsing/storage fixtures.
export default defineConfig({
	testDir: './tests/live', testMatch: 'hfcl.spec.ts', workers: 1, retries: 0, timeout: 300000,
	expect: { timeout: 15000 }, outputDir: '../logs/hfcl-playwright',
	reporter: [['list'], ['html', { open: 'never', outputFolder: '../logs/hfcl-playwright-report' }]],
	use: { ...devices['Desktop Chrome'], channel: existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'chrome' : undefined,
		baseURL: 'http://127.0.0.1:5190', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' }
});
