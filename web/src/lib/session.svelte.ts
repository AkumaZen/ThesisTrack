// Class-based $state store (Svelte 5 best practice: prefer this over
// writable stores for shared reactivity). Ports frontend/state.js's
// localStorage session helpers.
class SessionState {
	token = $state(typeof localStorage !== 'undefined' ? localStorage.getItem('thesis_token') || '' : '');
	email = $state(typeof localStorage !== 'undefined' ? localStorage.getItem('thesis_email') || '' : '');
	role = $state(typeof localStorage !== 'undefined' ? localStorage.getItem('thesis_role') || '' : '');
	apiKey = $state(typeof localStorage !== 'undefined' ? localStorage.getItem('thesis_api_key') || '' : '');

	isReadOnly = $derived(this.role === 'read_only');
	isAuthenticated = $derived(Boolean(this.token || this.apiKey));

	setSession(token: string, email: string, role: string) {
		this.token = token;
		this.email = email;
		this.role = role;
		localStorage.setItem('thesis_token', token);
		localStorage.setItem('thesis_email', email);
		localStorage.setItem('thesis_role', role);
	}

	setApiKey(key: string) {
		this.apiKey = key;
		localStorage.setItem('thesis_api_key', key);
	}

	clear() {
		this.token = '';
		this.email = '';
		this.role = '';
		this.apiKey = '';
		localStorage.removeItem('thesis_token');
		localStorage.removeItem('thesis_email');
		localStorage.removeItem('thesis_role');
		localStorage.removeItem('thesis_api_key');
	}
}

export const session = new SessionState();
