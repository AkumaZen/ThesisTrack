import { describe, it, expect } from 'vitest';
import { parseImportPayload, validateCandidate, buildImportedRecord } from './importValuation';
import { freshAllAssumptions } from './valuationEngine';

describe('parseImportPayload', () => {
	it('wraps a single object into a one-element candidate array', () => {
		const result = parseImportPayload('{"symbol":"TCS","methods":{}}');
		expect('candidates' in result).toBe(true);
		if ('candidates' in result) expect(result.candidates).toHaveLength(1);
	});

	it('passes an array straight through as candidates', () => {
		const result = parseImportPayload('[{"symbol":"TCS"},{"symbol":"INFY"}]');
		if ('candidates' in result) expect(result.candidates).toHaveLength(2);
	});

	it('returns a readable error for invalid JSON instead of throwing', () => {
		const result = parseImportPayload('{not valid json');
		expect('error' in result).toBe(true);
		if ('error' in result) expect(result.error).toContain('Invalid JSON');
	});

	it('reports an empty array as having no entries', () => {
		const result = parseImportPayload('[]');
		expect('error' in result).toBe(true);
	});
});

describe('validateCandidate', () => {
	it('accepts a minimal valid entry (symbol + one method/scenario)', () => {
		const result = validateCandidate({
			symbol: 'tcs',
			methods: { pe: { base: { targetMultiple: 24 } } }
		});
		expect('input' in result).toBe(true);
		if ('input' in result) {
			expect(result.input.symbol).toBe('TCS'); // uppercased
			expect(result.input.methods.pe?.base?.targetMultiple).toBe(24);
		}
	});

	it('rejects a missing symbol', () => {
		const result = validateCandidate({ methods: {} });
		expect('error' in result).toBe(true);
	});

	it('rejects a non-object entry', () => {
		expect('error' in validateCandidate('TCS')).toBe(true);
		expect('error' in validateCandidate(null)).toBe(true);
		expect('error' in validateCandidate([1, 2, 3])).toBe(true);
	});

	it('rejects a missing methods object', () => {
		const result = validateCandidate({ symbol: 'TCS' });
		expect('error' in result).toBe(true);
	});

	it('rejects an unknown method name with a clear error naming the valid options', () => {
		const result = validateCandidate({ symbol: 'TCS', methods: { xyz: { base: {} } } });
		expect('error' in result).toBe(true);
		if ('error' in result) {
			expect(result.error).toContain('xyz');
			expect(result.error).toContain('pe, pb, ev_ebitda, mcap_sales');
		}
	});

	it('rejects an unknown scenario name', () => {
		const result = validateCandidate({ symbol: 'TCS', methods: { pe: { worst_case: {} } } });
		expect('error' in result).toBe(true);
	});

	it('rejects methods with zero scenario entries', () => {
		const result = validateCandidate({ symbol: 'TCS', methods: { pe: {} } });
		expect('error' in result).toBe(true);
	});

	it('rejects a non-numeric shares field', () => {
		const result = validateCandidate({
			symbol: 'TCS',
			shares: '366',
			methods: { pe: { base: {} } }
		});
		expect('error' in result).toBe(true);
	});

	it('accepts an optional name and shares when valid', () => {
		const result = validateCandidate({
			symbol: 'TCS',
			name: 'Tata Consultancy Services',
			shares: 366.57,
			methods: { pe: { base: {} } }
		});
		if ('input' in result) {
			expect(result.input.name).toBe('Tata Consultancy Services');
			expect(result.input.shares).toBe(366.57);
		}
	});
});

describe('buildImportedRecord', () => {
	it('fills unspecified fields from this app’s own defaults (flat-growth shorthand)', () => {
		const input = {
			symbol: 'TCS',
			methods: {
				pe: {
					base: { revenueGrowthPct: 12, expensePct: 78, targetMultiple: 24 }
				}
			}
		};
		const record = buildImportedRecord(null, input);
		const y0 = record.assumptions.pe.base.years[0];
		expect(y0.revenueGrowthPct).toBe(12);
		expect(y0.expensePct).toBe(78);
		expect(y0.targetMultiple).toBe(24);
		expect(y0.taxPct).toBe(25); // untouched default, not zeroed out

		// Unspecified scenario/method fall back to full defaults rather than being blank.
		const defaults = freshAllAssumptions();
		expect(record.assumptions.pe.bear).toEqual(defaults.pe.bear);
		expect(record.assumptions.pb.base).toEqual(defaults.pb.base);
	});

	it('applies per-year overrides, letting them win over flat overrides for that year only', () => {
		const input = {
			symbol: 'XYZ',
			methods: {
				pe: {
					base: {
						targetMultiple: 20,
						years: [{ revenueGrowthPct: 5 }, { revenueGrowthPct: 10 }, { revenueGrowthPct: 15 }]
					}
				}
			}
		};
		const record = buildImportedRecord(null, input);
		expect(record.assumptions.pe.base.years.map((y) => y.revenueGrowthPct)).toEqual([5, 10, 15]);
		expect(record.assumptions.pe.base.years.every((y) => y.targetMultiple === 20)).toBe(true);
	});

	it('a partial re-import preserves untouched methods/scenarios from the existing record', () => {
		const existing = {
			name: 'Existing Co',
			lastUpdated: 1000,
			shares: 55,
			assumptions: freshAllAssumptions()
		};
		existing.assumptions.pb.base.years[0].targetMultiple = 99; // a value the user had set

		const input = { symbol: 'ABC', methods: { pe: { base: { targetMultiple: 30 } } } };
		const merged = buildImportedRecord(existing, input);

		expect(merged.assumptions.pe.base.years[0].targetMultiple).toBe(30); // from the import
		expect(merged.assumptions.pb.base.years[0].targetMultiple).toBe(99); // preserved
		expect(merged.shares).toBe(55); // preserved, import had none
		expect(merged.name).toBe('Existing Co'); // preserved, import had none
	});

	it('an import-supplied name/shares overrides the existing record', () => {
		const existing = {
			name: 'Old Name',
			lastUpdated: 1000,
			shares: 55,
			assumptions: freshAllAssumptions()
		};
		const input = {
			symbol: 'ABC',
			name: 'New Name',
			shares: 100,
			methods: { pe: { base: {} } }
		};
		const merged = buildImportedRecord(existing, input);
		expect(merged.name).toBe('New Name');
		expect(merged.shares).toBe(100);
	});

	it('defaults shares to 100 and name to the symbol when nothing else is available', () => {
		const input = { symbol: 'NEWCO', methods: { pe: { base: {} } } };
		const record = buildImportedRecord(null, input);
		expect(record.shares).toBe(100);
		expect(record.name).toBe('NEWCO');
	});
});
