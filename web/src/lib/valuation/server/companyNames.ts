import { inArray, sql } from 'drizzle-orm';
import { db } from './db';
import { companyCache, savedValuations, symbolNameCache } from './db/schema';
import { SYMBOL_NAMES } from '$lib/symbolNames';

/** The real company name for a ticker, from what the app has already verified: the hand-checked
 *  list, a saved valuation, the Sector Manager's verified names, or the scraped company page.
 *  Falls back to the ticker itself - never a guess. */
export async function resolveCompanyName(symbol: string): Promise<string> {
	const key = symbol.toUpperCase();
	return (await resolveCompanyNames([key]))[key] ?? key;
}

export async function resolveCompanyNames(symbols: string[]): Promise<Record<string, string>> {
	const keys = [...new Set(symbols.map((s) => s.toUpperCase()))];
	const out: Record<string, string> = {};
	for (const k of keys) if (SYMBOL_NAMES[k]) out[k] = SYMBOL_NAMES[k];
	let missing = keys.filter((k) => !out[k]);
	if (!missing.length) return out;

	const sources = [
		() =>
			db
				.select({ symbol: savedValuations.symbol, name: savedValuations.name })
				.from(savedValuations)
				.where(inArray(savedValuations.symbol, missing)),
		() =>
			db
				.select({ symbol: symbolNameCache.symbol, name: symbolNameCache.name })
				.from(symbolNameCache)
				.where(inArray(symbolNameCache.symbol, missing)),
		() =>
			db
				.select({ symbol: companyCache.symbol, name: sql<string>`${companyCache.data}->>'name'` })
				.from(companyCache)
				.where(inArray(companyCache.symbol, missing))
	];
	for (const query of sources) {
		for (const r of await query()) if (r.name && !out[r.symbol]) out[r.symbol] = r.name;
		missing = missing.filter((k) => !out[k]);
		if (!missing.length) break;
	}
	return out;
}
