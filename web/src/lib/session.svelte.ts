// The signed-in person, as a shared reactive store for the thesis pages. Filled from the root
// layout's server data (the httpOnly session cookie is resolved in hooks.server.ts), so it is
// always the same person the server sees - nothing auth-related lives in localStorage any more.
import { canWrite, type SessionUser } from '$lib/auth';

class SessionState {
	user = $state<SessionUser | null>(null);

	email = $derived(this.user?.email ?? '');
	displayName = $derived(this.user?.username ?? '');
	role = $derived(this.user?.role ?? '');
	isAdmin = $derived(this.user?.role === 'admin');
	isReadOnly = $derived(!canWrite(this.user?.role));
	isAuthenticated = $derived(this.user !== null);

	set(user: SessionUser | null) {
		this.user = user;
	}
}

export const session = new SessionState();
