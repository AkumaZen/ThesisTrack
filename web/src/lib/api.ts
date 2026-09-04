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
	proposeNiche: (broadIndustry: string, name: string) =>
		request('POST', '/taxonomy/niches', { broad_industry: broadIndustry, name }),
	getMetrics: (operatingModel?: string) =>
		request('GET', `/metrics${operatingModel ? `?operating_model=${operatingModel}` : ''}`),

	// Custom tables (app/routers/custom_tables.py)
	listTables: (companyId: string) => request('GET', `/companies/${encodeURIComponent(companyId)}/tables`),
	createTable: (companyId: string, payload: unknown) =>
		request('POST', `/companies/${encodeURIComponent(companyId)}/tables`, payload),
	getTable: (tableId: number) => request('GET', `/tables/${tableId}`),
	patchTable: (tableId: number, payload: unknown) => request('PATCH', `/tables/${tableId}`, payload),
	deleteTable: (tableId: number) => request('DELETE', `/tables/${tableId}`),
	createRow: (tableId: number, rowData: unknown) => request('POST', `/tables/${tableId}/rows`, { row_data: rowData }),
	updateRow: (tableId: number, rowId: number, rowData: unknown) =>
		request('PUT', `/tables/${tableId}/rows/${rowId}`, { row_data: rowData }),
	deleteRow: (tableId: number, rowId: number) => request('DELETE', `/tables/${tableId}/rows/${rowId}`),

	// Status proposals / review queue (app/routers/health.py)
	listProposals: (state?: string) => request('GET', `/proposals?${buildQuery({ state: state ?? 'pending' })}`),
	resolveProposal: (id: number, payload: { action: 'accept' | 'reject'; verdict?: string | null; note?: string | null }) =>
		request('POST', `/proposals/${id}/resolve`, payload),

	// Guidance notes (app/routers/guidance.py)
	listGuidance: (params?: Record<string, unknown>) => request('GET', `/guidance?${buildQuery(params)}`),
	createGuidance: (companyId: string, payload: { block_key: string; note: string }) =>
		request('POST', `/companies/${encodeURIComponent(companyId)}/guidance`, payload),
	resolveGuidance: (id: number) => request('POST', `/guidance/${id}/resolve`),
	deleteGuidance: (id: number) => request('DELETE', `/guidance/${id}`),

	// Observations (app/routers/observations.py)
	postObservations: (companyId: string, payload: unknown) =>
		request('POST', `/companies/${encodeURIComponent(companyId)}/observations`, payload),

	// Decisions (app/routers/decisions.py) - insert-only, position_decisions is append-only via DB trigger
	listDecisions: (companyId: string) => request('GET', `/companies/${encodeURIComponent(companyId)}/decisions`),
	logDecision: (companyId: string, payload: unknown) =>
		request('POST', `/companies/${encodeURIComponent(companyId)}/decisions`, payload),

	// Prices / performance (app/routers/price.py)
	listPrices: (companyId: string) => request('GET', `/companies/${encodeURIComponent(companyId)}/prices`),
	logPrice: (companyId: string, payload: unknown) =>
		request('POST', `/companies/${encodeURIComponent(companyId)}/prices`, payload),
	getPerformance: (companyId: string, baseline?: 'thesis' | 'decision') =>
		request('GET', `/companies/${encodeURIComponent(companyId)}/performance?${buildQuery({ baseline })}`),

	// Health check / outcome (app/routers/health.py)
	submitHealthCheck: (companyId: string, payload: unknown) =>
		request('POST', `/companies/${encodeURIComponent(companyId)}/health-check`, payload),
	submitOutcome: (companyId: string, payload: unknown) =>
		request('POST', `/companies/${encodeURIComponent(companyId)}/outcome`, payload),

	// AI reviewer (app/routers/ai_review.py)
	runAiReview: (companyId: string, payload: { period: string; narrative?: string | null }) =>
		request('POST', `/companies/${encodeURIComponent(companyId)}/ai-review`, payload),

	// SFT export (app/routers/export.py)
	getExportStats: (params?: { split?: string; include_open?: boolean }) =>
		request('GET', `/export-training-data/stats?${buildQuery(params)}`),
	exportTrainingDataUrl: (params: {
		task: string;
		format?: string;
		split?: string;
		min_confidence?: number;
		include_open?: boolean;
	}) => `${API_BASE}/export-training-data?${buildQuery(params)}`
};

export { buildQuery, request };
