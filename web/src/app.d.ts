// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Actor } from '$lib/server/auth';
import type { SessionUser } from '$lib/auth';

declare global {
	namespace App {
		interface Error {
			message: string;
			/** Set for unexpected (500) errors; the same id is in the server log line. */
			errorId?: string;
		}
		interface Locals {
			/** The signed-in person for this request, or null (set in hooks.server.ts). */
			user: SessionUser | null;
			/** The raw session cookie value, kept so a password change can preserve this session. */
			sessionToken: string | null;
			/** Who thesis routes act as: the signed-in person, or a script's API key / bearer token. */
			actor: Actor | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
