import { test, expect, type Page } from '@playwright/test';

// No page may scroll sideways on a phone. Wide tables scroll inside their own container.
//
// Master Tracker and Compare run against the harness's mock mode (no database, no sign-in). The other
// routes need a signed-in session: start the suite with E2E_DATABASE_URL (a local database) and
// E2E_SESSION (the value of a valid `tt_session` cookie for it) and they run too; without them they skip.
// Admin-only pages need an admin: set E2E_ADMIN_SESSION to check them; with only E2E_SESSION (a regular
// user) it checks that those pages refuse the user, and with both set it does both. E2E_SESSION must be a non-admin.
const WIDTH = 390;
const session = process.env.E2E_SESSION;
const adminSession = process.env.E2E_ADMIN_SESSION;
const ADMIN_ROUTES = ['/admin/users', '/valuation/sectors'];
const cookie = (value: string) => ({ name: 'tt_session', value, url: 'http://127.0.0.1:5179' });

const years = ['Mar 2025', 'Mar 2026'];
function company(symbol: string, name: string, scale: number) {
	const row = (section: string, label: string, unit: string, values: number[]) => ({ key: `${section}:${label}`, label, parent: null, unit, values });
	return {
		symbol, name, basis: 'consolidated', fetchedAt: 0,
		sections: [
			{ id: 'mkt', labels: [], rows: [row('mkt', 'Market Cap', 'cr', [9000 * scale]), row('mkt', 'Current Price', 'rs', [450 * scale])] },
			{ id: 'pl', labels: years, rows: [row('pl', 'Sales', 'cr', [1000 * scale, 1200 * scale]), row('pl', 'Net Profit', 'cr', [100 * scale, 130 * scale])] }
		]
	};
}

/** How far the document is wider than the viewport, and the widest offenders. */
async function overflow(page: Page) {
	return page.evaluate((w) => {
		const extra = document.scrollingElement!.scrollWidth - w;
		const culprits: string[] = [];
		if (extra > 0)
			for (const el of document.querySelectorAll('body *')) {
				const r = el.getBoundingClientRect();
				if (r.right > w + 1 && getComputedStyle(el).position !== 'fixed') culprits.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} right=${Math.round(r.right)}`);
			}
		return { extra, culprits: culprits.slice(0, 8) };
	}, WIDTH);
}

async function visit(page: Page, path: string) {
	await page.goto(path);
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await page.waitForTimeout(500);
	const { extra, culprits } = await overflow(page);
	expect(extra, `${path} is ${extra}px wider than the screen: ${culprits.join(', ')}`).toBeLessThanOrEqual(0);
}

test.describe('phone width', () => {
	test.use({ viewport: { width: WIDTH, height: 844 }, hasTouch: true });

	test('Master Tracker has no sideways page scroll', async ({ page }) => {
		await visit(page, '/valuation/master-tracker');
	});

	test('Compare has no sideways page scroll', async ({ page }) => {
		await page.route('**/api/valuation/compare/*', (route) => {
			const symbol = route.request().url().split('/').pop()!.split('?')[0];
			return route.fulfill({ json: company(symbol, `${symbol} Ltd`, symbol === 'AAA' ? 1 : 2) });
		});
		await visit(page, '/valuation/compare?symbols=AAA,BBB,CCC');
	});

	test.describe('signed in', () => {
		test.skip(!session, 'set E2E_DATABASE_URL and E2E_SESSION to check the signed-in routes');
		test.beforeEach(async ({ context }) => {
			await context.addCookies([cookie(session!)]);
		});
		const routes = [
			'/', '/review', '/guidance', '/ingest', '/export', '/sectors', '/account/password',
			'/valuation', '/valuation/sector-rotation', '/valuation/stage-scanner', '/valuation/stage-scanner?preset=near-high', '/valuation/company/HDFCBANK',
			'/valuation/sector-rotation/conventional_energy/transformers_manufacturing', '/valuation/alerts', '/valuation/settings', '/valuation/tracking',
			'/valuation/results', '/valuation/scans', '/valuation/returns', '/valuation/returns?s=HDFCBANK,TCS&p=1Y', '/valuation/breadth',
			'/valuation/announcements', '/valuation/insider-trades', '/valuation/corporate-actions', '/valuation/lists', '/valuation/price-alerts',
			'/valuation/filings/HDFCBANK', '/valuation/concalls', '/valuation/concalls/PICCADIL', '/valuation/red-flags'
		];
		for (const route of routes) test(`${route} has no sideways page scroll`, async ({ page }) => visit(page, route));

		test('the company page has no sideways scroll with the filings panel open', async ({ page }) => {
			await visit(page, '/valuation/company/HDFCBANK');
			await page.locator('summary', { hasText: 'Corporate actions, dividends and insider trades' }).click();
			await expect(page.getByTestId('company-filings')).toBeVisible();
			await page.waitForTimeout(1500);
			const { extra, culprits } = await overflow(page);
			expect(extra, `filings panel is ${extra}px wider than the screen: ${culprits.join(', ')}`).toBeLessThanOrEqual(0);
		});

		// Admin pages: refused for a regular user, checked for overflow with an admin session.
		for (const route of ADMIN_ROUTES) {
			test(`${route} refuses a regular user`, async ({ page }) => {
				const response = await page.goto(route);
				expect(response?.status()).toBe(403);
			});
		}
	});

	test.describe('admin signed in', () => {
		test.skip(!adminSession, 'set E2E_DATABASE_URL and E2E_ADMIN_SESSION (an admin tt_session) to check the admin pages');
		test.beforeEach(async ({ context }) => {
			await context.addCookies([cookie(adminSession!)]);
		});
		for (const route of ADMIN_ROUTES) test(`${route} has no sideways page scroll`, async ({ page }) => visit(page, route));
	});

	test('the menu reaches every tool', async ({ page }) => {
		await page.goto('/valuation/master-tracker');
		await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
		await page.getByRole('button', { name: 'Open menu' }).click();
		const links = page.locator('#mobile-drawer .drawer-link');
		expect(await links.count()).toBeGreaterThanOrEqual(11);
		for (const box of await links.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(40);
	});
});
