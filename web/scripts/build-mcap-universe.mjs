// Builds research/companies_mcap_above_500cr.csv, the file scripts/import-mcap-universe.mjs loads: every
// NSE/BSE company whose AMFI six-month average market cap is above Rs 500 Cr, one row per company, with
// ISIN-verified Angel One tokens. Nothing is written to a database.
//
//   node scripts/build-mcap-universe.mjs --amfi <xlsx> --angel <OpenAPIScripMaster.json> --nse <EQUITY_L.csv> \
//        [--nse-sme <SME_EQUITY_L.csv>] --bse <bhavcopy.csv> [--bse <more days>] [--out <csv>]
//
// Inputs are downloaded by hand (see research/README_companies_mcap.md) so the raw files stay out of git.
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { CSV_COLUMNS } from '../src/lib/valuation/mcapUniverse.js';
import { amfiRow, buildAngelLookups, buildUniverseRows, filterAboveMcap, mergeBseMaps, parseBseBhavcopy, parseNseList, rowsToCsv } from '../src/lib/valuation/mcapBuild.js';

const args = process.argv.slice(2);
const all = (name) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []));
const one = (name, fallback) => all(name)[0] ?? fallback;
const need = (name) => {
	const v = one(name);
	if (!v) {
		console.error(`Missing --${name}. See the header of scripts/build-mcap-universe.mjs.`);
		process.exit(1);
	}
	return v;
};

const cellValue = (c) => (c && typeof c === 'object' && 'result' in c ? c.result : c);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(need('amfi'));
const ws = wb.worksheets[0];
const amfi = [];
for (let r = 3; r <= ws.rowCount; r++) {
	const v = ws.getRow(r).values;
	if (!v[3]) continue;
	amfi.push(amfiRow([v[2], v[3], v[4], cellValue(v[5]), v[6], cellValue(v[7]), v[8], cellValue(v[9])]));
}

const nseList = parseNseList(fs.readFileSync(need('nse'), 'utf8'));
for (const f of all('nse-sme')) for (const [k, v] of parseNseList(fs.readFileSync(f, 'utf8'))) if (!nseList.has(k)) nseList.set(k, v);
const bseMap = mergeBseMaps(all('bse').map((f) => parseBseBhavcopy(fs.readFileSync(f, 'utf8'))));
if (all('bse').length === 0) {
	console.error('Missing --bse.');
	process.exit(1);
}
const angel = buildAngelLookups(JSON.parse(fs.readFileSync(need('angel'), 'utf8')));

const { rows, report } = buildUniverseRows(amfi, nseList, bseMap, angel);
const out = one('out', '../research/companies_mcap_above_500cr.csv');
fs.writeFileSync(out, rowsToCsv(rows, CSV_COLUMNS));

const { dropped } = filterAboveMcap(amfi);
console.log(`AMFI rows ${amfi.length}; NSE list ${nseList.size} ISINs; BSE list ${bseMap.size} ISINs; Angel NSE ${angel.nseByName.size}, BSE ${angel.bseByCode.size}`);
console.log(`Above 500 Cr: ${report.total + report.duplicates.length + report.trusts.length} unique ISINs (${dropped.mseiOnly.length} MSEI-only set aside, ${dropped.badIsin.length} bad ISIN, ${dropped.repeatedIsin.length} repeated ISIN)`);
console.log(`REIT/InvIT units left out: ${report.trusts.length}`);
for (const t of report.trusts) console.log(`  trust ${t.isin} ${t.company_name} (${t.market_cap_cr} Cr)`);
console.log(`Duplicate company rows dropped: ${report.duplicates.length}`);
for (const d of report.duplicates) console.log(`  dropped ${d.isin} ${d.company_name} (${d.market_cap_cr}) in favour of ${d.keptIsin} ${d.keptName}`);
console.log(`ISIN replaced by the exchange's current one (AMFI ISIN not on any list, ticker and name matched): ${report.reIsined.length}`);
for (const r of report.reIsined) console.log(`  ${r.company_name}: ${r.amfiIsin} -> ${r.isin} (${r.symbol})`);
console.log(`Written ${rows.length} companies to ${out}: NSE-priced ${report.nsePriced}, BSE-only ${report.bsePriced}, no price source ${report.unmatched.length}`);
for (const u of report.unmatched) console.log(`  unmatched ${u.isin} ${u.company_name} (${u.market_cap_cr} Cr)`);
