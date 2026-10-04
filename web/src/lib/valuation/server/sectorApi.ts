import { error, json } from '@sveltejs/kit';
import { SectorEditError } from './sectorStore';
import { verifySymbol, type VerifyResult } from './symbolVerify';

/** Runs a Sector Manager mutation, mapping expected edit failures to their 4xx status. */
export async function handleEdit<T>(fn: () => Promise<T>): Promise<Response> {
	try {
		return json(await fn());
	} catch (e) {
		if (e instanceof SectorEditError) error(e.status, e.message);
		throw e;
	}
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
	try {
		const body = await request.json();
		if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
			return body as Record<string, unknown>;
		}
	} catch {
		// fall through
	}
	error(400, 'Expected a JSON object body.');
}

/** Verifies a symbol or throws a 4xx edit error carrying the reason - used by every endpoint
 *  that adds a company, so a symbol can never reach a basket without passing verification. */
export async function requireVerified(raw: unknown): Promise<Extract<VerifyResult, { ok: true }>> {
	if (typeof raw !== 'string') throw new SectorEditError(400, 'Missing "symbol".');
	let result: VerifyResult;
	try {
		result = await verifySymbol(raw);
	} catch (e) {
		error(502, (e as Error).message);
	}
	if (!result.ok) {
		const hint = result.suggestions.length
			? ` Did you mean: ${result.suggestions.map((s) => `${s.symbol} (${s.name})`).join(', ')}?`
			: '';
		throw new SectorEditError(400, result.reason + hint);
	}
	return result;
}
