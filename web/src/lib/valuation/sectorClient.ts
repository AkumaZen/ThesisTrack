import type { SymbolSuggestion } from './sectorEdit';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string };

/** Thin fetch wrapper for the Sector Manager API: never throws, returns the server's own
 *  human-readable message on failure so the UI can show it as-is. */
export async function sectorApi<T = unknown>(
	method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
	url: string,
	body?: unknown
): Promise<ApiResult<T>> {
	try {
		const res = await fetch(url, {
			method,
			headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const parsed = await res.json().catch(() => null);
		if (!res.ok) {
			return { ok: false, message: parsed?.message ?? `Request failed (${res.status}).` };
		}
		return { ok: true, data: parsed as T };
	} catch {
		return { ok: false, message: 'Could not reach the server - try again.' };
	}
}

export type VerifyResponse =
	| { ok: true; symbol: string; name: string; listedOnAngelOne: boolean }
	| { ok: false; reason: string; suggestions: SymbolSuggestion[] };
