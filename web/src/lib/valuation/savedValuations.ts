import {
	METHODS,
	SCENARIOS,
	type MethodId,
	type ScenarioId,
	type ScenarioAssumptions
} from './valuationEngine';

export interface SavedValuationMeta {
	symbol: string;
	name: string;
	lastUpdated: number;
	/** Who made the latest save (null for rows saved before this was tracked). */
	updatedBy?: string | null;
	version?: number;
	/** Review status (null when never set) and whether an approval predates the current version. */
	status?: import('./team').ReviewStatus | null;
	statusStale?: boolean;
	/** The covering analyst's username, or null. */
	coveredBy?: string | null;
}

export interface SavedValuationRecord {
	name: string;
	lastUpdated: number;
	assumptions: Record<MethodId, Record<ScenarioId, ScenarioAssumptions>>;
	shares: number;
	// The valuation method the user last had selected on the company page. Optional because
	// older saved records (and imports) predate this field — falls back to the diagnosed
	// method when absent.
	activeMethod?: MethodId;
	activeScenario?: ScenarioId;
	/** Set by the server on reads: the save counter and who made the latest save. Ignored on
	 *  writes - send `baseVersion` (see SaveBody) to ask for a conflict check instead. */
	version?: number;
	updatedBy?: string | null;
}

/** The stored content of one version (what the history keeps and a rollback brings back). */
export type ValuationContent = Omit<SavedValuationRecord, 'version' | 'updatedBy'>;

/** One entry in a company's valuation history (newest first from the API). */
export interface ValuationVersionInfo {
	id: number;
	version: number;
	action: 'save' | 'delete' | 'restore';
	savedBy: string;
	/** An autosave session runs from startedAt to savedAt and counts as one version. */
	startedAt: number;
	savedAt: number;
	/** What this version changed compared with the one before it. */
	changes: string[];
}

/** A company recently removed from the watchlist, restorable in one click. */
export interface RemovedValuation {
	versionId: number;
	symbol: string;
	name: string;
	removedBy: string;
	removedAt: number;
}

/** What a client PUTs. `baseVersion` is the version it loaded: the save is refused with a
 *  conflict if someone else saved since. 0 means "create only" (refused if a row now exists).
 *  Omitted means "overwrite regardless" (imports, scripts). */
export type SaveBody = Omit<SavedValuationRecord, 'version' | 'updatedBy'> & {
	baseVersion?: number;
};

export type SaveResult =
	| { ok: true; version: number; updatedBy: string | null }
	| { ok: false; conflict: true; current: SavedValuationRecord | null }
	| { ok: false; conflict: false; message: string };

/** Persisted server-side in Postgres (`saved_valuations` table) — see
 *  `src/lib/server/savedValuationsStore.ts` and `src/routes/api/valuations/`. Not localStorage:
 *  that was lost wholesale on any browser/profile switch or "clear site data" click. */
export async function getSavedValuation(symbol: string): Promise<SavedValuationRecord | null> {
	const res = await fetch(`/api/valuations/${symbol.toUpperCase()}`);
	if (!res.ok) return null;
	return (await res.json()) as SavedValuationRecord;
}

export async function listSavedValuations(): Promise<SavedValuationMeta[]> {
	const res = await fetch('/api/valuations');
	if (!res.ok) return [];
	return (await res.json()) as SavedValuationMeta[];
}

/** Removes it from the watchlist. Returns the history id of the removal, which restores it
 *  (Undo), or null if the request failed. */
export async function removeSavedValuation(symbol: string): Promise<number | null> {
	const res = await fetch(`/api/valuations/${symbol.toUpperCase()}`, { method: 'DELETE' });
	if (!res.ok) return null;
	const data = (await res.json().catch(() => null)) as { versionId?: number | null } | null;
	return data?.versionId ?? null;
}

export type RestoreResult =
	| { ok: true; version: number }
	| { ok: false; conflict: true; current: SavedValuationRecord | null }
	| { ok: false; conflict: false; message: string };

/** Brings back a removed valuation or rolls back to an old version (as a new version). Pass the
 *  version you are looking at as `baseVersion` to be refused if someone saved meanwhile. */
export async function restoreValuation(
	symbol: string,
	versionId: number,
	baseVersion?: number
): Promise<RestoreResult> {
	let res: Response;
	try {
		res = await fetch(`/api/valuations/${symbol.toUpperCase()}/restore`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ versionId, baseVersion })
		});
	} catch {
		return { ok: false, conflict: false, message: 'Network error - nothing was restored.' };
	}
	if (res.ok) return { ok: true, version: ((await res.json()) as { version: number }).version };
	if (res.status === 409) {
		const data = (await res.json().catch(() => null)) as { current?: SavedValuationRecord } | null;
		return { ok: false, conflict: true, current: data?.current ?? null };
	}
	const msg = (await res.json().catch(() => null)) as { message?: string } | null;
	return { ok: false, conflict: false, message: msg?.message ?? `HTTP ${res.status}` };
}

export async function saveSavedValuation(symbol: string, body: SaveBody): Promise<SaveResult> {
	let res: Response;
	try {
		res = await fetch(`/api/valuations/${symbol.toUpperCase()}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
	} catch {
		return { ok: false, conflict: false, message: 'Network error - your changes were not saved.' };
	}
	if (res.ok) {
		const data = (await res.json()) as { version: number; updatedBy: string | null };
		return { ok: true, version: data.version, updatedBy: data.updatedBy };
	}
	if (res.status === 409) {
		const data = (await res.json().catch(() => null)) as { current?: SavedValuationRecord } | null;
		return { ok: false, conflict: true, current: data?.current ?? null };
	}
	return { ok: false, conflict: false, message: `Could not save (HTTP ${res.status}).` };
}

/** Returns why a saved valuation's assumptions are unusable, or null when every method and
 *  scenario has three years of finite numbers. Checked on every save so a malformed model can
 *  never reach the database (and later break the watchlist or the alert checks). */
export function assumptionsProblem(assumptions: unknown): string | null {
	if (typeof assumptions !== 'object' || assumptions === null)
		return 'assumptions must be an object';
	for (const m of METHODS) {
		for (const sc of SCENARIOS) {
			const years = (assumptions as Record<string, Record<string, { years?: unknown }>>)[m]?.[sc]
				?.years;
			if (!Array.isArray(years) || years.length !== 3) return `${m}/${sc} needs exactly 3 years`;
			for (const y of years) {
				if (typeof y !== 'object' || y === null) return `${m}/${sc} has a malformed year`;
				for (const [k, v] of Object.entries(y)) {
					if (typeof v !== 'number' || !Number.isFinite(v))
						return `${m}/${sc} ${k} is not a number`;
				}
			}
		}
	}
	return null;
}
