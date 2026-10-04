import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getAlertSettings,
	saveAlertSettings,
	type AlertSettingsPatch
} from '$lib/valuation/server/alertStore';
import { emailStatus } from '$lib/valuation/server/alertNotify';
import { ALERT_TYPES, type AlertType } from '$lib/valuation/alerts';
import { parseThresholds } from '$lib/valuation/rsThresholds';

async function snapshot(userId: number) {
	return { ...(await getAlertSettings(userId)), email: emailStatus() };
}

export const GET: RequestHandler = async ({ locals }) => json(await snapshot(locals.user!.id));

function stringArray(value: unknown, name: string): string[] {
	if (!Array.isArray(value) || !value.every((m) => typeof m === 'string')) {
		error(400, `"${name}" must be an array of strings.`);
	}
	return value as string[];
}

/** Body (all optional, partial updates): { enabled: { [type]: boolean }, mute: string[],
 *  unmute: string[], muted: string[] (replaces the whole list), thresholds: { weeklyPct,
 *  monthlyPct } }. Alert types and mutes belong to the signed-in user alone; the sector-rotation
 *  thresholds are shared configuration, so only the admin may change them. */
export const PUT: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as {
		enabled?: Record<string, unknown>;
		muted?: unknown;
		mute?: unknown;
		unmute?: unknown;
		thresholds?: unknown;
	} | null;
	if (!body || typeof body !== 'object') error(400, 'Expected a JSON object.');

	const patch: AlertSettingsPatch = {};
	if (body.enabled !== undefined) {
		if (typeof body.enabled !== 'object' || body.enabled === null)
			error(400, '"enabled" must be an object.');
		patch.enabled = {};
		for (const [k, v] of Object.entries(body.enabled)) {
			if (!ALERT_TYPES.includes(k as AlertType)) error(400, `Unknown alert type "${k}".`);
			if (typeof v !== 'boolean') error(400, `"enabled.${k}" must be true or false.`);
			patch.enabled[k as AlertType] = v;
		}
	}
	if (body.muted !== undefined) patch.muted = stringArray(body.muted, 'muted');
	if (body.mute !== undefined) patch.mute = stringArray(body.mute, 'mute');
	if (body.unmute !== undefined) patch.unmute = stringArray(body.unmute, 'unmute');
	if (body.thresholds !== undefined) {
		if (locals.user?.role !== 'admin') error(403, 'Only the admin can change the thresholds.');
		const parsed = parseThresholds(body.thresholds);
		if ('error' in parsed) error(400, parsed.error);
		patch.thresholds = parsed.value;
	}
	await saveAlertSettings(locals.user!.id, patch);
	return json(await snapshot(locals.user!.id));
};
