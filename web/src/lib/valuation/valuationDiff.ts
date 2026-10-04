import { METHODS, METHOD_LABELS, SCENARIOS, type YearAssumptions } from './valuationEngine';
import type { SavedValuationRecord } from './savedValuations';

// Pure - no I/O. Describes, in words, what differs between two saved valuations. Used when a save
// is refused because someone else changed the same company first, so the person can see exactly
// what the other analyst changed before deciding whether to reload.

const FIELD_LABELS: Record<keyof YearAssumptions, string> = {
	revenueGrowthPct: 'revenue growth %',
	expensePct: 'expenses % of sales',
	otherIncome: 'other income',
	interest: 'interest',
	depreciation: 'depreciation',
	taxPct: 'tax %',
	dividendPayoutPct: 'dividend payout %',
	netDebt: 'net debt',
	targetMultiple: 'target multiple'
};

const SCENARIO_LABELS = { bear: 'Bear', base: 'Base', bull: 'Bull' } as const;

const fmt = (n: unknown) =>
	typeof n === 'number' && Number.isFinite(n) ? String(Math.round(n * 1e6) / 1e6) : String(n);

/** One human-readable line per changed value, e.g. "Base · P/E · FY+2 target multiple: 20 → 22". */
export function diffValuations(
	before: Pick<SavedValuationRecord, 'assumptions' | 'shares' | 'activeMethod' | 'activeScenario'>,
	after: Pick<SavedValuationRecord, 'assumptions' | 'shares' | 'activeMethod' | 'activeScenario'>
): string[] {
	const lines: string[] = [];
	for (const method of METHODS) {
		for (const scenario of SCENARIOS) {
			const a = before.assumptions?.[method]?.[scenario]?.years;
			const b = after.assumptions?.[method]?.[scenario]?.years;
			if (!a || !b) continue;
			for (let i = 0; i < Math.max(a.length, b.length); i++) {
				for (const field of Object.keys(FIELD_LABELS) as (keyof YearAssumptions)[]) {
					const x = a[i]?.[field];
					const y = b[i]?.[field];
					if (x !== y) {
						lines.push(
							`${SCENARIO_LABELS[scenario]} · ${METHOD_LABELS[method].split(' ')[0]} · FY+${i + 1} ${FIELD_LABELS[field]}: ${fmt(x)} → ${fmt(y)}`
						);
					}
				}
			}
		}
	}
	if (before.shares !== after.shares) {
		lines.push(`Shares outstanding: ${fmt(before.shares)} → ${fmt(after.shares)}`);
	}
	if (before.activeMethod !== after.activeMethod) {
		lines.push(
			`Selected method: ${before.activeMethod ?? 'none'} → ${after.activeMethod ?? 'none'}`
		);
	}
	if (before.activeScenario !== after.activeScenario) {
		lines.push(
			`Selected scenario: ${before.activeScenario ?? 'none'} → ${after.activeScenario ?? 'none'}`
		);
	}
	return lines;
}
