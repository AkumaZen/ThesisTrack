import { STATUS_STYLES, escapeHtml, formatMetricValue } from "./format.js";

function redlineBar(trigger) {
  if (trigger.manual_check || trigger.metric_key === null) {
    return `<div class="text-xs text-slate-500 italic">Manual check - not quantifiable.</div>`;
  }
  const observed = trigger.latest_observed_value;
  const threshold = trigger.threshold;
  if (observed === null || observed === undefined) {
    return `<div class="text-xs text-slate-400">No observation yet for ${escapeHtml(trigger.metric_key)}.</div>`;
  }
  const breached = trigger.latest_breached;
  const span = Math.max(Math.abs(observed), Math.abs(threshold), 1) * 1.4;
  const obsPct = Math.min(100, Math.max(0, (observed / span) * 100));
  const thPct = Math.min(100, Math.max(0, (threshold / span) * 100));
  return `
    <div class="mt-1">
      <div class="relative h-2 rounded-full bg-slate-100">
        <div class="absolute inset-y-0 left-0 rounded-full ${breached ? "bg-rose-500" : "bg-emerald-500"}" style="width:${obsPct}%"></div>
        <div class="absolute inset-y-0 w-0.5 bg-slate-700" style="left:${thPct}%"></div>
      </div>
      <div class="flex justify-between text-[11px] text-slate-500 mt-0.5">
        <span>observed ${observed}</span>
        <span>threshold ${trigger.operator || ""} ${threshold}</span>
      </div>
    </div>`;
}

function killTriggerRow(trigger) {
  const fired = trigger.latest_fired;
  return `
    <div class="border-b border-slate-100 py-2 last:border-0">
      <div class="flex items-center justify-between">
        <span class="text-sm ${fired ? "text-rose-700 font-medium" : "text-slate-700"}">${escapeHtml(trigger.label)}</span>
        <span class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${trigger.severity === "kill" ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600"}">${trigger.severity}</span>
      </div>
      <div class="text-xs text-slate-500">${escapeHtml(trigger.action)} · grace ${trigger.grace_periods}</div>
      ${redlineBar(trigger)}
    </div>`;
}

function healthCheckTimeline(healthChecks) {
  if (!healthChecks.length) return `<div class="text-xs text-slate-400">No health checks recorded yet.</div>`;
  return healthChecks
    .map((h) => {
      const style = STATUS_STYLES[h.verdict] || STATUS_STYLES.on_track;
      return `<div class="flex gap-2 py-1.5 border-b border-slate-100 last:border-0">
        <span class="inline-block h-2 w-2 mt-1.5 rounded-full ${style.dot} shrink-0"></span>
        <div>
          <div class="text-xs font-medium">${escapeHtml(h.period)} - ${style.label} <span class="text-slate-400 font-normal">(${h.source}${h.human_confirmed ? ", confirmed" : ""})</span></div>
          <div class="text-xs text-slate-500">${escapeHtml(h.note)}</div>
        </div>
      </div>`;
    })
    .join("");
}

function reasoningList(items) {
  return `<ol class="list-decimal list-inside text-sm space-y-1 text-slate-700">
    ${(items || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
  </ol>`;
}

export function renderDrawer(detail) {
  const t = detail.current_thesis || {};
  const style = STATUS_STYLES[detail.status] || STATUS_STYLES.on_track;
  const revenueRows = (t.the_business?.revenue_split || [])
    .map((r) => `<div class="flex justify-between text-sm"><span>${escapeHtml(r.segment)}</span><span>${r.share_pct}%</span></div>`)
    .join("");

  const references = (t.references || [])
    .map((r) => `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" class="block text-sm text-blue-600 hover:underline">${escapeHtml(r.title)}</a>`)
    .join("");

  return `
    <div class="p-5 overflow-y-auto h-full">
      <div class="flex items-start justify-between">
        <div>
          <div class="flex items-center gap-2">
            <span class="inline-block h-2 w-2 rounded-full ${style.dot}"></span>
            <span class="text-xs font-medium ${style.pill} px-2 py-0.5 rounded-full ring-1">${style.label}</span>
            ${detail.has_active_override ? `<span class="text-[10px] font-semibold uppercase text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full ring-1 ring-rose-600/20">Active Override</span>` : ""}
          </div>
          <h2 class="text-xl font-semibold mt-1">${escapeHtml(detail.name)}</h2>
          <div class="text-sm text-slate-500">${escapeHtml(detail.broad_industry)} &gt; ${escapeHtml(detail.specific_niche)} · ${escapeHtml(detail.operating_model)} · ${escapeHtml(detail.currency)}</div>
        </div>
        <button id="drawer-close" class="text-slate-400 hover:text-slate-700 text-xl leading-none">&times;</button>
      </div>

      ${detail.active_override ? `
        <div class="mt-3 rounded-md bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800">
          <strong>Override active:</strong> status held at ${detail.active_override.to_status} by ${escapeHtml(detail.active_override.actor)}.
          <div class="mt-1 text-rose-700">${escapeHtml(detail.active_override.rationale)}</div>
        </div>` : ""}

      <div class="mt-4 flex gap-2">
        <button id="drawer-amend" class="text-sm px-3 py-1.5 rounded-md bg-slate-800 text-white hover:bg-slate-700">Amend Thesis</button>
        <button id="drawer-observations" class="text-sm px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50">Post Observations</button>
        <button id="drawer-health-check" class="text-sm px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50">Log Health Check</button>
        <button id="drawer-ai-review" class="text-sm px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50">Run AI Review</button>
      </div>

      <section class="mt-5">
        <h3 class="font-medium text-sm text-slate-500 uppercase tracking-wide">The Business</h3>
        <p class="text-sm mt-1">${escapeHtml(t.the_business?.what_it_does)}</p>
        <div class="mt-2 space-y-0.5">${revenueRows}</div>
      </section>

      <section class="mt-5">
        <h3 class="font-medium text-sm text-slate-500 uppercase tracking-wide">The Growth Engine</h3>
        <ul class="list-disc list-inside text-sm mt-1 space-y-0.5">
          ${(t.the_growth_engine || []).map((g) => `<li>${escapeHtml(g)}</li>`).join("")}
        </ul>
      </section>

      <section class="mt-5">
        <h3 class="font-medium text-sm text-slate-500 uppercase tracking-wide">The Big Change</h3>
        <p class="text-sm mt-1">${escapeHtml(t.the_big_change?.summary)}</p>
        <div class="text-xs text-slate-500 mt-0.5">Expected completion: ${escapeHtml(t.the_big_change?.expected_completion)}</div>
      </section>

      <section class="mt-5">
        <h3 class="font-medium text-sm text-slate-500 uppercase tracking-wide">Proof Points</h3>
        <ul class="list-disc list-inside text-sm mt-1 space-y-0.5">
          ${(t.proof_points?.hard_evidence || []).map((e) => `<li>${escapeHtml(e)}</li>`).join("")}
        </ul>
      </section>

      <section class="mt-5">
        <h3 class="font-medium text-sm text-slate-500 uppercase tracking-wide">Why We Believe It</h3>
        <div class="mt-1">${reasoningList(t.why_we_believe_it)}</div>
      </section>

      <section class="mt-5">
        <h3 class="font-medium text-sm text-slate-500 uppercase tracking-wide">Invalidation Redlines</h3>
        <div class="mt-1">${(detail.kill_triggers || []).map(killTriggerRow).join("") || '<div class="text-xs text-slate-400">None defined.</div>'}</div>
      </section>

      <section class="mt-5">
        <h3 class="font-medium text-sm text-slate-500 uppercase tracking-wide">Health Check Timeline</h3>
        <p class="text-sm mt-1 text-slate-600">${escapeHtml(t.health_check?.latest_quarter_review)}</p>
        <div class="mt-2">${healthCheckTimeline(detail.health_checks || [])}</div>
      </section>

      ${detail.pending_proposals?.length ? `
        <section class="mt-5">
          <h3 class="font-medium text-sm text-slate-500 uppercase tracking-wide">Pending Proposals</h3>
          <div class="text-xs text-slate-500 mt-1">${detail.pending_proposals.length} pending - resolve them from the Review Queue.</div>
        </section>` : ""}

      <section class="mt-5 mb-8">
        <h3 class="font-medium text-sm text-slate-500 uppercase tracking-wide">References</h3>
        <div class="mt-1 space-y-0.5">${references}</div>
      </section>
    </div>`;
}
