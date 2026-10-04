// Per-user preferences: which watchlist columns to show and in what order, the default sort and
// view, and the last visit (for "changed since you last looked"). Stored as one JSON document per
// user; everything read back goes through sanitizePrefs, so a stale or hand-edited document can
// never break the page - unknown values fall back to the defaults.

export const WATCHLIST_COLUMNS = [
	{ id: 'cmp', label: 'CMP', help: 'Current market price' },
	{ id: 'target', label: 'Target', help: 'Base-case FY+2E implied price' },
	{ id: 'fairValue', label: 'Fair value', help: 'The team’s set % of the target (Settings)' },
	{ id: 'upside', label: 'Upside', help: 'From CMP to the target' },
	{ id: 'baseCagr', label: 'Base CAGR (2yr)', help: 'Annual return to the Base FY+2E price' },
	{ id: 'bullCagr', label: 'Bull CAGR (2yr)', help: 'Annual return to the Bull FY+2E price' },
	{ id: 'bearCagr', label: 'Bear CAGR (2yr)', help: 'Annual return to the Bear FY+2E price' },
	{ id: 'marketCap', label: 'Market cap', help: 'In ₹ crore' },
	{ id: 'trend', label: 'Trend', help: 'Last ~90 days of closing prices' },
	{ id: 'status', label: 'Review', help: 'Review status of the valuation' },
	{ id: 'coverage', label: 'Analyst', help: 'Who covers the company' },
	{ id: 'updated', label: 'Updated', help: 'When the valuation was last saved, and by whom' }
] as const;

export type ColumnId = (typeof WATCHLIST_COLUMNS)[number]['id'];
export const COLUMN_IDS: ColumnId[] = WATCHLIST_COLUMNS.map((c) => c.id);

/** What the watchlist showed before columns were configurable. */
export const DEFAULT_COLUMNS: ColumnId[] = [
	'cmp',
	'target',
	'fairValue',
	'upside',
	'baseCagr',
	'bullCagr',
	'bearCagr',
	'trend',
	'updated'
];

export const SORT_KEYS = [
	'symbol',
	'cmp',
	'marketCap',
	'target',
	'fairValue',
	'upside',
	'bearCagr',
	'baseCagr',
	'bullCagr',
	'lastUpdated',
	'status',
	'coverage'
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/** 'all' = every saved valuation, 'mine' = my coverage, 'list:<id>' = a named watchlist. */
export type WatchlistView = 'all' | 'mine' | `list:${number}`;

export interface UserPrefs {
	watchlist: {
		columns: ColumnId[];
		sort: { key: SortKey; dir: 'asc' | 'desc' };
		view: WatchlistView;
	};
	/** Metrics shown on each sector rotation card (see SECTOR_CARD_METRICS). */
	sectorCard: { metrics: SectorCardMetric[] };
	/** Previous visit to the watchlist, for highlighting what teammates changed since. */
	lastWatchlistVisit: number | null;
}

export const SECTOR_CARD_METRICS = [
	{ id: '1w', label: '1W', field: 'return1w', help: 'Return over 1 week' },
	{ id: '1m', label: '1M', field: 'return1m', help: 'Return over 1 month' },
	{ id: '3m', label: '3M', field: 'return3m', help: 'Return over 3 months' },
	{ id: '6m', label: '6M', field: 'return6m', help: 'Return over 6 months' },
	{ id: 'rs1w', label: 'RS(1W)', field: 'rs1w', help: 'Return minus Nifty, 1 week' },
	{ id: 'rs1m', label: 'RS(1M)', field: 'rs1m', help: 'Return minus Nifty, 1 month' },
	{ id: 'rs3m', label: 'RS(3M)', field: 'rs3m', help: 'Return minus Nifty, 3 months' },
	{ id: 'rs6m', label: 'RS(6M)', field: 'rs6m', help: 'Return minus Nifty, 6 months' }
] as const;
export type SectorCardMetric = (typeof SECTOR_CARD_METRICS)[number]['id'];
/** What every card showed before the metrics were configurable. */
export const DEFAULT_SECTOR_CARD_METRICS: SectorCardMetric[] = ['1w', '1m', '3m', '6m', 'rs1m'];

export const DEFAULT_PREFS: UserPrefs = {
	watchlist: { columns: DEFAULT_COLUMNS, sort: { key: 'upside', dir: 'desc' }, view: 'all' },
	sectorCard: { metrics: DEFAULT_SECTOR_CARD_METRICS },
	lastWatchlistVisit: null
};

function pickList<T extends string>(raw: unknown, allowed: readonly T[], fallback: T[]): T[] {
	if (!Array.isArray(raw)) return [...fallback];
	const out: T[] = [];
	for (const v of raw) if (allowed.includes(v as T) && !out.includes(v as T)) out.push(v as T);
	return out.length ? out : [...fallback];
}

function isView(v: unknown): v is WatchlistView {
	return v === 'all' || v === 'mine' || (typeof v === 'string' && /^list:[1-9]\d{0,9}$/.test(v));
}

/** Any input -> a complete, valid UserPrefs (defaults wherever the input is missing or wrong). */
export function sanitizePrefs(raw: unknown): UserPrefs {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const wl = (r.watchlist && typeof r.watchlist === 'object' ? r.watchlist : {}) as Record<
		string,
		unknown
	>;
	const sort = (wl.sort && typeof wl.sort === 'object' ? wl.sort : {}) as Record<string, unknown>;
	const card = (r.sectorCard && typeof r.sectorCard === 'object' ? r.sectorCard : {}) as Record<
		string,
		unknown
	>;
	const visit = r.lastWatchlistVisit;
	return {
		watchlist: {
			columns: pickList(wl.columns, COLUMN_IDS, DEFAULT_COLUMNS),
			sort: {
				key: SORT_KEYS.includes(sort.key as SortKey)
					? (sort.key as SortKey)
					: DEFAULT_PREFS.watchlist.sort.key,
				dir: sort.dir === 'asc' || sort.dir === 'desc' ? sort.dir : DEFAULT_PREFS.watchlist.sort.dir
			},
			view: isView(wl.view) ? wl.view : 'all'
		},
		sectorCard: {
			metrics: pickList(
				card.metrics,
				SECTOR_CARD_METRICS.map((m) => m.id),
				DEFAULT_SECTOR_CARD_METRICS
			)
		},
		lastWatchlistVisit:
			typeof visit === 'number' && Number.isFinite(visit) && visit > 0 ? visit : null
	};
}

/** Applies a partial update (one level deep per section) and re-validates the result. */
export function mergePrefs(current: UserPrefs, patch: unknown): UserPrefs {
	const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
	const section = (k: string) =>
		p[k] && typeof p[k] === 'object' ? (p[k] as Record<string, unknown>) : {};
	return sanitizePrefs({
		watchlist: { ...current.watchlist, ...section('watchlist') },
		sectorCard: { ...current.sectorCard, ...section('sectorCard') },
		lastWatchlistVisit:
			'lastWatchlistVisit' in p ? p.lastWatchlistVisit : current.lastWatchlistVisit
	});
}

/** Moves a column one place left (-1) or right (+1) within the visible list. Pure. */
export function moveColumn(columns: ColumnId[], id: ColumnId, delta: -1 | 1): ColumnId[] {
	const i = columns.indexOf(id);
	const j = i + delta;
	if (i < 0 || j < 0 || j >= columns.length) return columns;
	const next = [...columns];
	[next[i], next[j]] = [next[j], next[i]];
	return next;
}
