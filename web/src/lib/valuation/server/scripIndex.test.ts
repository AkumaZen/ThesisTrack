import { describe, expect, it } from 'vitest';
import { buildScripIndex, type ScripEntry } from './angelone';

const e = (exch_seg: string, symbol: string, token = '1', instrumenttype = ''): ScripEntry => ({
	exch_seg,
	symbol,
	name: symbol.split('-')[0],
	token,
	instrumenttype
});

describe('buildScripIndex', () => {
	it('prefers EQ over trade-to-trade and SME listings of the same name', () => {
		const idx = buildScripIndex([e('NSE', 'ABC-BE', 'be'), e('NSE', 'ABC-EQ', 'eq'), e('NSE', 'ABC-SM', 'sm')]);
		expect(idx.get('ABC')?.token).toBe('eq');
	});

	it('resolves REITs and surveillance-series names that were previously skipped', () => {
		const idx = buildScripIndex([e('NSE', 'EMBASSY-RR', 'reit'), e('NSE', 'RAJESHEXPO-BZ', 'bz')]);
		expect(idx.get('EMBASSY')?.token).toBe('reit');
		expect(idx.get('RAJESHEXPO')?.token).toBe('bz');
	});

	it('falls back to a BSE equity listing only when there is no NSE listing', () => {
		const idx = buildScripIndex([
			e('BSE', 'SPICEJET', 'bse-only'),
			e('BSE', 'TCS', 'bse-tcs'),
			e('NSE', 'TCS-EQ', 'nse-tcs')
		]);
		expect(idx.get('SPICEJET')).toMatchObject({ exch_seg: 'BSE', token: 'bse-only' });
		expect(idx.get('TCS')).toMatchObject({ exch_seg: 'NSE', token: 'nse-tcs' });
	});

	it('does not pull derivatives, bonds or suffixed BSE rows into the index', () => {
		const idx = buildScripIndex([
			e('BSE', '85TMCV26', 'bond', 'AMXIDX'),
			e('BSE', 'SOMETHING-X', 'x'),
			e('NSE', 'FOO-N0', 'debt'),
			e('NSE', 'BARFUT', 'fut', 'FUTSTK')
		]);
		expect(idx.size).toBe(0);
	});
});
