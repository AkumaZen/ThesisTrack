import { createHash } from 'node:crypto';
import { parseNseTime } from './nseTime';
import { istDay } from './boardMeetings';
import { formatQty } from './dealFormat';
import type { PushPayload } from './announcements';

// Pure helpers for bulk/block deals and shareholding: reading NSE's snapshot, the dedupe key, who is
// told, and the change between two quarters. No network or database in here.

export type DealKind = 'bulk' | 'block';

export interface ParsedDeal {
	dedupeKey: string;
	kind: DealKind;
	nseSymbol: string;
	companyName: string;
	/** IST calendar day, YYYY-MM-DD. */
	dealDate: string;
	clientName: string;
	side: 'BUY' | 'SELL';
	quantity: number;
	price: number | null;
}

const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const num = (v: unknown): number | null => {
	const n = Number(clean(v).replace(/,/g, ''));
	return clean(v) !== '' && Number.isFinite(n) ? n : null;
};

/** Same deal, same key: the date, company, client, side, quantity and price identify it (NSE has no id). */
export function dealKey(d: Omit<ParsedDeal, 'dedupeKey'>): string {
	const raw = [d.kind, d.dealDate, d.nseSymbol, d.clientName.toUpperCase(), d.side, d.quantity, d.price ?? ''].join('|');
	return 'd:' + createHash('sha1').update(raw).digest('hex').slice(0, 24);
}

/** Rows of nseindia.com/api/snapshot-capital-market-largedeal (the latest trading day's bulk and block
 *  deals). Short-selling rows have no client or price and are ignored. */
export function parseLargeDeals(payload: unknown): ParsedDeal[] {
	if (!payload || typeof payload !== 'object') return [];
	const p = payload as Record<string, unknown>;
	const out = new Map<string, ParsedDeal>();
	for (const [field, kind] of [
		['BULK_DEALS_DATA', 'bulk'],
		['BLOCK_DEALS_DATA', 'block']
	] as const) {
		const rows = p[field];
		if (!Array.isArray(rows)) continue;
		for (const r of rows as Record<string, unknown>[]) {
			if (!r || typeof r !== 'object') continue;
			const when = parseNseTime(r.date);
			const side = clean(r.buySell).toUpperCase();
			const quantity = num(r.qty);
			const nseSymbol = clean(r.symbol).toUpperCase();
			const clientName = clean(r.clientName);
			if (!when || !nseSymbol || !clientName || (side !== 'BUY' && side !== 'SELL') || !quantity || quantity <= 0) continue;
			const base: Omit<ParsedDeal, 'dedupeKey'> = {
				kind,
				nseSymbol,
				companyName: clean(r.name) || nseSymbol,
				dealDate: istDay(when),
				clientName,
				side,
				quantity,
				price: num(r.watp)
			};
			const deal = { ...base, dedupeKey: dealKey(base) };
			out.set(deal.dedupeKey, deal);
		}
	}
	return [...out.values()];
}

export function buildDealPayload(
	d: { id: number } & Pick<ParsedDeal, 'kind' | 'nseSymbol' | 'side' | 'quantity' | 'price' | 'clientName'>
): PushPayload {
	const label = d.kind === 'block' ? 'Block deal' : 'Bulk deal';
	const verb = d.side === 'BUY' ? 'bought' : 'sold';
	const price = d.price ? ` at Rs ${d.price}` : '';
	return {
		title: `[${label}] ${d.nseSymbol}: ${verb} ${formatQty(d.quantity)} shares`,
		body: `${d.clientName} ${verb} ${formatQty(d.quantity)} shares${price}.`,
		url: `/valuation/tracking?symbol=${encodeURIComponent(d.nseSymbol)}`,
		tag: `deal-${d.id}`
	};
}

/** Told once, only about deals first seen after tracking began and no older than three days. */
export function shouldNotifyDeal(dealDate: string, firstSeenAt: Date, trackedSince: Date, now: Date, maxDays = 3): boolean {
	const today = new Date(`${istDay(now)}T00:00:00Z`).getTime();
	const ageDays = (today - new Date(`${dealDate}T00:00:00Z`).getTime()) / 86_400_000;
	return firstSeenAt > trackedSince && ageDays <= maxDays;
}

/** Percentage-point change between two quarters, to two decimals; null when either side is unknown. */
export function holdingChange(latest: number | null, previous: number | null): number | null {
	return latest == null || previous == null ? null : Math.round((latest - previous) * 100) / 100;
}
