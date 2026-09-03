const API_BASE = "/api";

export function getApiKey() {
  return localStorage.getItem("thesis_api_key") || "";
}

export function setApiKey(key) {
  localStorage.setItem("thesis_api_key", key);
}

export function getToken() {
  return localStorage.getItem("thesis_token") || "";
}

export function getRole() {
  return localStorage.getItem("thesis_role") || "";
}

export function getEmail() {
  return localStorage.getItem("thesis_email") || "";
}

export function setSession(token, email, role) {
  localStorage.setItem("thesis_token", token);
  localStorage.setItem("thesis_email", email);
  localStorage.setItem("thesis_role", role);
}

export function clearSession() {
  localStorage.removeItem("thesis_token");
  localStorage.removeItem("thesis_email");
  localStorage.removeItem("thesis_role");
}

export function isReadOnly() {
  return getRole() === "read_only";
}

class ApiError extends Error {
  constructor(status, body) {
    super(typeof body === "string" ? body : JSON.stringify(body));
    this.status = status;
    this.body = body;
  }
}

function buildQuery(params) {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) usp.append(key, v);
    } else {
      usp.append(key, value);
    }
  }
  return usp.toString();
}

async function request(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else if (getApiKey()) {
    headers["X-API-Key"] = getApiKey();
  }
  const resp = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const isJson = resp.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await resp.json() : await resp.text();
  if (!resp.ok) throw new ApiError(resp.status, data);
  return data;
}

export const api = {
  login: (email, password) => request("POST", "/auth/login", { email, password }),
  me: () => request("GET", "/auth/me"),
  changePassword: (oldPassword, newPassword) =>
    request("POST", "/auth/change-password", { old_password: oldPassword, new_password: newPassword }),
  listCompanies: (params) => request("GET", `/companies?${buildQuery(params)}`),
  getCompany: (id) => request("GET", `/companies/${encodeURIComponent(id)}`),
  createCompany: (payload) => request("POST", "/companies", payload),
  amendThesis: (id, payload) => request("PUT", `/companies/${encodeURIComponent(id)}/thesis`, payload),
  getVersions: (id, diff) =>
    request("GET", `/companies/${encodeURIComponent(id)}/versions${diff ? `?diff=${diff}` : ""}`),
  postObservations: (id, payload) => request("POST", `/companies/${encodeURIComponent(id)}/observations`, payload),
  postHealthCheck: (id, payload) => request("POST", `/companies/${encodeURIComponent(id)}/health-check`, payload),
  postOutcome: (id, payload) => request("POST", `/companies/${encodeURIComponent(id)}/outcome`, payload),
  aiReview: (id, payload) => request("POST", `/companies/${encodeURIComponent(id)}/ai-review`, payload),
  listProposals: (state) => request("GET", `/proposals?state=${state || "pending"}`),
  resolveProposal: (id, payload) => request("POST", `/proposals/${id}/resolve`, payload),
  getTaxonomy: () => request("GET", "/taxonomy"),
  proposeNiche: (payload) => request("POST", "/taxonomy/niches", payload),
  getMetrics: (operatingModel) =>
    request("GET", `/metrics${operatingModel ? `?operating_model=${operatingModel}` : ""}`),
  exportStats: (params) => request("GET", `/export-training-data/stats?${new URLSearchParams(params)}`),
  exportUrl: (params) => `${API_BASE}/export-training-data?${new URLSearchParams(params)}`,
};

export { ApiError };
