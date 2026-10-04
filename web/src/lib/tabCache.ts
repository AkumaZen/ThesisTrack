// Keeps figures already downloaded in this tab's sessionStorage, so a refresh (or reopening a
// closed tab with Ctrl+Shift+T) reuses them instead of asking the server again. Only data every
// signed-in person sees alike is kept here (stored prices and the figures worked out from them),
// never anything personal. The keys share viewMemory's prefix, so signing out clears them too.
//
// Each entry is "<saved at>|<json>". The whole cache is held under a size budget, well inside the
// browser's limit for the site; past it, or when the browser refuses a write, the oldest entries go.

import { browserStores, savingStopped, type StorageLike } from './viewMemory';

const PREFIX = 'tt:v1:cache:';
/** Characters the cache may use in all (about 2.5 MB; browsers allow about 5 MB per site). */
export const TAB_CACHE_BUDGET = 1_250_000;

const storage = (): StorageLike | null => browserStores().session;

function parse(raw: string | null): { at: number; json: string } | null {
	if (!raw) return null;
	const bar = raw.indexOf('|');
	const at = Number(raw.slice(0, bar));
	return bar > 0 && Number.isFinite(at) ? { at, json: raw.slice(bar + 1) } : null;
}

function entries(store: StorageLike) {
	const out: { key: string; at: number; size: number }[] = [];
	for (let i = 0; i < store.length; i++) {
		const key = store.key(i);
		if (!key?.startsWith(PREFIX)) continue;
		const raw = store.getItem(key);
		out.push({ key, at: parse(raw)?.at ?? 0, size: key.length + (raw?.length ?? 0) });
	}
	return out;
}

/** The value kept under `key`, if it is younger than `maxAgeMs`. */
export function readTab<T>(key: string, maxAgeMs: number, now = Date.now(), store = storage()): T | undefined {
	if (!store) return undefined;
	try {
		const hit = parse(store.getItem(PREFIX + key));
		if (!hit) return undefined;
		if (now - hit.at >= maxAgeMs || hit.at > now + 60_000) {
			store.removeItem(PREFIX + key);
			return undefined;
		}
		return JSON.parse(hit.json) as T;
	} catch {
		return undefined;
	}
}

/** Keeps `value` under `key`, making room by dropping the oldest entries when needed. */
export function writeTab(key: string, value: unknown, now = Date.now(), store = storage(), budget = TAB_CACHE_BUDGET) {
	if (!store || savingStopped()) return;
	try {
		const raw = `${now}|${JSON.stringify(value)}`;
		const size = PREFIX.length + key.length + raw.length;
		if (size > budget / 4) return; // one answer never crowds out the rest
		const others = entries(store).filter((e) => e.key !== PREFIX + key);
		let used = others.reduce((sum, e) => sum + e.size, 0);
		others.sort((a, b) => a.at - b.at);
		while (used + size > budget && others.length) used -= drop(store, others.shift()!.key);
		for (;;) {
			try {
				store.setItem(PREFIX + key, raw);
				return;
			} catch {
				// The browser's own limit (other data on the site counts too): make more room.
				if (!others.length) return;
				drop(store, others.shift()!.key);
			}
		}
	} catch {
		// storage blocked: the figures are simply fetched again next time
	}
}

function drop(store: StorageLike, key: string): number {
	const size = key.length + (store.getItem(key)?.length ?? 0);
	store.removeItem(key);
	return size;
}

/** Forgets the entries whose key starts with `prefix` (all of them when omitted). */
export function forgetTab(prefix = '', store = storage()) {
	if (!store) return;
	try {
		const doomed: string[] = [];
		for (let i = 0; i < store.length; i++) {
			const key = store.key(i);
			if (key?.startsWith(PREFIX + prefix)) doomed.push(key);
		}
		for (const key of doomed) store.removeItem(key);
	} catch {
		// ignore
	}
}
