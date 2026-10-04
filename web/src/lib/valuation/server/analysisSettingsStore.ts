import { eq } from 'drizzle-orm';
import { db } from './db';
import { alertSettings } from './db/schema';
import { storedAnalysisSettings, type AnalysisSettings } from '../analysisSettings';

// Stored as one row of the shared key/value settings table (the same one that holds the RS alert
// thresholds). Read on every rotation and scan computation, so kept in memory and replaced on
// write; the app runs as a single process, so there is no other copy to invalidate.
const KEY = 'analysis';
let cached: AnalysisSettings | null = null;

export async function getAnalysisSettings(): Promise<AnalysisSettings> {
	if (cached) return cached;
	const [row] = await db.select().from(alertSettings).where(eq(alertSettings.key, KEY));
	cached = storedAnalysisSettings(row?.value);
	return cached;
}

/** Stores already-validated settings (the route validates and checks the caller is admin). */
export async function saveAnalysisSettings(value: AnalysisSettings): Promise<void> {
	await db
		.insert(alertSettings)
		.values({ key: KEY, value })
		.onConflictDoUpdate({ target: alertSettings.key, set: { value } });
	cached = value;
}
