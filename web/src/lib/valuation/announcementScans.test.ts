import { describe, expect, it } from 'vitest';
import { PRESET_SCANS, feedQuery, likeContains, matchesAny, normaliseKeyword, parseFeedFilters, pickTrending, presetScan } from './announcementScans';

describe('preset scans', () => {
	it('covers the eight requested scans with at least one term each', () => {
		expect(PRESET_SCANS.map((s) => s.key)).toEqual(['order_win', 'capex', 'pledge', 'insolvency', 'resignation', 'fund_raise', 'acquisition', 'credit_rating']);
		for (const s of PRESET_SCANS) expect(s.terms.length).toBeGreaterThan(0);
	});
	it('matches phrases case-insensitively and does not fire on a bare "order"', () => {
		const orders = presetScan('order_win')!.terms;
		expect(matchesAny('Bagging/Receiving of orders/contracts worth Rs 100 crore', orders)).toBe(true);
		expect(matchesAny('Order of the Hon. High Court regarding a tax matter', orders)).toBe(false);
		expect(matchesAny('CRISIL has reaffirmed its rating', presetScan('credit_rating')!.terms)).toBe(true);
		expect(presetScan('nope')).toBeNull();
	});
});

describe('keywords', () => {
	it('normalises and rejects unusable input', () => {
		expect(normaliseKeyword('  green   hydrogen ')).toBe('green hydrogen');
		expect(normaliseKeyword('a')).toBeNull();
		expect(normaliseKeyword('x'.repeat(61))).toBeNull();
		expect(normaliseKeyword(5)).toBeNull();
	});
	it('escapes LIKE wildcards', () => {
		expect(likeContains('50%_off\\')).toBe('%50\\%\\_off\\\\%');
	});
});

describe('feed filters', () => {
	it('reads valid values and ignores junk', () => {
		const f = parseFeedFilters(new URLSearchParams('company=%20tata  motors&tag=results&from=2026-10-01&to=2026-13-45&scan=pledge&q=solar&page=3'));
		expect(f).toMatchObject({ company: 'tata motors', tag: 'results', from: '2026-10-01', to: null, keyword: 'solar', page: 3 });
		expect(f.scan?.key).toBe('pledge');
		const bad = parseFeedFilters(new URLSearchParams('tag=zzz&page=-4&scan=x&from=yesterday'));
		expect(bad).toMatchObject({ tag: null, page: 1, scan: null, from: null, company: '', keyword: null });
	});
	it('round-trips through the query string', () => {
		const f = parseFeedFilters(new URLSearchParams('company=TCS&tag=results&page=2'));
		expect(feedQuery(f)).toBe('?company=TCS&tag=results&page=2');
		expect(feedQuery(f, 1)).toBe('?company=TCS&tag=results');
		expect(feedQuery({})).toBe('');
	});
});

describe('pickTrending', () => {
	it('drops stopwords and rare words, ranks by count and shows the change', () => {
		const out = pickTrending([
			{ word: 'company', current: 900, previous: 800 },
			{ word: 'buyback', current: 40, previous: 10 },
			{ word: 'dividend', current: 90, previous: 120 },
			{ word: 'rare', current: 2, previous: 0 },
			{ word: '2026', current: 500, previous: 400 },
			{ word: 'abc', current: 80, previous: 1 }
		]);
		expect(out.map((w) => w.word)).toEqual(['dividend', 'buyback']);
		expect(out[0].change).toBe(-30);
		expect(out[1].change).toBe(30);
	});
});
