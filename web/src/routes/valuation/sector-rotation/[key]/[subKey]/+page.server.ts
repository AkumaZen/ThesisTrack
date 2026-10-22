import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSectorEarnings } from '$lib/valuation/server/sectorEarningsStore';
import { findAnyMajorSector, findAnyCustomSector } from '$lib/valuation/server/sectorStore';

// Static metadata only — no live fetch, so this is instant. Each constituent's own chart/growth
// data, and the basket summary, are fetched one at a time from the client (see +page.svelte).
// Resolves against both built-in and user-imported sectors.
export const load: PageServerLoad = async ({ params }) => {
	// A basket can be retired or moved (taxonomy imports), but old links to it live on in alert
	// history and bookmarks: send them to the nearest page that still exists instead of a 404.
	const major = await findAnyMajorSector(params.key);
	if (!major) redirect(307, '/valuation/sector-rotation');

	const sector = await findAnyCustomSector(params.subKey);
	if (!sector || !major.subsectorKeys.includes(sector.key)) {
		redirect(307, `/valuation/sector-rotation/${encodeURIComponent(major.key)}`);
	}

	// Stored results only; a failure just leaves the panel off.
	const earnings = await getSectorEarnings(sector.symbols).catch(() => null);

	return {
		majorKey: major.key,
		majorLabel: major.label,
		key: sector.key,
		label: sector.label,
		symbols: sector.symbols,
		earnings
	};
};
