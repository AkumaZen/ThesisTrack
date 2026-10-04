import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCompanyData } from '$lib/valuation/server/companyCache';
import { listAllBaskets, listAllMajorSectors } from '$lib/valuation/server/sectorStore';
import { startingTemplateFor } from '$lib/valuation/server/templatesStore';
import { db } from '$lib/server/db';
import { companies } from '$lib/server/db/schema';
import { eq, or } from 'drizzle-orm';

/** The thesis on this company, if the team has one (matched by NSE/BSE ticker). */
async function thesisFor(symbol: string) {
	const s = symbol.toUpperCase();
	const [row] = await db
		.select({ companyId: companies.companyId })
		.from(companies)
		.where(or(eq(companies.nseTicker, s), eq(companies.bseTicker, s), eq(companies.companyId, s)))
		.limit(1);
	return row?.companyId ?? null;
}

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
		const [sectors, startingTemplate, thesisId] = await Promise.all([
			sectorsFor(data.symbol),
			startingTemplateFor(data.symbol, locals.user!.id),
			thesisFor(data.symbol)
		]);
		// startingTemplate: what a valuation not yet on the watchlist starts from (or null).
		return { company: data, sectors, startingTemplate, thesisId };
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Unknown scrape error';
		if (message.startsWith('NOT_FOUND')) {
			error(404, `Company symbol not found on Screener: ${params.symbol}`);
		}
		// A database failure (e.g. no free connection) is not the company's fault, and its message
		// is the SQL itself - show something a person can act on instead.
		if (message.startsWith('Failed query'))
			error(503, 'The database is busy right now. Wait a moment and reload this page.');
		error(502, message);
	}
};
