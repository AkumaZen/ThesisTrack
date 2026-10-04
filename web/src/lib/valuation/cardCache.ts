// Browser-side cache for the sector rotation cards. A card's figures come from prices already
// stored on the server, so once fetched they are kept here and reused when the person pages,
// sorts or comes back to the page, instead of asking again. Refresh (which fetches new prices)
// bypasses it. Requests are capped so a screenful of cards doesn't fire all at once.

export interface CachedResponse<T = unknown> {
	status: number;
	body: T | null;
}

/** How long a stored answer is reused before it is asked for again. */
export const CARD_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_PARALLEL = 4;

const store = new Map<string, { at: number; res: CachedResponse }>();
const inFlight = new Map<string, Promise<CachedResponse>>();
let running = 0;
const queue: (() => void)[] = [];

async function slot<T>(work: () => Promise<T>): Promise<T> {
	if (running >= MAX_PARALLEL) await new Promise<void>((go) => queue.push(go));
	running++;
	try {
		return await work();
	} finally {
		running--;
		queue.shift()?.();
	}
}

/** Statuses worth remembering: an answer (200) or "no prices for it" (404). */
const keep = (status: number) => status === 200 || status === 404;

/** The remembered answer for `url`, if it is still fresh. */
export function peekCard<T>(url: string, now = Date.now()): CachedResponse<T> | undefined {
	const hit = store.get(url);
	return hit && now - hit.at < CARD_CACHE_TTL_MS ? (hit.res as CachedResponse<T>) : undefined;
}

/**
 * GETs `url` as JSON, reusing a fresh remembered answer. `fresh` skips the cache (after a
 * Refresh). Network failures throw; any HTTP status is returned for the caller to judge.
 */
export function fetchCard<T>(url: string, { fresh = false } = {}): Promise<CachedResponse<T>> {
	if (!fresh) {
		const hit = peekCard<T>(url);
		if (hit) return Promise.resolve(hit);
		const pending = inFlight.get(url);
		if (pending) return pending as Promise<CachedResponse<T>>;
	}
	const request = slot(async () => {
		const res = await fetch(url);
		const body = (await res.json().catch(() => null)) as T | null;
		const out: CachedResponse<T> = { status: res.status, body };
		if (keep(res.status)) store.set(url, { at: Date.now(), res: out });
		return out;
	}).finally(() => inFlight.delete(url));
	inFlight.set(url, request);
	return request;
}

/** Forgets remembered answers whose URL starts with `prefix` (all of them when omitted). */
export function forgetCards(prefix = '') {
	for (const url of store.keys()) if (url.startsWith(prefix)) store.delete(url);
}
