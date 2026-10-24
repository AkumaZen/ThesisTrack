// Guest mode: anyone can explore the app without an account, read only. Pure helpers shared by the
// access policy, the hook, the client router and the UI - no I/O. A guest is a request that carries
// the (unsigned) tt_guest cookie and no real session; it can only ever do what this file allows.
import type { SessionUser } from './auth';

export const GUEST_COOKIE = 'tt_guest';
export const GUEST_TTL_SECONDS = 30 * 24 * 60 * 60;

/** The stand-in "user" for a guest. Id 0 never matches a real account, so every per-person store
 *  (preferences, lists, alerts) simply comes back empty. */
export const GUEST_USER: SessionUser = {
	id: 0,
	email: '',
	username: 'Guest',
	role: 'guest',
	mustChangePassword: false
};

export const isGuest = (user: { role?: string } | null | undefined): boolean => user?.role === 'guest';

export interface LockedFeature {
	key: string;
	title: string;
	summary: string;
	points: string[];
	/** Page prefixes that open this feature's preview instead of the feature. */
	pages: string[];
}

/** Features a guest sees previewed but cannot use. */
export const LOCKED_FEATURES: LockedFeature[] = [
	{
		key: 'master-tracker',
		title: 'Master Tracker and AI research',
		summary:
			'One page per company that reads the latest concalls and filings and keeps the guidance, the numbers and the open questions together.',
		points: [
			'AI reads each concall and pulls out what management promised, quarter by quarter',
			'Guidance is checked against the reported results, so misses are obvious',
			'Annual reports and presentations are fetched and summarised for you'
		],
		pages: ['/valuation/master-tracker']
	},
	{
		key: 'alerts',
		title: 'Alerts and tracking',
		summary: 'Follow the companies you care about and get told the moment something happens.',
		points: [
			'Announcement alerts with a short AI summary, by email, push or Telegram',
			'Price alerts when a stock crosses your fair value or a level you set',
			'A personal inbox of everything that needs a look'
		],
		pages: ['/valuation/alerts', '/valuation/price-alerts', '/valuation/tracking']
	},
	{
		key: 'lists',
		title: 'Watchlists',
		summary: 'Your own watchlists, with colour flags and notes, shared with the team.',
		points: [
			'Group companies into sections and keep them sorted your way',
			'Flag companies with a colour and a short label',
			'Your columns, sort and view are remembered'
		],
		pages: ['/valuation/lists']
	},
	{
		key: 'scans',
		title: 'Saved scans',
		summary: 'Save a breakout scan once and come back to it, or share it with the team.',
		points: [
			'Save any scanner filter and re-run it with one click',
			'See what changed since the last time you looked',
			'Share a scan with a link'
		],
		pages: ['/valuation/scans']
	},
	{
		key: 'settings',
		title: 'Settings',
		summary: 'Tune the app to how you work.',
		points: [
			'Choose the fair value and margin of safety the team uses',
			'Set what counts as a big move in your holdings',
			'Control which alerts reach you'
		],
		pages: ['/valuation/settings']
	},
	{
		key: 'team-review',
		title: 'Team review, scorecard and guidance',
		summary: 'How the team keeps every thesis honest over time.',
		points: [
			'A review queue that surfaces theses that have gone stale',
			'A scorecard of calls that worked and calls that did not',
			'Management guidance tracked against what was actually reported'
		],
		pages: ['/review', '/scorecard', '/guidance']
	},
	{
		key: 'ai-import',
		title: 'AI thesis import',
		summary: 'Turn a research note into a structured thesis in minutes.',
		points: [
			'Paste a note or upload a document and get the seven pillars drafted',
			'Review every proposed change before it is saved',
			'Every version is kept, so nothing is ever overwritten'
		],
		pages: ['/ingest']
	},
	{
		key: 'sectors',
		title: 'Sector map',
		summary: 'See how every company in your coverage fits into its industry.',
		points: [
			'Industries, niches and operating models in one map',
			'Compare companies inside the same niche',
			'Add reference companies for a sector'
		],
		pages: ['/sectors']
	}
];

const startsWithPath = (pathname: string, prefix: string) =>
	pathname === prefix || pathname.startsWith(prefix + '/');

const hasTraversal = (pathname: string) => pathname.split('/').includes('..');

export const lockedFeatureByKey = (key: string): LockedFeature | undefined =>
	LOCKED_FEATURES.find((f) => f.key === key);

export function lockedFeatureForPath(pathname: string): LockedFeature | undefined {
	if (hasTraversal(pathname)) return undefined;
	return LOCKED_FEATURES.find((f) => f.pages.some((p) => startsWithPath(pathname, p)));
}

/** Exact pages: a prefix here would also open /valuation/lists and friends. */
const GUEST_EXACT_PAGES = ['/', '/valuation'];

const GUEST_PAGE_PREFIXES = [
	'/company',
	'/locked',
	'/valuation/company',
	'/valuation/compare',
	'/valuation/filings',
	'/valuation/concalls',
	'/valuation/announcements',
	'/valuation/results',
	'/valuation/insider-trades',
	'/valuation/corporate-actions',
	'/valuation/red-flags',
	'/valuation/breadth',
	'/valuation/returns',
	'/valuation/sector-rotation',
	'/valuation/stage-scanner'
];

export function guestMayOpenPage(pathname: string): boolean {
	if (hasTraversal(pathname)) return false;
	return GUEST_EXACT_PAGES.includes(pathname) || GUEST_PAGE_PREFIXES.some((p) => startsWithPath(pathname, p));
}

/** Read-only API areas a guest may call (deny by default). /api/tables and /api/notes are
 *  deliberately absent: they are keyed by table or note id, so they would bypass showcase gating. */
const GUEST_API_PREFIXES = [
	'/api/auth/me',
	'/api/companies',
	'/api/taxonomy',
	'/api/metrics',
	'/api/valuation/symbol-search',
	'/api/valuation/valuations',
	'/api/valuation/company',
	'/api/valuation/company-filings',
	'/api/valuation/compare',
	'/api/valuation/concalls/company',
	'/api/valuation/sparklines',
	'/api/valuation/strength',
	'/api/valuation/presets',
	'/api/valuation/templates',
	'/api/valuation/sector-rotation',
	'/api/valuation/sector-rotation-major',
	'/api/valuation/sector-symbols',
	'/api/valuation/stage-scan',
	'/api/valuation/alerts/unread-count'
];

/** Inside an allowed area but still off limits: personal, admin-ish or data-loading endpoints. */
const GUEST_API_DENIED = [
	'/api/valuation/valuations/removed',
	'/api/valuation/strength/prefs',
	'/api/valuation/strength/rules',
	'/api/valuation/search/all'
];

/** /api/valuation/company/<symbol>/<sub> routes that load data or expose team internals. */
const GUEST_COMPANY_DENIED_SUBROUTES = ['depth', 'refresh-price', 'refresh-series', 'status', 'coverage'];

export function guestMayCallApi(pathname: string, method: string): boolean {
	if (method !== 'GET' && method !== 'HEAD') return false;
	if (hasTraversal(pathname)) return false;
	if (!GUEST_API_PREFIXES.some((p) => startsWithPath(pathname, p))) return false;
	if (GUEST_API_DENIED.some((p) => startsWithPath(pathname, p))) return false;
	const sub = /^\/api\/valuation\/company\/[^/]+\/([^/]+)/.exec(pathname)?.[1];
	if (sub && GUEST_COMPANY_DENIED_SUBROUTES.includes(sub)) return false;
	return true;
}

/** Where a guest asking for this page should land: the preview of a locked feature, nowhere
 *  (null: the page is open to guests) or the sign-in page for everything else. */
export function guestPageRedirect(pathname: string, search = ''): string | null {
	const locked = lockedFeatureForPath(pathname);
	if (locked) return `/locked/${locked.key}`;
	if (guestMayOpenPage(pathname)) return null;
	return `/login?next=${encodeURIComponent(pathname + search)}`;
}

export type ShowcaseTarget = { kind: 'company'; id: string } | { kind: 'symbol'; symbol: string };

/** A malformed escape decodes to '' - which is never showcased, so the request is refused. */
const decode = (part: string): string => {
	try {
		return decodeURIComponent(part);
	} catch {
		return '';
	}
};

/** Which showcase check a guest API read needs: a thesis company by id, or a valuation symbol. */
export function guestShowcaseTarget(pathname: string): ShowcaseTarget | null {
	let m = /^\/api\/companies\/([^/]+)(?:\/|$)/.exec(pathname);
	if (m) return { kind: 'company', id: decode(m[1]) };
	m = /^\/api\/valuation\/valuations\/([^/]+)(?:\/|$)/.exec(pathname);
	if (m) return { kind: 'symbol', symbol: decode(m[1]).toUpperCase() };
	m = /^\/api\/valuation\/company\/([^/]+)\/(?:team|notes)(?:\/|$)/.exec(pathname);
	if (m) return { kind: 'symbol', symbol: decode(m[1]).toUpperCase() };
	return null;
}
