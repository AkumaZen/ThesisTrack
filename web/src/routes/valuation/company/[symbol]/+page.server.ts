import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCompanyData } from '$lib/valuation/server/companyCache';
import { listAllBaskets, listAllMajorSectors } from '$lib/valuation/server/sectorStore';
import { startingTemplateFor } from '$lib/valuation/server/templatesStore';

/** Every sector -> basket path this company sits on, so the page can link to where it is ranked. */
async function sectorsFor(symbol: string) {
	const [majors, baskets] = await Promise.all([listAllMajorSectors(), listAllBaskets()]);
	const paths: { majorKey: string; majorLabel: string; basketKey: string; basketLabel: string }[] =
		[];
	for (const basket of baskets) {
		if (!basket.symbols.includes(symbol.toUpperCase())) continue;
		for (const major of majors) {
			if (major.subsectorKeys.includes(basket.key)) {
				paths.push({
					majorKey: major.key,
					majorLabel: major.label,
					basketKey: basket.key,
					basketLabel: basket.label
				});
			}
		}
	}
	return paths;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	try {
		const { data } = await getCompanyData(params.symbol);
		const [sectors, startingTemplate] = await Promise.all([
			sectorsFor(data.symbol),
			startingTemplateFor(data.symbol, locals.user!.id)
		]);
		// startingTemplate: what a valuation not yet on the watchlist starts from (or null).
		return { company: data, sectors, startingTemplate };
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Unknown scrape error';
		if (message.startsWith('NOT_FOUND')) {
			error(404, `Company symbol not found on Screener: ${params.symbol}`);
		}
		error(502, message);
	}
};
