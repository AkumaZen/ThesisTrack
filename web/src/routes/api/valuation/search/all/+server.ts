import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { globalSearch } from '$lib/valuation/server/globalSearch';

// Companies, sectors and notes in one call, for the search box in the top navigation.
export const GET: RequestHandler = async ({ url }) =>
	json(await globalSearch(url.searchParams.get('q') ?? ''));
