// Ports frontend/api.js's request()/ApiError pattern - grows one method per
// backend phase, same as the original file did.
import { session } from './session.svelte';

const API_BASE = '/api';

export class ApiError extends Error {
	status: number;
	body: unknown;
	constructor(status: number, body: unknown) {
		super(typeof body === 'string' ? body : JSON.stringify(body));
		this.status = status;
		this.body = body;
	}
}

function buildQuery(params?: Record<string, unknown>): string {
	const usp = new URLSearchParams();
	for (const [key, value] of Object.entries(params ?? {})) {
		if (value === undefined || value === null) continue;
		if (Array.isArray(value)) {
			for (const v of value) usp.append(key, String(v));
		} else {
			usp.append(key, String(value));
		}
	}
	return usp.toString();
}

async function request(method: string, path: string, body?: unknown) {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (session.token) {
		headers['Authorization'] = `Bearer ${session.token}`;
	} else if (session.apiKey) {
		headers['X-API-Key'] = session.apiKey;
	}
	const resp = await fetch(`${API_BASE}${path}`, {
		method,
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined
	});
	const isJson = resp.headers.get('content-type')?.includes('application/json');
	const data = isJson ? await resp.json() : await resp.text();
	if (!resp.ok) throw new ApiError(resp.status, data);
	return data;
}

export const api = {
	login: (email: string, password: string) => request('POST', '/auth/login', { email, password }),
	me: () => request('GET', '/auth/me'),
	changePassword: (oldPassword: string, newPassword: string) =>
		request('POST', '/auth/change-password', { old_password: oldPassword, new_password: newPassword }),
	listCompanies: (params?: Record<string, unknown>) => request('GET', `/companies?${buildQuery(params)}`),
	getCompany: (id: string) => request('GET', `/companies/${encodeURIComponent(id)}`),
	createCompany: (payload: unknown) => request('POST', '/companies', payload),
	amendThesis: (id: string, payload: unknown) => request('PUT', `/companies/${encodeURIComponent(id)}/thesis`, payload),
	getVersions: (id: string, diff?: string) =>
		request('GET', `/companies/${encodeURIComponent(id)}/versions${diff ? `?diff=${diff}` : ''}`),
	getTaxonomy: () => request('GET', '/taxonomy'),
	getMetrics: (operatingModel?: string) =>
		request('GET', `/metrics${operatingModel ? `?operating_model=${operatingModel}` : ''}`)
};

export { buildQuery, request };
