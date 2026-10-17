// Fills in the entry price of theses created before the Scorecard feature.
// Order per thesis: first logged BUY decision price -> stored close on/before the creation date
// -> flag needs_price (or 'no_data' for symbols with no price source). Never overwrites a price.
//
//   DATABASE_URL=postgresql://... node scripts/backfill-entry-price.mjs            (dry run)
//   DATABASE_URL=postgresql://... node scripts/backfill-entry-price.mjs --apply    (writes)
//   --no-source=GUJGASLTD,INDLMETER   symbols that have no price source (default shown)
import postgres from 'postgres';
import { chooseBackfill, closeOnOrBefore } from '../src/lib/entryPrice.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const noSourceArg = args.find((a) => a.startsWith('--no-source='));
const noSource = new Set((noSourceArg ? noSourceArg.split('=')[1] : 'GUJGASLTD,INDLMETER').toUpperCase().split(',').filter(Boolean));
const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is required.');
	process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });
try {
	const scenarios = await sql`
		select s.id, s.company_id, s.owner, (s.created_at at time zone 'Asia/Kolkata')::date::text as created_on,
		       upper(coalesce(nullif(c.nse_ticker, ''), nullif(c.bse_ticker, ''))) as symbol
		from thesis_scenarios s join companies c on c.company_id = s.company_id
		where s.entry_price is null and s.entry_price_source is null
		order by s.id`;
	const tally = { backfill_buy: 0, backfill_history: 0, no_data: 0, needs_price: 0 };
	const rows = [];
	for (const s of scenarios) {
		const [buy] = await sql`
			select price::float8 as price, decided_on::text as date from position_decisions
			where scenario_id = ${s.id} and lower(action) = 'buy' order by decided_on, id limit 1`;
		let history = null;
		if (s.symbol) {
			const [row] = await sql`
				select jsonb_path_query_array(candles, '$[*].date') as dates, jsonb_path_query_array(candles, '$[*].close') as closes
				from valuation.company_growth_series_cache where symbol = ${s.symbol}`;
			if (row) history = closeOnOrBefore(row.dates, row.closes, s.created_on);
		}
		let pick = chooseBackfill({ firstBuy: buy ?? null, history });
		let outcome = pick.source ?? 'needs_price';
		if (pick.needsPrice && (!s.symbol || noSource.has(s.symbol))) {
			pick = { price: null, date: null, source: 'no_data', needsPrice: false };
			outcome = 'no_data';
		}
		tally[outcome]++;
		rows.push({ id: s.id, company: s.company_id, owner: s.owner, outcome, price: pick.price, date: pick.date });
		if (apply) {
			await sql`
				update thesis_scenarios set entry_price = ${pick.price}, entry_date = ${pick.date ?? null},
				       entry_price_source = ${pick.source}, needs_price = ${pick.needsPrice}
				where id = ${s.id} and entry_price is null and entry_price_source is null`;
		}
	}
	console.table(rows);
	console.log(`${apply ? 'APPLIED' : 'DRY RUN (nothing written; pass --apply)'}: ${scenarios.length} theses without an entry price`);
	console.log(tally);
} finally {
	await sql.end();
}
