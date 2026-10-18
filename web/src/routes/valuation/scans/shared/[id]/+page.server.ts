import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { diffSnapshots, isScanId } from '$lib/valuation/savedScans';
import { getScan, getSnapshot, listSnapshotDates } from '$lib/valuation/server/savedScanStore';
import { getSymbolNames } from '$lib/valuation/server/sectorStore';
import { resolveCompanyNames } from '$lib/valuation/server/companyNames';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Any signed-in person may open a shared scan; only the owner can change it. ?d= picks the snapshot date and
// ?c= the date to compare it with (default: the snapshot before).
export const load: PageServerLoad = async ({ params, url, locals }) => {
	if (!isScanId(params.id)) error(404, 'No such scan.');
	const scan = await getScan(params.id);
	if (!scan) error(404, 'No such scan. It may have been deleted by its owner.');
	const dates = await listSnapshotDates(scan.id);
	const asked = url.searchParams.get('d');
	const date = asked && DATE.test(asked) && dates.includes(asked) ? asked : (dates[0] ?? null);
	const askedCompare = url.searchParams.get('c');
	const olderDates = date ? dates.filter((d) => d < date) : [];
	const compare = askedCompare && olderDates.includes(askedCompare) ? askedCompare : (olderDates[0] ?? null);
	const symbols = date ? ((await getSnapshot(scan.id, date)) ?? []) : [];
	const before = compare ? await getSnapshot(scan.id, compare) : null;
	const diff = diffSnapshots(before, symbols);
	const all = [...new Set([...symbols, ...diff.removed])];
	const names = { ...(await resolveCompanyNames(all)), ...(await getSymbolNames(all).catch(() => ({}))) };
	return {
		scan: {
			id: scan.id,
			name: scan.name,
			ownerName: scan.ownerName,
			config: scan.config,
			// Only the owner sees the alert switch.
			notify: scan.ownerId === locals.user!.id ? scan.notify : null,
			mine: scan.ownerId === locals.user!.id
		},
		dates,
		date,
		compare,
		symbols,
		diff,
		names
	};
};
