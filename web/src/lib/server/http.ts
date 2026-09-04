// Matches FastAPI's default HTTPException JSON shape ({"detail": "..."})
// so the frontend's error-handling (errorMessage() reading `detail`) needs
// no changes when pointed at the new backend.
import { json } from '@sveltejs/kit';
import { AuthError, requireWrite, type Actor } from './auth';

export function errorResponse(status: number, detail: string) {
	return json({ detail }, { status });
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
