import type { PageServerLoad } from './$types';
import { listAllMajorSectors } from '$lib/server/sectorStore';

// Static metadata (built-in major sectors plus whatever's been imported via the "Import
// Sector" panel) â€” no live fetch, so this is instant regardless of cache state. The actual
// per-major-sector data (price, returns, signal) is fetched one at a time from the client
// (see +page.svelte), and each card fills in independently as its own request resolves.
export const load: PageServerLoad = async () => {
	const majors = await listAllMajorSectors();
	return {
		majors: majors.map((m) => ({
			key: m.key,
			label: m.label,
			subsectorCount: m.subsectorKeys.length
		}))
	};
};
