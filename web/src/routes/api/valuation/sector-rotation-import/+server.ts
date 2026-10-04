import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	validateUserSectorInput,
	createUserSector,
	SectorEditError
} from '$lib/server/sectorStore';
import { requireVerified } from '$lib/server/sectorApi';

export const POST: RequestHandler = async ({ request }) => {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		error(400, 'Invalid JSON.');
	}

	const validated = await validateUserSectorInput(raw);
	if ('error' in validated) {
		error(400, validated.error);
	}

	try {
		// Same rule as the Sector Manager: a symbol reaches a basket only after Screener.in confirms
		// the exact ticker, so an import can't smuggle in a typo or a made-up symbol.
		const verified = new Map<string, string>();
		for (const sub of validated.input.subsectors) {
			for (const symbol of sub.symbols) {
				if (verified.has(symbol)) continue;
				verified.set(symbol, (await requireVerified(symbol)).symbol);
			}
		}
		for (const sub of validated.input.subsectors) {
			sub.symbols = Array.from(new Set(sub.symbols.map((s) => verified.get(s) ?? s)));
		}
		await createUserSector(validated.input);
	} catch (e) {
		if (e instanceof SectorEditError) error(e.status, e.message);
		throw e;
	}
	return json({ ok: true, key: validated.input.key });
};
