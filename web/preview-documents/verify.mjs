import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const artifacts = new URL('../../logs/company-documents-ui/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];
try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('http://127.0.0.1:5188/');
	const section = page.getByRole('region', { name: 'Important documents', exact: true });
	await expect(section.locator('details')).toHaveCount(6);
	await expect(section.getByRole('option', { name: 'Order wins (2)', exact: true })).toHaveCount(1);
	await section.locator('summary').first().click();
	await expect(section.getByRole('heading', { name: 'Announcement summary' }).first()).toBeVisible();
	const pdf = await page.request.get('http://127.0.0.1:5188/sample-filing.pdf');
	expect(pdf.headers()['content-type']).toBe('application/pdf');
	expect((await pdf.text()).startsWith('%PDF')).toBe(true);
	await section.screenshot({ path: fileURLToPath(new URL('desktop.png', artifacts)) });
	await section.getByLabel('Document type').selectOption('Order wins');
	await expect(section.locator('details')).toHaveCount(2);
	await section.getByLabel('Search documents').fill('payment terms');
	await expect(section.locator('details')).toHaveCount(1);
	await section.getByLabel('Search documents').fill('nothing matches');
	await expect(section.getByRole('heading', { name: 'No matching documents' })).toBeVisible();
	await section.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
	await expect(section.locator('details')).toHaveCount(6);
	await section.getByLabel('Sort documents').selectOption('oldest');
	await expect(section.locator('details').first()).toContainText('minority investment');
	for (const [state, heading] of [['empty', 'No important documents yet'], ['pending', 'Documents are awaiting review'], ['error', 'Documents could not be loaded']]) {
		await page.goto(`http://127.0.0.1:5188/?state=${state}`);
		await expect(section.getByRole('heading', { name: heading, exact: true })).toBeVisible();
	}
	await page.goto('http://127.0.0.1:5188/?state=readonly');
	await expect(section.locator('details')).toHaveCount(6);
	await expect(section.getByRole('button', { name: 'Refresh documents', exact: true })).toHaveCount(0);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('http://127.0.0.1:5188/');
	await expect(section.locator('details')).toHaveCount(6);
	await section.locator('summary').first().focus();
	await page.keyboard.press('Enter');
	await expect(section.locator('details').first()).toHaveAttribute('open', '');
	await section.screenshot({ path: fileURLToPath(new URL('mobile.png', artifacts)) });
	for (const width of [390, 640, 820]) {
		await page.setViewportSize({ width, height: 900 });
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	}
	expect(errors).toEqual([]);
	console.log('Preview passed: categories, counts, search, sort, keyboard expansion, PDF link, empty/pending/error/read-only states, and 390/640/820px overflow checks.');
	console.log('Screenshots: logs/company-documents-ui/desktop.png and mobile.png');
} finally { await browser.close(); }
