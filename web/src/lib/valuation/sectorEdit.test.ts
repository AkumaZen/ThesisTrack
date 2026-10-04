import { describe, expect, it } from 'vitest';
import {
	KEY_RE,
	bseFallback,
	SYMBOL_RE,
	normalizeSymbol,
	resolveSymbolMatch,
	slugifyKey,
	symbolFromScreenerUrl,
	uniqueKey
} from './sectorEdit';

describe('slugifyKey / uniqueKey', () => {
	it('produces URL-safe keys that satisfy KEY_RE', () => {
		for (const label of ['Power Transformers (HV)', '  Oil & Gas  ', 'AI / GPU 2.0', '***']) {
			expect(KEY_RE.test(slugifyKey(label))).toBe(true);
		}
		expect(slugifyKey('Oil & Gas')).toBe('oil_and_gas');
		expect(slugifyKey('Power Transformers (HV)')).toBe('power_transformers_hv');
	});

	it('suffixes on collision', () => {
		expect(uniqueKey('Banks', ['x'])).toBe('banks');
		expect(uniqueKey('Banks', ['banks'])).toBe('banks_2');
		expect(uniqueKey('Banks', ['banks', 'banks_2'])).toBe('banks_3');
	});
});

describe('symbols', () => {
	it('normalizes case and whitespace', () => {
		expect(normalizeSymbol('  tcs ')).toBe('TCS');
	});

	it('accepts real NSE shapes and rejects junk', () => {
		for (const ok of ['TCS', 'M&M', 'GVT&D', 'BAJAJ-AUTO', '360ONE']) {
			expect(SYMBOL_RE.test(ok)).toBe(true);
		}
		for (const bad of ['', ' ', 'a b', 'TC$', '-X', 'X'.repeat(31)]) {
			expect(SYMBOL_RE.test(bad)).toBe(false);
		}
	});
});

describe('resolveSymbolMatch', () => {
	const hits = [
		{ name: 'Tata Consultancy Services Ltd', url: '/company/TCS/consolidated/' },
		{ name: 'Tata Consumer Products Ltd', url: '/company/TATACONSUM/consolidated/' },
		{ name: 'no url' }
	];

	it('extracts the slug from a screener url', () => {
		expect(symbolFromScreenerUrl('/company/GVT%26D/consolidated/')).toBe('GVT&D');
		expect(symbolFromScreenerUrl('/nope')).toBeNull();
	});

	it('accepts only an exact slug match', () => {
		const r = resolveSymbolMatch('tcs', hits);
		expect(r.match).toEqual({ symbol: 'TCS', name: 'Tata Consultancy Services Ltd' });
		expect(r.suggestions).toEqual([]);
	});

	it('never accepts a fuzzy match - returns suggestions instead', () => {
		const r = resolveSymbolMatch('TATA', hits);
		expect(r.match).toBeNull();
		expect(r.suggestions.map((s) => s.symbol)).toEqual(['TCS', 'TATACONSUM']);
	});

	it('returns nothing for no hits', () => {
		expect(resolveSymbolMatch('ZZZ', [])).toEqual({ match: null, suggestions: [] });
	});
});

describe('bseFallback', () => {
	const asm = { symbol: '526433', name: 'ASM Technologies Ltd' };
	it('uses the BSE-code page carrying the known company name', () => {
		expect(bseFallback([asm, { symbol: 'ASMS', name: 'Bartronics' }], 'ASM Technologies Ltd')).toEqual(asm);
		expect(bseFallback([asm], 'ASM Technologies Limited.')).toEqual(asm); // only one hit
	});
	it('uses the only company the search returned when the name is unknown', () => {
		expect(bseFallback([asm], null)).toEqual(asm);
	});
	it('never picks between several unnamed candidates or a different company', () => {
		const other = { symbol: '500123', name: 'ASM Foods Ltd' };
		expect(bseFallback([asm, other], null)).toBeNull();
		expect(bseFallback([asm, other], 'Something Else Ltd')).toBeNull();
		expect(bseFallback([{ symbol: 'ASMS', name: 'ASM Technologies Ltd' }], null)).toBeNull();
		expect(bseFallback([], 'ASM Technologies Ltd')).toBeNull();
	});
});
