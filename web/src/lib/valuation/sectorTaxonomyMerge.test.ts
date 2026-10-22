import { describe, expect, it } from 'vitest';
import { fileSymbols, parseTaxonomyFile, planMerge, pricedNames } from './sectorTaxonomyMerge.js';
import { KEY_RE, SYMBOL_RE } from './sectorEdit';

const file = (majors: unknown[]) => ({ version: 2, generated_at: 'x', majors });
const basket = (key: string, symbols: string[], label = key.toUpperCase()) => ({ key, label, symbols });
const parse = (majors: unknown[]) => {
	const r = parseTaxonomyFile(file(majors));
	expect(r.errors).toEqual([]);
	return r.majors;
};

const current = () => ({
	majors: [
		{ key: 'power', label: 'Power', position: 0, subsectorKeys: ['grid'] },
		{ key: 'legacy', label: 'Legacy', position: 1, subsectorKeys: ['old'] }
	],
	baskets: [
		{ key: 'grid', label: 'Grid', symbols: ['KEC', 'POWERGRID'] },
		{ key: 'old', label: 'Old', symbols: ['OLDCO'] }
	]
});

describe('parseTaxonomyFile', () => {
	it('normalises symbols and drops duplicates inside a basket', () => {
		const majors = parse([{ key: 'm', label: 'M', baskets: [basket('b', [' kec ', 'KEC', 'abb'])] }]);
		expect(majors[0].baskets[0].symbols).toEqual(['KEC', 'ABB']);
	});

	it('reports duplicate major and basket keys, bad symbols and stray primaries', () => {
		const r = parseTaxonomyFile(
			file([
				{ key: 'm', label: 'M', baskets: [basket('b', ['KEC']), { ...basket('b', ['ABB']), primary: ['ZZZ'] }] },
				{ key: 'm', label: 'M2', baskets: [basket('c', ['bad symbol'])] }
			])
		);
		expect(r.errors.join('\n')).toMatch(/duplicate basket key "b"/);
		expect(r.errors.join('\n')).toMatch(/duplicate major key "m"/);
		expect(r.errors.join('\n')).toMatch(/invalid symbol "bad symbol"/);
		expect(r.errors.join('\n')).toMatch(/primary symbol "ZZZ"/);
	});

	it('rejects a wrong version and empty majors', () => {
		expect(parseTaxonomyFile({ version: 1, majors: [] }).errors.length).toBeGreaterThan(0);
		expect(parseTaxonomyFile([]).errors).toHaveLength(1);
	});

	it('uses the same key and symbol shapes as the Sector Manager', () => {
		for (const symbol of ['KEC', 'M&M', 'BAJAJ-AUTO', 'A B', '-X', 'X'.repeat(31)]) {
			const r = parseTaxonomyFile(file([{ key: 'm', label: 'M', baskets: [basket('b', [symbol])] }]));
			expect(r.errors.length === 0, symbol).toBe(SYMBOL_RE.test(symbol.toUpperCase()));
		}
		for (const key of ['abc', 'a_b-1', '_x', 'Abc', 'a b']) {
			const r = parseTaxonomyFile(file([{ key, label: 'M', baskets: [basket('b', ['KEC'])] }]));
			expect(r.errors.length === 0, key).toBe(KEY_RE.test(key));
		}
	});
});

describe('planMerge', () => {
	it('adds symbols, new baskets and new majors but removes nothing', () => {
		const majors = parse([
			{ key: 'power', label: 'Power', baskets: [basket('grid', ['KEC', 'ABB']), basket('solar', ['WAAREEENER'])] },
			{ key: 'rail', label: 'Rail', baskets: [basket('wagons', ['TEXRAIL'])] }
		]);
		const plan = planMerge(current(), majors);
		expect(plan.newMajors.map((m) => m.key)).toEqual(['rail']);
		expect(plan.newBaskets.map((b) => b.key)).toEqual(['solar', 'wagons']);
		expect(plan.symbolsAdded).toEqual([{ key: 'grid', symbols: ['ABB'] }]);
		// POWERGRID is in the database but not the file: kept, in place.
		expect(plan.keptSymbols).toEqual([{ key: 'grid', symbols: ['POWERGRID'] }]);
		expect(plan.basketWrites.find((b) => b.key === 'grid')!.symbols).toEqual(['KEC', 'POWERGRID', 'ABB']);
		expect(plan.keptMajors).toEqual(['legacy']);
		expect(plan.keptBaskets).toEqual(['old']);
		const power = plan.majorWrites.find((m) => m.key === 'power')!;
		expect(power.subsectorKeys).toEqual(['grid', 'solar']);
		// No write ever drops an existing key.
		expect(plan.majorWrites.find((m) => m.key === 'legacy')!.subsectorKeys).toEqual(['old']);
	});

	it('renames labels and sets positions from file order, kept majors follow', () => {
		const majors = parse([
			{ key: 'rail', label: 'Railways', baskets: [basket('wagons', ['TEXRAIL'])] },
			{ key: 'power', label: 'Power & Grid', baskets: [basket('grid', ['KEC', 'POWERGRID'], 'Grid Equipment')] }
		]);
		const plan = planMerge(current(), majors);
		expect(plan.renamedMajors).toEqual([{ key: 'power', from: 'Power', to: 'Power & Grid' }]);
		expect(plan.renamedBaskets).toEqual([{ key: 'grid', from: 'Grid', to: 'Grid Equipment' }]);
		const pos = Object.fromEntries(plan.majorWrites.map((m) => [m.key, m.position]));
		expect(pos).toEqual({ rail: 0, power: 1, legacy: 2 });
	});

	it('is idempotent: applying a plan and re-planning gives an empty plan', () => {
		const majors = parse([
			{ key: 'rail', label: 'Railways', baskets: [basket('wagons', ['TEXRAIL'])] },
			{ key: 'power', label: 'Power', baskets: [basket('grid', ['KEC', 'ABB']), basket('solar', ['WAAREEENER'])] }
		]);
		const db = current();
		const first = planMerge(db, majors);
		expect(first.empty).toBe(false);
		const next = {
			majors: db.majors.map((m) => first.majorWrites.find((w) => w.key === m.key) ?? m),
			baskets: db.baskets.map((b) => first.basketWrites.find((w) => w.key === b.key) ?? b)
		};
		for (const m of first.majorWrites) if (!next.majors.some((x) => x.key === m.key)) next.majors.push(m);
		for (const b of first.basketWrites) if (!next.baskets.some((x) => x.key === b.key)) next.baskets.push(b);
		const second = planMerge(next, majors);
		expect(second.empty).toBe(true);
		expect(second.majorWrites).toEqual([]);
		expect(second.basketWrites).toEqual([]);
	});

	it('does not add skipped (unpriced) symbols, nor create a basket left empty', () => {
		const majors = parse([
			{ key: 'power', label: 'Power', baskets: [basket('grid', ['KEC', 'GHOST']), basket('ghosts', ['GHOST'])] }
		]);
		const plan = planMerge(current(), majors, new Set(['GHOST']));
		expect(plan.symbolsAdded).toEqual([]);
		expect(plan.skippedSymbols).toEqual(['GHOST']);
		expect(plan.skippedBaskets.map((b) => b.key)).toEqual(['ghosts']);
		expect(plan.basketWrites.some((b) => b.key === 'ghosts')).toBe(false);
		expect(plan.majorWrites.find((m) => m.key === 'power')?.subsectorKeys ?? ['grid']).not.toContain('ghosts');
	});

	it('leaves a stored symbol alone even when it is unpriced', () => {
		const majors = parse([{ key: 'power', label: 'Power', baskets: [basket('grid', ['KEC', 'POWERGRID'])] }]);
		const plan = planMerge(current(), majors, new Set(['KEC']));
		expect(plan.skippedSymbols).toEqual([]);
	});
});

describe('retired baskets', () => {
	const keepGrid = () => parse([{ key: 'power', label: 'Power', baskets: [basket('grid', ['KEC', 'POWERGRID'], 'Grid')] }]);

	it('parses the retired list, de-duplicated', () => {
		const r = parseTaxonomyFile({ ...file([{ key: 'm', label: 'M', baskets: [basket('b', ['KEC'])] }]), retired: ['old', 'old'] });
		expect(r.errors).toEqual([]);
		expect(r.retired).toEqual(['old']);
		expect(parseTaxonomyFile(file([{ key: 'm', label: 'M', baskets: [basket('b', ['KEC'])] }])).retired).toEqual([]);
	});

	it('rejects a retired key that is also a basket in the file, and malformed lists', () => {
		const majors = [{ key: 'm', label: 'M', baskets: [basket('b', ['KEC'])] }];
		expect(parseTaxonomyFile({ ...file(majors), retired: ['b'] }).errors.join()).toMatch(/retired key "b" is also a basket/);
		expect(parseTaxonomyFile({ ...file(majors), retired: 'b' }).errors.join()).toMatch(/"retired" must be an array/);
		expect(parseTaxonomyFile({ ...file(majors), retired: ['Bad Key'] }).errors.join()).toMatch(/retired: invalid key/);
	});

	it('deletes the basket, detaches it from every major and reports its member count', () => {
		const db = current();
		db.majors.push({ key: 'extra', label: 'Extra', position: 2, subsectorKeys: ['old', 'grid'] });
		const plan = planMerge(db, keepGrid(), new Set(), ['old']);
		expect(plan.retired).toEqual([{ key: 'old', label: 'Old', count: 1 }]);
		expect(plan.basketDeletes).toEqual(['old']);
		expect(plan.keptBaskets).toEqual([]);
		expect(plan.majorWrites.find((m) => m.key === 'extra')!.subsectorKeys).toEqual(['grid']);
		expect(plan.majorWrites.find((m) => m.key === 'legacy')!.subsectorKeys).toEqual([]);
		expect(plan.empty).toBe(false);
	});

	it('reports a major left with no baskets instead of deleting it', () => {
		const plan = planMerge(current(), keepGrid(), new Set(), ['old']);
		expect(plan.emptiedMajors).toEqual(['legacy']);
		expect(plan.keptMajors).toEqual(['legacy']);
		const fileMajors = parse([{ key: 'legacy', label: 'Legacy', baskets: [basket('fresh', ['ABB'])] }]);
		expect(planMerge(current(), fileMajors, new Set(), ['old']).emptiedMajors).toEqual([]);
	});

	it('lists unknown retired keys without failing, and a re-run is empty', () => {
		const first = planMerge(current(), keepGrid(), new Set(), ['old', 'ghost']);
		expect(first.unknownRetired).toEqual(['ghost']);
		const after = {
			majors: current().majors.map((m) => first.majorWrites.find((w) => w.key === m.key) ?? m),
			baskets: current().baskets.filter((b) => b.key !== 'old')
		};
		const again = planMerge(after, keepGrid(), new Set(), ['old', 'ghost']);
		expect(again.unknownRetired).toEqual(['old', 'ghost']);
		expect(again.empty).toBe(true);
	});
});

describe('replace mode', () => {
	const replace = (db: ReturnType<typeof current>, majors: ReturnType<typeof parse>, skip = new Set<string>(), retired: string[] = []) =>
		planMerge(db, majors, skip, retired, { replace: true });

	it('sets a listed basket to exactly the file symbols and reports the removals', () => {
		const majors = parse([{ key: 'power', label: 'Power', baskets: [basket('grid', ['KEC', 'ABB'], 'Grid')] }]);
		const db = current();
		db.baskets.push({ key: 'elsewhere', label: 'Elsewhere', symbols: ['POWERGRID'] });
		const plan = replace(db, majors);
		expect(plan.symbolsRemoved).toEqual([{ key: 'grid', symbols: ['POWERGRID'] }]);
		expect(plan.symbolsAdded).toEqual([{ key: 'grid', symbols: ['ABB'] }]);
		expect(plan.basketWrites.find((b) => b.key === 'grid')!.symbols).toEqual(['KEC', 'ABB']);
		expect(plan.keptSymbols).toEqual([]);
		expect(plan.orphaned).toEqual([]);
	});

	it('keeps an orphaned symbol in the basket it was removed from', () => {
		const majors = parse([{ key: 'power', label: 'Power', baskets: [basket('grid', ['KEC'], 'Grid')] }]);
		const plan = replace(current(), majors);
		expect(plan.orphaned).toEqual([{ key: 'grid', symbol: 'POWERGRID' }]);
		expect(plan.symbolsRemoved).toEqual([]);
		expect(plan.basketWrites.find((b) => b.key === 'grid')?.symbols ?? ['KEC', 'POWERGRID']).toEqual(['KEC', 'POWERGRID']);
	});

	it('does not orphan a symbol that another basket (new, or not in the file) still holds', () => {
		const majors = parse([
			{ key: 'power', label: 'Power', baskets: [basket('grid', ['KEC'], 'Grid'), basket('solar', ['POWERGRID'])] }
		]);
		const plan = replace(current(), majors);
		expect(plan.orphaned).toEqual([]);
		expect(plan.symbolsRemoved).toEqual([{ key: 'grid', symbols: ['POWERGRID'] }]);
	});

	it('sets a listed major to exactly the file baskets', () => {
		const db = current();
		db.majors[0].subsectorKeys = ['grid', 'stale'];
		db.baskets.push({ key: 'stale', label: 'Stale', symbols: ['S'] });
		const majors = parse([{ key: 'power', label: 'Power', baskets: [basket('grid', ['KEC', 'POWERGRID'], 'Grid')] }]);
		const plan = replace(db, majors);
		expect(plan.majorWrites.find((m) => m.key === 'power')!.subsectorKeys).toEqual(['grid']);
		expect(plan.detached).toEqual([{ key: 'power', baskets: ['stale'] }]);
	});

	it('deletes a major not in the file once its baskets are claimed, keeps one with unclaimed baskets', () => {
		const db = current();
		db.majors.push({ key: 'fert', label: 'Fertilisers', subsectorKeys: ['grid'], position: 2 });
		const majors = parse([{ key: 'power', label: 'Power', baskets: [basket('grid', ['KEC', 'POWERGRID'], 'Grid')] }]);
		const plan = replace(db, majors);
		expect(plan.deletedMajors).toEqual([{ key: 'fert', label: 'Fertilisers', baskets: ['grid'] }]);
		expect(plan.majorDeletes).toEqual(['fert']);
		// legacy still holds 'old', which no file major claims
		expect(plan.unclaimedKept).toEqual([{ key: 'legacy', baskets: ['old'] }]);
		expect(plan.keptMajors).toEqual(['legacy']);
		expect(plan.empty).toBe(false);
	});

	it('keeps a major whose baskets were all retired (reported, not deleted)', () => {
		const majors = parse([{ key: 'power', label: 'Power', baskets: [basket('grid', ['KEC', 'POWERGRID'], 'Grid')] }]);
		const plan = replace(current(), majors, new Set(), ['old']);
		expect(plan.majorDeletes).toEqual([]);
		expect(plan.emptiedMajors).toEqual(['legacy']);
	});

	it('is idempotent once applied', () => {
		const db = current();
		db.majors.push({ key: 'fert', label: 'Fertilisers', subsectorKeys: ['grid'], position: 2 });
		const majors = parse([
			{ key: 'rail', label: 'Rail', baskets: [basket('wagons', ['TEXRAIL'])] },
			{ key: 'power', label: 'Power', baskets: [basket('grid', ['KEC', 'ABB'], 'Grid'), basket('solar', ['POWERGRID'])] }
		]);
		const first = replace(db, majors);
		const gone = new Set(first.majorDeletes);
		const next = {
			majors: [...db.majors.filter((m) => !gone.has(m.key)).map((m) => first.majorWrites.find((w) => w.key === m.key) ?? m),
				...first.majorWrites.filter((w) => !db.majors.some((m) => m.key === w.key))],
			baskets: [...db.baskets.map((b) => first.basketWrites.find((w) => w.key === b.key) ?? b),
				...first.basketWrites.filter((w) => !db.baskets.some((b) => b.key === w.key))]
		};
		const second = replace(next, majors);
		expect(second.empty).toBe(true);
		expect(second.symbolsRemoved).toEqual([]);
		expect(second.orphaned).toEqual([]);
	});

	it('drops an orphan that is not in the universe and keeps one that is', () => {
		const db = current();
		db.baskets[0].symbols = ['KEC', 'POWERGRID', 'STALETKR'];
		const majors = parse([{ key: 'power', label: 'Power', baskets: [basket('grid', ['KEC'], 'Grid')] }]);
		const plan = planMerge(db, majors, new Set(), [], { replace: true, universe: new Set(['KEC', 'POWERGRID']) });
		expect(plan.orphaned).toEqual([{ key: 'grid', symbol: 'POWERGRID' }]);
		expect(plan.orphansDropped).toEqual([{ key: 'grid', symbol: 'STALETKR' }]);
		expect(plan.basketWrites.find((b) => b.key === 'grid')!.symbols).toEqual(['KEC', 'POWERGRID']);
		// no universe given: every orphan is kept
		const all = planMerge(db, majors, new Set(), [], { replace: true });
		expect(all.orphansDropped).toEqual([]);
		expect(all.orphaned.map((o) => o.symbol)).toEqual(['POWERGRID', 'STALETKR']);
	});

	it('leaves add-only behaviour alone without the option', () => {
		const majors = parse([{ key: 'power', label: 'Power', baskets: [basket('grid', ['KEC'], 'Grid')] }]);
		const plan = planMerge(current(), majors);
		expect(plan.keptSymbols).toEqual([{ key: 'grid', symbols: ['POWERGRID'] }]);
		expect(plan.majorDeletes).toEqual([]);
	});
});

describe('pricedNames and fileSymbols', () => {
	it('mirrors the scrip index: NSE series rows and BSE-only equities', () => {
		const names = pricedNames([
			{ token: '1', symbol: 'KEC-EQ', name: 'KEC', exch_seg: 'NSE' },
			{ token: '2', symbol: 'KECFUT', name: 'KECFUT', exch_seg: 'NFO', instrumenttype: 'FUTSTK' },
			{ token: '3', symbol: 'SPICEJET', name: 'SPICEJET', exch_seg: 'BSE' },
			{ token: '4', symbol: 'NIFTY', name: 'NIFTY', exch_seg: 'NSE', instrumenttype: 'AMXIDX' }
		]);
		expect([...names].sort()).toEqual(['KEC', 'SPICEJET']);
	});

	it('lists each file symbol once', () => {
		const majors = parse([
			{ key: 'a', label: 'A', baskets: [basket('x', ['KEC', 'ABB']), basket('y', ['ABB'])] }
		]);
		expect(fileSymbols(majors)).toEqual(['KEC', 'ABB']);
	});
});