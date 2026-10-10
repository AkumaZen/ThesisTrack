import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Prefer installed Chrome on Windows, avoiding a separate browser download.
const channel = process.env.PLAYWRIGHT_CHANNEL ?? (existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'chrome' : undefined);
export default defineConfig({
	testDir: './tests/e2e', fullyParallel: false, workers: 1, retries: 0, timeout: 60000,
	expect: { timeout: 10000 }, reporter: [['list'], ['html', { open: 'never' }]],
	use: { baseURL: 'http://127.0.0.1:5179', trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure', channel },
	projects: [
		{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
		{ name: 'mobile', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' } }
	],
	webServer: {
		command: 'npm run dev -- --host 127.0.0.1 --port 5179 --strictPort', url: 'http://127.0.0.1:5179/valuation/master-tracker', timeout: 120000, reuseExistingServer: false,
		env: { DATABASE_URL: 'postgres://test:test@127.0.0.1:1/tracker_test', MASTER_TRACKER_TEST_MODE: 'true', DISABLE_BACKGROUND_JOBS: 'true' }
	}
});
