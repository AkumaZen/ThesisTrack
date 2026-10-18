import { describe, expect, it } from 'vitest';
import { flagCss, validateFlag, validateSectionName } from './watchlistSections';

describe('validateSectionName', () => {
	it('trims, collapses spaces and bounds the length', () => {
		expect(validateSectionName('  Banks   to watch ')).toEqual({ ok: true, value: 'Banks to watch' });
		expect(validateSectionName('   ').ok).toBe(false);
		expect(validateSectionName(42).ok).toBe(false);
		expect(validateSectionName('x'.repeat(41)).ok).toBe(false);
	});
});

describe('validateFlag', () => {
	it('accepts a palette colour and a short label, or clears the flag', () => {
		expect(validateFlag({ color: 'green', label: ' Buy on dip ' })).toEqual({ ok: true, value: { color: 'green', label: 'Buy on dip' } });
		expect(validateFlag({ color: '', label: '' })).toEqual({ ok: true, value: { color: null, label: null } });
		expect(validateFlag({ color: 'teal' }).ok).toBe(false);
		expect(validateFlag({ label: 'y'.repeat(25) }).ok).toBe(false);
	});
	it('maps colours to CSS', () => {
		expect(flagCss('red')).toBe('#ff6b6b');
		expect(flagCss('nope')).toBeNull();
		expect(flagCss(null)).toBeNull();
	});
});
