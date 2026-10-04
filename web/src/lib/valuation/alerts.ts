import type { FairValueSide } from './fairValue';

// Pure alert logic - no I/O. Every detector takes the PREVIOUS stored state and the CURRENT
// reading and returns the state to store plus whether it's a transition worth alerting on.
// Alerts fire on a *change*, never on "is currently true": a price hovering around fair value or
// a sector sitting in Rotating In produces exactly one alert per change, not one per check.
// A missing previous state (first time we've seen the thing) seeds silently so switching the
// feature on never floods the feed with every already-true condition.

export type AlertType = 'price_fair_value' | 'sector_rotation' | 'near_breakout';

export const ALERT_TYPES: AlertType[] = ['price_fair_value', 'sector_rotation', 'near_breakout'];

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
	price_fair_value: 'Price vs fair value',
	sector_rotation: 'Sector rotation',
	near_breakout: 'Near breakout'
};

/** Fired on window by the alerts page after read/unread changes so the header bell updates at once. */
export const ALERTS_CHANGED_EVENT = 'alerts:changed';

export const NEAR_BREAKOUT_STAGE = 'Near Stage 2 Breakout';

export type FairValueCrossing = 'up' | 'down' | null;

export function detectFairValueCrossing(
	prev: string | null,
	side: FairValueSide
): { next: FairValueSide; crossing: FairValueCrossing } {
	if (prev !== 'below' && prev !== 'at_or_above') return { next: side, crossing: null };
	if (prev === side) return { next: side, crossing: null };
	return { next: side, crossing: side === 'at_or_above' ? 'up' : 'down' };
}

export type RotationSignal = 'Rotating In' | 'Rotating Out' | 'Neutral';

/** Alerts on a flip INTO Rotating In or Rotating Out; moving to Neutral just updates state. */
export function detectSectorFlip(
	prev: string | null,
	current: RotationSignal
): { next: RotationSignal; flippedTo: 'Rotating In' | 'Rotating Out' | null } {
	if (prev == null || prev === current) return { next: current, flippedTo: null };
	return {
		next: current,
		flippedTo: current === 'Neutral' ? null : current
	};
}

export function detectNearBreakout(
	prev: string | null,
	stage: string
): { next: string; entered: boolean } {
	if (prev == null) return { next: stage, entered: false };
	return { next: stage, entered: stage === NEAR_BREAKOUT_STAGE && prev !== NEAR_BREAKOUT_STAGE };
}

const inr = (n: number) =>
	`₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function fairValueMessage(
	crossing: 'up' | 'down',
	name: string,
	price: number,
	fairValue: number
): string {
	return crossing === 'up'
		? `${name} reached fair value: ${inr(price)} is at or above ${inr(fairValue)}.`
		: `${name} fell back below fair value: ${inr(price)} is under ${inr(fairValue)}.`;
}

export function sectorFlipMessage(
	label: string,
	level: 'sector' | 'basket',
	flippedTo: 'Rotating In' | 'Rotating Out',
	rs1m: number | null
): string {
	const rs = rs1m == null ? '' : ` (1M RS vs Nifty ${rs1m >= 0 ? '+' : ''}${rs1m.toFixed(1)}%)`;
	return `${label} ${level} flipped to ${flippedTo}${rs}.`;
}

export function nearBreakoutMessage(
	name: string,
	prevStage: string | null,
	distancePct: number | null
): string {
	const dist = distancePct == null ? '' : ` ${distancePct.toFixed(1)}% below resistance.`;
	return `${name} entered Near Stage 2 Breakout${prevStage ? ` (was ${prevStage})` : ''}.${dist}`;
}

/** Subject keys used for muting and de-duplication: `symbol:TCS`, `sector:<key>`, `basket:<key>`. */
export const symbolSubject = (symbol: string) => `symbol:${symbol.toUpperCase()}`;
export const sectorSubject = (key: string) => `sector:${key}`;
export const basketSubject = (key: string) => `basket:${key}`;

export interface AlertRecord {
	id: number;
	type: AlertType;
	subjectKey: string;
	subjectLabel: string;
	message: string;
	href: string | null;
	createdAt: number;
	read: boolean;
}
