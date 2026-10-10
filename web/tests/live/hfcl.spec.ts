import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { unflatten } from 'devalue';

test('live Luna: HFCL Q1 FY27 research, review, save and refresh', async ({ page, request }, testInfo) => {
	test.skip(process.env.RUN_HFCL_LIVE_TEST !== 'true', 'Explicit opt-in required for billable live analysis.');
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	const rows = await (await request.get('/api/valuation/master-tracker')).json();
	if (!rows.length) {
		const created = await request.post('/api/valuation/master-tracker', { data: { symbol: 'HFCL', name: 'HFCL Ltd', bseCode: null, sector: 'Telecommunication', subsector: 'Telecom - Infrastructure' }, timeout: 90000 });
		expect(created.status()).toBe(201);
		expect((await created.json()).bseCode).toBe('500183');
	} else expect(rows.map((c: { symbol: string }) => c.symbol)).toEqual(['HFCL']);
	await page.goto('/valuation/master-tracker');
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(page.getByText('Mock testing mode', { exact: false })).toHaveCount(0);
	const company = page.getByRole('article', { name: 'HFCL Ltd', exact: true });
	const periods = page.waitForResponse((r) => r.url().endsWith('/master-tracker/HFCL') && r.request().postDataJSON()?.action === 'quarters', { timeout: 120000 });
	await company.getByRole('button', { name: /Load available quarters|Refresh available quarters/ }).click();
	const periodResponse = await periods;
	expect(periodResponse.status(), await periodResponse.text()).toBe(200);
	const quarter = company.getByRole('region', { name: 'Jun 2026', exact: true });
	await expect(quarter).toBeVisible();
	const strip = company.getByRole('region', { name: 'Reported quarters', exact: true });
	await strip.getByRole('checkbox', { checked: true }).uncheck();
	await quarter.getByRole('checkbox').check();
	await expect(strip.getByRole('checkbox', { checked: true })).toHaveCount(1);
	let preview;
	if (process.env.REUSE_HFCL_LIVE_PREVIEW === 'true') {
		// Resume the actual live draft after a test assertion fails, avoiding another billable call.
		const data = await (await request.get('/valuation/master-tracker/__data.json')).json();
		preview = unflatten(data.nodes.at(-1).data).previews[0];
		expect(preview.symbol).toBe('HFCL');expect(preview.quarters).toEqual(['2026-06-30']);
	} else {
		const responsePromise = page.waitForResponse((r) => r.url().endsWith('/master-tracker/HFCL') && r.request().postDataJSON()?.action === 'analyse', { timeout: 240000 });
		await company.getByRole('button', { name: 'Create valuation', exact: true }).click();
		const response = await responsePromise;
		expect(response.request().postDataJSON().quarters).toEqual(['2026-06-30']);
		expect(response.status(), await response.text()).toBe(200);
		preview = (await response.json()).preview;
	}
	expect(preview.analysis.guidance.length).toBeGreaterThan(0);
	const guidance = preview.analysis.guidance as { metric: string; commitment: string; status: string }[];
	expect(guidance.find((g) => /revenue.*growth/i.test(g.metric))?.status).toBe('Revised');
	expect(guidance.some((g) => /preform/i.test(g.commitment) && /300/.test(g.commitment))).toBe(true);
	expect(guidance.some((g) => /data.centre|data.center/i.test(g.commitment) && /(?:5|five)\s*(?:x|times|fold)/i.test(g.commitment))).toBe(true);
	expect(preview.analysis.guidance.every((g: { quarter: string; sources: { url: string }[] }) => g.quarter === '2026-06-30' && g.sources.every((s) => !s.url.includes('example.com')))).toBe(true);
	await writeFile(testInfo.outputPath('live-analysis.json'), JSON.stringify(preview, null, 2));
	const review = page.getByRole('region', { name: 'Review analysis for HFCL Ltd' });
	await expect(review.getByRole('heading', { name: 'Review analysis before saving' })).toBeVisible();
	if (preview.analysis.valuation) await expect(review.getByRole('table')).toHaveCount(3);
	else expect(preview.analysis.warnings.length).toBeGreaterThan(0);
	await review.getByRole('button', { name: 'Save selected analysis' }).click();
	await expect(review).toHaveCount(0);
	await page.reload();
	await expect(company.getByText(`Guidance: ${preview.analysis.guidance.length}`, { exact: true })).toBeVisible();
	const saved = (await (await request.get('/api/valuation/master-tracker')).json())[0];
	const withoutSaveTime = (g: Record<string, unknown>) => { const { recordedAt, ...record } = g; return record; };
	expect(saved.guidance.map(withoutSaveTime)).toEqual(preview.analysis.guidance.map(withoutSaveTime));
	expect(saved.valuation).toEqual(preview.analysis.valuation);
	if (saved.valuation) {
		await company.getByRole('button', { name: 'View scenarios & reasoning' }).click();
		await expect(company.getByRole('table')).toHaveCount(3);
	}
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.screenshot({ path: testInfo.outputPath('hfcl-saved.png'), fullPage: true });
	expect(errors).toEqual([]);
});
