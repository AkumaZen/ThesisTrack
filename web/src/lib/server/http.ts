// Matches FastAPI's default HTTPException JSON shape ({"detail": "..."})
// so the frontend's error-handling (errorMessage() reading `detail`) needs
// no changes when pointed at the new backend.
import { json } from '@sveltejs/kit';
import type { ZodError } from 'zod';
import { AuthError, requireWrite, type Actor } from './auth';

export function errorResponse(status: number, detail: string) {
	return json({ detail }, { status });
}

// zod's own `error.message` is the whole issues array JSON-stringified -
// readable to a developer, not to whoever is filling in the form that
// tripped it. Collapse it to one line per issue instead.
export function zodErrorMessage(error: ZodError): string {
	return error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');
}

export function requireActor(actor: Actor | null): Actor {
	if (!actor) throw new AuthError('provide a valid X-API-Key or Authorization: Bearer <token>', 401);
	return actor;
}

export function requireWriteActor(actor: Actor | null): Actor {
	return requireWrite(requireActor(actor));
}

export function handleAuthError(err: unknown) {
	if (err instanceof AuthError) return errorResponse(err.status, err.message);
	throw err;
}
