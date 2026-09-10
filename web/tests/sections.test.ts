import { describe, expect, it } from 'vitest';
import { THESIS_SECTIONS, SECTION_KEYS, readTrackables } from '../src/lib/sections';
import { thesisData } from '../src/lib/server/schemas/thesis';
import { diffVersions } from '../src/lib/server/services/versioning';

export const validThesis = {
	the_business: { what_it_does: 'Test business', revenue_split: [{ segment: 'Main', share_pct: 100 }] },
	the_growth_engine: [], the_big_change: { summary: '', expected_completion: '' },
	proof_points: { hard_evidence: [], model_specific_metrics: {} },
	what_can_kill_it: [{ label: 'Independent risk', severity: 'kill', manual_check: true, action: 'Review' }],
	why_we_believe_it: ['Premise: Demand', 'Inference: Growth', 'Conclusion: Monitor'],
	health_check: { latest_quarter_review: '', historical_checks: [] }, references: []
};

describe('nine default sections and separate references', () => {
	it('defines nine unique sections and keeps References supplementary', () => {
		expect(THESIS_SECTIONS).toHaveLength(9);
		expect(new Set(THESIS_SECTIONS.map((s) => s.key)).size).toBe(9);
		expect(SECTION_KEYS).toHaveLength(10);
		expect(SECTION_KEYS.at(-1)).toBe('references');
	});
	it('loads legacy theses without deriving trackables from kill triggers', () => {
		const parsed = thesisData.parse(validThesis);
		expect(parsed.trackables).toEqual([]);
		expect(parsed.buy_sell_decision).toBe('');
		expect(readTrackables(validThesis)).toEqual([]);
	});
	it('preserves authored text, newlines, duplicate entries and decision reasoning', () => {
		const items = ['  Monitor new beds\nDue next quarter  ', 'Monitor new beds', 'Monitor new beds'];
		const parsed = thesisData.parse({ ...validThesis, trackables: items, buy_sell_decision: 'Buy only after\ncommissioning.' });
		expect(readTrackables(parsed)).toEqual(items);
		expect(parsed.buy_sell_decision).toBe('Buy only after\ncommissioning.');
	});
	it('rejects malformed entries and accepts empty new sections', () => {
		for (const trackables of [['   '], [123], 'not an array']) {
			expect(thesisData.safeParse({ ...validThesis, trackables }).success).toBe(false);
		}
		expect(thesisData.safeParse({ ...validThesis, trackables: [], buy_sell_decision: '' }).success).toBe(true);
	});
	it('includes new sections in version differences', () => {
		const changes = diffVersions({ thesisData: validThesis }, { thesisData: { ...validThesis, trackables: ['A'], buy_sell_decision: 'B' } });
		expect(changes.map((c) => c.path)).toEqual(expect.arrayContaining(['trackables[0]', 'buy_sell_decision']));
	});
});
