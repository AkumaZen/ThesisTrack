import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

export default defineConfig({
	testDir: './tests/live', testMatch: 'production.spec.ts', workers: 1, retries: 0, timeout: 420000,
	expect: { timeout: 20000 }, outputDir: '../logs/production-playwright', reporter: [['list']],
	use: { ...devices['Desktop Chrome'], channel: existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'chrome' : undefined,
		baseURL: 'https://thesis-track-sigma.vercel.app', viewport: { width: 1440, height: 1000 }, trace: 'off', screenshot: 'only-on-failure' }
});
