// Guest mode: a guest only ever sees data already stored. Every request a guest makes runs inside
// runAsGuest(), and while it does, a fetch() to another origin (NSE, BSE, Screener, an AI
// provider...) throws GuestLiveFetchError instead of going out. Code that would load live data can
// catch it, or check inGuestContext() first, and fall back to the stored copy.
//
// Same-origin requests made through SvelteKit's event.fetch never reach globalThis.fetch (the
// framework answers them in process), and the database driver speaks TCP, not fetch - so neither
// is affected. Outside a guest request (signed-in users, schedulers, cron) the wrapper is a no-op.
import { AsyncLocalStorage } from 'node:async_hooks';

interface GuestContext {
	/** The app's own origin; a fetch to it is allowed (it never leaves the app). */
	origin: string;
	blocked: number;
}

const storage = new AsyncLocalStorage<GuestContext>();

export class GuestLiveFetchError extends Error {
	/** The origin that was blocked, for logs; the message itself is safe to show a guest. */
	readonly blockedOrigin: string;
	constructor(origin: string) {
		super('Thanks for looking around! This needs live market data, which loads for signed-in members. Sign in to see it.');
		this.name = 'GuestLiveFetchError';
		this.blockedOrigin = origin;
	}
}

export const inGuestContext = (): boolean => storage.getStore() !== undefined;

/** Blocked external fetches so far in the current guest request (0 outside one). */
export const guestBlockedFetches = (): number => storage.getStore()?.blocked ?? 0;

/** Process-wide count of blocked fetches, for local verification. */
let blockedTotal = 0;
export const guestBlockedFetchTotal = (): number => blockedTotal;

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === 'string') return input;
	if (input instanceof URL) return input.href;
	return input.url;
}

const FETCH_GUARD = Symbol.for('thesis-tracker.guest-fetch-guard');

function installFetchGuard(): void {
	const g = globalThis as typeof globalThis & { [FETCH_GUARD]?: true };
	if (g[FETCH_GUARD]) return; // once per process, even across dev hot reloads
	const original = globalThis.fetch;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const ctx = storage.getStore();
		if (ctx) {
			const raw = requestUrl(input);
			let origin: string | null = null;
			try {
				origin = new URL(raw, ctx.origin).origin;
			} catch {
				origin = null;
			}
			if (origin !== ctx.origin) {
				ctx.blocked++;
				blockedTotal++;
				console.warn(`[guest] blocked live fetch to ${origin ?? 'an invalid URL'}`);
				throw new GuestLiveFetchError(origin ?? 'an invalid URL');
			}
		}
		return original(input, init);
	}) as typeof fetch;
	g[FETCH_GUARD] = true;
}

installFetchGuard();

export function runAsGuest<T>(origin: string, fn: () => T): T {
	return storage.run({ origin, blocked: 0 }, fn);
}
