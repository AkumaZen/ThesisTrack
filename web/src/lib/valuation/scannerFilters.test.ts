import { describe, expect, it } from 'vitest';
import { SIGNALS, UNCLASSIFIED, matchesFilters, sectorOptions, signalMatches, type ScanEntry, type ScanFilters } from './scannerFilters';
import { SCANNER_SIGNAL_KEYS } from '../viewMemory';
import type { StageScanResult } from './stageScan';

const result = (over: Record<string, unknown> = {}) =>
	({
		stage: 'Near Stage 2 Breakout',
		breakout: null,
		intradayAboveResistance: false,
		volumeSurgeWarning: false,
		volumeTier: 'Normal',
		...over
	}) as unknown as StageScanResult;

const entry = (over: Partial<ScanEntry> = {}): ScanEntry => ({
	symbol: 'ACME',
	name: 'Acme Industries',
	baskets: ['Capital Goods'],
	mcapCr: 3000,
	r: result(),
	...over
});

const ALL: ScanFilters = { stage: 'all', sector: '', band: 'all', signal: 'all', query: '' };

describe('matchesFilters', () => {
	it('passes everything with no filter set', () => {
		expect(matchesFilters(entry(), ALL)).toBe(true);
	});

	it('filters by stage', () => {
		expect(matchesFilters(entry(), { ...ALL, stage: 'Near Stage 2 Breakout' })).toBe(true);
		expect(matchesFilters(entry(), { ...ALL, stage: 'Stage 4' })).toBe(false);
	});

	it('filters by sector, with Unclassified for companies in no basket', () => {
		expect(matchesFilters(entry(), { ...ALL, sector: 'Capital Goods' })).toBe(true);
		expect(matchesFilters(entry(), { ...ALL, sector: 'Banks' })).toBe(false);
		expect(matchesFilters(entry({ baskets: [] }), { ...ALL, sector: UNCLASSIFIED })).toBe(true);
		expect(matchesFilters(entry(), { ...ALL, sector: UNCLASSIFIED })).toBe(false);
		expect(matchesFilters(entry({ baskets: ['A', 'B'] }), { ...ALL, sector: 'B' })).toBe(true);
	});

	it('filters by market cap band, including companies not on the list', () => {
		expect(matchesFilters(entry({ mcapCr: 3000 }), { ...ALL, band: 'm2000' })).toBe(true);
		expect(matchesFilters(entry({ mcapCr: 3000 }), { ...ALL, band: 'm500' })).toBe(false);
		expect(matchesFilters(entry({ mcapCr: null }), { ...ALL, band: 'none' })).toBe(true);
		expect(matchesFilters(entry({ mcapCr: 3000 }), { ...ALL, band: 'none' })).toBe(false);
	});

	it('searches name and ticker', () => {
		expect(matchesFilters(entry(), { ...ALL, query: ' acme ind' })).toBe(true);
		expect(matchesFilters(entry(), { ...ALL, query: 'ACM' })).toBe(true);
		expect(matchesFilters(entry(), { ...ALL, query: 'zzz' })).toBe(false);
	});

	it('requires every filter at once', () => {
		const f: ScanFilters = { stage: 'Near Stage 2 Breakout', sector: 'Capital Goods', band: 'm2000', signal: 'vol_building', query: 'acme' };
		const e = entry({ r: result({ volumeSurgeWarning: true }) });
		expect(matchesFilters(e, f)).toBe(true);
		for (const wrong of [{ stage: 'Stage 3' }, { sector: 'Banks' }, { band: 'm5000' }, { signal: 'confirmed' }, { query: 'nope' }] as Partial<ScanFilters>[]) {
			expect(matchesFilters(e, { ...f, ...wrong })).toBe(false);
		}
	});
});

describe('signalMatches', () => {
	it('uses only what the scan already produces', () => {
		const confirmed = result({ stage: 'Confirmed Stage 2 Breakout' });
		expect(signalMatches(confirmed, 'confirmed')).toBe(true);
		expect(signalMatches(result(), 'confirmed')).toBe(false);
		expect(signalMatches(result({ breakout: { date: '2026-01-01', ageDays: 9 } }), 'on_record')).toBe(true);
		expect(signalMatches(result(), 'on_record')).toBe(false);
		expect(signalMatches(result({ intradayAboveResistance: true }), 'above_today')).toBe(true);
		// Already a confirmed breakout: not "awaiting a close".
		expect(signalMatches(result({ intradayAboveResistance: true, stage: 'Confirmed Stage 2 Breakout' }), 'above_today')).toBe(false);
		expect(signalMatches(result({ volumeTier: 'Breakout-confirmation' }), 'vol_breakout')).toBe(true);
		expect(signalMatches(result({ volumeSurgeWarning: true }), 'vol_building')).toBe(true);
		expect(signalMatches(result(), 'all')).toBe(true);
	});
	it('matches the keys the scanner remembers', () => {
		expect(SIGNALS.map((s) => s.key)).toEqual([...SCANNER_SIGNAL_KEYS]);
	});
});

describe('sectorOptions', () => {
	it('sorts the labels and adds Unclassified last only when needed', () => {
		expect(sectorOptions(['Metals', 'Banks', 'Banks'], false)).toEqual(['Banks', 'Metals']);
		expect(sectorOptions(['Metals', 'Banks'], true)).toEqual(['Banks', 'Metals', UNCLASSIFIED]);
	});
});
