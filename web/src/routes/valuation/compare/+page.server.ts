import type { PageServerLoad } from './$types';
import { getCompanyData } from '$lib/valuation/server/companyCache';
import type { CompanyFinancials } from '$lib/valuation/server/scraper';

export interface CompareResult {
	symbol: string;
	company: CompanyFinancials | null;
	errorMessage: string | null;
}

const MAX_SYMBOLS = 4;

export const load: PageServerLoad = async ({ url }) => {
	const raw = url.searchParams.get('symbols') ?? '';
	const symbols = [
		...new Set(
			raw
				.split(',')
				.map((s) => s.trim().toUpperCase())
				.filter(Boolean)
		)
	].slice(0, MAX_SYMBOLS);

	const results: CompareResult[] = await Promise.all(
		symbols.map(async (symbol) => {
			try {
				const { data } = await getCompanyData(symbol);
				return { symbol, company: data, errorMessage: null };
			} catch (e) {
				const message = e instanceof Error ? e.message : 'Unknown scrape error';
				return {
					symbol,
					company: null,
					errorMessage: message.startsWith('NOT_FOUND') ? 'Symbol not found on Screener' : message
				};
			}
		})
	);

	return { results, maxSymbols: MAX_SYMBOLS };
};
