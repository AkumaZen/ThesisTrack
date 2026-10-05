import type { PageServerLoad } from './$types';

const MAX_SYMBOLS = 10;

// Only reads which companies to compare. Each company's statements are fetched by the page from
// /api/valuation/compare/[symbol] in parallel, so the table fills in company by company instead
// of waiting for the slowest uncached one.
export const load: PageServerLoad = async ({ url }) => {
	const raw = url.searchParams.get('symbols') ?? '';
	const symbols = [
		...new Set(
			raw
				.split(',')
				.map((s) => s.trim().toUpperCase())
				.filter((s) => /^[A-Z0-9&._-]{1,30}$/.test(s))
		)
	].slice(0, MAX_SYMBOLS);

	return { symbols, maxSymbols: MAX_SYMBOLS };
};
