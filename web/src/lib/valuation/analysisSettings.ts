// Team-wide analysis settings: what counts as Rotating In/Out and the Stage 2 scanner's
// thresholds. One shared set (the admin edits it on /settings) so everyone reads the same
// signals. Pure - no I/O; the server store persists it.

import { DEFAULT_ROTATION_PARAMS, type RotationParams } from './sectorRotation';
import { DEFAULT_SCAN_PARAMS, type ScanParams } from './stageScan';
import { DEFAULT_FAIR_VALUE_PCT } from './fairValue';

export interface ValuationParams {
	/** Fair value as a % of the Base-case FY+2E target. */
	fairValuePct: number;
}

export interface AnalysisSettings {
	valuation: ValuationParams;
	rotation: RotationParams;
	scan: ScanParams;
}

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
	valuation: { fairValuePct: DEFAULT_FAIR_VALUE_PCT },
	rotation: { ...DEFAULT_ROTATION_PARAMS },
	scan: { ...DEFAULT_SCAN_PARAMS }
};

interface FieldSpec {
	label: string;
	help: string;
	min: number;
	max: number;
	step: number;
	unit: string;
	integer?: boolean;
}

export const VALUATION_FIELDS: Record<keyof ValuationParams, FieldSpec> = {
	fairValuePct: {
		label: 'Fair value',
		help: 'Fair value as a share of the Base-case FY+2E target. 80 means a 20% margin of safety. Used by the watchlist, exports and fair-value alerts.',
		min: 50,
		max: 100,
		step: 1,
		unit: '% of target',
		integer: true
	}
};

export const ROTATION_FIELDS: Record<keyof RotationParams, FieldSpec> = {
	shortDays: {
		label: 'Short window',
		help: 'Most recent relative-strength window the signal looks at. 21 trading days is about a month.',
		min: 5,
		max: 63,
		step: 1,
		unit: 'trading days',
		integer: true
	},
	midDays: {
		label: 'Medium window',
		help: '63 trading days is about three months.',
		min: 10,
		max: 126,
		step: 1,
		unit: 'trading days',
		integer: true
	},
	longDays: {
		label: 'Long window',
		help: '126 trading days is about six months.',
		min: 21,
		max: 252,
		step: 1,
		unit: 'trading days',
		integer: true
	},
	minRsPct: {
		label: 'Minimum relative strength',
		help: 'Short-window RS vs Nifty must be above +this (Rotating In) or below -this (Rotating Out). 0 means any lead or lag counts.',
		min: 0,
		max: 20,
		step: 0.5,
		unit: '% points'
	}
};

export const SCAN_FIELDS: Record<keyof ScanParams, FieldSpec> = {
	breakoutVolumeRatio: {
		label: 'Breakout volume',
		help: 'A breakout day needs at least this multiple of the 20-day average volume.',
		min: 1,
		max: 5,
		step: 0.1,
		unit: 'x average'
	},
	elevatedVolumeRatio: {
		label: 'Elevated volume',
		help: 'Volume at or above this multiple (but below breakout volume) shows as Elevated.',
		min: 1,
		max: 5,
		step: 0.1,
		unit: 'x average'
	},
	volumeSurgeRatio: {
		label: 'Early volume surge',
		help: 'Flags a base when the last 5 days average this multiple of the 20 days before.',
		min: 1,
		max: 5,
		step: 0.1,
		unit: 'x average'
	},
	minBaseDurationDays: {
		label: 'Minimum base length',
		help: 'A base must last at least this long from its first resistance touch.',
		min: 10,
		max: 120,
		step: 1,
		unit: 'trading days',
		integer: true
	},
	baseMaxRangePct: {
		label: 'Maximum base depth',
		help: 'Bases wider than this from support to resistance are treated as chop, not a base.',
		min: 5,
		max: 60,
		step: 1,
		unit: '%'
	},
	cleanBreakMarginPct: {
		label: 'Breakout margin',
		help: 'A close must clear resistance by at least this much to count as a clean breakout.',
		min: 0,
		max: 10,
		step: 0.1,
		unit: '%'
	},
	nearBreakoutMaxPct: {
		label: 'Near-breakout band',
		help: 'A stock within this distance below resistance is listed as Near Breakout.',
		min: 1,
		max: 20,
		step: 0.5,
		unit: '%'
	}
};

function cleanGroup<T extends object>(
	raw: unknown,
	fields: Record<keyof T, FieldSpec>,
	base: T,
	group: string
): { error: string } | { value: T } {
	if (raw === undefined) return { value: { ...base } };
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return { error: `"${group}" must be an object.` };
	}
	const out = { ...base } as Record<string, number>;
	for (const key of Object.keys(fields) as (keyof T & string)[]) {
		const v = (raw as Record<string, unknown>)[key];
		if (v === undefined) continue;
		const spec = fields[key];
		if (typeof v !== 'number' || !Number.isFinite(v)) {
			return { error: `${spec.label} must be a number.` };
		}
		if (v < spec.min || v > spec.max) {
			return { error: `${spec.label} must be between ${spec.min} and ${spec.max} ${spec.unit}.` };
		}
		if (spec.integer && !Number.isInteger(v)) {
			return { error: `${spec.label} must be a whole number of ${spec.unit}.` };
		}
		out[key] = Math.round(v * 100) / 100;
	}
	return { value: out as T };
}

/** Validates a (partial) settings object on top of `base`. Returns a readable error or the
 *  complete cleaned settings. */
export function parseAnalysisSettings(
	raw: unknown,
	base: AnalysisSettings = DEFAULT_ANALYSIS_SETTINGS
): { error: string } | { value: AnalysisSettings } {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return { error: 'Settings must be an object.' };
	}
	const r = raw as Record<string, unknown>;
	const valuation = cleanGroup(r.valuation, VALUATION_FIELDS, base.valuation, 'valuation');
	if ('error' in valuation) return valuation;
	const rotation = cleanGroup(r.rotation, ROTATION_FIELDS, base.rotation, 'rotation');
	if ('error' in rotation) return rotation;
	const scan = cleanGroup(r.scan, SCAN_FIELDS, base.scan, 'scan');
	if ('error' in scan) return scan;

	const { shortDays, midDays, longDays } = rotation.value;
	if (!(shortDays < midDays && midDays < longDays)) {
		return { error: 'The rotation windows must go short < medium < long.' };
	}
	if (scan.value.elevatedVolumeRatio > scan.value.breakoutVolumeRatio) {
		return { error: 'Elevated volume cannot be higher than breakout volume.' };
	}
	return { value: { valuation: valuation.value, rotation: rotation.value, scan: scan.value } };
}

/** Reads a stored value leniently: anything invalid falls back to the defaults. */
export function storedAnalysisSettings(raw: unknown): AnalysisSettings {
	const parsed = raw == null ? null : parseAnalysisSettings(raw);
	return parsed && 'value' in parsed ? parsed.value : structuredClone(DEFAULT_ANALYSIS_SETTINGS);
}
