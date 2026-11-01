import { test, expect, type Page } from '@playwright/test';

// New company -> JSON import. The spec serves every /api call itself and records what the page
// sends, so nothing reaches the database.
const card = {
	nse_ticker: 'TESTFORGE',
	bse_ticker: '999123',
	name: 'Test Forge Limited',
	classification: { broad_industry: 'Auto & Mobility', specific_niche: 'Precision Forged & Machined Components', operating_model: 'factory', currency: 'INR' },
	status: 'watch_closely',
	last_reviewed: '2026-09-26',
	thesis_data: {
		the_business: { what_it_does: 'Forges crankshafts for defence and rail.', revenue_split: [{ segment: 'Defence', share_pct: 100 }] },
		the_growth_engine: ['New shell line'],
		why_we_believe_it: ['Premise: Orders doubled.', 'Conclusion: Growth continues.'],
		pillar_notes: { the_business: ['A plain string note'] }
	},
	custom_sections: [
		{ name: 'Segment Revenue', pillar: 'the_business', text: 'Rs cr.', columns: [{ key: 'segment', label: 'Segment', type: 'text' }, { key: 'fy26', label: 'FY26', type: 'number' }], rows: [{ segment: 'Defence', fy26: 427 }] },
		{ name: 'Risk Register', pillar: 'what_can_kill_it', columns: [{ key: 'risk', label: 'Risk', type: 'text' }], rows: [{ risk: 'Customer loss' }] }
	]
};

type Sent = { method: string; path: string; body: Record<string, unknown> | null };

async function open(page: Page) {
	const sent: Sent[] = [];
	let tableId = 100;
	await page.route('**/api/**', (route) => {
		const r = route.request();
		const path = new URL(r.url()).pathname;
		if (r.method() !== 'GET') sent.push({ method: r.method(), path, body: r.postDataJSON() });
		if (path === '/api/taxonomy')
			return route.fulfill({ json: { industries: [{ name: 'Consumer Retail', niches: [{ name: 'Specialty Retail Chains' }] }, { name: 'Auto & Mobility', niches: [{ name: 'Precision Forged & Machined Components' }] }], operating_models: [{ name: 'factory' }] } });
		if (path.includes('entry-price')) return route.fulfill({ json: { status: 'none', close: null } });
		if (path === '/api/companies' && r.method() === 'POST') return route.fulfill({ status: 201, json: { company_id: 'TESTFORGE' } });
		if (r.method() === 'POST' && path.endsWith('/tables')) return route.fulfill({ status: 201, json: { id: ++tableId } });
		if (r.method() === 'GET' && path === '/api/metrics') return route.fulfill({ json: [] });
		return route.fulfill({ json: {} });
	});
	await page.goto('/ingest');
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await page.getByRole('button', { name: 'JSON', exact: true }).click();
	await page.getByPlaceholder('Paste a full thesis payload here').fill(JSON.stringify(card));
	return sent;
}

async function enterManualPrice(page: Page) {
	await page.getByLabel('Enter price manually').check();
	await page.getByTestId('buy-price-input').fill('507');
}

test('switching to the Form tab loads the pasted JSON, and saving sends it all', async ({ page }) => {
	const sent = await open(page);
	await page.getByRole('button', { name: 'Form', exact: true }).click();
	await expect(page.getByText('Previewing a JSON import.')).toBeVisible();
	await enterManualPrice(page);
	await page.getByRole('button', { name: 'Create Company' }).click();
	await page.waitForURL('**/company/TESTFORGE');

	const created = sent.find((s) => s.path === '/api/companies')!.body!;
	expect(created).toMatchObject({ nse_ticker: 'TESTFORGE', bse_ticker: '999123', name: 'Test Forge Limited', status: 'watch_closely', last_reviewed: '2026-09-26', entry_price: 507 });
	expect(created.thesis_data).toMatchObject({ the_business: { what_it_does: 'Forges crankshafts for defence and rail.' }, the_growth_engine: ['New shell line'] });
	expect(sent.filter((s) => s.path.endsWith('/tables')).map((s) => s.body!.name)).toEqual(['Segment Revenue', 'Risk Register']);
	// The second save points the section notes at the real table ids.
	const amended = sent.find((s) => s.method === 'PUT')!.body!.thesis_data as { pillar_notes: Record<string, { blocks: { type: string; table_id?: number }[] }[]> };
	expect(amended.pillar_notes.the_business.flatMap((n) => n.blocks.map((b) => b.table_id ?? b.type))).toEqual(['text', 'text', 101]);
});

test('Create Company with unloaded JSON loads it for review instead of saving a blank thesis', async ({ page }) => {
	const sent = await open(page);
	await page.getByRole('button', { name: 'Create Company' }).click();
	await expect(page.getByText('Your pasted JSON is now loaded into the form. Review it, then save again.')).toBeVisible();
	expect(sent.filter((s) => s.path === '/api/companies')).toHaveLength(0);
	await expect(page.getByText('Previewing a JSON import.')).toBeVisible();
});

test('loading edited JSON again replaces the earlier import instead of adding it twice', async ({ page }) => {
	const sent = await open(page);
	await page.getByRole('button', { name: 'Load into form' }).click();
	await page.getByRole('button', { name: 'Edit JSON' }).click();
	await page.getByPlaceholder('Paste a full thesis payload here').fill(JSON.stringify({ ...card, name: 'Test Forge Ltd' }));
	await page.getByRole('button', { name: 'Load into form' }).click();
	await enterManualPrice(page);
	await page.getByRole('button', { name: 'Create Company' }).click();
	await page.waitForURL('**/company/TESTFORGE');
	expect(sent.find((s) => s.path === '/api/companies')!.body!.name).toBe('Test Forge Ltd');
	expect(sent.filter((s) => s.path.endsWith('/tables'))).toHaveLength(2);
});
