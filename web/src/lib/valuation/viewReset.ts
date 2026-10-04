import { invalidate } from '$app/navigation';
import { DEFAULT_SECTOR_CARD_METRICS } from '$lib/valuation/prefs';

/** Puts the figures shown on each sector card back to the standard set (saved on the server). */
export async function saveDefaultCardMetrics(): Promise<void> {
	try {
		await fetch('/api/valuation/me/prefs', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sectorCard: { metrics: DEFAULT_SECTOR_CARD_METRICS } })
		});
		await invalidate('app:prefs');
	} catch {
		// not saved: the page still shows the defaults for now
	}
}
