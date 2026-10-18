import type { PushPayload } from './announcements';

// Pure logic for personal alert rules: price levels / percentage moves on any stock, and quarterly
// shareholding changes of tracked companies. No network or database in here.

// ---- price alerts ----

export type PriceAlertKind = 'above' | 'below' | 'pct_up' | 'pct_down';

export const PRICE_ALERT_KINDS: PriceAlertKind[] = ['above', 'below', 'pct_up', 'pct_down'];

export const PRICE_ALERT_LABELS: Record<PriceAlertKind, string> = {
	above: 'Price rises to or above',
	below: 'Price falls to or below',
	pct_up: 'Rises by (%)',
	pct_down: 'Falls by (%)'
};

export const MAX_ACTIVE_PRICE_ALERTS = 50;

export interface PriceRule {
	kind: PriceAlertKind;
	threshold: number;
	/** The stored price when the rule was made; the starting point of a percentage move. */
	basePrice: number | null;
}

export const isPriceAlertKind = (v: unknown): v is PriceAlertKind =>
	typeof v === 'string' && (PRICE_ALERT_KINDS as string[]).includes(v);

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The price at which the rule fires; null for a percentage rule that has no base price. */
export function triggerPrice(rule: PriceRule): number | null {
	if (rule.kind === 'above' || rule.kind === 'below') return rule.threshold;
	if (rule.basePrice == null) return null;
	return round2(rule.basePrice * (1 + (rule.kind === 'pct_up' ? 1 : -1) * (rule.threshold / 100)));
}

export function evaluatePriceAlert(rule: PriceRule, price: number | null): boolean {
	if (price == null || !(price > 0)) return false;
	const target = triggerPrice(rule);
	if (target == null) return false;
	return rule.kind === 'above' || rule.kind === 'pct_up' ? price >= target : price <= target;
}

export interface NewPriceAlert {
	nseSymbol: string;
	kind: PriceAlertKind;
	threshold: number;
	basePrice: number | null;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; message: string };

/** Checks a request to create a price alert. `lastPrice` is the stored price, needed for % moves. */
export function validatePriceAlert(body: unknown, lastPrice: number | null): Validated<NewPriceAlert> {
	const b = (body ?? {}) as Record<string, unknown>;
	const nseSymbol = typeof b.symbol === 'string' ? b.symbol.trim().toUpperCase() : '';
	if (!/^[A-Z0-9&-]{1,20}$/.test(nseSymbol)) return { ok: false, message: 'Pick a company from the list.' };
	if (!isPriceAlertKind(b.kind)) return { ok: false, message: 'Pick a type of alert.' };
	const threshold = typeof b.threshold === 'number' ? b.threshold : Number(b.threshold);
	if (!Number.isFinite(threshold) || threshold <= 0) return { ok: false, message: 'Enter a number above zero.' };
	if ((b.kind === 'pct_up' || b.kind === 'pct_down') && (threshold > 100 || (b.kind === 'pct_down' && threshold >= 100))) {
		return { ok: false, message: b.kind === 'pct_down' ? 'A fall must be under 100%.' : 'A rise can be at most 100%.' };
	}
	if ((b.kind === 'above' || b.kind === 'below') && threshold > 10_000_000) return { ok: false, message: 'That price is too large.' };
	if (b.kind === 'pct_up' || b.kind === 'pct_down') {
		if (lastPrice == null || !(lastPrice > 0)) {
			return { ok: false, message: `No stored price for ${nseSymbol} yet, so a % move cannot be measured. Set a price level instead.` };
		}
		return { ok: true, value: { nseSymbol, kind: b.kind, threshold: round2(threshold), basePrice: lastPrice } };
	}
	return { ok: true, value: { nseSymbol, kind: b.kind as PriceAlertKind, threshold: round2(threshold), basePrice: lastPrice } };
}

const inr = (n: number) => `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One-line description of a rule, for the management page. */
export function describePriceRule(rule: PriceRule): string {
	const target = triggerPrice(rule);
	switch (rule.kind) {
		case 'above':
			return `At or above ${inr(rule.threshold)}`;
		case 'below':
			return `At or below ${inr(rule.threshold)}`;
		case 'pct_up':
			return `Up ${rule.threshold}%${rule.basePrice != null ? ` from ${inr(rule.basePrice)}` : ''}${target != null ? ` (${inr(target)})` : ''}`;
		case 'pct_down':
			return `Down ${rule.threshold}%${rule.basePrice != null ? ` from ${inr(rule.basePrice)}` : ''}${target != null ? ` (${inr(target)})` : ''}`;
	}
}

export function buildPriceAlertPayload(rule: PriceRule & { id: number; nseSymbol: string }, price: number): PushPayload {
	const target = triggerPrice(rule);
	const up = rule.kind === 'above' || rule.kind === 'pct_up';
	return {
		title: `${rule.nseSymbol}: ${inr(price)}`,
		body: `${rule.nseSymbol} ${up ? 'rose to or above' : 'fell to or below'} ${target != null ? inr(target) : inr(rule.threshold)} (${describePriceRule(rule).toLowerCase()}).`,
		url: `/valuation/company/${encodeURIComponent(rule.nseSymbol)}`,
		tag: `price-alert-${rule.id}`
	};
}

// ---- shareholding change alerts ----

export interface HoldingAlertSettings {
	/** Percentage points of quarter-on-quarter change that triggers an alert; null turns the group off. */
	promoterPp: number | null;
	fiiPp: number | null;
	diiPp: number | null;
}

export const DEFAULT_HOLDING_SETTINGS: HoldingAlertSettings = { promoterPp: null, fiiPp: null, diiPp: null };

export const hasHoldingAlerts = (s: HoldingAlertSettings): boolean => s.promoterPp != null || s.fiiPp != null || s.diiPp != null;

export function validateHoldingSettings(body: unknown): Validated<HoldingAlertSettings> {
	const b = (body ?? {}) as Record<string, unknown>;
	const out: HoldingAlertSettings = { promoterPp: null, fiiPp: null, diiPp: null };
	for (const [field, key] of [['promoterPp', 'promoter'], ['fiiPp', 'FII'], ['diiPp', 'DII']] as const) {
		const raw = b[field];
		if (raw == null || raw === '') continue;
		const n = typeof raw === 'number' ? raw : Number(raw);
		if (!Number.isFinite(n) || n <= 0 || n > 50) return { ok: false, message: `The ${key} change must be between 0 and 50 percentage points, or empty to turn it off.` };
		out[field] = Math.round(n * 100) / 100;
	}
	return { ok: true, value: out };
}

export interface HoldingSnapshot {
	period: string;
	prevPeriod: string | null;
	promoters: number | null;
	fiis: number | null;
	diis: number | null;
	prevPromoters: number | null;
	prevFiis: number | null;
	prevDiis: number | null;
}

export interface HoldingChange {
	group: 'Promoter' | 'FII' | 'DII';
	from: number;
	to: number;
	/** Percentage points, signed. */
	change: number;
}

/** The holder groups whose share moved by at least their threshold between the two quarters. */
export function holdingChanges(settings: HoldingAlertSettings, s: HoldingSnapshot): HoldingChange[] {
	const out: HoldingChange[] = [];
	const check = (group: HoldingChange['group'], threshold: number | null, from: number | null, to: number | null) => {
		if (threshold == null || from == null || to == null) return;
		const change = Math.round((to - from) * 100) / 100;
		if (Math.abs(change) >= threshold) out.push({ group, from, to, change });
	};
	check('Promoter', settings.promoterPp, s.prevPromoters, s.promoters);
	check('FII', settings.fiiPp, s.prevFiis, s.fiis);
	check('DII', settings.diiPp, s.prevDiis, s.diis);
	return out;
}

const signed = (n: number) => (n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2));

export function buildHoldingPayload(symbol: string, snapshot: Pick<HoldingSnapshot, 'period' | 'prevPeriod'>, changes: HoldingChange[]): PushPayload {
	const parts = changes.map((c) => `${c.group} ${c.from.toFixed(2)}% to ${c.to.toFixed(2)}% (${signed(c.change)} pts)`);
	return {
		title: `${symbol}: shareholding changed`,
		body: `${snapshot.period}${snapshot.prevPeriod ? ` vs ${snapshot.prevPeriod}` : ''}: ${parts.join('; ')}.`,
		url: `/valuation/tracking?symbol=${encodeURIComponent(symbol)}`,
		tag: `holding-${symbol}-${snapshot.period}`
	};
}

/** True when a freshly fetched snapshot is a new quarter compared with what we stored. A first fetch
 *  (nothing stored) only seeds, so switching the feature on never sends a flood. */
export const isNewHoldingPeriod = (storedPeriod: string | null, fetchedPeriod: string): boolean =>
	storedPeriod != null && storedPeriod !== fetchedPeriod;
