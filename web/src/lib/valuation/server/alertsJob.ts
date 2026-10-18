import { inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { trackedCompanies } from '$lib/server/db/valuationSchema';
import { buildHoldingPayload, buildPriceAlertPayload, evaluatePriceAlert, holdingChanges, type PriceAlertKind } from '../alertRules';
import { fetchDayQuotes, QUOTE_MAX_TOKENS } from './angelone';
import { getShareholding } from './intelStore';
import { isMarketOpenIST } from './marketHours';
import { claimHoldingDelivery, claimPriceRule, lastStoredCloses, listActivePriceRules, listHoldingSettings } from './marketIntelStore';
import type { Notify } from './notify';

// Personal alerts checked from the one-minute poller: price levels and shareholding changes.

/** Live prices come in quote batches of 50; one run looks at no more symbols than this. */
const MAX_LIVE_SYMBOLS = QUOTE_MAX_TOKENS * 3;

export interface AlertDeps {
	/** Last traded price of each symbol; symbols the broker has no answer for are left out. */
	liveQuotes: (symbols: string[]) => Promise<Map<string, number>>;
	storedCloses: (symbols: string[]) => Promise<Map<string, number>>;
	marketOpen: (now: Date) => boolean;
}

export const defaultAlertDeps: AlertDeps = {
	async liveQuotes(symbols) {
		const out = new Map<string, number>();
		for (let i = 0; i < symbols.length; i += QUOTE_MAX_TOKENS) {
			const { quotes } = await fetchDayQuotes(symbols.slice(i, i + QUOTE_MAX_TOKENS));
			for (const [symbol, q] of quotes) if (q.ltp > 0) out.set(symbol, q.ltp);
		}
		return out;
	},
	storedCloses: lastStoredCloses,
	marketOpen: isMarketOpenIST
};

export interface AlertSummary {
	priceRulesChecked: number;
	priceAlertsSent: number;
	holdingAlertsSent: number;
	errors: string[];
}

export const emptyAlertSummary = (): AlertSummary => ({ priceRulesChecked: 0, priceAlertsSent: 0, holdingAlertsSent: 0, errors: [] });

/**
 * Checks every active price rule. During market hours the price is the live quote (one request per
 * 50 symbols); at other times, or if the broker is unreachable, it is the latest stored close that
 * the refresh jobs keep. A rule fires once (it is switched off when claimed) and can be re-armed.
 */
export async function runPriceAlerts(notify: Notify, now: Date, summary: AlertSummary, overrides: Partial<AlertDeps> = {}) {
	const deps = { ...defaultAlertDeps, ...overrides };
	const rules = await listActivePriceRules();
	summary.priceRulesChecked = rules.length;
	if (!rules.length) return;
	const symbols = [...new Set(rules.map((r) => r.nseSymbol))];
	const prices = await deps.storedCloses(symbols);
	if (deps.marketOpen(now)) {
		try {
			for (const [symbol, ltp] of await deps.liveQuotes(symbols.slice(0, MAX_LIVE_SYMBOLS))) prices.set(symbol, ltp);
		} catch (err) {
			summary.errors.push(`live prices: ${err instanceof Error ? err.message : String(err)} (using stored prices)`);
		}
	}
	for (const rule of rules) {
		const price = prices.get(rule.nseSymbol) ?? null;
		const spec = { id: rule.id, nseSymbol: rule.nseSymbol, kind: rule.kind as PriceAlertKind, threshold: rule.threshold, basePrice: rule.basePrice };
		if (price == null || !evaluatePriceAlert(spec, price)) continue;
		if (!(await claimPriceRule(rule.id, price, now))) continue;
		summary.priceAlertsSent++;
		await notify(rule.userId, buildPriceAlertPayload(spec, price));
	}
}

/**
 * After a company's shareholding moved to a new quarter, tells each person who tracks it and set a
 * threshold for the groups that moved by at least that much. Once per person, company and quarter.
 */
export async function runHoldingAlerts(symbols: string[], notify: Notify, summary: AlertSummary) {
	if (!symbols.length) return;
	const settings = await listHoldingSettings();
	if (!settings.length) return;
	const trackers = await db
		.select({ userId: trackedCompanies.userId, nseSymbol: trackedCompanies.nseSymbol })
		.from(trackedCompanies)
		.where(inArray(trackedCompanies.nseSymbol, symbols));
	for (const symbol of symbols) {
		const snapshot = await getShareholding(symbol);
		if (!snapshot) continue;
		for (const s of settings) {
			if (!trackers.some((t) => t.userId === s.userId && t.nseSymbol === symbol)) continue;
			const changes = holdingChanges({ promoterPp: s.promoterPp, fiiPp: s.fiiPp, diiPp: s.diiPp }, snapshot);
			if (!changes.length || !(await claimHoldingDelivery(s.userId, symbol, snapshot.period))) continue;
			summary.holdingAlertsSent++;
			await notify(s.userId, buildHoldingPayload(symbol, snapshot, changes));
		}
	}
}
