import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchCompanies } from '$lib/valuation/server/search';

export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	const results = await searchCompanies(q);
	return json(results);
};
