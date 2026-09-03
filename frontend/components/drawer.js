import { STATUS_STYLES, escapeHtml, formatMetricValue } from "./format.js";

function redlineBar(trigger) {
  if (trigger.manual_check || trigger.metric_key === null) {
    return `<div class="text-xs text-muted-fg italic">Manual check - not quantifiable.</div>`;
  }
  const observed = trigger.latest_observed_value;
  const threshold = trigger.threshold;
  if (observed === null || observed === undefined) {
    return `<div class="text-xs text-muted-fg">No observation yet for ${escapeHtml(trigger.metric_key)}.</div>`;
  }
  const breached = trigger.latest_breached;
  const span = Math.max(Math.abs(observed), Math.abs(threshold), 1) * 1.4;
  const obsPct = Math.min(100, Math.max(0, (observed / span) * 100));
  const thPct = Math.min(100, Math.max(0, (threshold / span) * 100));
  return `
    <div class="mt-1">
      <div class="relative h-2 rounded-full bg-surface-3">
        <div class="absolute inset-y-0 left-0 rounded-full ${breached ? "bg-danger" : "bg-good"}" style="width:${obsPct}%"></div>
        <div class="absolute inset-y-0 w-0.5 bg-fg" style="left:${thPct}%"></div>
      </div>
      <div class="flex justify-between text-[11px] text-muted-fg mt-0.5">
        <span>observed ${observed}</span>
        <span>threshold ${trigger.operator || ""} ${threshold}</span>
      </div>
    </div>`;
}

function killTriggerRow(trigger) {
  const fired = trigger.latest_fired;
  return `
    <div class="border-b border-border py-2 last:border-0">
      <div class="flex items-center justify-between">
        <span class="text-sm ${fired ? "text-danger font-medium" : "text-fg"}">${escapeHtml(trigger.label)}</span>
        <span class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${trigger.severity === "kill" ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn"}">${trigger.severity}</span>
      </div>
      <div class="text-xs text-muted-fg">${escapeHtml(trigger.action)} · grace ${trigger.grace_periods}</div>
      ${redlineBar(trigger)}
    </div>`;
}

function healthCheckTimeline(healthChecks) {
  if (!healthChecks.length) return `<div class="text-xs text-muted-fg">No health checks recorded yet.</div>`;
  return healthChecks
    .map((h) => {
      const style = STATUS_STYLES[h.verdict] || STATUS_STYLES.on_track;
      return `<div class="flex gap-2 py-1.5 border-b border-border last:border-0">
        <span class="inline-block h-2 w-2 mt-1.5 rounded-full ${style.dot} shrink-0"></span>
        <div>
          <div class="text-xs font-medium">${escapeHtml(h.period)} - ${style.label} <span class="text-muted-fg font-normal">(${h.source}${h.human_confirmed ? ", confirmed" : ""})</span></div>
          <div class="text-xs text-muted-fg">${escapeHtml(h.note)}</div>
        </div>
      </div>`;
    })
    .join("");
}

// Renders into #drawer-performance, filled/refreshed async by app.js
// (loadPerformanceIntoDrawer) whenever the baseline toggle changes or a
// new price is logged. `perf` is a PerformanceOut from GET .../performance.
export function renderPerformancePanel(perf) {
  if (perf.pct_change === null || perf.pct_change === undefined) {
    return `<div class="text-xs text-muted-fg">${escapeHtml(perf.note || "Not enough data yet.")}</div>`;
  }
  const up = perf.pct_change >= 0;
  const baselineLabel = perf.baseline_mode === "thesis" ? "since thesis review" : "since first buy";
  return `
    <div class="flex items-baseline gap-2">
      <span class="text-2xl font-semibold ${up ? "text-good" : "text-danger"}">${up ? "+" : ""}${perf.pct_change.toFixed(1)}%</span>
      <span class="text-xs text-muted-fg">${baselineLabel}</span>
    </div>
    <div class="text-xs text-muted-fg mt-1">
      ${perf.currency} ${perf.baseline_price} (${perf.baseline_date}) &rarr; ${perf.currency} ${perf.current_price} (${perf.current_date})
    </div>
    ${perf.note ? `<div class="text-xs text-muted-fg italic mt-1">${escapeHtml(perf.note)}</div>` : ""}`;
}

function decisionRow(d) {
  const isBuy = d.action === "buy";
  return `
    <div class="flex items-start gap-2 py-1.5 border-b border-border last:border-0">
      <span class="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 ${isBuy ? "bg-good/10 text-good" : "bg-danger/10 text-danger"}">${isBuy ? "Buy" : "Sell"}</span>
      <div class="min-w-0">
        <div class="text-xs">
          <span class="font-medium">${escapeHtml(d.decided_on)}</span>
          <span class="text-muted-fg"> &middot; ${d.price}${d.quantity ? ` &times; ${d.quantity}` : ""} &middot; by ${escapeHtml(d.actor)}</span>
        </div>
        <div class="text-xs text-muted-fg mt-0.5">${escapeHtml(d.rationale)}</div>
      </div>
    </div>`;
}

// Filled async by app.js (loadDecisionsIntoDrawer) - decisions belong to
// the company, not any one pillar, so they get their own top-level section
// rather than living inside pillarExtra() like notes/tables do.
export function renderDecisionsList(decisions) {
  if (!decisions.length) return `<div class="text-xs text-muted-fg">No decisions logged yet.</div>`;
  return decisions.map(decisionRow).join("");
}

function reasoningList(items) {
  return `<ol class="list-decimal list-inside text-sm space-y-1 text-fg">
    ${(items || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
  </ol>`;
}

// Tier 3 (pillar_notes, read-only here - edited via Amend Thesis like every
// other pillar field) + Tier 2 (a placeholder app.js fills in with any Data
// Tables tagged to this pillar, plus a button to tag a new one here).
function pillarExtra(pillarKey, thesis) {
  const notes = thesis.pillar_notes?.[pillarKey] || [];
  return `
    ${
      notes.length
        ? `<div class="mt-2"><div class="text-xs font-medium text-muted-fg">Notes</div>
            <ul class="list-disc list-inside text-xs mt-0.5 space-y-0.5">${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>
          </div>`
        : ""
    }
    <div class="mt-2 flex items-center justify-end">
      <button data-add-table-section="${pillarKey}" class="text-xs text-ok">+ Add Table</button>
    </div>
    <div id="drawer-tables-${pillarKey}" class="space-y-2 empty:hidden"></div>`;
}

// "Also tracked by" - other users' theses on this company (ADR-026). Full
// side-by-side comparison is a fast-follow; for now this is a lightweight
// pointer showing who else has a thesis here and where their status stands.
function otherScenariosBlock(detail) {
  if (!detail.other_scenarios?.length) return "";
  return `
    <div class="mt-3 flex flex-wrap items-center gap-1.5">
      <span class="text-xs text-muted-fg">Also tracked by:</span>
      ${detail.other_scenarios
        .map((s) => {
          const style = STATUS_STYLES[s.status] || STATUS_STYLES.on_track;
          return `<span class="text-xs px-2 py-0.5 rounded-full ${style.pill} ring-1">${escapeHtml(s.owner)} &middot; ${style.label}</span>`;
        })
        .join("")}
    </div>`;
}

const COMPANY_PAGE_SECTIONS = [
  { id: "business", label: "1. The Business" },
  { id: "growth", label: "2. The Growth Engine" },
  { id: "change", label: "3. The Big Change" },
  { id: "proof", label: "4. Proof Points" },
  { id: "kill", label: "5. What Can Kill It" },
  { id: "believe", label: "6. Why We Believe It" },
  { id: "health", label: "7. Health Check" },
  { id: "decisions", label: "Buy / Sell Decisions" },
  { id: "references", label: "References" },
  { id: "custom", label: "Custom Sections" },
];

// Full-page equivalent of renderDrawer, meant for a dedicated browser tab
// (see openCompanyTab/openCompanyPage in app.js) rather than the narrow
// slide-over: a proper left nav instead of a horizontal jump bar, one
// section per pillar. Deliberately reuses the exact same element ids as
// renderDrawer (drawer-amend, drawer-performance, drawer-tables, etc.) so
// app.js's action-wiring code works unchanged against either container -
// safe because only one of #drawer/#company-page is ever populated with
// real content in a given browser tab.
export function renderCompanyPage(detail) {
  if (!detail.has_own_scenario) {
    return `
      <div class="h-14 border-b border-border flex items-center gap-3 px-4 shrink-0">
        <button id="cp-back" class="text-sm px-2 py-1.5 rounded-md hover:bg-surface-3 text-muted-fg hover:text-fg shrink-0">&larr; Back to Dashboard</button>
        <h1 class="font-semibold text-base flex-1 min-w-0 truncate">${escapeHtml(detail.name)}</h1>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto p-6">
        <div class="max-w-2xl mx-auto">
          <div class="text-sm text-muted-fg">${escapeHtml(detail.broad_industry)} &gt; ${escapeHtml(detail.specific_niche)} &middot; ${escapeHtml(detail.operating_model)} &middot; ${escapeHtml(detail.currency)}</div>
          ${otherScenariosBlock(detail)}
          <div class="mt-6 rounded-md border border-dashed border-border p-5 text-center">
            <p class="text-sm text-muted-fg mb-3">You haven't started a thesis on this company yet.</p>
            <button id="drawer-start-thesis" class="text-sm px-4 py-2 rounded-md bg-accent text-accent-ink hover:brightness-90">+ Start Your Own Thesis</button>
          </div>
        </div>
      </div>`;
  }

  const t = detail.current_thesis || {};
  const style = STATUS_STYLES[detail.status] || STATUS_STYLES.on_track;
  const revenueRows = (t.the_business?.revenue_split || [])
    .map((r) => `<div class="flex justify-between text-sm"><span>${escapeHtml(r.segment)}</span><span>${r.share_pct}%</span></div>`)
    .join("");
  const references = (t.references || [])
    .map((r) => `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" class="block text-sm text-ok hover:underline">${escapeHtml(r.title)}</a>`)
    .join("");

  return `
    <div class="h-14 border-b border-border flex items-center gap-3 px-4 shrink-0">
      <button id="cp-back" class="text-sm px-2 py-1.5 rounded-md hover:bg-surface-3 text-muted-fg hover:text-fg shrink-0">&larr; Back to Dashboard</button>
      <span class="inline-block h-2 w-2 rounded-full ${style.dot} shrink-0"></span>
      <span class="text-xs font-medium ${style.pill} px-2 py-0.5 rounded-full ring-1 shrink-0">${style.label}</span>
      ${detail.has_active_override ? `<span class="text-[10px] font-semibold uppercase text-danger bg-danger/10 px-2 py-0.5 rounded-full ring-1 ring-danger/20 shrink-0">Active Override</span>` : ""}
      <h1 class="font-semibold text-base flex-1 min-w-0 truncate">${escapeHtml(detail.name)}</h1>
      <div class="flex flex-wrap gap-2 shrink-0">
        <button id="drawer-amend" class="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90">Amend Thesis</button>
        <button id="drawer-observations" class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Post Observations</button>
        <button id="drawer-health-check" class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Log Health Check</button>
        <button id="drawer-log-decision" class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Log Buy/Sell</button>
        <button id="drawer-ai-review" class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Run AI Review</button>
        <button id="drawer-guidance" class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Guidance</button>
      </div>
    </div>

    <div class="flex-1 min-h-0 flex overflow-hidden">
      <nav class="w-60 shrink-0 border-r border-border overflow-y-auto p-3 flex flex-col gap-0.5">
        ${COMPANY_PAGE_SECTIONS.map((s) => `<a href="#cp-sec-${s.id}" class="block px-2.5 py-1.5 rounded-md text-sm text-muted-fg hover:bg-surface-3 hover:text-fg">${s.label}</a>`).join("")}
      </nav>
      <div class="flex-1 min-w-0 overflow-y-auto p-6">
        <div class="max-w-3xl">
          <div class="text-sm text-muted-fg">${escapeHtml(detail.broad_industry)} &gt; ${escapeHtml(detail.specific_niche)} &middot; ${escapeHtml(detail.operating_model)} &middot; ${escapeHtml(detail.currency)}</div>
          ${otherScenariosBlock(detail)}

          ${detail.active_override ? `
            <div class="mt-3 rounded-md bg-danger/10 border border-danger/30 p-3 text-sm text-danger">
              <strong>Override active:</strong> status held at ${detail.active_override.to_status} by ${escapeHtml(detail.active_override.actor)}.
              <div class="mt-1 text-danger">${escapeHtml(detail.active_override.rationale)}</div>
            </div>` : ""}

          <div class="mt-4 rounded-md border border-border p-3">
            <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div class="flex items-center gap-2">
                <span class="text-xs font-medium text-muted-fg uppercase tracking-wide">Thesis Performance</span>
                <div class="flex border border-border rounded-md overflow-hidden">
                  <button id="perf-baseline-thesis" data-baseline="thesis" class="perf-baseline-btn text-xs px-2.5 py-1">Since Thesis</button>
                  <button id="perf-baseline-decision" data-baseline="decision" class="perf-baseline-btn text-xs px-2.5 py-1 text-muted-fg">Since Purchase</button>
                </div>
              </div>
              <button id="drawer-log-price" class="text-xs text-ok">+ Log Price</button>
            </div>
            <div id="drawer-performance"><div class="text-xs text-muted-fg">Loading...</div></div>
          </div>

          <div id="cp-sec-business" class="mt-8 pt-2 scroll-mt-4">
            <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">1. The Business</h3>
            <p class="text-sm mt-1">${escapeHtml(t.the_business?.what_it_does)}</p>
            <div class="mt-2 space-y-0.5">${revenueRows}</div>
            ${pillarExtra("the_business", t)}
          </div>

          <div id="cp-sec-growth" class="mt-8 pt-5 border-t border-border scroll-mt-4">
            <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">2. The Growth Engine</h3>
            <ul class="list-disc list-inside text-sm mt-1 space-y-0.5">
              ${(t.the_growth_engine || []).map((g) => `<li>${escapeHtml(g)}</li>`).join("")}
            </ul>
            ${pillarExtra("the_growth_engine", t)}
          </div>

          <div id="cp-sec-change" class="mt-8 pt-5 border-t border-border scroll-mt-4">
            <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">3. The Big Change</h3>
            <p class="text-sm mt-1">${escapeHtml(t.the_big_change?.summary)}</p>
            <div class="text-xs text-muted-fg mt-0.5">Expected completion: ${escapeHtml(t.the_big_change?.expected_completion)}</div>
            ${pillarExtra("the_big_change", t)}
          </div>

          <div id="cp-sec-proof" class="mt-8 pt-5 border-t border-border scroll-mt-4">
            <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">4. Proof Points</h3>
            <ul class="list-disc list-inside text-sm mt-1 space-y-0.5">
              ${(t.proof_points?.hard_evidence || []).map((e) => `<li>${escapeHtml(e)}</li>`).join("")}
            </ul>
            ${pillarExtra("proof_points", t)}
          </div>

          <div id="cp-sec-kill" class="mt-8 pt-5 border-t border-border scroll-mt-4">
            <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">5. What Can Kill It</h3>
            <div class="mt-1">${(detail.kill_triggers || []).map(killTriggerRow).join("") || '<div class="text-xs text-muted-fg">None defined.</div>'}</div>
            ${pillarExtra("what_can_kill_it", t)}
          </div>

          <div id="cp-sec-believe" class="mt-8 pt-5 border-t border-border scroll-mt-4">
            <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">6. Why We Believe It</h3>
            <div class="mt-1">${reasoningList(t.why_we_believe_it)}</div>
            ${pillarExtra("why_we_believe_it", t)}
          </div>

          <div id="cp-sec-health" class="mt-8 pt-5 border-t border-border scroll-mt-4">
            <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">7. Health Check</h3>
            <p class="text-sm mt-1 text-muted-fg">${escapeHtml(t.health_check?.latest_quarter_review)}</p>
            <div class="mt-2">${healthCheckTimeline(detail.health_checks || [])}</div>
            ${pillarExtra("health_check", t)}
          </div>

          <div id="cp-sec-decisions" class="mt-8 pt-5 border-t border-border scroll-mt-4">
            <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Buy / Sell Decisions <span class="text-muted-fg font-normal normal-case">(all users)</span></h3>
            <div id="drawer-decisions" class="mt-1"><div class="text-xs text-muted-fg">Loading...</div></div>
            ${detail.pending_proposals?.length ? `<div class="text-xs text-muted-fg mt-3">${detail.pending_proposals.length} pending proposal(s) - resolve them from the Review Queue.</div>` : ""}
          </div>

          <div id="cp-sec-references" class="mt-8 pt-5 border-t border-border scroll-mt-4">
            <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">References</h3>
            <div class="mt-1 space-y-0.5">${references || '<div class="text-xs text-muted-fg">None added.</div>'}</div>
            ${pillarExtra("references", t)}
          </div>

          <div id="cp-sec-custom" class="mt-8 pt-5 border-t border-border mb-10 scroll-mt-4">
            <div class="flex items-center justify-between">
              <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Custom Sections <span class="text-muted-fg font-normal normal-case">(not tied to a pillar)</span></h3>
              <button id="drawer-new-table" class="text-xs text-ok">+ New Table</button>
            </div>
            <div id="drawer-tables" class="mt-2 space-y-2"><div class="text-xs text-muted-fg">Loading...</div></div>
          </div>
        </div>
      </div>
    </div>`;
}

export function renderDrawer(detail) {
  if (!detail.has_own_scenario) {
    return `
      <div class="p-5 overflow-y-auto h-full">
        <div class="flex items-start justify-between">
          <div>
            <h2 class="text-xl font-semibold">${escapeHtml(detail.name)}</h2>
            <div class="text-sm text-muted-fg">${escapeHtml(detail.broad_industry)} &gt; ${escapeHtml(detail.specific_niche)} &middot; ${escapeHtml(detail.operating_model)} &middot; ${escapeHtml(detail.currency)}</div>
          </div>
          <button id="drawer-close" class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
        </div>
        ${otherScenariosBlock(detail)}
        <div class="mt-6 rounded-md border border-dashed border-border p-5 text-center">
          <p class="text-sm text-muted-fg mb-3">You haven't started a thesis on this company yet.</p>
          <button id="drawer-start-thesis" class="text-sm px-4 py-2 rounded-md bg-accent text-accent-ink hover:brightness-90">+ Start Your Own Thesis</button>
        </div>
      </div>`;
  }

  const t = detail.current_thesis || {};
  const style = STATUS_STYLES[detail.status] || STATUS_STYLES.on_track;
  const revenueRows = (t.the_business?.revenue_split || [])
    .map((r) => `<div class="flex justify-between text-sm"><span>${escapeHtml(r.segment)}</span><span>${r.share_pct}%</span></div>`)
    .join("");

  const references = (t.references || [])
    .map((r) => `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" class="block text-sm text-ok hover:underline">${escapeHtml(r.title)}</a>`)
    .join("");

  return `
    <div class="p-5 overflow-y-auto h-full">
      <div class="flex items-start justify-between">
        <div>
          <div class="flex items-center gap-2">
            <span class="inline-block h-2 w-2 rounded-full ${style.dot}"></span>
            <span class="text-xs font-medium ${style.pill} px-2 py-0.5 rounded-full ring-1">${style.label}</span>
            ${detail.has_active_override ? `<span class="text-[10px] font-semibold uppercase text-danger bg-danger/10 px-2 py-0.5 rounded-full ring-1 ring-danger/20">Active Override</span>` : ""}
          </div>
          <h2 class="text-xl font-semibold mt-1">${escapeHtml(detail.name)}</h2>
          <div class="text-sm text-muted-fg">${escapeHtml(detail.broad_industry)} &gt; ${escapeHtml(detail.specific_niche)} · ${escapeHtml(detail.operating_model)} · ${escapeHtml(detail.currency)}</div>
        </div>
        <button id="drawer-close" class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
      </div>
      ${otherScenariosBlock(detail)}

      ${detail.active_override ? `
        <div class="mt-3 rounded-md bg-danger/10 border border-danger/30 p-3 text-sm text-danger">
          <strong>Override active:</strong> status held at ${detail.active_override.to_status} by ${escapeHtml(detail.active_override.actor)}.
          <div class="mt-1 text-danger">${escapeHtml(detail.active_override.rationale)}</div>
        </div>` : ""}

      <div class="mt-4 flex flex-wrap gap-2">
        <button id="drawer-amend" class="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90">Amend Thesis</button>
        <button id="drawer-observations" class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Post Observations</button>
        <button id="drawer-health-check" class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Log Health Check</button>
        <button id="drawer-log-decision" class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Log Buy/Sell</button>
        <button id="drawer-ai-review" class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Run AI Review</button>
        <button id="drawer-guidance" class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Guidance</button>
      </div>

      <div class="mt-4 rounded-md border border-border p-3">
        <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium text-muted-fg uppercase tracking-wide">Thesis Performance</span>
            <div class="flex border border-border rounded-md overflow-hidden">
              <button id="perf-baseline-thesis" data-baseline="thesis" class="perf-baseline-btn text-xs px-2.5 py-1">Since Thesis</button>
              <button id="perf-baseline-decision" data-baseline="decision" class="perf-baseline-btn text-xs px-2.5 py-1 text-muted-fg">Since Purchase</button>
            </div>
          </div>
          <button id="drawer-log-price" class="text-xs text-ok">+ Log Price</button>
        </div>
        <div id="drawer-performance">
          <div class="text-xs text-muted-fg">Loading...</div>
        </div>
      </div>

      <nav class="drawer-jumpnav sticky top-0 z-10 -mx-5 mt-4 px-5 py-2 bg-bg-ink border-y border-border flex gap-4 text-xs overflow-x-auto">
        <a href="#drawer-sec-overview" class="drawer-jump">Overview</a>
        <a href="#drawer-sec-evidence" class="drawer-jump">Evidence</a>
        <a href="#drawer-sec-risk" class="drawer-jump">Risk &amp; Monitoring</a>
        <a href="#drawer-sec-reference" class="drawer-jump">Reference</a>
      </nav>

      <div id="drawer-sec-overview" class="mt-5">
        <section>
          <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">1. The Business</h3>
          <p class="text-sm mt-1">${escapeHtml(t.the_business?.what_it_does)}</p>
          <div class="mt-2 space-y-0.5">${revenueRows}</div>
          ${pillarExtra("the_business", t)}
        </section>

        <section class="mt-4">
          <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">2. The Growth Engine</h3>
          <ul class="list-disc list-inside text-sm mt-1 space-y-0.5">
            ${(t.the_growth_engine || []).map((g) => `<li>${escapeHtml(g)}</li>`).join("")}
          </ul>
          ${pillarExtra("the_growth_engine", t)}
        </section>

        <section class="mt-4">
          <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">3. The Big Change</h3>
          <p class="text-sm mt-1">${escapeHtml(t.the_big_change?.summary)}</p>
          <div class="text-xs text-muted-fg mt-0.5">Expected completion: ${escapeHtml(t.the_big_change?.expected_completion)}</div>
          ${pillarExtra("the_big_change", t)}
        </section>
      </div>

      <div id="drawer-sec-evidence" class="mt-8 pt-5 border-t border-border">
        <section>
          <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">4. Proof Points</h3>
          <ul class="list-disc list-inside text-sm mt-1 space-y-0.5">
            ${(t.proof_points?.hard_evidence || []).map((e) => `<li>${escapeHtml(e)}</li>`).join("")}
          </ul>
          ${pillarExtra("proof_points", t)}
        </section>

        <section class="mt-4">
          <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">6. Why We Believe It</h3>
          <div class="mt-1">${reasoningList(t.why_we_believe_it)}</div>
          ${pillarExtra("why_we_believe_it", t)}
        </section>
      </div>

      <div id="drawer-sec-risk" class="mt-8 pt-5 border-t border-border">
        <section>
          <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">5. What Can Kill It</h3>
          <div class="mt-1">${(detail.kill_triggers || []).map(killTriggerRow).join("") || '<div class="text-xs text-muted-fg">None defined.</div>'}</div>
          ${pillarExtra("what_can_kill_it", t)}
        </section>

        <section class="mt-4">
          <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">7. Health Check</h3>
          <p class="text-sm mt-1 text-muted-fg">${escapeHtml(t.health_check?.latest_quarter_review)}</p>
          <div class="mt-2">${healthCheckTimeline(detail.health_checks || [])}</div>
          ${pillarExtra("health_check", t)}
        </section>

        <section class="mt-4">
          <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Buy / Sell Decisions <span class="text-muted-fg font-normal normal-case">(all users)</span></h3>
          <div id="drawer-decisions" class="mt-1">
            <div class="text-xs text-muted-fg">Loading...</div>
          </div>
        </section>

        ${detail.pending_proposals?.length ? `
          <section class="mt-4">
            <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Pending Proposals</h3>
            <div class="text-xs text-muted-fg mt-1">${detail.pending_proposals.length} pending - resolve them from the Review Queue.</div>
          </section>` : ""}
      </div>

      <div id="drawer-sec-reference" class="mt-8 pt-5 border-t border-border mb-8">
        <section>
          <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">References</h3>
          <div class="mt-1 space-y-0.5">${references || '<div class="text-xs text-muted-fg">None added.</div>'}</div>
          ${pillarExtra("references", t)}
        </section>

        <section class="mt-4">
          <div class="flex items-center justify-between">
            <h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Custom Sections <span class="text-muted-fg font-normal normal-case">(not tied to a pillar)</span></h3>
            <button id="drawer-new-table" class="text-xs text-ok">+ New Table</button>
          </div>
          <div id="drawer-tables" class="mt-2 space-y-2">
            <div class="text-xs text-muted-fg">Loading...</div>
          </div>
        </section>
      </div>
    </div>`;
}
