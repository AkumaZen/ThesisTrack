import { STATUS_STYLES, daysSince, escapeHtml, formatMetricValue } from "./format.js";

export function renderHeaderStats(companies) {
  const total = companies.length;
  const counts = { on_track: 0, watch_closely: 0, broken: 0 };
  let reviewDue = 0;
  let activeOverrides = 0;
  for (const c of companies) {
    counts[c.status] = (counts[c.status] || 0) + 1;
    if ((daysSince(c.last_reviewed) ?? 0) > 91) reviewDue += 1;
    if (c.has_active_override) activeOverrides += 1;
  }

  const tile = (label, value, extraClass = "") => `
    <div class="flex-1 min-w-[120px] rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div class="text-2xl font-semibold ${extraClass}">${value}</div>
      <div class="text-xs text-slate-500">${label}</div>
    </div>`;

  return `
    <div class="flex flex-wrap gap-3 mb-4">
      ${tile("Total Tracked", total)}
      ${tile("On Track", counts.on_track, "text-emerald-600")}
      ${tile("Watch Closely", counts.watch_closely, "text-amber-600")}
      ${tile("Broken", counts.broken, "text-rose-600")}
      ${tile("Review Due", reviewDue, reviewDue ? "text-amber-600" : "")}
      ${tile("Active Overrides", activeOverrides, activeOverrides ? "text-rose-600" : "")}
    </div>`;
}

function metricChips(coreMetrics, metricDefsByKey) {
  const entries = Object.entries(coreMetrics || {}).slice(0, 4);
  if (!entries.length) return `<div class="text-xs text-slate-400 mt-2">No metrics yet</div>`;
  return `
    <div class="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
      ${entries
        .map(([key, value]) => {
          const def = metricDefsByKey[key];
          const label = def?.label || key;
          const unit = def?.unit || "ratio";
          return `<div class="text-xs">
            <span class="text-slate-400">${escapeHtml(label)}</span>
            <span class="block font-medium text-slate-800">${formatMetricValue(value, unit, def?.decimals)}</span>
          </div>`;
        })
        .join("")}
    </div>`;
}

export function renderCards(companies, metricDefsByKey) {
  if (!companies.length) {
    return `<div class="col-span-full text-center text-slate-400 py-16">No companies match these filters.</div>`;
  }
  return companies
    .map((c) => {
      const style = STATUS_STYLES[c.status] || STATUS_STYLES.on_track;
      const since = daysSince(c.last_reviewed);
      return `
      <button data-company-id="${escapeHtml(c.company_id)}"
        class="card-open text-left rounded-xl border border-slate-200 bg-white p-4 hover:shadow-md transition-shadow relative">
        ${c.has_active_override ? `<span class="absolute top-3 right-3 text-[10px] font-semibold uppercase tracking-wide text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full ring-1 ring-rose-600/20">Override</span>` : ""}
        <div class="flex items-center gap-2">
          <span class="inline-block h-2 w-2 rounded-full ${style.dot}"></span>
          <span class="text-xs font-medium ${style.pill} px-2 py-0.5 rounded-full ring-1">${style.label}</span>
        </div>
        <div class="mt-2 font-semibold text-slate-900">${escapeHtml(c.name)}</div>
        <div class="text-xs text-slate-500">${escapeHtml(c.broad_industry)} &gt; ${escapeHtml(c.specific_niche)}</div>
        <div class="text-xs text-slate-400 mt-1">${escapeHtml(c.operating_model)} · ${since === null ? "never reviewed" : `${since}d since review`}</div>
        ${metricChips(c.core_metrics, metricDefsByKey)}
      </button>`;
    })
    .join("");
}
