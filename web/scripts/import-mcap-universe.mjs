// Loads the market cap list (every NSE/BSE company with a six-month average market cap above Rs 500 Cr,
// from AMFI, built by scripts/build-mcap-universe.mjs) into valuation.mcap_universe. Run twice a year with the new file.
// The whole-market breadth chart uses all of it; the breakout scanner reads only the part below Rs 20,000 Cr.
//
//   DATABASE_URL=postgresql://... node scripts/import-mcap-universe.mjs <csv>            (dry run)
//   DATABASE_URL=postgresql://... node scripts/import-mcap-universe.mjs <csv> --apply    (writes)
//
// Upserts by ISIN. Companies missing from the new file are kept but marked active=false, and
// come back to active=true if a later file lists them again. The header is checked against the
// columns in research/README_companies_mcap.md and any difference stops the run before any write.
import fs from 'node:fs';
import postgres from 'postgres';
import { parseUniverseCsv, planImport } from '../src/lib/valuation/mcapUniverse.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
	console.error('Usage: node scripts/import-mcap-universe.mjs <csv path> [--apply]');
	process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is required.');
	process.exit(1);
}

let parsed;
try {
	parsed = parseUniverseCsv(fs.readFileSync(file, 'utf8'));
} catch (e) {
	console.error(`Refusing to import ${file}: ${e instanceof Error ? e.message : e}`);
	process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });
try {
	const existing = await sql`
		select isin, company_name, nse_symbol, bse_code, market_cap_cr::float8 as market_cap_cr, mcap_as_of::text as mcap_as_of,
		       listed_on, angel_nse_token, angel_nse_symbol, angel_bse_token, angel_bse_symbol, bse_scrip_code,
		       price_exchange, price_source_status, match_method, symbol, active
		from valuation.mcap_universe`;
	const plan = planImport(existing, parsed.rows);

	if (apply) {
		await sql.begin(async (tx) => {
			if (plan.toDeactivate.length > 0) {
				await tx`update valuation.mcap_universe set active = false, symbol = null where isin in ${tx(plan.toDeactivate)}`;
			}
			// Free the tickers of changing rows first so two companies swapping one cannot collide.
			const changing = plan.toUpdate.map((r) => r.isin);
			if (changing.length > 0) await tx`update valuation.mcap_universe set symbol = null where isin in ${tx(changing)}`;
			const writes = [...plan.toInsert, ...plan.toUpdate];
			for (let i = 0; i < writes.length; i += 200) {
				const part = writes.slice(i, i + 200).map((r) => ({ ...r, active: true, imported_at: new Date() }));
				await tx`
					insert into valuation.mcap_universe ${tx(part)}
					on conflict (isin) do update set
						company_name = excluded.company_name, nse_symbol = excluded.nse_symbol, bse_code = excluded.bse_code,
						market_cap_cr = excluded.market_cap_cr, mcap_as_of = excluded.mcap_as_of, listed_on = excluded.listed_on,
						angel_nse_token = excluded.angel_nse_token, angel_nse_symbol = excluded.angel_nse_symbol,
						angel_bse_token = excluded.angel_bse_token, angel_bse_symbol = excluded.angel_bse_symbol,
						bse_scrip_code = excluded.bse_scrip_code, price_exchange = excluded.price_exchange,
						price_source_status = excluded.price_source_status, match_method = excluded.match_method,
						symbol = excluded.symbol, active = true, imported_at = excluded.imported_at`;
			}
		});
	}

	const c = plan.counts;
	console.log(`${apply ? 'APPLIED' : 'DRY RUN (nothing written; pass --apply)'}: ${c.total} companies in ${file}`);
	console.log(`  new ${c.new}, updated ${c.updated}, unchanged ${c.unchanged}, deactivated ${c.deactivated}`);
	console.log(`  priced on NSE ${c.matchedNse}, priced on BSE only ${c.matchedBse}, no price source ${c.noPriceSource}`);
	for (const d of parsed.duplicates) {
		console.log(`  shares ticker ${d.symbol} with ${d.kept}, left without a symbol: ${d.isin} ${d.company_name}`);
	}
} finally {
	await sql.end();
}
