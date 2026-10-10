import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID, pbkdf2Sync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import dotenv from 'dotenv';
import postgres from 'postgres';
import { scenarioYears, type Preview } from '../../src/lib/valuation/masterTracker';

const enabled = process.env.RUN_PICCADILY_LIVE_TEST === 'true';
const includeValuation = process.env.PICCADILY_TEST_VALUATION === 'true';
let sql: ReturnType<typeof postgres>;
let userId: number;
const email = `playwright-piccadily-${randomUUID()}@local.test`;
const password = randomBytes(24).toString('base64url');

test.beforeAll(async () => {
	if (!enabled) return;
	const env = dotenv.parse(readFileSync('.env'));
	if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.DATABASE_URL).hostname)) throw new Error('Live browser test requires the local database.');
	expect(env.MASTER_TRACKER_TEST_MODE).toBe('false');
	expect(env.OPENAI_MODEL).toBe('gpt-5.6-luna');
	sql = postgres(env.DATABASE_URL, { max: 1 });
	const salt = randomBytes(16);
	const hash = `${salt.toString('hex')}$${pbkdf2Sync(password, salt, 260000, 32, 'sha256').toString('hex')}`;
	const rows = await sql.unsafe("insert into public.users(email,password_hash,display_name,role,is_active,must_change_password) values($1,$2,$3,'read_write',true,false) returning id", [email, hash, 'Playwright.Piccadily']);
	userId = rows[0].id;
});

test.afterAll(async () => {
	if (!sql) return;
	try {
		// Remove only the generated test account; its sessions/drafts cascade. Saved analysis stays.
		if (userId) await sql.unsafe('delete from public.users where id=$1 and email=$2', [userId, email]);
	} finally { await sql.end(); }
});

test('normal app: Piccadily Q1 FY27 live research, review, save and reload', async ({ page }, testInfo) => {
	test.skip(!enabled, 'Explicit opt-in required for live Luna analysis.');
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('/login?next=%2Fvaluation%2Fmaster-tracker');
	await page.getByLabel('Email', { exact: true }).fill(email);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page).toHaveURL(/\/valuation\/master-tracker$/);
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(page.getByText('Mock testing mode', { exact: false })).toHaveCount(0);

	await page.getByRole('button', { name: 'Add company', exact: true }).click();
	await page.getByRole('combobox', { name: 'Choose tracker company' }).fill('Piccadily');
	await page.getByRole('listbox').getByRole('option').filter({ hasText: 'Piccadily Agro Industries Ltd' }).click();
	await expect(page.getByLabel('New company BSE code')).toHaveValue('530305', { timeout: 90000 });
	const company = page.getByRole('article', { name: 'Piccadily Agro Industries Ltd', exact: true });
	if (await company.count()) await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	else await page.getByRole('button', { name: 'Create tracker company' }).click();
	await expect(company).toBeVisible();
	await page.getByLabel('Search tracker').fill('');
	await page.getByLabel('Filter execution status').selectOption('all');
	await page.getByLabel('Filter reported period').selectOption('');
	const periods = page.waitForResponse((r) => r.url().endsWith('/master-tracker/PICCADIL') && r.request().postDataJSON()?.action === 'quarters', { timeout: 120000 });
	await company.getByRole('button', { name: /Load available quarters|Refresh available quarters/ }).click();
	const periodResponse = await periods;
	expect(periodResponse.status(), await periodResponse.text()).toBe(200);
	const strip = company.getByRole('region', { name: 'Reported quarters', exact: true });
	for (const box of await strip.getByRole('checkbox', { checked: true }).all()) await box.uncheck();
	await company.getByRole('region', { name: 'Jun 2026', exact: true }).getByRole('checkbox').check();
	await expect(strip.getByRole('checkbox', { checked: true })).toHaveCount(1);
	await company.getByLabel('Include valuation').setChecked(includeValuation);
	await company.getByLabel('Refresh research').uncheck();

	const analysisResponse = page.waitForResponse((r) => r.url().endsWith('/master-tracker/PICCADIL') && r.request().postDataJSON()?.action === 'analyse', { timeout: 240000 });
	await company.getByRole('button', { name: includeValuation ? 'Create valuation' : 'Analyse selected quarters', exact: true }).click();
	await page.screenshot({ path: testInfo.outputPath('piccadily-progress.png'), fullPage: true });
	const response = await analysisResponse;
	expect(response.status()).toBe(200);
	// Chrome may discard a consumed streaming body. Verify the rendered draft and
	// read this temporary account's real persisted preview instead of reading it twice.
	const review = page.getByRole('region', { name: 'Review analysis for Piccadily Agro Industries Ltd' });
	await expect(review.getByRole('heading', { name: 'Review analysis before saving' })).toBeVisible({ timeout: 180000 });
	const draftRows = await sql.unsafe('select data from valuation.master_tracker_previews where user_id=$1 and symbol=$2', [userId, 'PICCADIL']);
	const preview = draftRows[0].data as Preview;
	expect(preview.quarters).toEqual(['2026-06-30']);
	expect(preview.analysis.guidance.length).toBeGreaterThan(0);
	if (includeValuation) {
		expect(preview.analysis.valuation, JSON.stringify(preview.analysis.warnings)).not.toBeNull();
		for (const year of preview.analysis.valuation!.history) expect(year.pbt - year.tax).toBeCloseTo(year.netProfit, 6);
	} else expect(preview.analysis.valuation).toBeNull();
	const researchRows = await sql.unsafe('select data from valuation.master_tracker_research where key=$1', ['PICCADIL:2026-06-30']);
	const documents = researchRows[0].data.sources.filter((s: { id: string }) => s.id.startsWith('doc-'));
	const sourceUrls = new Set(documents.map((d: { url: string }) => d.url));
	expect(preview.analysis.guidance.some((g: { sources: { url: string }[] }) => g.sources.some((s) => sourceUrls.has(s.url)))).toBeTruthy();
	for (const item of preview.analysis.guidance) {
		expect(item.quarter).toBe('2026-06-30');
		expect(item.sources.length).toBeGreaterThan(0);
	}
	// Ground truth from the August 12 Q1-results call: its current quarter is Q2.
	const launches = preview.analysis.guidance.find((g: { metric: string }) => /product.*launch|launch.*product/i.test(g.metric));
	expect(launches).toBeDefined();
	expect(launches!.commitment).not.toMatch(/Q1\s*FY27/i);
	const barrels = preview.analysis.guidance.find((g: { metric: string }) => /barrel/i.test(g.metric));
	expect(barrels).toBeDefined();
	expect(barrels!.status).toBe('Revised');
	expect(barrels!.commitment.replaceAll(',', '')).toMatch(/115000|120000/);
	writeFileSync(testInfo.outputPath('live-analysis.json'), JSON.stringify(preview.analysis, null, 2));
	await expect(review.getByRole('heading', { name: 'Review analysis before saving' })).toBeVisible();
	if (includeValuation) await expect(review.getByRole('table')).toHaveCount(3);
	await expect(page.getByRole('alert')).toHaveCount(0);
	await review.getByRole('button', { name: 'Save selected analysis' }).click();
	await expect(review).toHaveCount(0);
	await page.reload();
	await expect(company).toBeVisible();
	const savedResponse = await page.request.get('/api/valuation/master-tracker');
	expect(savedResponse.status()).toBe(200);
	const saved = (await savedResponse.json()).find((c: { symbol: string }) => c.symbol === 'PICCADIL');
	for (const proposed of preview.analysis.guidance) {
		const restored = saved.guidance.find((g: { id: string }) => g.id === proposed.id);
		expect(restored).toBeDefined();
		expect(restored.commitment).toBe(proposed.commitment);
		expect(restored.sources).toEqual(proposed.sources);
	}
	await expect(company.getByRole('region', { name: 'Jun 2026', exact: true }).getByRole('checkbox')).toBeChecked();
	await page.screenshot({ path: testInfo.outputPath('piccadily-saved.png'), fullPage: true });
	if (includeValuation) {
		const watchlistResponse = await page.request.get('/api/valuation/valuations/PICCADIL');
		expect(watchlistResponse.status()).toBe(200);
		const record = await watchlistResponse.json();
		expect(record.activeMethod).toBe(saved.valuation.method);
		expect(record.assumptions[record.activeMethod].base.years[1].targetMultiple).toBe(saved.valuation.scenarios.base[1].targetMultiple);
		expect((await (await page.request.get('/api/valuation/valuations')).json()).some((r: { symbol: string }) => r.symbol === 'PICCADIL')).toBe(true);
		await company.getByRole('link', { name: 'View in watchlist' }).click();
		await expect(page).toHaveURL(/\/valuation$/);
		const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Piccadily Agro Industries Ltd', exact: true }) });
		await expect(row).toBeVisible({ timeout: 30000 });
		const target = scenarioYears(saved.valuation, 'base')[1].impliedPrice;
		await expect(row).toContainText(target.toLocaleString('en-IN', { maximumFractionDigits: 2 }), { timeout: 45000 });
		await page.screenshot({ path: testInfo.outputPath('piccadily-watchlist.png'), fullPage: true });
	}
	expect(errors).toEqual([]);
});
