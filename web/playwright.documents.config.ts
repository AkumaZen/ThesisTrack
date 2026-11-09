import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const database = 'postgres://thesis:thesis@127.0.0.1:45432/thesis_documents_test';
export default defineConfig({
	testDir: './tests/documents', workers: 1, fullyParallel: false, timeout: 60000,
	use: { baseURL: 'http://127.0.0.1:5187', trace: 'off', screenshot: 'only-on-failure', channel: existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'chrome' : undefined },
	projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' } }],
	webServer: {
		command: 'node --import ./tests/document-provider.mjs ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5187 --strictPort',
		url: 'http://127.0.0.1:5187/login', reuseExistingServer: false, timeout: 120000,
		env: { DATABASE_URL: database, DISABLE_BACKGROUND_JOBS: 'true', OPENAI_API_KEY: 'local-provider-fixture', OPEN_AI_KEY: '', AI_FEATURES: 'on', MASTER_TRACKER_TEST_MODE: 'false' }
	}
});
