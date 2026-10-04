import { isListedOnAngelOne } from './angelone';
import { rememberSymbolName } from './sectorStore';
import { lookupScreenerPage, type ScreenerLookup } from './screenerSlug';
import { SYMBOL_RE, normalizeSymbol, type SymbolSuggestion } from '../sectorEdit';

export type VerifyResult =
	| { ok: true; symbol: string; name: string; listedOnAngelOne: boolean }
	| { ok: false; reason: string; suggestions: SymbolSuggestion[] };

/**
 * Enforces the project's "never guess a symbol" rule inside the app: a symbol is accepted only
 * when Screener.in returns a company whose own slug is exactly that symbol, or (for a company
 * Screener lists only by BSE code) that BSE-code page under the same name. Fuzzy matches are
 * returned as suggestions for a human to pick, never auto-accepted. The real company name is
 * stored so cards can show names rather than tickers. `listedOnAngelOne` is a separate flag
 * (not a rejection): such a company can still be tracked, it just won't have live charts.
 */
export async function verifySymbol(raw: string): Promise<VerifyResult> {
	const symbol = normalizeSymbol(raw);
	if (!SYMBOL_RE.test(symbol)) {
		return { ok: false, reason: `"${raw}" isn't a valid NSE symbol shape.`, suggestions: [] };
	}

	let found: ScreenerLookup;
	try {
		found = await lookupScreenerPage(symbol);
	} catch (e) {
		throw new Error(`Couldn't reach Screener.in to verify ${symbol}: ${(e as Error).message}`, {
			cause: e
		});
	}
	if (found.kind === 'none') {
		return {
			ok: false,
			reason: `Screener.in has no company with the exact symbol "${symbol}".`,
			suggestions: found.suggestions
		};
	}

	const listed = async (s: string) => {
		try {
			return await isListedOnAngelOne(s);
		} catch {
			return false; // Scrip master unreachable (e.g. credentials/network) - don't fail over it.
		}
	};
	// A company Screener lists only by its BSE code keeps its NSE ticker when Angel One prices
	// it (its financial statements are then read from the BSE-code page behind the scenes).
	let id = found.page.symbol;
	let listedOnAngelOne = await listed(id);
	if (found.kind === 'bse' && (await listed(symbol))) {
		id = symbol;
		listedOnAngelOne = true;
	}
	await rememberSymbolName(id, found.page.name);
	return { ok: true, symbol: id, name: found.page.name, listedOnAngelOne };
}
