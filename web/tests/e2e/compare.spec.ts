import { test, expect, type Page } from '@playwright/test';

// The Compare page with fixture figures: the browser test serves /api/valuation/compare itself,
// so nothing reaches Screener.
const years = ['Mar 2025', 'Mar 2026'];
function company(symbol: string, name: string, scale: number) {
	const row = (section: string, label: string, unit: string, values: number[]) => ({ key: `${section}:${label}`, label, parent: null, unit, values });
	return {
		symbol, name, basis: 'consolidated', fetchedAt: 0,
		sections: [
			{ id: 'mkt', labels: [], rows: [row('mkt', 'Market Cap', 'cr', [9000 * scale]), row('mkt', 'Current Price', 'rs', [450 * scale])] },
			{ id: 'pl', labels: years, rows: [row('pl', 'Sales', 'cr', [1000 * scale, 1200 * scale]), row('pl', 'Net Profit', 'cr', [100 * scale, 130 * scale])] },
			{ id: 'bs', labels: years, rows: [row('bs', 'Reserves', 'cr', [500 * scale, 600 * scale]), row('bs', 'Fixed Assets', 'cr', [700 * scale, 760 * scale]), row('bs', 'CWIP', 'cr', [40 * scale, 90 * scale])] }
		]
	};
}

async function open(page: Page) {
	await page.route('**/api/valuation/compare/*', (route) => {
		const symbol = route.request().url().split('/').pop()!.split('?')[0];
		return route.fulfill({ json: symbol === 'AAA' ? company('AAA', 'Alpha Ltd', 1) : company('BBB', 'Beta Ltd', 2) });
	});
	await page.goto('/valuation/compare?symbols=AAA,BBB');
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(page.getByRole('link', { name: 'Beta Ltd' })).toBeVisible();
}
/** Section headers and metric names down the table, as the reader sees them. */
const rowsOf = (page: Page) =>
	page.locator('.cmp-table tbody tr').evaluateAll((trs) => trs.map((tr) => (tr.classList.contains('cmp-section') ? '# ' : '') + tr.querySelector('th')!.textContent!.replace(/\s+/g, ' ').trim()));

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
