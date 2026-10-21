// Usage: node research/check_taxonomy_v2.js [--detail]
// Compares each basket in sector_taxonomy_v2.json with NSE basic industries
// from universe_industry_classification.csv.
// (a) members whose basic_industry is not one of the basket's dominant basic industries
// (b) universe names in a dominant basic industry that sit in no basket
const fs = require('fs');
const path = require('path');
const dir = __dirname;
function parseLine(l) {
  const o = []; let c = '', q = false;
  for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(c); c = ''; } else c += ch; }
  o.push(c); return o;
}
function readCsv(f) {
  const t = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).filter(Boolean);
  const h = parseLine(t[0]);
  return t.slice(1).map(parseLine).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
const tax = JSON.parse(fs.readFileSync(path.join(dir, 'sector_taxonomy_v2.json'), 'utf8'));
const uni = readCsv('companies_mcap_above_500cr.csv');
const cls = new Map();
for (const r of readCsv('universe_industry_classification.csv')) cls.set(r.nse_symbol || r.bse_code, r);
const idOf = r => r.nse_symbol || r.bse_code;
const nameOf = new Map(uni.map(r => [idOf(r), r.company_name]));
const placed = new Set();
tax.majors.forEach(m => m.baskets.forEach(b => b.symbols.forEach(s => placed.add(s))));
const bi = s => (cls.get(s) || {}).basic_industry || null;
const report = [];
let totalDis = 0, totalMissing = 0, unclassifiedMembers = 0;
for (const m of tax.majors) for (const b of m.baskets) {
  const prim = new Set(b.primary);
  const counts = new Map();
  for (const s of b.symbols) { const k = bi(s); if (k && prim.has(s)) counts.set(k, (counts.get(k) || 0) + 1); }
  if (!counts.size) for (const s of b.symbols) { const k = bi(s); if (k) counts.set(k, (counts.get(k) || 0) + 1); }
  const tot = [...counts.values()].reduce((a, c) => a + c, 0);
  const dom = new Set([...counts].filter(([, c]) => c >= 2 && c / tot >= 0.15).map(([k]) => k));
  if (!dom.size && counts.size) dom.add([...counts].sort((a, b) => b[1] - a[1])[0][0]);
  const dis = b.symbols.filter(s => bi(s) && !dom.has(bi(s)));
  unclassifiedMembers += b.symbols.filter(s => !bi(s) && uni.some(r => idOf(r) === s)).length;
  const missing = uni.filter(r => { const k = bi(idOf(r)); return k && dom.has(k) && !placed.has(idOf(r)); }).map(idOf);
  totalDis += dis.length; totalMissing += missing.length;
  report.push({ basket: b.key, dominant: [...dom], disagree: dis.map(s => s + ' (' + bi(s) + ')'), missing: missing.map(s => s + ' (' + bi(s) + ')') });
}
const detail = process.argv.includes('--detail');
console.log('classified rows', cls.size, 'of', uni.length, '| baskets', report.length);
console.log('disagreeing members (all baskets):', totalDis, '| unplaced names in dominant industries:', totalMissing, '| members without classification:', unclassifiedMembers);
for (const r of report) {
  if (!r.disagree.length && !r.missing.length) continue;
  console.log('\n' + r.basket + '  dominant: ' + r.dominant.join(' | '));
  if (r.disagree.length) console.log('  disagree: ' + r.disagree.join(', '));
  if (r.missing.length) console.log('  unplaced in industry: ' + r.missing.join(', '));
}
const un = uni.filter(r => idOf(r) && !placed.has(idOf(r)));
console.log('\nUnplaced universe names with classification:');
un.forEach(r => { if (bi(idOf(r))) console.log('  ' + idOf(r) + ' | ' + r.company_name + ' | ' + bi(idOf(r))); });
console.log('Unplaced without classification:', un.filter(r => !bi(idOf(r))).map(idOf).join(' '));
