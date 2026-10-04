// Remembers where someone was in a view, so they can pick up where they left off.
//
// Only non-sensitive UI state lives here: sort, period, view mode, which panels are open, the
// chart range and the scroll position. Market data, credentials and saved alert rules stay in
// their own server-side storage.
//
//  - sessionStorage: the temporary browsing state of this tab (survives refresh and back).
//  - localStorage:   lasting display preferences and the last place someone visited.
//
// Every key carries the signed-in person's id and a version, so one person never reads another's
// settings on a shared browser, and a change of shape simply discards what was saved before.
// Anything read back is validated field by field; a bad or outdated value falls back to the default.

const PREFIX = 'tt:v1:';
const MAX_VISIT_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
	readonly length: number;
	key(index: number): string | null;
}
export interface Stores {
	session: StorageLike | null;
	local: StorageLike | null;
}

/** The browser's storages, or nulls where they are missing or blocked (private windows, SSR). */
export function browserStores(): Stores {
	const pick = (name: 'sessionStorage' | 'localStorage'): StorageLike | null => {
		try {
			return typeof window === 'undefined' ? null : window[name];
		} catch {
			return null;
		}
	};
	return { session: pick('sessionStorage'), local: pick('localStorage') };
}

// ---- field specs ------------------------------------------------------------------------

export interface FieldSpec<T> {
	fallback: T;
	/** Returns the cleaned value, or undefined when the raw one is not acceptable. */
	parse: (raw: unknown) => T | undefined;
	/** Also kept across sessions as a lasting display preference. */
	lasting?: boolean;
	/** The URL query parameter that can set it explicitly (wins over anything saved). */
	url?: string;
}
type Opts = { lasting?: boolean; url?: string };

export const field = {
	oneOf<T extends string>(values: readonly T[], fallback: T, opts: Opts = {}): FieldSpec<T> {
		return {
			fallback,
			parse: (raw) => (typeof raw === 'string' && (values as readonly string[]).includes(raw) ? (raw as T) : undefined),
			...opts
		};
	},
	flag(fallback: boolean, opts: Opts = {}): FieldSpec<boolean> {
		return { fallback, parse: (raw) => (typeof raw === 'boolean' ? raw : undefined), ...opts };
	},
	int(min: number, max: number, fallback: number, opts: Opts = {}): FieldSpec<number> {
		return {
			fallback,
			parse: (raw) =>
				typeof raw === 'number' && Number.isInteger(raw) && raw >= min && raw <= max ? raw : undefined,
			...opts
		};
	}
};

export type Schema = Record<string, FieldSpec<never> | FieldSpec<unknown>>;
export type StateOf<S extends Schema> = {
	[K in keyof S]: S[K] extends FieldSpec<infer T> ? T : never;
};

export const SECTOR_SORT_KEYS = ['rs1m', 'return1w', 'return1m', 'return3m', 'return6m', 'label'] as const;
export const TIMEFRAME_KEYS = ['1W', '1M', '3M', '6M', '1Y'] as const;
export const CHART_RANGE_KEYS = ['3M', '6M', '1Y'] as const;

const scrollY = field.int(0, 10_000_000, 0);
/** How many cards a list shows per page, and which page this tab is on. */
export const PAGE_SIZES = [12, 24, 48, 96] as const;
export const DEFAULT_PAGE_SIZE = 24;
const pageSize: FieldSpec<number> = {
	fallback: DEFAULT_PAGE_SIZE,
	parse: (raw) => (typeof raw === 'number' && (PAGE_SIZES as readonly number[]).includes(raw) ? raw : undefined),
	lasting: true,
	url: 'size'
};
const pageNo = field.int(1, 1000, 1, { url: 'page' });
/** A collapsible panel: 'auto' follows the panel's own default until the person opens or closes it. */
export const PANEL_STATES = ['auto', 'open', 'closed'] as const;
export type PanelState = (typeof PANEL_STATES)[number];
const panel = () => field.oneOf(PANEL_STATES, 'auto');

/**
 * What each view remembers. `sector` covers the list of all sectors and one sector's subsectors,
 * `subsector` the companies in one subsector, `company` a single company.
 */
export const VIEWS = {
	sector: {
		sort: field.oneOf(SECTOR_SORT_KEYS, 'rs1m', { lasting: true, url: 'sort' }),
		dir: field.oneOf(['asc', 'desc'] as const, 'desc', { lasting: true, url: 'dir' }),
		strength: panel(),
		importer: field.flag(false),
		page: pageNo,
		pageSize,
		scrollY
	},
	subsector: {
		timeframe: field.oneOf(TIMEFRAME_KEYS, '3M', { lasting: true, url: 'tf' }),
		strength: panel(),
		page: pageNo,
		pageSize,
		scrollY
	},
	company: {
		chartRange: field.oneOf(CHART_RANGE_KEYS, '1Y', { lasting: true, url: 'range' }),
		strength: panel(),
		integrity: field.flag(false),
		scrollY
	}
} as const;
export type ViewName = keyof typeof VIEWS;
export type ViewState<V extends ViewName> = StateOf<(typeof VIEWS)[V]>;

export function defaultsOf<V extends ViewName>(view: V): ViewState<V> {
	const out: Record<string, unknown> = {};
	for (const [k, spec] of Object.entries(VIEWS[view] as Schema))
		out[k] = spec.fallback;
	return out as ViewState<V>;
}

// ---- keys -------------------------------------------------------------------------------

const idOk = (userId: number | null | undefined): userId is number =>
	typeof userId === 'number' && Number.isInteger(userId) && userId > 0;
const sessionKey = (uid: number, view: ViewName, scope: string) => `${PREFIX}${uid}:${view}:${scope}:s`;
const localKey = (uid: number, view: ViewName) => `${PREFIX}${uid}:${view}:l`;
const visitKey = (uid: number) => `${PREFIX}${uid}:last`;
const originKey = (uid: number, symbol: string) => `${PREFIX}${uid}:origin:${symbol}`;

function readJson(store: StorageLike | null, key: string): Record<string, unknown> | null {
	if (!store) return null;
	try {
		const text = store.getItem(key);
		if (!text) return null;
		const parsed: unknown = JSON.parse(text);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
	} catch {
		// unreadable: treated as nothing saved, and replaced on the next write
	}
	try {
		store.removeItem(key);
	} catch {
		// nothing more to do
	}
	return null;
}
function writeJson(store: StorageLike | null, key: string, value: unknown) {
	if (!store) return;
	try {
		store.setItem(key, JSON.stringify(value));
	} catch {
		// storage full or blocked: the view just will not be remembered
	}
}
function remove(store: StorageLike | null, key: string) {
	try {
		store?.removeItem(key);
	} catch {
		// ignore
	}
}

/** The saved values of an entry, cleaned. A different version, or a bad field, is dropped. */
function cleanEntry(entry: Record<string, unknown> | null, schema: Schema, onlyLasting: boolean) {
	const out: Record<string, unknown> = {};
	const values = entry?.v === 1 && entry.s && typeof entry.s === 'object' ? (entry.s as Record<string, unknown>) : null;
	if (!values) return out;
	for (const [k, spec] of Object.entries(schema)) {
		if (onlyLasting && !spec.lasting) continue;
		const parsed = (spec as FieldSpec<unknown>).parse(values[k]);
		if (parsed !== undefined) out[k] = parsed;
	}
	return out;
}

// ---- views ------------------------------------------------------------------------------

/**
 * The state to start a view with. Order of precedence: explicit URL parameter, then this tab's
 * saved state, then the saved lasting preference, then the default.
 */
export function loadView<V extends ViewName>(
	view: V,
	userId: number | null | undefined,
	scope: string,
	params?: URLSearchParams,
	stores: Stores = browserStores()
): ViewState<V> {
	const schema = VIEWS[view] as Schema;
	const state: Record<string, unknown> = { ...defaultsOf(view) };
	if (idOk(userId)) {
		Object.assign(state, cleanEntry(readJson(stores.local, localKey(userId, view)), schema, true));
		Object.assign(state, cleanEntry(readJson(stores.session, sessionKey(userId, view, scope)), schema, false));
	}
	if (params) {
		for (const [k, spec] of Object.entries(schema)) {
			const name = (spec as FieldSpec<unknown>).url;
			const raw = name ? params.get(name) : null;
			if (raw == null) continue;
			const parse = (spec as FieldSpec<unknown>).parse;
			// Numbers arrive from the address bar as text.
			const parsed = parse(raw) ?? (/^\d{1,9}$/.test(raw) ? parse(Number(raw)) : undefined);
			if (parsed !== undefined) state[k] = parsed;
		}
	}
	return state as ViewState<V>;
}

export function saveView<V extends ViewName>(
	view: V,
	userId: number | null | undefined,
	scope: string,
	state: Partial<ViewState<V>>,
	stores: Stores = browserStores()
) {
	if (!idOk(userId)) return;
	const schema = VIEWS[view] as Schema;
	const all: Record<string, unknown> = {};
	const lasting: Record<string, unknown> = {};
	for (const [k, spec] of Object.entries(schema)) {
		const value = (state as Record<string, unknown>)[k];
		if (value === undefined) continue;
		all[k] = value;
		if (spec.lasting) lasting[k] = value;
	}
	writeJson(stores.session, sessionKey(userId, view, scope), { v: 1, s: all });
	writeJson(stores.local, localKey(userId, view), { v: 1, s: lasting });
}

/** "Reset this view": forgets this page's tab state and the lasting preferences for the view. */
export function resetView(
	view: ViewName,
	userId: number | null | undefined,
	scope: string,
	stores: Stores = browserStores()
) {
	if (!idOk(userId)) return;
	remove(stores.session, sessionKey(userId, view, scope));
	remove(stores.local, localKey(userId, view));
}

function removeWithPrefix(store: StorageLike | null, prefix: string) {
	if (!store) return;
	try {
		const doomed: string[] = [];
		for (let i = 0; i < store.length; i++) {
			const k = store.key(i);
			if (k && k.startsWith(prefix)) doomed.push(k);
		}
		for (const k of doomed) store.removeItem(k);
	} catch {
		// ignore
	}
}

/** "Reset all preferences": everything remembered for this person, in both storages. */
export function resetAll(userId: number | null | undefined, stores: Stores = browserStores()) {
	if (!idOk(userId)) return;
	removeWithPrefix(stores.session, `${PREFIX}${userId}:`);
	removeWithPrefix(stores.local, `${PREFIX}${userId}:`);
}

/** On sign-out: no temporary state of anyone is left behind in this tab. */
export function clearSessionState(stores: Stores = browserStores()) {
	removeWithPrefix(stores.session, PREFIX);
}

// ---- last visited context and where a company was opened from ---------------------------

export interface Place {
	path: string;
	label: string;
}
const VISIT_PATH =
	/^\/valuation\/(sector-rotation(\/[A-Za-z0-9_-]{1,80}){1,2}|company\/[A-Za-z0-9&._%-]{1,60})$/;
// Every valuation list a company can be opened from: the watchlist, sector rotation (any level),
// the breakout scanner, compare, alerts and sector baskets.
const ORIGIN_PATH =
	/^\/valuation(\/sector-rotation(\/[A-Za-z0-9_-]{1,80}){0,2}|\/stage-scanner|\/compare|\/alerts|\/sectors)?$/;
// Compare keeps its companies in the address as a comma-separated list.
const ORIGIN_QUERY = /^[A-Za-z0-9_=&.,%-]{0,200}$/;
const originOk = (path: string) => {
	const [pathname, query = '', ...rest] = path.split('?');
	return rest.length === 0 && ORIGIN_PATH.test(pathname) && ORIGIN_QUERY.test(query);
};
const cleanLabel = (raw: unknown) =>
	typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 80) : '';

export function rememberVisit(userId: number | null | undefined, place: Place, stores: Stores = browserStores(), now = Date.now()) {
	if (!idOk(userId) || !VISIT_PATH.test(place.path)) return;
	const label = cleanLabel(place.label);
	if (!label) return;
	writeJson(stores.local, visitKey(userId), { v: 1, path: place.path, label, at: now });
}

export function readVisit(userId: number | null | undefined, stores: Stores = browserStores(), now = Date.now()): Place | null {
	if (!idOk(userId)) return null;
	const entry = readJson(stores.local, visitKey(userId));
	const label = cleanLabel(entry?.label);
	const at = entry?.at;
	const fresh = typeof at === 'number' && at <= now + 60_000 && now - at <= MAX_VISIT_AGE_MS;
	if (entry?.v === 1 && typeof entry.path === 'string' && VISIT_PATH.test(entry.path) && label && fresh)
		return { path: entry.path, label };
	if (entry) remove(stores.local, visitKey(userId)); // outdated or malformed
	return null;
}

/** The list a company was opened from, so its "back" link returns to that same list. */
export function rememberOrigin(userId: number | null | undefined, symbol: string, place: Place, stores: Stores = browserStores()) {
	if (!idOk(userId) || !symbol || !originOk(place.path)) return;
	const label = cleanLabel(place.label);
	if (!label) return;
	writeJson(stores.session, originKey(userId, symbol.toUpperCase()), { v: 1, path: place.path, label });
}

export function readOrigin(userId: number | null | undefined, symbol: string, stores: Stores = browserStores()): Place | null {
	if (!idOk(userId)) return null;
	const entry = readJson(stores.session, originKey(userId, symbol.toUpperCase()));
	const label = cleanLabel(entry?.label);
	if (entry?.v === 1 && typeof entry.path === 'string' && originOk(entry.path) && label)
		return { path: entry.path, label };
	return null;
}
