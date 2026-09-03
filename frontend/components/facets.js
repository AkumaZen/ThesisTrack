import { escapeHtml } from "./format.js";

const OPERATING_MODELS = ["factory", "subscription", "money_lending", "retail_stores", "services"];
const STATUSES = ["on_track", "watch_closely", "broken"];

function chipGroup(name, options, selected) {
  return options
    .map((opt) => {
      const checked = selected.includes(opt) ? "checked" : "";
      const label = typeof opt === "string" ? opt : opt.label;
      const value = typeof opt === "string" ? opt : opt.value;
      return `<label class="facet-chip">
        <input type="checkbox" class="facet-input" data-facet="${name}" value="${escapeHtml(value)}" ${checked} />
        <span>${escapeHtml(label)}</span>
      </label>`;
    })
    .join("");
}

function filterGroup(title, name, options, selected) {
  if (!options.length) return "";
  return `
    <div class="min-w-[160px]">
      <div class="text-xs font-medium text-muted-fg mb-1.5">${title}</div>
      <div class="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">${chipGroup(name, options, selected)}</div>
    </div>`;
}

export function renderFacetBar(taxonomy, filters) {
  const industries = taxonomy.map((i) => i.name);
  const selectedIndustries = filters.broad_industry || [];
  const nicheSource = selectedIndustries.length
    ? taxonomy.filter((i) => selectedIndustries.includes(i.name))
    : taxonomy;
  const niches = nicheSource.flatMap((i) => i.niches.map((n) => n.name));

  return `
    <div class="rounded-lg border border-border bg-surface mb-4">
      <div class="flex flex-wrap items-center gap-4 p-3 border-b border-border">
        <input type="search" id="search-input" placeholder="Search companies..."
          value="${escapeHtml(filters.q || "")}"
          class="flex-1 min-w-[200px] rounded-md border border-border px-3 py-1.5 text-sm" />
        <label class="flex items-center gap-2 text-sm text-muted-fg shrink-0">
          <input type="checkbox" id="review-due-toggle" ${filters.review_due ? "checked" : ""} />
          Review due only
        </label>
        <div class="flex items-center gap-2 text-sm shrink-0">
          <label class="text-muted-fg" for="sort-select">Sort</label>
          <select id="sort-select" class="rounded-md border border-border px-2 py-1 text-sm">
            <option value="name" ${filters.sort === "name" ? "selected" : ""}>Name</option>
            <option value="last_reviewed" ${filters.sort === "last_reviewed" ? "selected" : ""}>Last Reviewed</option>
          </select>
        </div>
      </div>
      <div class="flex flex-wrap gap-x-6 gap-y-3 p-3">
        ${filterGroup("Industry", "broad_industry", industries, selectedIndustries)}
        ${filterGroup("Niche", "niche", niches, filters.niche || [])}
        ${filterGroup("Operating Model", "operating_model", OPERATING_MODELS, filters.operating_model || [])}
        ${filterGroup("Status", "status", STATUSES, filters.status || [])}
      </div>
    </div>`;
}
