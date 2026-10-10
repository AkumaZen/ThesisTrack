import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID, pbkdf2Sync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import postgres from 'postgres';

const enabled = process.env.RUN_TRACKER_PRODUCTION_TEST === 'true';
const email = `playwright-production-${randomUUID()}@test.invalid`;
const password = randomBytes(24).toString('base64url');
let sql: ReturnType<typeof postgres>, userId: number;
test.beforeAll(async () => {
	if (!enabled) return;
	const env = dotenv.parse(readFileSync('../.env'));
	if (!env.NEON_DB_URL) throw new Error('Explicit production database configuration required');
	sql = postgres(env.NEON_DB_URL, { max: 1, prepare: false, ssl: 'require' });
	const salt = randomBytes(16);
	const hash = `${salt.toString('hex')}$${pbkdf2Sync(password, salt, 260000, 32, 'sha256').toString('hex')}`;
	const rows = await sql.unsafe("insert into public.users(email,password_hash,display_name,role,is_active,must_change_password) values($1,$2,'Production.QA','read_write',true,false) returning id", [email, hash]);
	userId = rows[0].id;
});
test.afterAll(async () => {
	if (!sql) return;
	try { if (userId) await sql.unsafe('delete from public.users where id=$1 and email=$2', [userId, email]); } finally { await sql.end(); }
});
test('deployed login → research → Luna valuation → manual edit → save → watchlist', async ({ page }, info) => {
	test.skip(!enabled, 'Production testing requires explicit opt-in.');
	await page.goto('/login?next=%2Fvaluation%2Fmaster-tracker');
	await page.getByLabel('Email', { exact: true }).fill(email);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page).toHaveURL(/\/valuation\/master-tracker$/);
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	const company = page.getByRole('article', { name: 'Piccadily Agro Industries Ltd', exact: true });
	if (!await company.count()) {
		await page.getByRole('button', { name: 'Add company', exact: true }).click();
		await page.getByRole('combobox', { name: 'Choose tracker company' }).fill('Piccadily');
		await page.getByRole('listbox').getByRole('option').filter({ hasText: 'Piccadily Agro Industries Ltd' }).click();
		await expect(page.getByLabel('New company BSE code')).toHaveValue('530305', { timeout: 90000 });
		await page.getByRole('button', { name: 'Create tracker company' }).click();
	}
	await expect(company).toBeVisible();
	await company.getByRole('button', { name: /Load available quarters|Refresh available quarters/ }).click();
	const strip = company.getByRole('region', { name: 'Reported quarters', exact: true });
	await expect(company.getByRole('region', { name: 'Jun 2026', exact: true })).toBeVisible({ timeout: 90000 });
	for (const box of await strip.getByRole('checkbox', { checked: true }).all()) await box.uncheck();
	await company.getByRole('region', { name: 'Jun 2026', exact: true }).getByRole('checkbox').check();
	await company.getByLabel('Include valuation').check();
	const responsePromise = page.waitForResponse((response) => response.url().endsWith('/master-tracker/PICCADIL') && response.request().postDataJSON()?.action === 'analyse', { timeout: 300000 });
	await company.getByRole('button', { name: 'Create valuation', exact: true }).click();
	const response = await responsePromise;
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toContain('application/x-ndjson');
	const review = page.getByRole('region', { name: 'Review analysis for Piccadily Agro Industries Ltd' });
	await expect(review.getByRole('heading', { name: 'Review analysis before saving' })).toBeVisible({ timeout: 300000 });
	await expect(review.getByRole('table')).toHaveCount(3);
	const [draft] = await sql.unsafe('select data from valuation.master_tracker_previews where user_id=$1 and symbol=$2', [userId, 'PICCADIL']);
	expect(draft.data.analysis.valuation).not.toBeNull();
	expect(draft.data.analysis.guidance.length).toBeGreaterThan(0);
	await review.getByText('Edit scenario assumptions', { exact: true }).click();
	const editedCmp = draft.data.analysis.valuation.cmp + 1;
	await review.getByLabel('Edit valuation CMP', { exact: true }).fill(String(editedCmp));
	await review.getByRole('button', { name: 'Save selected analysis' }).click();
	await expect(review).toHaveCount(0);
	await page.reload();
	const saved = await (await page.request.get('/api/valuation/master-tracker')).json();
	expect(saved.find((item: { symbol: string }) => item.symbol === 'PICCADIL').valuation.cmp).toBe(editedCmp);
	const recordResponse = await page.request.get('/api/valuation/valuations/PICCADIL');
	expect(recordResponse.status()).toBe(200);
	await company.getByRole('link', { name: 'View in watchlist' }).click();
	await expect(page).toHaveURL(/\/valuation$/);
	await expect(page.getByRole('link', { name: 'Piccadily Agro Industries Ltd', exact: true })).toBeVisible();
	await page.screenshot({ path: info.outputPath('deployed-watchlist.png'), fullPage: true });
});
