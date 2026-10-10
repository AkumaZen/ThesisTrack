import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Opt-in against the normal local app: real login, database and research providers.
export default defineConfig({
	testDir: './tests/live', testMatch: 'piccadily.spec.ts', workers: 1, retries: 0, timeout: 300000,
	expect: { timeout: 15000 }, outputDir: '../logs/piccadily-playwright',
	reporter: [['list'], ['html', { open: 'never', outputFolder: '../logs/piccadily-playwright-report' }]],
	use: { ...devices['Desktop Chrome'], channel: existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'chrome' : undefined,
		baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 1000 },
		// Login uses a temporary local account; its password/session must not enter traces.
		trace: 'off', screenshot: 'only-on-failure' }
});
