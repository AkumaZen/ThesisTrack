import { test, expect } from '@playwright/test';
import postgres from 'postgres';
import { randomBytes, pbkdf2Sync, randomUUID } from 'node:crypto';

const sql = postgres('postgres://thesis:thesis@127.0.0.1:45432/thesis_documents_test', { max: 1 });
const email = `documents-${randomUUID()}@local.test`;
const password = randomBytes(24).toString('base64url');
const companyId = `DOCS_${randomBytes(6).toString('hex')}`;
const symbol = `DOCS${randomBytes(5).toString('hex').toUpperCase()}`;
let userId: number;
let industryId: number;

test.beforeAll(async () => {
	const salt = randomBytes(16);
	const hash = `${salt.toString('hex')}$${pbkdf2Sync(password, salt, 260000, 32, 'sha256').toString('hex')}`;
	[userId] = (await sql`insert into public.users(email,password_hash,display_name,role,is_active,must_change_password) values(${email},${hash},${`Docs.${randomBytes(4).toString('hex')}`},'read_write',true,false) returning id`).map((r) => r.id);
	const [industry] = await sql`insert into public.broad_industries(name) values(${companyId}) returning id`; industryId = industry.id;
	const [niche] = await sql`insert into public.specific_niches(broad_industry_id,name) values(${industryId},${companyId}) returning id`;
	await sql`insert into public.operating_models(name) values('factory') on conflict do nothing`;
	await sql`insert into public.companies(company_id,name,nse_ticker,broad_industry_id,specific_niche_id,operating_model) values(${companyId},'Document Test Company',${symbol},${industryId},${niche.id},'factory')`;
	const [scenario] = await sql`insert into public.thesis_scenarios(company_id,owner,last_reviewed) values(${companyId},${email},'2026-11-02') returning id`;
	const [version] = await sql`insert into public.thesis_versions(company_id,scenario_id,version_no,thesis_data,authored_by) values(${companyId},${scenario.id},1,${sql.json({ the_business: { what_it_does: 'Manufactures test products.' } })},${email}) returning version_id`;
	await sql`update public.thesis_scenarios set current_version_id=${version.version_id} where id=${scenario.id}`;
});
test.afterAll(async () => {
	try {
		await sql.begin(async (tx) => { await tx`select set_config('app.allow_thesis_delete','on',true)`; await tx`delete from public.companies where company_id=${companyId}`; });
		await sql`delete from public.specific_niches where broad_industry_id=${industryId}`;
		await sql`delete from public.broad_industries where id=${industryId}`;
		await sql`delete from public.users where id=${userId} and email=${email}`;
		await sql`delete from valuation.announcements where nse_symbol=${symbol}`;
	} finally { await sql.end(); }
});

test('company documents: refresh, PDF summaries, categories, expansion, persistence and read-only access', async ({ page }, info) => {
	const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
	expect((await page.request.get(`/api/companies/${companyId}/documents`)).status()).toBe(401);
	await page.goto(`/login?next=${encodeURIComponent(`/company/${companyId}`)}`);
	await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/company/${companyId}$`));
	const section = page.getByRole('region', { name: 'Important documents', exact: true });
	await expect(section.getByText(/No summarised important documents/)).toBeVisible();
	await section.getByRole('button', { name: 'Refresh documents', exact: true }).click();
	const order = section.locator('details').filter({ hasText: 'secured a new manufacturing contract' });
	await expect(order).toBeVisible(); await expect(section.locator('details')).toHaveCount(2);
	await expect(order.locator('p').filter({ hasText: 'INR 100 crore' })).not.toBeVisible();
	await order.locator('summary').click(); await expect(order.getByText(/INR 100 crore/)).toBeVisible();
	await expect(order.getByRole('link', { name: 'Open original filing (PDF)' })).toHaveAttribute('href', /docs-e2e-order.pdf$/);
	await section.getByLabel('Document type').selectOption('Management'); await expect(section.locator('details')).toHaveCount(1);
	await expect(section.getByText('A new chief financial officer was appointed.')).toBeVisible();
	await section.getByLabel('Document type').selectOption('Results'); await expect(section.getByText(/No summarised important documents in this category/)).toBeVisible();
	await section.getByLabel('Document type').selectOption('All');
	const [cached] = await sql`select count(*)::int as count from valuation.announcements where nse_symbol=${symbol} and document_summary is not null`;
	expect(cached.count).toBe(3); // Includes a reviewed, excluded routine meeting.
	await page.reload(); await expect(section.locator('details')).toHaveCount(2);
	expect((await page.request.get('/api/companies/NOT_A_CARD/documents')).status()).toBe(404);
	await sql`update public.users set role='read_only' where id=${userId}`;
	await page.reload(); await expect(section.locator('details')).toHaveCount(2);
	await expect(section.getByRole('button', { name: 'Refresh documents', exact: true })).toHaveCount(0);
	expect((await page.request.post(`/api/companies/${companyId}/documents`)).status()).toBe(403);
	await page.screenshot({ path: info.outputPath('company-documents.png'), fullPage: true });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	expect(errors).toEqual([]);
});
