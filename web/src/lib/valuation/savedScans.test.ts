import { describe, expect, it } from 'vitest';
import {
	cleanScanName,
	describeScanConfig,
	DEFAULT_SCAN_CONFIG,
	diffSnapshots,
	evaluateScan,
	isScanId,
	parseScanConfig,
	type ScanInputs
} from './savedScans';
import type { ScanEntry } from './scannerFilters';
import type { StageScanResult } from './stageScan';

function entry(symbol: string, stage: string, over: Partial<ScanEntry> = {}, high52 = 100, close = 100): ScanEntry {
	return {
		symbol,
		name: symbol,
		baskets: ['Banks'],
		mcapCr: 3000,
		r: {
			stage,
			presets: { sessions: 300, close, prevClose: close, high52, volume: 1, avgVolume50: 1, breakoutAge: null, breakoutLevel: null, ret3m: null, ret6m: null, bench3m: null, bench6m: null }
		} as unknown as StageScanResult,
		...over
	};
}

const none: ScanInputs = { growth: {}, fundamentals: {}, high5y: {} };

describe('parseScanConfig', () => {
	it('accepts a full valid config', () => {
		const c = { ...DEFAULT_SCAN_CONFIG, stage: 'Stage 2 Advancing', preset: 'near-high', band: 'm2000', signal: 'confirmed' };
		expect(parseScanConfig(c)).toEqual(c);
	});
	it('rejects unknown or malformed values', () => {
		expect(parseScanConfig(null)).toBeNull();
		expect(parseScanConfig({ ...DEFAULT_SCAN_CONFIG, stage: 'Stage 9' })).toBeNull();
		expect(parseScanConfig({ ...DEFAULT_SCAN_CONFIG, preset: 'made-up' })).toBeNull();
		expect(parseScanConfig({ ...DEFAULT_SCAN_CONFIG, band: 'huge' })).toBeNull();
		expect(parseScanConfig({ ...DEFAULT_SCAN_CONFIG, query: 'x'.repeat(200) })).toBeNull();
		expect(parseScanConfig({ ...DEFAULT_SCAN_CONFIG, sector: 5 })).toBeNull();
	});
});

describe('cleanScanName', () => {
	it('trims, collapses spaces and caps the length', () => {
		expect(cleanScanName('  My   scan \n')).toBe('My scan');
		expect(cleanScanName('a'.repeat(100))).toHaveLength(60);
	});
	it('is null for empty or non-text input', () => {
		expect(cleanScanName('   ')).toBeNull();
		expect(cleanScanName(5)).toBeNull();
	});
});

describe('describeScanConfig', () => {
	it('lists the active filters in words', () => {
		expect(describeScanConfig(DEFAULT_SCAN_CONFIG)).toEqual(['Everything scanned']);
		const parts = describeScanConfig({ ...DEFAULT_SCAN_CONFIG, preset: 'stage2', sector: 'Banks', query: 'hdfc' });
		expect(parts).toEqual(['Stage 2', 'Banks', '"hdfc"']);
	});
});

describe('evaluateScan', () => {
	const entries = [
		entry('AAA', 'Stage 2 Advancing'),
		entry('BBB', 'Stage 4'),
		entry('CCC', 'Confirmed Stage 2 Breakout', { baskets: ['Autos'] })
	];
	it('applies the scanner filters', () => {
		expect(evaluateScan(DEFAULT_SCAN_CONFIG, entries, none)).toEqual(['AAA', 'BBB', 'CCC']);
		expect(evaluateScan({ ...DEFAULT_SCAN_CONFIG, sector: 'Autos' }, entries, none)).toEqual(['CCC']);
		expect(evaluateScan({ ...DEFAULT_SCAN_CONFIG, stage: 'Stage 4' }, entries, none)).toEqual(['BBB']);
	});
	it('applies a preset on top of the filters', () => {
		expect(evaluateScan({ ...DEFAULT_SCAN_CONFIG, preset: 'stage2' }, entries, none)).toEqual(['AAA', 'CCC']);
		expect(evaluateScan({ ...DEFAULT_SCAN_CONFIG, preset: 'stage2', sector: 'Autos' }, entries, none)).toEqual(['CCC']);
	});
	it('uses the stored 5-year high for the 5-year-high preset and skips stocks without one', () => {
		const e = [entry('AAA', 'Stage 2 Advancing', {}, 100, 100), entry('BBB', 'Stage 2 Advancing', {}, 100, 100)];
		const inputs: ScanInputs = { growth: {}, fundamentals: {}, high5y: { AAA: 101 } };
		expect(evaluateScan({ ...DEFAULT_SCAN_CONFIG, preset: 'five-year-high' }, e, inputs)).toEqual(['AAA']);
	});
});

describe('diffSnapshots', () => {
	it('lists entries and exits between two days', () => {
		expect(diffSnapshots(['A', 'B', 'C'], ['B', 'C', 'D'])).toEqual({ added: ['D'], removed: ['A'], unchanged: 2 });
	});
	it('treats the first snapshot as having nothing new', () => {
		expect(diffSnapshots(null, ['A', 'B'])).toEqual({ added: [], removed: [], unchanged: 2 });
	});
});

describe('isScanId', () => {
	it('accepts a uuid and rejects anything else', () => {
		expect(isScanId('3f2b8c1e-9d4a-4e7b-8a1c-0123456789ab')).toBe(true);
		expect(isScanId('abc')).toBe(false);
		expect(isScanId("1' or '1'='1")).toBe(false);
	});
});
