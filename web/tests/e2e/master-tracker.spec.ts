import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const symbol='SUPREMEPWR';
const identity={symbol,name:'Supreme Power Equipment Ltd',bseCode:'999001',sector:'Power',subsector:'Transmission & Distribution'};
async function seed(request:APIRequestContext) {
	expect((await request.post('/api/valuation/master-tracker',{data:identity})).status()).toBe(201);
	expect((await request.post(`/api/valuation/master-tracker/${symbol}`,{data:{action:'quarters'}})).ok()).toBeTruthy();
}
async function visit(page:Page) {
	await page.goto('/valuation/master-tracker');
	await expect(page.locator('html')).toHaveAttribute('data-hydrated','true');
}
test.beforeEach(async({request})=>{expect((await request.delete('/api/valuation/master-tracker')).ok()).toBeTruthy();});

test('explicit company creation, quarter selection, valuation preview and selective save',async({page,request},testInfo)=>{
	const errors:string[]=[];page.on('pageerror',(e)=>errors.push(e.message));
	await visit(page);
	await expect(page.getByText('No companies in your tracker yet')).toBeVisible();
	await expect(page.getByText('Mock testing mode', {exact:false})).toBeVisible();
	await page.getByRole('button',{name:'Add company',exact:true}).click();
	await page.getByRole('combobox',{name:'Choose tracker company'}).fill('Supreme');
	await page.getByRole('option').filter({hasText:'Supreme Power'}).click();
	await expect(page.getByLabel('New company BSE code')).toHaveValue('999001');
	await expect(page.getByLabel('New company BSE code')).toHaveJSProperty('readOnly',true);
	await page.getByLabel('Sector',{exact:true}).fill('Power');
	await page.getByLabel('Subsector',{exact:true}).fill('Transmission & Distribution');
	expect(await page.getByRole('form',{name:'Add tracker company'}).evaluate((form)=>[...form.querySelectorAll<HTMLInputElement>('input')].filter((i)=>!i.checkValidity()).map((i)=>({name:i.getAttribute('aria-label'),value:i.value,reason:i.validationMessage})))).toEqual([]);
	await page.getByRole('button',{name:'Create tracker company'}).click();
	const company=page.getByRole('article',{name:identity.name,exact:true});
	await expect(company).toBeVisible();await expect(company.getByText('No accepted valuation yet.')).toBeVisible();
	await company.getByRole('button',{name:'Load available quarters'}).click();
	await expect(company.getByRole('region',{name:'Q1 FY27'})).toBeVisible();
	await expect(company.getByRole('region',{name:'Q2 FY27'})).toHaveCount(0);
	await company.getByRole('region',{name:'Q4 FY26'}).getByRole('checkbox').check();
	await company.getByLabel('Valuation method for SUPREMEPWR').selectOption('pe');
	await company.getByRole('button',{name:'Create valuation',exact:true}).click();
	const review=page.getByRole('region',{name:`Review analysis for ${identity.name}`});
	await expect(review.getByRole('heading',{name:'Review analysis before saving'})).toBeVisible();
	await expect(review.getByRole('table')).toHaveCount(3);
	await expect(company.getByRole('region',{name:'Analysis progress'})).toContainText('Draft ready for review');
	const progressItems=company.getByRole('region',{name:'Analysis progress'}).getByRole('listitem');
	await expect(progressItems).toHaveCount(5);
	await expect(progressItems.filter({hasText:'Complete'})).toHaveCount(5);
	await expect(review.getByRole('heading',{name:/P\/E.*scenario model/})).toBeVisible();
	await expect(company.getByText('No accepted valuation yet.')).toBeVisible();
	await review.getByRole('checkbox').filter({visible:true}).first().uncheck();
	await review.getByRole('button',{name:'Save selected analysis'}).click();
	await expect(review).toHaveCount(0);
	await expect(company.getByText('Guidance: 1', {exact:true})).toBeVisible();
	await expect(company.getByRole('heading',{name:'Base case FY28E'})).toBeVisible();
	const saved=await (await request.get(`/api/valuation/valuations/${symbol}`)).json();
	expect(saved.activeMethod).toBe('pe');expect(saved.activeScenario).toBe('base');expect(saved.shares).toBe(2);
	expect(saved.assumptions.pe.base.years[0].revenueGrowthPct).toBe(30);
	expect((await (await request.get('/api/valuation/valuations')).json()).some((r:{symbol:string})=>r.symbol===symbol)).toBe(true);
	await company.getByRole('button',{name:'View scenarios & reasoning'}).click();
	await expect(company.getByRole('table')).toHaveCount(3);
	await expect(company.getByRole('columnheader',{name:'FY25'})).toHaveCount(3);
	await expect(company.getByRole('columnheader',{name:'FY29E'})).toHaveCount(3);
	await page.evaluate(()=>window.scrollTo(0,0));
	await expect(page.getByRole('heading',{name:'Master Tracker',exact:true})).toBeInViewport();
	await page.screenshot({path:testInfo.outputPath('master-tracker.png'),fullPage:true});
	await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
	expect(errors).toEqual([]);
});

test('progress remains visible while running and streamed errors allow a retry',async({page,request})=>{
	await seed(request);await visit(page);
	let release!:()=>void;const wait=new Promise<void>((resolve)=>{release=resolve;});
	await page.route(`**/api/valuation/master-tracker/${symbol}`,async(route)=>{
		if(route.request().postDataJSON()?.action!=='analyse')return route.continue();
		await wait;
		await route.fulfill({contentType:'application/x-ndjson',body:'{"type":"progress","step":"documents"}\n{"type":"error","message":"Document service unavailable. Retry."}\n'});
	});
	const company=page.getByRole('article',{name:identity.name,exact:true});
	await company.getByRole('button',{name:'Create valuation',exact:true}).click();
	await expect(company.getByRole('region',{name:'Analysis progress'})).toContainText('Currently: Check company financials');
	await expect(company.getByRole('button',{name:'Create valuation',exact:true})).toBeDisabled();
	release();await expect(page.getByRole('alert')).toContainText('Document service unavailable');
	await expect(company.getByRole('region',{name:'Analysis progress'})).toContainText('Analysis stopped');
	await page.unroute(`**/api/valuation/master-tracker/${symbol}`);
	await company.getByRole('button',{name:'Create valuation',exact:true}).click();
	await expect(page.getByRole('region',{name:`Review analysis for ${identity.name}`})).toContainText('Accept this valuation model');
});

test('an empty requested valuation explains the gap and regeneration keeps valuation enabled',async({page,request})=>{
	await seed(request);await visit(page);
	// The page reloads draft state from SvelteKit after analysis; simulate a
	// provider-declined draft in that response, rather than only its POST result.
	const draftData='**/valuation/master-tracker/__data.json*';
	await page.route(draftData,async(route)=>{
		const response=await route.fetch(),payload=await response.json();
		for(const node of payload.nodes??[]) {
			if(!Array.isArray(node.data))continue;
			const data=node.data;
			for(const entry of [...data]) {
				if(!entry||typeof entry!=='object'||!('analysis' in entry)||!('userId' in entry))continue;
				const analysis=data[entry.analysis];
				analysis.valuation=data.push(null)-1;
				const reason=data.push('Valuation unavailable: current share count is missing.')-1;
				analysis.warnings=data.push([reason])-1;
			}
		}
		await route.fulfill({response,json:payload});
	});
	await page.getByRole('article',{name:identity.name,exact:true}).getByRole('button',{name:'Create valuation',exact:true}).click();
	const review=page.getByRole('region',{name:`Review analysis for ${identity.name}`});
	await expect(review).toContainText('current share count is missing');
	await expect(review).toContainText('No valuation has been saved to the watchlist');
	await page.unroute(draftData);
	const retry=page.waitForRequest((r)=>r.url().endsWith(`/master-tracker/${symbol}`)&&r.postDataJSON()?.action==='analyse');
	await review.getByRole('button',{name:'Regenerate draft'}).click();expect((await retry).postDataJSON().valuation).toBe(true);
	await expect(review.getByRole('table')).toHaveCount(3);
});

test('manual revisions survive new-quarter analysis, regeneration, rejection and refresh',async({page,request})=>{
	await seed(request);
	const first=await request.post(`/api/valuation/master-tracker/${symbol}`,{data:{action:'analyse',quarters:['2026-03-31'],valuation:false,method:'auto'}});
	expect(first.ok()).toBeTruthy();const {preview}=await first.json();
	expect((await request.post(`/api/valuation/master-tracker/${symbol}`,{data:{action:'accept',previewId:preview.id,accepted:preview.analysis.guidance.map((g:{id:string})=>g.id),valuation:false}})).ok()).toBeTruthy();
	await visit(page);const company=page.getByRole('article',{name:identity.name,exact:true});
	await company.getByRole('button',{name:'Edit guidance',exact:true}).click();
	await company.getByLabel('Commitment',{exact:true}).fill('My reviewed FY27 revenue target: 30%');
	await company.getByLabel('Reasoning',{exact:true}).fill('Reviewed against the company call; keep this manual interpretation.');
	await company.getByRole('button',{name:'Save manual revision'}).click();
	await expect(company.getByText('Protected manual edit', {exact:false})).toBeVisible();
	await company.getByRole('button',{name:'Analyse selected quarters'}).click();
	const review=page.getByRole('region',{name:`Review analysis for ${identity.name}`});
	await expect(review.getByText('that you manually edited',{exact:false})).toBeVisible();
	await expect(review.getByRole('button',{name:'Save selected analysis'})).toBeDisabled();
	await review.getByRole('button',{name:'Regenerate draft'}).click();
	await expect(review.getByRole('button',{name:'Save selected analysis'})).toBeDisabled();
	await page.reload();await expect(review).toBeVisible();
	await review.getByRole('checkbox',{name:'I reviewed the proposed changes to manually edited work.'}).check();
	await review.getByRole('button',{name:'Save selected analysis'}).click();
	await expect(review).toHaveCount(0);
	await expect(company.getByText('My reviewed FY27 revenue target: 30%',{exact:true})).toBeVisible();
	await expect(company.getByText('Guidance: 1',{exact:true})).toBeVisible();
	await company.getByRole('button',{name:'Analyse selected quarters'}).click();
	await expect(review).toBeVisible();await review.getByRole('button',{name:'Discard draft'}).click();
	await expect(review).toHaveCount(0);
	await page.reload();await expect(company.getByText('My reviewed FY27 revenue target: 30%',{exact:true})).toBeVisible();
});

test('filters and selected quarters are restored and reset is effective',async({page,request})=>{
	await seed(request);await visit(page);
	await page.getByLabel('Search tracker').fill('Supreme');
	await page.getByLabel('Filter reported period').selectOption('2026-03-31');
	const company=page.getByRole('article',{name:identity.name,exact:true});
	await company.getByRole('region',{name:'Q4 FY26'}).getByRole('checkbox').check();
	await expect(page).toHaveURL(/period=2026-03-31/);
	await expect.poll(()=>page.evaluate(()=>Object.keys(sessionStorage).some((k)=>k.includes('masterTracker')))).toBeTruthy();
	await page.reload();await expect(page.getByLabel('Search tracker')).toHaveValue('Supreme');
	await expect(company.getByRole('region',{name:'Q4 FY26'}).getByRole('checkbox')).toBeChecked();
	await page.getByRole('button',{name:'Reset this view'}).click();
	await expect(page.getByLabel('Search tracker')).toHaveValue('');
	await expect(page.getByLabel('Filter reported period')).toHaveValue('');
	await expect.poll(()=>page.evaluate(()=>Object.values(localStorage).every((s)=>!s.includes('999001')&&!s.includes('FY27 revenue')))).toBeTruthy();
});

test('stale saves, invalid periods, duplicate creation and another user’s draft are rejected',async({request,browser})=>{
	await seed(request);
	expect((await request.post('/api/valuation/master-tracker',{data:identity})).status()).toBe(409);
	expect((await request.post(`/api/valuation/master-tracker/${symbol}`,{data:{action:'analyse',quarters:['2030-03-31'],valuation:false,method:'auto'}})).status()).toBe(503);
	const {preview}=await (await request.post(`/api/valuation/master-tracker/${symbol}`,{data:{action:'analyse',quarters:['2026-03-31'],valuation:false,method:'auto'}})).json();
	const second=await browser.newContext({baseURL:'http://127.0.0.1:5179'});
	await second.addCookies([{name:'tracker-test-user',value:'second',url:'http://127.0.0.1:5179'}]);
	expect((await second.request.post(`/api/valuation/master-tracker/${symbol}`,{data:{action:'reject',previewId:preview.id}})).status()).toBe(404);await second.close();
	const [company]=await (await request.get('/api/valuation/master-tracker')).json();
	expect((await request.post(`/api/valuation/master-tracker/${symbol}`,{data:{action:'identity',baseVersion:company.version,bseCode:'999003'}})).ok()).toBeTruthy();
	expect((await request.post(`/api/valuation/master-tracker/${symbol}`,{data:{action:'accept',previewId:preview.id,accepted:preview.analysis.guidance.map((g:{id:string})=>g.id),valuation:false}})).status()).toBe(409);
});

test('read-only users can view accepted data but cannot create or analyse',async({page,context,request})=>{
	await seed(request);await context.addCookies([{name:'tracker-test-role',value:'read_only',url:'http://127.0.0.1:5179'}]);
	await visit(page);await expect(page.getByRole('article',{name:identity.name,exact:true})).toBeVisible();
	await expect(page.getByRole('button',{name:'Add company',exact:true})).toHaveCount(0);
	await expect(page.getByRole('button',{name:'Analyse selected quarters'})).toHaveCount(0);
	expect((await context.request.post('/api/valuation/master-tracker',{data:identity})).status()).toBe(403);
});

test('labelled guidance and scenario edits are saved as manual work and preserve the previous model',async({page,request})=>{
	await seed(request);await visit(page);
	const company=page.getByRole('article',{name:identity.name,exact:true});
	await company.getByRole('button',{name:'Create valuation',exact:true}).click();
	const review=page.getByRole('region',{name:`Review analysis for ${identity.name}`});
	await expect(review.getByRole('table')).toHaveCount(3);
	await review.getByText('Edit this proposed item',{exact:true}).click();
	await review.getByLabel('Edit Revenue growth commitment',{exact:true}).fill('Reviewed management FY27 revenue guidance: 35%');
	await review.getByText('Edit scenario assumptions',{exact:true}).click();
	await review.getByLabel('base FY27E Revenue growth %',{exact:true}).fill('40');
	await review.getByLabel('base FY27E reasoning',{exact:true}).fill('Manual upside check: 40% growth; not directly company-guided.');
	await review.getByRole('button',{name:'Save selected analysis'}).click();
	await expect(review).toHaveCount(0);
	await expect(company.getByText('Reviewed management FY27 revenue guidance: 35%',{exact:true})).toBeVisible();
	await company.getByRole('button',{name:'View scenarios & reasoning'}).click();
	await expect(company.getByText('Manually edited',{exact:true})).toBeVisible();
	const base=company.getByRole('region',{name:'Base scenario',exact:true});
	await expect(base.getByRole('row',{name:/^Sales /}).getByRole('cell').nth(2)).toHaveText('168');
	await company.getByRole('button',{name:'Edit valuation',exact:true}).click();
	await expect(review).toBeVisible();
	await review.getByText('Edit scenario assumptions',{exact:true}).click();
	await review.getByLabel('base FY27E Revenue growth %',{exact:true}).fill('30');
	await expect(review.getByRole('button',{name:'Save selected analysis'})).toBeDisabled();
	await review.getByRole('checkbox',{name:'I reviewed the proposed changes to manually edited work.'}).check();
	await review.getByRole('button',{name:'Save selected analysis'}).click();
	await expect(review).toHaveCount(0);
	await expect(company.getByText('Earlier valuation versions (2)',{exact:true})).toBeVisible();
});

test('server refuses edits to evidence and changes to manual work without acknowledgement',async({request})=>{
	await seed(request);
	const {preview}=await (await request.post(`/api/valuation/master-tracker/${symbol}`,{data:{action:'analyse',quarters:['2026-03-31'],valuation:false,method:'auto'}})).json();
	const original=preview.analysis.guidance[0];
	const changed={...original,sources:[{...original.sources[0],url:'https://example.com/fabricated.pdf'}]};
	expect((await request.post(`/api/valuation/master-tracker/${symbol}`,{data:{action:'accept',previewId:preview.id,accepted:[original.id],valuation:false,edited:[changed]}})).status()).toBe(409);
	expect((await request.post(`/api/valuation/master-tracker/${symbol}`,{data:{action:'accept',previewId:preview.id,accepted:[original.id],valuation:false,edited:[{...original,commitment:'My manual commitment'}]}})).ok()).toBeTruthy();
	const next=await (await request.post(`/api/valuation/master-tracker/${symbol}`,{data:{action:'analyse',quarters:['2026-06-30'],valuation:false,method:'auto'}})).json();
	expect((await request.post(`/api/valuation/master-tracker/${symbol}`,{data:{action:'accept',previewId:next.preview.id,accepted:next.preview.analysis.guidance.map((g:{id:string})=>g.id),valuation:false}})).status()).toBe(409);
});

test('historical number corrections recalculate the draft and save manual work to the watchlist',async({page,request})=>{
	await seed(request);await visit(page);
	const company=page.getByRole('article',{name:identity.name,exact:true});
	await company.getByRole('button',{name:'Create valuation',exact:true}).click();
	const review=page.getByRole('region',{name:`Review analysis for ${identity.name}`});
	await review.getByText('Edit scenario assumptions',{exact:true}).click();
	await review.getByLabel('Edit FY26 Tax amount',{exact:true}).fill('13');
	await expect(review).toContainText('You can still save this model for manual review');
	await expect(review.getByRole('button',{name:'Save selected analysis'})).toBeEnabled();
	await review.getByLabel('Edit FY26 Tax amount',{exact:true}).fill('3.5');
	await review.getByLabel('Edit FY26 Sales',{exact:true}).fill('150');
	await expect(review).toContainText('Current historical PBT, tax and net profit reconcile');
	await expect(review.getByRole('region',{name:'Base scenario',exact:true}).getByRole('row',{name:/^Sales /}).getByRole('cell').nth(2)).toHaveText('195');
	await review.getByRole('button',{name:'Save selected analysis'}).click();await expect(review).toHaveCount(0);
	const saved=(await (await request.get('/api/valuation/master-tracker')).json())[0];
	expect(saved.valuation.manual).toBe(true);expect(saved.valuation.history[1].sales).toBe(150);
	expect(saved.valuationHistory[0].history[1].sales).toBe(120);
	const watchlist=await (await request.get(`/api/valuation/valuations/${symbol}`)).json();
	expect(watchlist.assumptions[watchlist.activeMethod].base.baseSales).toBe(150);
	await page.reload();await company.getByRole('button',{name:'Edit valuation',exact:true}).click();
	await review.getByText('Edit scenario assumptions',{exact:true}).click();
	await review.getByLabel('Edit FY26 Tax amount',{exact:true}).fill('13');
	await review.getByRole('checkbox',{name:'I reviewed the proposed changes to manually edited work.'}).check();
	await review.getByRole('button',{name:'Save selected analysis'}).click();await expect(review).toHaveCount(0);
	const unresolved=(await (await request.get('/api/valuation/master-tracker')).json())[0];
	expect(unresolved.valuation.history[1].tax).toBe(13);expect(unresolved.valuation.caveats.at(-1)).toContain('Manual figures need review');
	const draft=await (await request.post(`/api/valuation/master-tracker/${symbol}`,{data:{action:'edit-model',baseVersion:unresolved.version}})).json();
	const altered=structuredClone(draft.preview.analysis.valuation);altered.history[0].sources[0].url='https://example.com/fabricated.pdf';
	expect((await request.post(`/api/valuation/master-tracker/${symbol}`,{data:{action:'accept',previewId:draft.preview.id,accepted:[],valuation:true,editedModel:altered,acknowledgeManual:true}})).status()).toBe(400);
});

test('automatic identity and the saved Supreme Power sample need no manual code entry',async({page,request},testInfo)=>{
	const lookup=await request.get('/api/valuation/master-tracker/identity?symbol=SUPREMEPWR&name=Supreme%20Power%20Equipment%20Ltd');
	expect(lookup.ok()).toBeTruthy();expect(await lookup.json()).toMatchObject({nseSymbol:'SUPREMEPWR',bseCode:'999001'});
	const created=await request.post('/api/valuation/master-tracker',{data:{...identity,bseCode:null}});
	expect(created.status()).toBe(201);expect((await created.json()).bseCode).toBe('999001');
	expect((await request.post('/api/valuation/master-tracker/sample')).ok()).toBeTruthy();
	await visit(page);const company=page.getByRole('article',{name:identity.name,exact:true});
	await expect(company.getByText('Guidance: 6',{exact:true})).toBeVisible();
	const counts=company.getByLabel('Guidance execution counts');
	for(const text of ['Pending: 2','Met: 1','Beat: 1','Miss: 1','Revised: 1'])await expect(counts.getByText(text,{exact:true})).toBeVisible();
	await expect(company.getByText('Actual: Reported Q1 utilisation: 68%, below the 75% target.',{exact:true})).toBeVisible();
	const quarters=company.getByRole('region',{name:'Reported quarters',exact:true});
	await expect(quarters.getByRole('region')).toHaveCount(8);
	const summary=company.getByRole('complementary',{name:'Base valuation summary'});
	const summaryBefore=(await summary.boundingBox())!,quarterBounds=(await quarters.boundingBox())!;
	if(page.viewportSize()!.width>720)expect(summaryBefore.x+summaryBefore.width).toBeLessThanOrEqual(quarterBounds.x);
	else expect(summaryBefore.y+summaryBefore.height).toBeLessThanOrEqual(quarterBounds.y);
	expect(await quarters.evaluate((el)=>el.scrollWidth>el.clientWidth)).toBeTruthy();
	await quarters.focus();await page.keyboard.press('ArrowRight');
	await expect.poll(()=>quarters.evaluate((el)=>el.scrollLeft)).toBeGreaterThan(0);
	await quarters.evaluate((el)=>{el.scrollLeft=el.scrollWidth;});
	const summaryAfter=(await summary.boundingBox())!;
	expect(summaryAfter.x).toBe(summaryBefore.x);
	await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
	await page.screenshot({path:testInfo.outputPath('sample-quarter-scroll.png'),fullPage:true});
	const again=await request.post('/api/valuation/master-tracker/sample');expect((await again.json()).added).toBe(0);
});
