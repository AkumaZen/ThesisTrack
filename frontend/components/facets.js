import { escapeHtml } from "./format.js";

const OPERATING_MODELS = ["factory", "subscription", "money_lending", "retail_stores", "services"];
const STATUSES = ["on_track", "watch_closely", "broken"];

function checkboxGroup(name, options, selected) {
  return options
    .map((opt) => {
      const checked = selected.includes(opt) ? "checked" : "";
      const label = typeof opt === "string" ? opt : opt.label;
      const value = typeof opt === "string" ? opt : opt.value;
      return `<label class="flex items-center gap-2 text-sm px-2 py-1 hover:bg-slate-50 rounded cursor-pointer">
        <input type="checkbox" class="facet-input" data-facet="${name}" value="${escapeHtml(value)}" ${checked} />
        ${escapeHtml(label)}
      </label>`;
    })
    .join("");
}

export function renderFacetBar(taxonomy, filters) {
  const industries = taxonomy.map((i) => i.name);
  const allNiches = taxonomy.flatMap((i) => i.niches.map((n) => n.name));

  return `
    <div class="rounded-lg border border-slate-200 bg-white p-4 mb-4 flex flex-wrap gap-6">
      <div class="flex-1 min-w-[220px]">
        <input type="search" id="search-input" placeholder="Search companies..."
          value="${escapeHtml(filters.q || "")}"
          class="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        <label class="flex items-center gap-2 mt-2 text-sm text-slate-600">
          <input type="checkbox" id="review-due-toggle" ${filters.review_due ? "checked" : ""} />
          Review due only
        </label>
        <div class="mt-2">
          <label class="text-xs text-slate-500">Sort by</label>
          <select id="sort-select" class="w-full rounded-md border border-slate-300 px-2 py-1 text-sm">
            <option value="name" ${filters.sort === "name" ? "selected" : ""}>Name</option>
            <option value="last_reviewed" ${filters.sort === "last_reviewed" ? "selected" : ""}>Last Reviewed</option>
          </select>
        </div>
      </div>
      <div>
        <div class="text-xs font-medium text-slate-500 mb-1">Industry</div>
        ${checkboxGroup("broad_industry", industries, filters.broad_industry || [])}
      </div>
      <div>
        <div class="text-xs font-medium text-slate-500 mb-1">Niche</div>
        ${checkboxGroup("niche", allNiches, filters.niche || [])}
      </div>
      <div>
        <div class="text-xs font-medium text-slate-500 mb-1">Operating Model</div>
        ${checkboxGroup("operating_model", OPERATING_MODELS, filters.operating_model || [])}
      </div>
      <div>
        <div class="text-xs font-medium text-slate-500 mb-1">Status</div>
        ${checkboxGroup("status", STATUSES, filters.status || [])}
      </div>
    </div>`;
}
