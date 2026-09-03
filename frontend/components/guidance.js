import { escapeHtml } from "./format.js";

export const BLOCK_KEYS = [
  "general",
  "the_business",
  "the_growth_engine",
  "the_big_change",
  "proof_points",
  "what_can_kill_it",
  "why_we_believe_it",
  "health_check",
  "references",
];

export function blockLabel(key) {
  if (key === "general") return "General";
  return key
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function blockOptions(selected) {
  return BLOCK_KEYS.map(
    (k) => `<option value="${k}" ${k === selected ? "selected" : ""}>${blockLabel(k)}</option>`
  ).join("");
}

export function renderGuidanceFilterBar(companies, filters) {
  const companyOptions = companies
    .map(
      (c) =>
        `<option value="${escapeHtml(c.company_id)}" ${c.company_id === filters.company_id ? "selected" : ""}>${escapeHtml(c.name)}</option>`
    )
    .join("");
  return `
    <div class="rounded-lg border border-border bg-surface p-4 mb-4 flex flex-wrap items-end gap-4">
      <label class="text-sm">Company
        <select id="guidance-filter-company" class="mt-1 block rounded-md border border-border px-2 py-1.5 text-sm">
          <option value="">All companies</option>
          ${companyOptions}
        </select>
      </label>
      <label class="text-sm">Block
        <select id="guidance-filter-block" class="mt-1 block rounded-md border border-border px-2 py-1.5 text-sm">
          <option value="">All blocks</option>
          ${blockOptions(filters.block_key)}
        </select>
      </label>
      <label class="text-sm">Status
        <select id="guidance-filter-status" class="mt-1 block rounded-md border border-border px-2 py-1.5 text-sm">
          <option value="open" ${filters.status === "open" ? "selected" : ""}>Open</option>
          <option value="resolved" ${filters.status === "resolved" ? "selected" : ""}>Resolved</option>
          <option value="" ${!filters.status ? "selected" : ""}>All</option>
        </select>
      </label>
      <button id="guidance-add" class="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90">+ Add Guidance</button>
    </div>`;
}

function guidanceCard(item, readOnly) {
  const isOpen = item.status === "open";
  return `
    <div class="rounded-lg border border-border bg-surface p-4" data-guidance-id="${item.id}">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <button data-open-company="${escapeHtml(item.company_id)}" class="font-medium hover:text-accent">${escapeHtml(item.company_name || item.company_id)}</button>
            <span class="text-xs px-2 py-0.5 rounded-full bg-surface-3 text-muted-fg">${blockLabel(item.block_key)}</span>
            <span class="text-xs px-2 py-0.5 rounded-full ${isOpen ? "bg-warn/10 text-warn" : "bg-good/10 text-good"}">${item.status}</span>
          </div>
          <p class="text-sm mt-2 whitespace-pre-wrap">${escapeHtml(item.note)}</p>
          <p class="text-xs text-muted-fg mt-2 font-mono">
            ${escapeHtml(item.created_by)} &middot; ${new Date(item.created_at).toLocaleString()}
            ${item.resolved_at ? ` &middot; resolved by ${escapeHtml(item.resolved_by || "")} ${new Date(item.resolved_at).toLocaleString()}` : ""}
          </p>
        </div>
        ${
          readOnly
            ? ""
            : `<div class="flex items-center gap-2 shrink-0">
                ${isOpen ? `<button data-resolve="${item.id}" class="text-xs px-2 py-1 rounded-md border border-border hover:bg-surface-3">Resolve</button>` : ""}
                <button data-delete="${item.id}" class="text-xs px-2 py-1 rounded-md border border-border hover:text-danger">Delete</button>
              </div>`
        }
      </div>
    </div>`;
}

export function renderGuidanceList(items, readOnly) {
  if (!items.length) {
    return `<div class="text-center text-muted-fg py-16">No guidance notes match these filters.</div>`;
  }
  return `<div class="space-y-3">${items.map((item) => guidanceCard(item, readOnly)).join("")}</div>`;
}

export function renderGuidanceAddForm(companies, presetCompanyId) {
  const companyOptions = companies
    .map(
      (c) =>
        `<option value="${escapeHtml(c.company_id)}" ${c.company_id === presetCompanyId ? "selected" : ""}>${escapeHtml(c.name)}</option>`
    )
    .join("");
  return `
    <div class="flex items-center justify-between px-5 py-3 border-b border-border">
      <h2 class="font-semibold">Add Guidance</h2>
      <button id="modal-close-x" class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
    </div>
    <div class="p-5 space-y-3">
      <label class="block text-sm">Company
        <select id="guidance-company" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">${companyOptions}</select>
      </label>
      <label class="block text-sm">Block
        <select id="guidance-block" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">${blockOptions("general")}</select>
      </label>
      <label class="block text-sm">Note
        <textarea id="guidance-note" rows="4" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" placeholder="What should the analyst look into or keep in mind on this block?"></textarea>
      </label>
    </div>
    <div class="px-5 py-3 border-t border-border flex justify-end gap-2">
      <button id="modal-cancel" class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Cancel</button>
      <button id="guidance-submit" class="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90">Add</button>
    </div>`;
}
