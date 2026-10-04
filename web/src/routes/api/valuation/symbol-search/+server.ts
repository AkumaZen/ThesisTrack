import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchSymbols } from '$lib/valuation/server/symbolSearch';

// Suggestions for the company picker (any page where a company or symbol is chosen).
export const GET: RequestHandler = async ({ url }) => {
	return json({ results: await searchSymbols(url.searchParams.get('q') ?? '') });
};
