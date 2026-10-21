// Merges a sector taxonomy file (research/sector_taxonomy_v2.json) into valuation.sector_majors and
// valuation.sector_baskets. The database is the source of truth for sectors (sectorStore.ts seeds from
// customSectors.ts only once), so a new taxonomy has to be loaded here rather than edited into the seed.
//
//   DATABASE_URL=postgresql://... node scripts/import-sector-taxonomy.mjs <json>            (dry run)
//   DATABASE_URL=postgresql://... node scripts/import-sector-taxonomy.mjs <json> --apply    (writes)
//
// ADD-ONLY: creates missing majors and baskets, updates labels, adds new symbols to existing baskets,
// attaches baskets to majors and sets major positions from file order (majors not in the file follow
// them in their old order). Nothing in the database but not in the file is ever removed; it is listed as
// "kept, not in file". With --replace the file is authoritative for what it lists: listed baskets get exactly the
// file's symbols (a symbol that would then be in no basket at all is reported as orphaned and stays where it was),
// listed majors get exactly the file's baskets, and a major not in the file is deleted once all its baskets are
// claimed by file majors. The other exception is an optional top-level "retired": [basket keys] list in the file:
// those baskets are deleted and detached from every major (a major left with no baskets is reported, not
// deleted), along with their stored sector-flip alert state. Re-running a merged file changes nothing.
//
// Every symbol is checked against Angel One's public scrip master (the list the price refresh resolves
// tickers through). Symbols it cannot price are reported and, with --apply, not added unless
// --allow-unpriced is passed. Writing to a non-local database needs --allow-remote as well.
//
// After --apply the new symbols have no stored prices yet: press "Refresh all sectors" on
// /valuation/sector-rotation (admin), or call GET /api/cron/sector-rotation with the cron bearer secret.
import fs from 'node:fs';
import postgres from 'postgres';
import { parseCsvText } from '../src/lib/valuation/mcapUniverse.js';
import { fileSymbols, parseTaxonomyFile, planMerge, pricedNames } from '../src/lib/valuation/sectorTaxonomyMerge.js';

const SCRIP_MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const apply = flag('apply');
const universeAt = args.indexOf('--universe');
const universeFile = universeAt >= 0 ? args[universeAt + 1] : null;
const file = args.find((a, i) => !a.startsWith('--') && !(universeAt >= 0 && i === universeAt + 1));
if (!file) {
	console.error('Usage: node scripts/import-sector-taxonomy.mjs <json path> [--apply] [--replace --universe <csv>] [--allow-unpriced] [--allow-remote]');
	process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is required.');
	process.exit(1);
}
const host = new URL(url).hostname;
const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
if (apply && !isLocal && !flag('allow-remote')) {
	console.error(`Refusing to write to non-local host ${host}. Pass --allow-remote if that is intended.`);
	process.exit(1);
}

let parsed;
try {
	parsed = parseTaxonomyFile(JSON.parse(fs.readFileSync(file, 'utf8')));
} catch (e) {
	console.error(`Refusing to import ${file}: ${e instanceof Error ? e.message : e}`);
	process.exit(1);
}
if (parsed.errors.length > 0) {
	console.error(`Refusing to import ${file}: ${parsed.errors.length} problem(s)`);
	for (const err of parsed.errors) console.error(`  ${err}`);
	process.exit(1);
}

// --replace --universe <csv>: an orphaned symbol (in no basket once replaced) is dropped when it is not in the market
// cap list (matched on nse_symbol, else bse_code) and kept otherwise. The list is required with --replace.
let universe = null;
if (flag('replace') !== Boolean(universeFile)) {
	console.error('--replace and --universe <csv> go together: pass both or neither.');
	process.exit(1);
}
if (universeFile) {
	const table = parseCsvText(fs.readFileSync(universeFile, 'utf8'));
	const col = (name) => table[0]?.map((h) => h.trim()).indexOf(name) ?? -1;
	const [nse, bse] = [col('nse_symbol'), col('bse_code')];
	if (nse < 0 || bse < 0) {
		console.error(`${universeFile} needs nse_symbol and bse_code columns.`);
		process.exit(1);
	}
	universe = new Set(
		table
			.slice(1)
			.map((r) => (r[nse] ?? '').trim() || (r[bse] ?? '').trim())
			.filter(Boolean)
			.map((s) => s.toUpperCase())
	);
}

let priced;
try {
	const res = await fetch(SCRIP_MASTER_URL);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	priced = pricedNames(await res.json());
} catch (e) {
	console.error(`Could not load Angel One's scrip master to check prices: ${e instanceof Error ? e.message : e}`);
	process.exit(1);
}
const unpriced = fileSymbols(parsed.majors).filter((s) => !priced.has(s));

const sql = postgres(url, { max: 1, prepare: false });
try {
	const current = {
		majors: (
			await sql`select key, label, position::int as position, subsector_keys from valuation.sector_majors`
		).map((r) => ({ key: r.key, label: r.label, position: r.position, subsectorKeys: r.subsector_keys })),
		baskets: await sql`select key, label, symbols from valuation.sector_baskets`
	};
	const stored = new Set(
		(await sql`select upper(symbol) as symbol from valuation.company_growth_series_cache`).map((r) => r.symbol)
	);
	const skip = flag('allow-unpriced') ? new Set() : new Set(unpriced);
	const plan = planMerge(current, parsed.majors, skip, parsed.retired, { replace: flag('replace'), universe });

	// Sector-flip state of retired baskets (alert_state keys sector:basket:<key>[:rsw|:rsm]) is never read again.
	// Basket keys contain no ':', so the key is the third segment. Alerts history is left alone.
	const retiredSet = new Set(parsed.retired);
	const staleStates = (await sql`select key from valuation.alert_state where key like 'sector:basket:%'`)
		.map((r) => r.key)
		.filter((k) => retiredSet.has(k.split(':')[2]));
	// Things that point at a basket key and would silently go dead: reported, never changed.
	const dangling = [];
	if (retiredSet.size > 0) {
		const keys = [...retiredSet];
		for (const r of await sql`select id, name, parent_key from valuation.strength_rules where level = 'companies' and parent_key in ${sql(keys)}`) {
			dangling.push(`strength rule #${r.id} "${r.name}" (parent ${r.parent_key}) will match nothing`);
		}
		for (const r of await sql`select scope from valuation.valuation_template_defaults where scope in ${sql(keys.map((k) => `basket:${k}`))}`) {
			dangling.push(`valuation template default for ${r.scope} will never apply`);
		}
	}

	if (apply && (!plan.empty || staleStates.length > 0)) {
		await sql.begin(async (tx) => {
			for (const b of plan.basketWrites) {
				await tx`
					insert into valuation.sector_baskets (key, label, symbols) values (${b.key}, ${b.label}, ${tx.json(b.symbols)})
					on conflict (key) do update set label = excluded.label, symbols = excluded.symbols`;
			}
			for (const m of plan.majorWrites) {
				await tx`
					insert into valuation.sector_majors (key, label, position, subsector_keys)
					values (${m.key}, ${m.label}, ${m.position}, ${tx.json(m.subsectorKeys)})
					on conflict (key) do update set
						label = excluded.label, position = excluded.position, subsector_keys = excluded.subsector_keys`;
			}
			if (plan.basketDeletes.length > 0) {
				await tx`delete from valuation.sector_baskets where key in ${tx(plan.basketDeletes)}`;
			}
			if (plan.majorDeletes.length > 0) await tx`delete from valuation.sector_majors where key in ${tx(plan.majorDeletes)}`;
			if (staleStates.length > 0) await tx`delete from valuation.alert_state where key in ${tx(staleStates)}`;
		});
	}

	const list = (items, max = 12) => (items.length > max ? `${items.slice(0, max).join(', ')} ... (+${items.length - max})` : items.join(', '));
	console.log(`${apply ? 'APPLIED' : 'DRY RUN (nothing written; pass --apply)'}: ${file} on ${host}`);
	console.log(`  file: ${parsed.majors.length} majors, ${parsed.majors.reduce((n, m) => n + m.baskets.length, 0)} baskets, ${fileSymbols(parsed.majors).length} symbols`);
	console.log(`  database before: ${current.majors.length} majors, ${current.baskets.length} baskets`);
	if (plan.empty) console.log('  nothing to change: the database already contains this taxonomy.');
	if (plan.newMajors.length) console.log(`New majors (${plan.newMajors.length}):`);
	for (const m of plan.newMajors) console.log(`  + ${m.key} "${m.label}" at position ${m.position}`);
	if (plan.newBaskets.length) console.log(`New baskets (${plan.newBaskets.length}):`);
	for (const b of plan.newBaskets) console.log(`  + ${b.key} "${b.label}" (${b.symbols.length}): ${list(b.symbols)}`);
	if (plan.renamedMajors.length || plan.renamedBaskets.length) console.log('Renamed labels:');
	for (const r of plan.renamedMajors) console.log(`  major ${r.key}: "${r.from}" -> "${r.to}"`);
	for (const r of plan.renamedBaskets) console.log(`  basket ${r.key}: "${r.from}" -> "${r.to}"`);
	if (plan.symbolsAdded.length) console.log('Symbols added to existing baskets:');
	for (const s of plan.symbolsAdded) console.log(`  ${s.key}: +${s.symbols.length} ${list(s.symbols)}`);
	if (plan.symbolsRemoved.length) console.log(`Symbols removed from baskets (--replace; ${plan.symbolsRemoved.reduce((n, s) => n + s.symbols.length, 0)} slots):`);
	for (const s of plan.symbolsRemoved) console.log(`  ${s.key}: -${s.symbols.length} ${list(s.symbols, 40)}`);
	if (plan.orphaned.length) console.log(`Orphaned, in the market cap list or no list given - kept in the old basket (${plan.orphaned.length}):`);
	for (const o of plan.orphaned) console.log(`  ${o.symbol} stays in ${o.key}`);
	if (plan.orphansDropped.length) console.log(`Orphaned and NOT in the market cap list - dropped (${plan.orphansDropped.length}):`);
	for (const o of plan.orphansDropped) console.log(`  ${o.symbol} removed from ${o.key}`);
	if (plan.attached.length) console.log('Baskets attached to majors:');
	for (const a of plan.attached) console.log(`  ${a.key}: ${a.baskets.length} ${list(a.baskets)}`);
	if (plan.detached.length) console.log('Baskets detached from majors (--replace):');
	for (const d of plan.detached) console.log(`  ${d.key}: ${list(d.baskets)}`);
	if (plan.deletedMajors.length) console.log(`${apply ? 'Deleted' : 'Will delete'} majors not in the file, all baskets claimed by file majors (${plan.deletedMajors.length}):`);
	for (const m of plan.deletedMajors) console.log(`  - ${m.key} "${m.label}" held ${list(m.baskets)}`);
	if (plan.unclaimedKept.length) console.log('Kept majors not in the file that hold unclaimed baskets:');
	for (const k of plan.unclaimedKept) console.log(`  ${k.key}: ${list(k.baskets)}`);
	const moved = plan.movedMajors.filter((m) => !plan.newMajors.some((n) => n.key === m.key));
	if (moved.length) console.log(`Major positions changed: ${moved.length} (${list(moved.map((m) => `${m.key} ${m.from}->${m.to}`))})`);
	if (plan.retired.length) console.log(`${apply ? 'Retired' : 'Will retire'} (${plan.retired.length} baskets, removed from every major):`);
	for (const r of plan.retired) console.log(`  - ${r.key} "${r.label}" (${r.count} members)`);
	if (retiredSet.size) console.log(`Sector alert state of retired baskets ${apply ? 'deleted' : 'to delete'}: ${staleStates.length} rows (alerts history is kept).`);
	if (dangling.length) console.log(`WARNING - references to retired baskets (left as is, check them):`);
	for (const d of dangling) console.log(`  ! ${d}`);
	if (plan.unknownRetired.length) console.log(`Retired keys not in the database (nothing to do): ${list(plan.unknownRetired)}`);
	if (plan.emptiedMajors.length) console.log(`Majors left with no baskets after retirement (kept, not deleted): ${list(plan.emptiedMajors)}`);
	if (plan.keptMajors.length) console.log(`Kept, not in file - majors (${plan.keptMajors.length}): ${list(plan.keptMajors)}`);
	if (plan.keptBaskets.length) console.log(`Kept, not in file - baskets (${plan.keptBaskets.length}): ${list(plan.keptBaskets, 30)}`);
	if (plan.keptSymbols.length) console.log('Kept, not in file - symbols in baskets that exist in both (use --replace to drop them):');
	for (const k of plan.keptSymbols) console.log(`  ${k.key}: ${list(k.symbols)}`);
	if (unpriced.length) {
		console.log(`Symbols with no price coverage in Angel One's scrip master (${unpriced.length}): ${list(unpriced, 40)}`);
		if (flag('allow-unpriced')) console.log('  --allow-unpriced: these are included.');
		else {
			console.log(`  ${apply ? 'Skipped' : 'Would be skipped'} (not added; pass --allow-unpriced to include).`);
			for (const b of plan.skippedBaskets) console.log(`  basket ${b.key} has no priceable symbol and is not created.`);
		}
	}
	const needFirstLoad = fileSymbols(parsed.majors).filter((s) => priced.has(s) && !stored.has(s));
	console.log(`Priceable symbols with no stored prices yet (${needFirstLoad.length}): they load on the next refresh.`);

	const after = {
		majors: current.majors.length + plan.newMajors.length - plan.majorDeletes.length,
		baskets: current.baskets.length + plan.newBaskets.length - plan.basketDeletes.length
	};
	console.log(
		`Counts: majors +${plan.newMajors.length} -${plan.majorDeletes.length} (${after.majors} total), baskets +${plan.newBaskets.length} -${plan.basketDeletes.length} (${after.baskets} total), ` +
			`symbols added ${plan.symbolsAdded.reduce((n, s) => n + s.symbols.length, 0) + plan.newBaskets.reduce((n, b) => n + b.symbols.length, 0)}, ` +
			`labels renamed ${plan.renamedMajors.length + plan.renamedBaskets.length}, rows written ${apply ? plan.majorWrites.length + plan.basketWrites.length + plan.basketDeletes.length + plan.majorDeletes.length + staleStates.length : 0}`
	);
	if (apply && !plan.empty) {
		console.log('Next: press "Refresh all sectors" on /valuation/sector-rotation, or GET /api/cron/sector-rotation with the cron secret, to fetch prices for the new symbols.');
	}
} finally {
	await sql.end();
}