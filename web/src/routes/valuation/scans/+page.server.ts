import type { PageServerLoad } from './$types';
import { diffSnapshots } from '$lib/valuation/savedScans';
import { listScans, listSnapshotDates, getSnapshot } from '$lib/valuation/server/savedScanStore';

// Your saved scans with the size of the latest snapshot and what is new since the one before it.
export const load: PageServerLoad = async ({ locals }) => {
	const scans = await listScans(locals.user!.id);
	const rows = await Promise.all(
		scans.map(async (scan) => {
			const dates = await listSnapshotDates(scan.id, 2);
			const latest = dates[0] ? await getSnapshot(scan.id, dates[0]) : null;
			const before = dates[1] ? await getSnapshot(scan.id, dates[1]) : null;
			const diff = latest ? diffSnapshots(before, latest) : null;
			return {
				id: scan.id,
				name: scan.name,
				config: scan.config,
				notify: scan.notify,
				latestDate: dates[0] ?? null,
				matches: latest?.length ?? null,
				added: diff?.added.length ?? 0,
				removed: diff?.removed.length ?? 0,
				compared: dates[1] ?? null
			};
		})
	);
	return { scans: rows };
};
