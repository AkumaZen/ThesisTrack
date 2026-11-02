import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import postgres from 'postgres';
import { randomBytes, pbkdf2Sync, randomUUID } from 'node:crypto';

const sql = postgres('postgres://thesis:thesis@127.0.0.1:45432/thesis_documents_test', { max: 1 });
const email = `images-${randomUUID()}@local.test`;
const password = randomBytes(24).toString('base64url');
const companyId = `IMAGES_${randomBytes(6).toString('hex')}`;
const symbol = `DOCS${randomBytes(5).toString('hex').toUpperCase()}`;
let userId: number;
let industryId: number;

test.beforeAll(async () => {
	await sql.unsafe(await readFile('drizzle/0036_thesis_images.sql', 'utf8'));
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

test('thesis images: file picker, paste, drag/drop, save, edit, expand and owner permissions', async ({ page }, info) => {
 const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
 const endpoint = `/api/companies/${companyId}/images`;
 expect((await page.request.get(endpoint)).status()).toBe(401);
 await page.goto(`/login?next=${encodeURIComponent(`/company/${companyId}`)}`);
 await page.getByLabel('Email', {exact:true}).fill(email);
 await page.getByLabel('Password', {exact:true}).fill(password);
 await page.getByRole('button', {name:'Sign in',exact:true}).click();
 await expect(page).toHaveURL(new RegExp(`/company/${companyId}$`));
 const section = page.getByRole('region',{name:'Images & key updates',exact:true});
 await expect(section).toBeVisible();
 const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1EAAAAASUVORK5CYII=', 'base64');
 // Use a real browser-generated raster: Chrome decodes it through the production resize path.
 const data = await page.evaluate(() => { const canvas=document.createElement('canvas'); canvas.width=1200; canvas.height=800; const ctx=canvas.getContext('2d')!; ctx.fillStyle='#2563eb'; ctx.fillRect(0,0,1200,800); ctx.fillStyle='white'; ctx.font='48px sans-serif'; ctx.fillText('Product update',80,100); return canvas.toDataURL('image/png').split(',')[1]; });
 const chooserPromise = page.waitForEvent('filechooser');
 await section.getByRole('button',{name:'Add images',exact:true}).click();
 await (await chooserPromise).setFiles({name:'Product launch.png', mimeType:'image/png', buffer:Buffer.from(data,'base64')});
 await expect(section.getByLabel('Title',{exact:true})).toHaveValue('Product launch');
 await section.getByLabel('Image type').selectOption('Product');
 await section.getByLabel('Caption or key update').fill('New product range\nLaunch planned for next quarter.');
 await section.getByLabel('Source link (optional)').fill('https://example.com/products');
 // Simulate the image clipboard payload consumed by Ctrl+V, without host clipboard permissions.
 await page.evaluate(({data}) => { const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)); const clipboardData=new DataTransfer(); clipboardData.items.add(new File([bytes],'Slide snapshot.png',{type:'image/png'})); window.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true})); },{data});
 await expect(section.getByLabel('Title',{exact:true})).toHaveCount(2);
 await section.getByLabel('Title',{exact:true}).nth(1).fill('PPT snapshot');
 await section.locator('.dropzone').evaluate((node, data) => {const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)); const dataTransfer=new DataTransfer(); dataTransfer.items.add(new File([bytes],'Key update.png',{type:'image/png'})); node.dispatchEvent(new DragEvent('drop',{dataTransfer,bubbles:true,cancelable:true}));},data);
 await expect(section.getByLabel('Title',{exact:true})).toHaveCount(3);
 await section.getByLabel('Image type').nth(2).selectOption('Key update');
 await page.route(`**/api/companies/${companyId}/images?*`, route=>route.fulfill({status:503,json:{detail:'Upload interrupted. Please retry.'}}),{times:1});
 await section.getByRole('button',{name:'Save images',exact:true}).click();
 await expect(section.getByRole('alert')).toContainText('Upload interrupted. Please retry.');
 await expect(section.getByLabel('Title',{exact:true})).toHaveCount(3);
 await section.getByRole('button',{name:'Save images',exact:true}).click();
 await expect(section.getByText('Images saved to this thesis.',{exact:true})).toBeVisible();
 await expect(section.locator('figure')).toHaveCount(3);
 const rows = await sql`select i.id,i.image_data from public.thesis_images i join public.thesis_scenarios s on s.id=i.scenario_id where s.company_id=${companyId}`;
 expect(rows).toHaveLength(3); expect(rows.every(r=>r.image_data.startsWith('data:image/webp;base64,'))).toBe(true);
 const asset = await page.request.get(`${endpoint}?image=${rows[0].id}`);
 expect(asset.status()).toBe(200); expect(asset.headers()['content-type']).toBe('image/webp');
 await section.getByRole('button',{name:'Expand Product launch',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Product launch',exact:true}); await expect(dialog).toBeVisible();
 await expect(dialog.getByText('New product range', {exact:false})).toBeVisible();
 await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
 await page.reload(); await expect(section.locator('figure')).toHaveCount(3);
 const product=section.locator('figure').filter({has:page.getByRole('heading',{name:'Product launch',exact:true})});
 await product.getByRole('button',{name:'Edit',exact:true}).click();
 await section.getByLabel('Caption or key update').fill('Revised key update.');
 await section.getByRole('button',{name:'Save images',exact:true}).click();
 await expect(product).toContainText('Revised key update.');
 page.once('dialog',dialog=>dialog.accept());
 await product.getByRole('button',{name:'Remove',exact:true}).click();
 await expect(section.locator('figure')).toHaveCount(2);
 expect((await page.request.post(endpoint,{data:{title:'Bad',category:'Product',imageData:'data:image/svg+xml;base64,PHN2Zz4='}})).status()).toBe(422);
 expect((await page.request.post(endpoint,{data:{title:'Bad',category:'Product',imageData:'data:image/png;base64,'+'A'.repeat(1_450_000)}})).status()).toBe(413);
 // A second analyst may view these images but cannot modify them through their own scenario.
 const [other]=await sql`insert into public.thesis_scenarios(company_id,owner,last_reviewed) values(${companyId},${`other-${email}`},'2026-11-02') returning id`;
 const [version] = await sql`select current_version_id from public.thesis_scenarios where company_id=${companyId} and owner=${email}`;
 await sql`update public.thesis_scenarios set current_version_id=${version.current_version_id} where id=${other.id}`;
 const [otherImage]=await sql`insert into public.thesis_images(scenario_id,title,category,image_data) values(${other.id},'Colleague image','Other',${'data:image/png;base64,'+png.toString('base64')}) returning id`;
 expect((await page.request.delete(endpoint,{data:{id:otherImage.id}})).status()).toBe(404);
 expect((await page.request.patch(endpoint,{data:{id:otherImage.id,title:'Changed',category:'Other'}})).status()).toBe(404);
 await page.goto(`/company/${companyId}?owner=${encodeURIComponent(`other-${email}`)}`);
 await expect(section.getByRole('button',{name:'Expand Colleague image',exact:true})).toBeVisible();
 await expect(section.getByRole('button',{name:'Add images',exact:true})).toHaveCount(0);
 await page.goto(`/company/${companyId}`);
 await sql`update public.users set role='read_only' where id=${userId}`;
 await page.reload(); await expect(section).toBeVisible(); await expect(section.locator('figure')).toHaveCount(2); await expect(section.getByRole('button',{name:'Add images',exact:true})).toHaveCount(0);
 expect((await page.request.post(endpoint,{data:{}})).status()).toBe(403);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await section.scrollIntoViewIfNeeded();
 await expect(section.locator('figure img').first()).toHaveJSProperty('complete',true);
 await expect(section.locator('figure img').first()).not.toHaveJSProperty('naturalWidth',0);
 await section.screenshot({path:info.outputPath('thesis-images.png')});
 expect(errors).toEqual([]);
});
