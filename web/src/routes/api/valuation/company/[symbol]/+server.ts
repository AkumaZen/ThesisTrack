import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCompanyData } from '$lib/valuation/server/companyCache';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const { data, cacheHit } = await getCompanyData(params.symbol);
		return json({ ...data, cacheHit });
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Unknown scrape error';
		if (message.startsWith('NOT_FOUND')) {
			error(404, `Company symbol not found on Screener: ${params.symbol}`);
		}
		error(502, message);
	}
};
