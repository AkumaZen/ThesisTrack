import { test, expect, type Page } from '@playwright/test';

// The Compare page with fixture figures: the browser test serves /api/valuation/compare itself,
// so nothing reaches Screener.
const years = ['Mar 2025', 'Mar 2026'];
/** Enough rows that the Arrange list has to scroll once they are all shown. */
const extra = Array.from({ length: 30 }, (_, i) => `Extra line ${i + 1}`);
function company(symbol: string, name: string, scale: number) {
	const row = (section: string, label: string, unit: string, values: number[]) => ({ key: `${section}:${label}`, label, parent: null, unit, values });
	return {
		symbol, name, basis: 'consolidated', fetchedAt: 0,
		sections: [
			{ id: 'mkt', labels: [], rows: [row('mkt', 'Market Cap', 'cr', [9000 * scale]), row('mkt', 'Current Price', 'rs', [450 * scale])] },
			{ id: 'pl', labels: years, rows: [row('pl', 'Sales', 'cr', [1000 * scale, 1200 * scale]), row('pl', 'Net Profit', 'cr', [100 * scale, 130 * scale])] },
			{ id: 'bs', labels: years, rows: [row('bs', 'Reserves', 'cr', [500 * scale, 600 * scale]), row('bs', 'Fixed Assets', 'cr', [700 * scale, 760 * scale]), row('bs', 'CWIP', 'cr', [40 * scale, 90 * scale]), ...extra.map((label, i) => row('bs', label, 'cr', [i, i + 1]))] }
		]
	};
}

/** The seven power-transmission names from a real comparison, long names included. */
const SEVEN: [string, string, number][] = [
	['JYOTISTRUC', 'Jyoti Structures Ltd', 0.3],
	['TRANSRAILL', 'Transrail Lighting Ltd', 6.9],
	['SKIPPER', 'Skipper Ltd', 5.6],
	['KPIL', 'Kalpataru Projects International Ltd', 27.1],
	['KEC', 'KEC International Ltd', 23.5],
	['BAJEL', 'Bajel Projects Ltd', 2.8],
	['SALASAR', 'Salasar Techno Engineering Ltd', 1.4]
];

async function open(page: Page, symbols = 'AAA,BBB,CCC') {
	await page.route('**/api/valuation/compare/*', (route) => {
		const symbol = route.request().url().split('/').pop()!.split('?')[0];
		const fixtures: Record<string, ReturnType<typeof company>> = {
			AAA: company('AAA', 'Alpha Ltd', 1),
			BBB: company('BBB', 'Beta Ltd', 2),
			CCC: company('CCC', 'Gamma Ltd', 1.5),
			...Object.fromEntries(SEVEN.map(([s, name, scale]) => [s, company(s, name, scale)]))
		};
		return route.fulfill({ json: fixtures[symbol] });
	});
	await page.goto(`/valuation/compare?symbols=${symbols}`);
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(page.locator('.cmp-co-name')).toHaveCount(symbols.split(',').length);
	await expect(page.locator('.cmp-status')).toHaveCount(0);
}
/** Section headers and metric names down the table, as the reader sees them. */
const rowsOf = (page: Page) =>
	page.locator('.cmp-table tbody tr').evaluateAll((trs) => trs.map((tr) => tr.classList.contains('cmp-section') ? '# ' + tr.querySelector('th')!.textContent!.trim() : [...tr.querySelectorAll('th .cmp-metric-label, th .cmp-unit')].map((e) => e.textContent!.trim()).join(' ')));

test('puts metrics from different statements side by side and remembers the order', async ({ page }, testInfo) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await open(page);

	// Show Market Cap, which the defaults leave out.
	await page.getByRole('button', { name: /Customize metrics/ }).click();
	await page.getByRole('checkbox', { name: 'Market Cap' }).check();
	await page.getByRole('tab', { name: /Arrange/ }).click();
	await page.screenshot({ path: testInfo.outputPath('arrange-panel.png') });
	const list = page.locator('.cmp-arrange li');
	await expect(list.first()).toContainText('Market Cap');
	// Move Market Cap down until it sits right above Fixed Assets.
	const labels = async () => (await list.locator('.cmp-arrange-name').allTextContents()).map((t) => t.trim());
	while ((await labels()).indexOf('Market Cap') < (await labels()).indexOf('Fixed assets') - 1)
		await page.getByRole('button', { name: 'Move Market Cap down' }).click();
	await page.getByRole('button', { name: 'Done' }).click();

	expect(await rowsOf(page)).toEqual(['# Market', 'CMP ₹', '# Profit & loss', 'Revenue', 'PAT', '# Balance sheet', 'Reserves', '# Market', 'Market Cap', '# Balance sheet', 'Fixed assets', 'CWIP']);
	await expect(page.getByRole('button', { name: 'Back to statement order' })).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath('arranged.png'), fullPage: true });

	// Drag Reserves to the very top.
	await page.getByRole('button', { name: 'Arrange rows' }).click();
	await list.filter({ hasText: 'Reserves' }).dragTo(list.first(), { targetPosition: { x: 40, y: 4 } });
	await expect(list.first()).toContainText('Reserves');
	await page.getByRole('button', { name: 'Done' }).click();
	expect((await rowsOf(page)).slice(0, 2)).toEqual(['# Balance sheet', 'Reserves']);

	await page.reload();
	await expect(page.getByRole('link', { name: 'Beta Ltd' })).toBeVisible();
	expect((await rowsOf(page)).slice(0, 2)).toEqual(['# Balance sheet', 'Reserves']);

	await page.getByRole('button', { name: 'Back to statement order' }).click();
	expect(await rowsOf(page)).toEqual(['# Market', 'Market Cap', 'CMP ₹', '# Profit & loss', 'Revenue', 'PAT', '# Balance sheet', 'Reserves', 'Fixed assets', 'CWIP']);
	expect(errors).toEqual([]);
});

test('scrolls the Arrange list while dragging a row past its top edge', async ({ page }) => {
	await open(page);
	await page.getByRole('button', { name: /Customize metrics/ }).click();
	await page.getByRole('button', { name: 'All', exact: true }).click();
	await page.getByRole('tab', { name: /Arrange/ }).click();
	const box = page.locator('.cmp-arrange');
	const list = box.locator('li');
	const last = list.last();
	const lastName = (await last.locator('.cmp-arrange-name').textContent())!.trim();
	await last.scrollIntoViewIfNeeded();
	expect(await box.evaluate((el) => el.scrollTop)).toBeGreaterThan(300);

	// Pick up the bottom row, carry it to the list's top edge and hold it there.
	const from = (await last.boundingBox())!;
	const area = (await box.boundingBox())!;
	await page.mouse.move(from.x + 40, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(from.x + 40, area.y + 24, { steps: 8 });
	await expect.poll(() => box.evaluate((el) => el.scrollTop), { timeout: 5000 }).toBe(0);
	await page.mouse.up();
	await expect(list.first().locator('.cmp-arrange-name')).toHaveText(lastName);

	// And back down: held below the list, over the panel footer, it scrolls to the end.
	const top = (await list.first().boundingBox())!;
	const foot = (await page.locator('.cmp-dialog-foot').boundingBox())!;
	await page.mouse.move(top.x + 40, top.y + top.height / 2);
	await page.mouse.down();
	await page.mouse.move(top.x + 40, foot.y + 10, { steps: 8 });
	await expect.poll(() => box.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1), { timeout: 5000 }).toBe(true);
	await page.mouse.up();
	await expect(list.last().locator('.cmp-arrange-name')).toHaveText(lastName);
});

test('shows one year per company and ranks companies by the metric clicked', async ({ page }, testInfo) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await open(page);
	const companies = () => page.locator('.cmp-table thead .cmp-co-name').allTextContents();
	const years = page.locator('.cmp-table thead .cmp-year');

	await page.getByRole('group', { name: 'Years per company' }).getByRole('button', { name: '1', exact: true }).click();
	await expect(years).toHaveCount(3);
	await expect(years.first()).toHaveText('FY26');

	const revenue = page.getByRole('button', { name: /^Revenue/ });
	await revenue.click();
	expect(await companies()).toEqual(['Beta Ltd', 'Gamma Ltd', 'Alpha Ltd']);
	await expect(page.getByText('Ranked by Revenue, high to low')).toBeVisible();
	await expect(revenue).toHaveAttribute('aria-pressed', 'true');
	await page.screenshot({ path: testInfo.outputPath('ranked.png') });

	await revenue.click();
	expect(await companies()).toEqual(['Alpha Ltd', 'Gamma Ltd', 'Beta Ltd']);
	await expect(page.getByText('Ranked by Revenue, low to high')).toBeVisible();
	// The values move with their company.
	await expect(page.getByRole('row', { name: /^Revenue/ }).locator('td').first()).toHaveText('1,200');

	await revenue.click();
	expect(await companies()).toEqual(['Alpha Ltd', 'Beta Ltd', 'Gamma Ltd']);
	await expect(page.getByText(/Ranked by/)).toHaveCount(0);

	// A market figure ranks by today's value; Clear goes back to the chosen order.
	await page.getByRole('button', { name: /^CMP/ }).click();
	expect(await companies()).toEqual(['Beta Ltd', 'Gamma Ltd', 'Alpha Ltd']);
	await page.getByRole('button', { name: 'Clear' }).click();
	expect(await companies()).toEqual(['Alpha Ltd', 'Beta Ltd', 'Gamma Ltd']);
	expect(errors).toEqual([]);
});

test('fits seven companies on one screen for one year, and stays compact for more', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'A phone can never fit seven companies side by side');
	await open(page, SEVEN.map(([s]) => s).join(','));
	const box = page.locator('.cmp-scroll');
	const overflow = () => box.evaluate((el) => el.scrollWidth - el.clientWidth);
	const setYears = (n: number) => page.getByRole('group', { name: 'Years per company' }).getByRole('button', { name: String(n), exact: true }).click();

	await setYears(1);
	await page.screenshot({ path: testInfo.outputPath('seven-1y.png') });
	expect(await overflow()).toBe(0);
	// Long names wrap instead of widening their column, and stay readable in full on hover.
	const kpil = page.getByRole('link', { name: 'Kalpataru Projects International Ltd' });
	await expect(kpil).toHaveAttribute('title', 'Kalpataru Projects International Ltd');
	expect((await kpil.boundingBox())!.height).toBeGreaterThan(30);
	// Every figure is shown whole, not clipped.
	const clipped = await page.locator('.cmp-table td.cmp-val, .cmp-table th.cmp-year').evaluateAll((cells) => cells.filter((c) => c.scrollWidth > c.clientWidth).length);
	expect(clipped).toBe(0);

	await setYears(2);
	await page.screenshot({ path: testInfo.outputPath('seven-2y.png') });
	expect(await overflow()).toBeLessThanOrEqual(0);

	await setYears(3);
	await page.screenshot({ path: testInfo.outputPath('seven-3y.png') });
});
