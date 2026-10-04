import { and, desc, eq, inArray, isNull, lt, notInArray, like, sql, type SQL } from 'drizzle-orm';
import { db } from './db';
import { alertReads, alertSettings, alertState, alertUserPrefs, alerts, users } from './db/schema';
import { ALERT_TYPES, type AlertRecord, type AlertType } from '../alerts';
import { DEFAULT_RS_THRESHOLDS, parseThresholds, type RsThresholds } from '../rsThresholds';

// ---- Settings ----
//
// Which alert types a person wants and what they muted are PER USER (alert_user_prefs). The
// weekly/monthly relative-strength thresholds are shared configuration (alert_settings) that only
// the admin changes. Alerts themselves are raised once for the whole team; a type that's switched
// off, or a subject that's muted, is simply hidden from that user's list, count and bell.

export interface UserAlertPrefs {
	enabled: Record<AlertType, boolean>;
	muted: string[];
}

export interface AlertSettings extends UserAlertPrefs {
	/** Weekly/monthly relative-strength levels for sector alerts (admin-editable, shared). */
	thresholds: RsThresholds;
}

function allEnabled(): Record<AlertType, boolean> {
	return { price_fair_value: true, sector_rotation: true, near_breakout: true };
}

function toPrefs(row: { enabled: unknown; muted: unknown } | undefined): UserAlertPrefs {
	const enabled = allEnabled();
	let muted: string[] = [];
	if (row?.enabled && typeof row.enabled === 'object') {
		for (const t of ALERT_TYPES) {
			const v = (row.enabled as Record<string, unknown>)[t];
			if (typeof v === 'boolean') enabled[t] = v;
		}
	}
	if (Array.isArray(row?.muted)) {
		muted = row.muted.filter((v): v is string => typeof v === 'string');
	}
	return { enabled, muted };
}

export async function getUserPrefs(userId: number): Promise<UserAlertPrefs> {
	const [row] = await db.select().from(alertUserPrefs).where(eq(alertUserPrefs.userId, userId));
	return toPrefs(row);
}

export async function getThresholds(): Promise<RsThresholds> {
	const thresholds: RsThresholds = { ...DEFAULT_RS_THRESHOLDS };
	const [row] = await db.select().from(alertSettings).where(eq(alertSettings.key, 'thresholds'));
	if (row) {
		const parsed = parseThresholds(row.value);
		if ('value' in parsed) Object.assign(thresholds, parsed.value);
	}
	return thresholds;
}

export async function getAlertSettings(userId: number): Promise<AlertSettings> {
	const [prefs, thresholds] = await Promise.all([getUserPrefs(userId), getThresholds()]);
	return { ...prefs, thresholds };
}

export interface AlertSettingsPatch {
	enabled?: Partial<Record<AlertType, boolean>>;
	/** Replaces the whole muted list. Prefer mute/unmute: they can't clobber a concurrent change. */
	muted?: string[];
	mute?: string[];
	unmute?: string[];
	thresholds?: Partial<RsThresholds>;
}

/** Applies the per-user part of a patch in one transaction with the user's row locked, so two
 *  tabs (or two quick clicks) changing different things can never overwrite each other. */
async function patchUserPrefs(userId: number, patch: AlertSettingsPatch): Promise<void> {
	if (!patch.enabled && !patch.muted && !patch.mute && !patch.unmute) return;
	await db.transaction(async (tx) => {
		await tx
			.insert(alertUserPrefs)
			.values({ userId, enabled: {}, muted: [] })
			.onConflictDoNothing();
		const [row] = await tx
			.select()
			.from(alertUserPrefs)
			.where(eq(alertUserPrefs.userId, userId))
			.for('update');
		const enabled = { ...(row.enabled ?? {}) };
		for (const t of ALERT_TYPES) {
			const v = patch.enabled?.[t];
			if (typeof v === 'boolean') enabled[t] = v;
		}
		let muted = new Set(toPrefs(row).muted);
		if (patch.muted) muted = new Set(patch.muted);
		for (const k of patch.mute ?? []) muted.add(k);
		for (const k of patch.unmute ?? []) muted.delete(k);
		await tx
			.update(alertUserPrefs)
			.set({ enabled, muted: [...muted] })
			.where(eq(alertUserPrefs.userId, userId));
	});
}

/** The caller decides who may change thresholds (admin only); this just stores them. A single
 *  atomic jsonb merge, so a partial update keeps the other value even under concurrent saves. */
async function patchThresholds(patch: Partial<RsThresholds>): Promise<void> {
	await db.execute(sql`
		insert into alert_settings (key, value)
		values ('thresholds', ${JSON.stringify({ ...DEFAULT_RS_THRESHOLDS, ...patch })}::jsonb)
		on conflict (key) do update set value = alert_settings.value || ${JSON.stringify(patch)}::jsonb`);
}

export async function saveAlertSettings(
	userId: number,
	patch: AlertSettingsPatch
): Promise<AlertSettings> {
	if (patch.thresholds) await patchThresholds(patch.thresholds);
	await patchUserPrefs(userId, patch);
	return getAlertSettings(userId);
}

/** Whether at least one team member would see this alert (their type is on and the subject isn't
 *  muted). Nobody wanting it means there's no point raising it or sending an email. */
export async function anyoneWants(type: AlertType, subjectKey?: string): Promise<boolean> {
	const [{ n: total }] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
	const prefs = await db.select().from(alertUserPrefs);
	if (total > prefs.length) return true; // someone has never changed a setting: everything is on
	return prefs.some((p) => {
		const u = toPrefs(p);
		return u.enabled[type] && !(subjectKey && u.muted.includes(subjectKey));
	});
}

// ---- State: the last observed reading per watched thing ----

export async function loadStates(prefix: string): Promise<Map<string, string>> {
	const rows = await db
		.select()
		.from(alertState)
		.where(like(alertState.key, `${prefix.replace(/[%_\\]/g, '\\$&')}%`));
	return new Map(rows.map((r) => [r.key, r.value]));
}

export async function setState(key: string, value: string): Promise<void> {
	const updatedAt = Date.now();
	await db
		.insert(alertState)
		.values({ key, value, updatedAt })
		.onConflictDoUpdate({ target: alertState.key, set: { value, updatedAt } });
}

// ---- The feed ----

export interface NewAlert {
	type: AlertType;
	subjectKey: string;
	subjectLabel: string;
	message: string;
	href?: string | null;
}

export async function insertAlert(a: NewAlert): Promise<AlertRecord> {
	const [row] = await db
		.insert(alerts)
		.values({
			type: a.type,
			subjectKey: a.subjectKey,
			subjectLabel: a.subjectLabel,
			message: a.message,
			href: a.href ?? null,
			createdAt: Date.now()
		})
		.returning();
	return toRecord(row, false);
}

function toRecord(row: typeof alerts.$inferSelect, read: boolean): AlertRecord {
	return {
		id: row.id,
		type: row.type as AlertType,
		subjectKey: row.subjectKey,
		subjectLabel: row.subjectLabel,
		message: row.message,
		href: row.href,
		createdAt: row.createdAt,
		read
	};
}

/** The conditions that hide what this user switched off or muted. */
function visibleTo(prefs: UserAlertPrefs): SQL[] {
	const conds: SQL[] = [];
	const off = ALERT_TYPES.filter((t) => !prefs.enabled[t]);
	if (off.length) conds.push(notInArray(alerts.type, off));
	if (prefs.muted.length) conds.push(notInArray(alerts.subjectKey, prefs.muted));
	return conds;
}

const readBy = (userId: number) =>
	and(eq(alertReads.alertId, alerts.id), eq(alertReads.userId, userId));

export interface AlertQuery {
	type?: AlertType;
	unreadOnly?: boolean;
	limit?: number;
	/** Cursor: only alerts older than this createdAt. */
	before?: number;
}

export async function listAlerts(userId: number, q: AlertQuery = {}): Promise<AlertRecord[]> {
	const conds = visibleTo(await getUserPrefs(userId));
	if (q.type) conds.push(eq(alerts.type, q.type));
	if (q.unreadOnly) conds.push(isNull(alertReads.alertId));
	if (q.before != null) conds.push(lt(alerts.createdAt, q.before));
	const rows = await db
		.select({ alert: alerts, readId: alertReads.alertId })
		.from(alerts)
		.leftJoin(alertReads, readBy(userId))
		.where(conds.length ? and(...conds) : undefined)
		.orderBy(desc(alerts.createdAt), desc(alerts.id))
		.limit(Math.min(Math.max(q.limit ?? 100, 1), 500));
	return rows.map((r) => toRecord(r.alert, r.readId != null));
}

export async function unreadCount(userId: number): Promise<number> {
	const conds = [...visibleTo(await getUserPrefs(userId)), isNull(alertReads.alertId)];
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(alerts)
		.leftJoin(alertReads, readBy(userId))
		.where(and(...conds));
	return row.n;
}

export async function setRead(
	userId: number,
	opts: { ids?: number[]; all?: boolean; read: boolean }
): Promise<void> {
	if (opts.all) {
		if (!opts.read) {
			await db.delete(alertReads).where(eq(alertReads.userId, userId));
			return;
		}
		const conds = [...visibleTo(await getUserPrefs(userId)), isNull(alertReads.alertId)];
		const unread = await db
			.select({ id: alerts.id })
			.from(alerts)
			.leftJoin(alertReads, readBy(userId))
			.where(and(...conds));
		await markRead(
			userId,
			unread.map((r) => r.id)
		);
	} else if (opts.ids && opts.ids.length > 0) {
		if (opts.read) await markRead(userId, opts.ids);
		else {
			await db
				.delete(alertReads)
				.where(and(eq(alertReads.userId, userId), inArray(alertReads.alertId, opts.ids)));
		}
	}
}

/** Ids that no longer exist are skipped (the foreign key would otherwise reject the whole batch). */
async function markRead(userId: number, ids: number[]): Promise<void> {
	if (ids.length === 0) return;
	await db.execute(sql`
		insert into alert_reads (user_id, alert_id)
		select ${userId}::int, id from alerts where id in (${sql.join(
			ids.map((i) => sql`${i}`),
			sql`, `
		)})
		on conflict do nothing`);
}
