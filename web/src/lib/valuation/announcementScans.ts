import { ANNOUNCEMENT_TAGS, isAnnouncementTag, type AnnouncementTag } from './announcementTags';

// Pure helpers for the market-wide announcement feed: preset keyword scans, saved keywords, the
// feed's filters read from a URL, and trending words. No network or database in here.

export interface PresetScan {
	key: string;
	label: string;
	/** Case-insensitive phrases; an announcement matches when its subject or text contains any. */
	terms: string[];
}

// Phrases rather than single words so "order" does not match every "order of the court".
export const PRESET_SCANS: PresetScan[] = [
	{ key: 'order_win', label: 'Order win', terms: ['bagging', 'receipt of order', 'new order', 'work order', 'purchase order', 'letter of award', 'letter of intent', 'secured order', 'order worth', 'orders worth', 'order inflow', 'awarded'] },
	{ key: 'capex', label: 'Capex / expansion', terms: ['capex', 'capital expenditure', 'expansion', 'new plant', 'new facility', 'greenfield', 'brownfield', 'capacity addition', 'commissioning', 'commercial production'] },
	{ key: 'pledge', label: 'Pledge', terms: ['pledge', 'encumbrance', 'invocation', 'creation of charge'] },
	{ key: 'insolvency', label: 'Insolvency', terms: ['insolvency', 'nclt', 'ibc', 'corporate debtor', 'liquidation', 'bankruptcy', 'resolution professional'] },
	{ key: 'resignation', label: 'Resignation', terms: ['resignation', 'resigned', 'cessation'] },
	{ key: 'fund_raise', label: 'Fund raise', terms: ['fund raising', 'fund raise', 'fundraise', 'preferential', 'qip', 'rights issue', 'warrants', 'raising of funds', 'non-convertible debentures', 'ncd'] },
	{ key: 'acquisition', label: 'Acquisition', terms: ['acquisition', 'acquire', 'acquires', 'takeover', 'merger', 'amalgamation', 'stake in', 'joint venture'] },
	{ key: 'credit_rating', label: 'Credit rating', terms: ['credit rating', 'rating action', 'crisil', 'icra', 'care ratings', 'india ratings', 'brickwork', 'acuite', 'rating reaffirmed', 'rating upgrade', 'rating downgrade'] }
];

export const presetScan = (key: string | null | undefined): PresetScan | null =>
	PRESET_SCANS.find((s) => s.key === key) ?? null;

/** True when `text` contains any of the phrases (case-insensitive). */
export function matchesAny(text: string, terms: string[]): boolean {
	const t = text.toLowerCase();
	return terms.some((term) => term && t.includes(term.toLowerCase()));
}

export const MAX_KEYWORD_LENGTH = 60;
export const MAX_SAVED_KEYWORDS = 20;

/** A keyword as stored: spaces collapsed, 2 to 60 characters; null when it is not usable. */
export function normaliseKeyword(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const k = raw.replace(/\s+/g, ' ').trim();
	return k.length >= 2 && k.length <= MAX_KEYWORD_LENGTH ? k : null;
}

/** SQL LIKE pattern matching `term` anywhere, with the wildcard characters escaped. */
export const likeContains = (term: string): string => '%' + term.replace(/[\\%_]/g, (c) => '\\' + c) + '%';

export const FEED_PAGE_SIZE = 40;

export interface FeedFilters {
	/** Company ticker or part of a name. */
	company: string;
	tag: AnnouncementTag | null;
	/** Inclusive IST calendar days, YYYY-MM-DD. */
	from: string | null;
	to: string | null;
	scan: PresetScan | null;
	/** Free-text phrase typed by the person, or one of their saved keywords. */
	keyword: string | null;
	page: number;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const validDay = (v: string | null): string | null => {
	if (!v || !DAY_RE.test(v)) return null;
	const d = new Date(`${v}T00:00:00Z`);
	return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
};

/** Filters from the page URL; anything unreadable falls back to "no filter". */
export function parseFeedFilters(params: URLSearchParams): FeedFilters {
	const tag = params.get('tag');
	const page = Number.parseInt(params.get('page') ?? '1', 10);
	return {
		company: (params.get('company') ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
		tag: isAnnouncementTag(tag) ? tag : null,
		from: validDay(params.get('from')),
		to: validDay(params.get('to')),
		scan: presetScan(params.get('scan')),
		keyword: normaliseKeyword(params.get('q')),
		page: Number.isFinite(page) && page >= 1 ? Math.min(page, 500) : 1
	};
}

/** Query string for the filters (page omitted when 1), for links that keep the current filters. */
export function feedQuery(f: Partial<FeedFilters>, page = f.page ?? 1): string {
	const p = new URLSearchParams();
	if (f.company) p.set('company', f.company);
	if (f.tag) p.set('tag', f.tag);
	if (f.from) p.set('from', f.from);
	if (f.to) p.set('to', f.to);
	if (f.scan) p.set('scan', f.scan.key);
	if (f.keyword) p.set('q', f.keyword);
	if (page > 1) p.set('page', String(page));
	const s = p.toString();
	return s ? `?${s}` : '';
}

export const feedTags: readonly AnnouncementTag[] = ANNOUNCEMENT_TAGS;

// Words that say nothing about what happened. Short words and numbers are dropped separately.
export const STOPWORD_LIST: string[] = (
		'about above after again against also another because been before being below between both company could does during each from further have having here into more most other over regulation regulations said same securities shares share should than that their them then there these they this those through under until upon very what when where which while will with within would your limited ltd has informed exchange pursuant disclosure disclosures requirements listing obligations sebi lodr board directors meeting held intimation attached attachment copy dated date please find enclosed regarding reg per cent lakh crore rupees india indian'
	).split(' ');
const STOPWORDS = new Set(STOPWORD_LIST);

export interface WordCount {
	word: string;
	current: number;
	previous: number;
}

export interface TrendingWord extends WordCount {
	/** Current count minus the previous week's. */
	change: number;
}

/** Most frequent meaningful words of the last week with how they moved against the week before.
 *  Input comes from SQL (one row per word); stopwords, digits and rare words are dropped. */
export function pickTrending(rows: WordCount[], limit = 20): TrendingWord[] {
	return rows
		.filter((r) => r.word.length >= 4 && /^[a-z][a-z-]*$/.test(r.word) && !STOPWORDS.has(r.word) && r.current >= 3)
		.map((r) => ({ ...r, change: r.current - r.previous }))
		.sort((a, b) => b.current - a.current || b.change - a.change || a.word.localeCompare(b.word))
		.slice(0, limit);
}
