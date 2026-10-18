import { createHash } from 'node:crypto';
import { parseNseTime } from './nseTime';
import { validDay } from './announcementScans';

// Pure helpers for NSE's insider trading (SEBI PIT) and substantial acquisition (SAST Reg 29)
// disclosures: reading the exchange's rows, the page filters, and a per-company holding timeline.
// No network or database in here.

const text = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
/** NSE writes "-" or null where it has nothing; both mean "no value". */
const clean = (v: unknown): string => {
	const t = text(v);
	return t === '-' ? '' : t;
};
const num = (v: unknown): number | null => {
	const t = clean(v).replace(/,/g, '');
	if (!t) return null;
	const n = Number(t);
	return Number.isFinite(n) ? n : null;
};

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

/** "13-Feb-2026" -> "2026-02-13"; null for anything else. */
export function parseNseDay(raw: unknown): string | null {
	const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(clean(raw));
	const month = m ? MONTHS[m[2].toLowerCase()] : undefined;
	return m && month ? `${m[3]}-${month}-${m[1].padStart(2, '0')}` : null;
}

const hash = (...parts: unknown[]) => 'h:' + createHash('sha1').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 24);

const rowsOf = (payload: unknown): Record<string, unknown>[] => {
	const data = Array.isArray(payload) ? payload : (payload as { data?: unknown } | null)?.data;
	return Array.isArray(data) ? data.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : [];
};

// ---- insider trading (PIT) ----

export type InsiderSide = 'buy' | 'sell' | 'pledge' | 'other';

export interface ParsedInsiderTrade {
	dedupeKey: string;
	nseSymbol: string;
	companyName: string;
	personName: string;
	personCategory: string;
	securityType: string;
	/** NSE's own wording: Buy, Sell, Pledge, Pledge Revoke, ... */
	txnType: string;
	mode: string;
	quantity: number;
	/** Rupees. */
	value: number;
	beforeShares: number | null;
	beforePct: number | null;
	afterShares: number | null;
	afterPct: number | null;
	fromDate: string | null;
	toDate: string | null;
	broadcastAt: Date;
	sourceUrl: string | null;
}

export function sideOf(txnType: string): InsiderSide {
	const t = txnType.toLowerCase();
	if (t.startsWith('buy') || t === 'acquisition') return 'buy';
	if (t.startsWith('sell') || t === 'disposal') return 'sell';
	if (t.includes('pledge') || t.includes('invoke') || t.includes('revoke')) return 'pledge';
	return 'other';
}

export function parseInsiderTrades(payload: unknown): ParsedInsiderTrade[] {
	const out: ParsedInsiderTrade[] = [];
	for (const r of rowsOf(payload)) {
		const nseSymbol = text(r.symbol).toUpperCase();
		const personName = clean(r.acqName);
		const broadcastAt = parseNseTime(r.date);
		if (!nseSymbol || !personName || !broadcastAt) continue;
		const txnType = clean(r.tdpTransactionType) || 'Other';
		// Derivative rows carry buy/sell lots instead of a share count.
		const quantity = num(r.secAcq) ?? num(r.buyQuantity) ?? num(r.sellquantity) ?? 0;
		const value = num(r.secVal) ?? num(r.buyValue) ?? num(r.sellValue) ?? 0;
		const xbrl = text(r.xbrl);
		const fromDate = parseNseDay(r.acqfromDt);
		out.push({
			dedupeKey: hash('pit', nseSymbol, personName, text(r.date), fromDate, quantity, value, txnType, clean(r.acqMode), text(r.did)),
			nseSymbol,
			companyName: text(r.company) || nseSymbol,
			personName,
			personCategory: clean(r.personCategory) || 'Other',
			securityType: clean(r.secType),
			txnType,
			mode: clean(r.acqMode),
			quantity,
			value,
			beforeShares: num(r.befAcqSharesNo),
			beforePct: num(r.befAcqSharesPer),
			afterShares: num(r.afterAcqSharesNo),
			afterPct: num(r.afterAcqSharesPer),
			fromDate,
			toDate: parseNseDay(r.acqtoDt),
			broadcastAt,
			sourceUrl: /^https?:\/\//i.test(xbrl) ? xbrl : null
		});
	}
	return out;
}

// ---- substantial acquisitions (SAST) ----

export interface ParsedSast {
	dedupeKey: string;
	nseSymbol: string;
	companyName: string;
	acquirerName: string;
	/** Acquisition, Disposal, ... as the exchange words it. */
	action: string;
	securityType: string;
	mode: string;
	regulation: string;
	isPromoter: boolean;
	sharesAcquired: number | null;
	sharesSold: number | null;
	sharesAfter: number | null;
	pctAcquired: number | null;
	pctSold: number | null;
	pctAfter: number | null;
	periodText: string;
	disclosedAt: Date;
	sourceUrl: string | null;
}

export function parseSastDisclosures(payload: unknown): ParsedSast[] {
	const out: ParsedSast[] = [];
	for (const r of rowsOf(payload)) {
		const nseSymbol = text(r.symbol).toUpperCase();
		const acquirerName = clean(r.acquirerName);
		const disclosedAt = parseNseTime(r.timestamp) ?? parseNseTime(r.sysTime);
		if (!nseSymbol || !acquirerName || !disclosedAt) continue;
		const sharesAcquired = num(r.noOfShareAcq);
		const sharesSold = num(r.noOfShareSale);
		const attachment = text(r.attachement);
		out.push({
			dedupeKey: hash('sast', nseSymbol, text(r.application_no), acquirerName, sharesAcquired, sharesSold, num(r.noOfShareAft), text(r.acquirerDate)),
			nseSymbol,
			companyName: text(r.company) || nseSymbol,
			acquirerName,
			action: clean(r.acqSaleType) || 'Other',
			securityType: clean(r.acqType),
			mode: clean(r.acquisitionMode),
			regulation: clean(r.regType),
			isPromoter: text(r.promoterType).toUpperCase() === 'Y',
			sharesAcquired,
			sharesSold,
			sharesAfter: num(r.noOfShareAft),
			pctAcquired: num(r.totAcqShare),
			pctSold: num(r.totSaleShare),
			pctAfter: num(r.totAftShare),
			periodText: clean(r.acquirerDate),
			disclosedAt,
			sourceUrl: /^https?:\/\//i.test(attachment) ? attachment : null
		});
	}
	return out;
}

// ---- page filters ----

export const PERSON_CATEGORIES = ['Promoters', 'Promoter Group', 'Director', 'Key Managerial Personnel', 'Employees/Designated Employees', 'Immediate relative', 'Other'] as const;
export const INSIDER_PAGE_SIZE = 40;

export interface InsiderFilters {
	company: string;
	/** Part of the person's (shareholder's) name. */
	person: string;
	category: string | null;
	side: InsiderSide | null;
	/** Smallest trade value, in rupees. */
	minValue: number | null;
	from: string | null;
	to: string | null;
	page: number;
}

export function parseInsiderFilters(params: URLSearchParams): InsiderFilters {
	const category = params.get('category') ?? '';
	const side = params.get('side');
	const minLakh = Number(params.get('minLakh'));
	const page = Number.parseInt(params.get('page') ?? '1', 10);
	return {
		company: text(params.get('company')).slice(0, 60),
		person: text(params.get('person')).slice(0, 60),
		category: (PERSON_CATEGORIES as readonly string[]).includes(category) ? category : null,
		side: side === 'buy' || side === 'sell' || side === 'pledge' ? side : null,
		minValue: Number.isFinite(minLakh) && minLakh > 0 ? Math.round(minLakh * 100_000) : null,
		from: validDay(params.get('from')),
		to: validDay(params.get('to')),
		page: Number.isFinite(page) && page >= 1 ? Math.min(page, 500) : 1
	};
}

/** The `txn_type` values that count as a side, for the SQL filter. */
export function txnTypesFor(side: InsiderSide): string[] {
	if (side === 'buy') return ['Buy', 'Acquisition'];
	if (side === 'sell') return ['Sell', 'Disposal'];
	return ['Pledge', 'Pledge Revoke', 'Pledge Invoke', 'Revoke', 'Invoke'];
}

export function insiderQuery(f: Partial<InsiderFilters>, page = f.page ?? 1, tab: 'sast' | null = null): string {
	const p = new URLSearchParams();
	if (tab) p.set('tab', tab);
	if (f.company) p.set('company', f.company);
	if (f.person) p.set('person', f.person);
	if (f.category) p.set('category', f.category);
	if (f.side) p.set('side', f.side);
	if (f.minValue) p.set('minLakh', String(f.minValue / 100_000));
	if (f.from) p.set('from', f.from);
	if (f.to) p.set('to', f.to);
	if (page > 1) p.set('page', String(page));
	const s = p.toString();
	return s ? `?${s}` : '';
}

// ---- per-company holding timeline ----

export interface HoldingEvent {
	at: string;
	source: 'PIT' | 'SAST';
	person: string;
	category: string;
	action: string;
	/** Shares bought (+) or sold (-); null when the filing does not say. */
	shares: number | null;
	/** The person's holding as a percent of the company after the event. */
	afterPct: number | null;
	/** Change in that percent caused by the event, in percentage points. */
	changePp: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Insider trades and SAST filings of one company as one list, newest first. */
export function holdingTimeline(
	trades: Pick<ParsedInsiderTrade, 'personName' | 'personCategory' | 'txnType' | 'quantity' | 'beforePct' | 'afterPct' | 'broadcastAt'>[],
	sast: Pick<ParsedSast, 'acquirerName' | 'isPromoter' | 'action' | 'sharesAcquired' | 'sharesSold' | 'pctAcquired' | 'pctSold' | 'pctAfter' | 'disclosedAt'>[]
): HoldingEvent[] {
	const events: HoldingEvent[] = [];
	for (const t of trades) {
		const side = sideOf(t.txnType);
		events.push({
			at: t.broadcastAt.toISOString(),
			source: 'PIT',
			person: t.personName,
			category: t.personCategory,
			action: t.txnType,
			shares: side === 'buy' ? t.quantity : side === 'sell' ? -t.quantity : null,
			afterPct: t.afterPct,
			changePp: t.afterPct != null && t.beforePct != null ? round2(t.afterPct - t.beforePct) : null
		});
	}
	for (const s of sast) {
		const acquired = s.pctAcquired ?? 0;
		const sold = s.pctSold ?? 0;
		events.push({
			at: s.disclosedAt.toISOString(),
			source: 'SAST',
			person: s.acquirerName,
			category: s.isPromoter ? 'Promoters' : 'Acquirer',
			action: s.action,
			shares: s.sharesAcquired != null || s.sharesSold != null ? (s.sharesAcquired ?? 0) - (s.sharesSold ?? 0) : null,
			afterPct: s.pctAfter,
			changePp: s.pctAcquired != null || s.pctSold != null ? round2(acquired - sold) : null
		});
	}
	return events.sort((a, b) => b.at.localeCompare(a.at));
}
