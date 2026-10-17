import { fetchLiveSnapshots, type LiveSnapshot } from './angelone';

/** What a symbol's live look-up came to: a snapshot, null (no Angel One listing or no price) or
 *  the error its own fallback call raised. */
export type LiveOutcome = LiveSnapshot | null | Error;

/** One quote request per 50 symbols instead of one request per symbol. A symbol whose batch
 *  failed, or that the quote answered nothing for, gets the old single call (`fallback`); symbols
 *  with no Angel One listing stay null without any call. Never throws: a symbol's own failure is
 *  its entry in the map. Symbols come back upper-cased. */
export async function liveSnapshotsFor(
	symbols: string[],
	fallback: (symbol: string) => Promise<LiveSnapshot | null>,
	fetchBatch: typeof fetchLiveSnapshots = fetchLiveSnapshots
): Promise<Map<string, LiveOutcome>> {
	const out = new Map<string, LiveOutcome>();
	const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))];
	if (wanted.length === 0) return out;
	let retry: string[] = wanted;
	try {
		const r = await fetchBatch(wanted);
		for (const s of r.unlisted) out.set(s, null);
		for (const [s, snap] of r.snapshots) out.set(s, snap);
		retry = [...r.failed, ...r.missing];
	} catch {
		// The batch call itself broke: every symbol takes the single-call route below.
	}
	for (const s of retry) {
		try {
			out.set(s, await fallback(s));
		} catch (e) {
			out.set(s, e instanceof Error ? e : new Error('Unknown error'));
		}
	}
	return out;
}
