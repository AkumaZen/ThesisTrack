import { isListedOnAngelOne } from './angelone';
import { rememberSymbolName } from './sectorStore';
import {
	SYMBOL_RE,
	normalizeSymbol,
	resolveSymbolMatch,
	type SymbolSuggestion
} from '../sectorEdit';

const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export type VerifyResult =
	| { ok: true; symbol: string; name: string; listedOnAngelOne: boolean }
	| { ok: false; reason: string; suggestions: SymbolSuggestion[] };

/**
 * Enforces the project's "never guess a symbol" rule inside the app: a symbol is accepted only
 * when Screener.in returns a company whose own slug is exactly that symbol. Fuzzy matches are
 * returned as suggestions for a human to pick, never auto-accepted. The real company name is
 * stored so cards can show names rather than tickers. `listedOnAngelOne` is a separate flag
 * (not a rejection): such a company can still be tracked, it just won't have live charts.
 */
export async function verifySymbol(raw: string): Promise<VerifyResult> {
	const symbol = normalizeSymbol(raw);
	if (!SYMBOL_RE.test(symbol)) {
		return { ok: false, reason: `"${raw}" isn't a valid NSE symbol shape.`, suggestions: [] };
	}

	let hits: { name?: string; url?: string }[];
	try {
		const res = await fetch(
			`https://www.screener.in/api/company/search/?q=${encodeURIComponent(symbol)}`,
			{ headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } }
		);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		hits = (await res.json()) as { name?: string; url?: string }[];
	} catch (e) {
		throw new Error(`Couldn't reach Screener.in to verify ${symbol}: ${(e as Error).message}`, {
			cause: e
		});
	}

	const { match, suggestions } = resolveSymbolMatch(symbol, hits);
	if (!match) {
		return {
			ok: false,
			reason: `Screener.in has no company with the exact symbol "${symbol}".`,
			suggestions
		};
	}

	await rememberSymbolName(match.symbol, match.name);
	let listedOnAngelOne = false;
	try {
		listedOnAngelOne = await isListedOnAngelOne(match.symbol);
	} catch {
		// Scrip master unreachable (e.g. credentials/network) - don't fail verification over it.
	}
	return { ok: true, symbol: match.symbol, name: match.name, listedOnAngelOne };
}
