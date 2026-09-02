// Facet/filter state lives in the URL query string so views are shareable
// and reloadable (BUILD_PLAN.md §8 point 2).
const MULTI_KEYS = ["broad_industry", "niche", "operating_model", "status"];

export function readFiltersFromUrl() {
  const params = new URLSearchParams(location.search);
  const filters = { page: Number(params.get("page")) || 1, page_size: 25, sort: params.get("sort") || "name" };
  for (const key of MULTI_KEYS) {
    const values = params.getAll(key);
    if (values.length) filters[key] = values;
  }
  if (params.get("q")) filters.q = params.get("q");
  if (params.get("review_due")) filters.review_due = "true";
  return filters;
}

export function writeFiltersToUrl(filters) {
  const params = new URLSearchParams();
  for (const key of MULTI_KEYS) {
    for (const v of filters[key] || []) params.append(key, v);
  }
  if (filters.q) params.set("q", filters.q);
  if (filters.review_due) params.set("review_due", "true");
  if (filters.sort && filters.sort !== "name") params.set("sort", filters.sort);
  if (filters.page && filters.page !== 1) params.set("page", String(filters.page));
  const qs = params.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

export function toQueryParams(filters) {
  const out = { page: filters.page || 1, page_size: filters.page_size || 25, sort: filters.sort || "name" };
  for (const key of MULTI_KEYS) {
    if (filters[key]?.length) out[key] = filters[key];
  }
  if (filters.q) out.q = filters.q;
  if (filters.review_due) out.review_due = "true";
  return out;
}
