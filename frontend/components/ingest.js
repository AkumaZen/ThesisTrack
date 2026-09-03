import { escapeHtml } from "./format.js";

const OPERATING_MODELS = ["factory", "subscription", "money_lending", "retail_stores", "services"];

// The 7 standard thesis pillars (BUILD_PLAN.md: "thesis_data JSONB -- the 7
// pillars"), plus Basics (company identity/classification, create-only) and
// References (supplementary, not itself a pillar). Every company's data is
// always organized under these; the "Data Tables" feature in the drawer is
// where genuinely open-ended, per-company custom sections belong instead of
// bending this fixed contract.
export const INGEST_SECTIONS = [
  { id: "basics", label: "Basics" },
  { id: "business", label: "1. The Business" },
  { id: "growth", label: "2. The Growth Engine" },
  { id: "change", label: "3. The Big Change" },
  { id: "proof", label: "4. Proof Points" },
  { id: "kill", label: "5. What Can Kill It" },
  { id: "believe", label: "6. Why We Believe It" },
  { id: "health", label: "7. Health Check" },
  { id: "references", label: "References" },
];

function navButton(section) {
  return `<button type="button" data-section="${section.id}" class="ingest-section-btn text-left px-2.5 py-1.5 rounded-md text-sm text-muted-fg hover:bg-surface-3 hover:text-fg">${escapeHtml(section.label)}</button>`;
}

// Kept for readability at call sites that still say "modal" conceptually -
// this is a full-page view now, not a small centered dialog.
export function renderIngestPage(taxonomy, mode = "create", title = "New Company / Thesis") {
  const industryOptions = taxonomy
    .map((i) => `<option value="${escapeHtml(i.name)}">${escapeHtml(i.name)}</option>`)
    .join("");

  return `
    <div class="h-14 border-b border-border flex items-center gap-3 px-4 shrink-0">
      <button id="ingest-back" class="text-sm px-2 py-1.5 rounded-md hover:bg-surface-3 text-muted-fg hover:text-fg shrink-0">&larr; Back</button>
      <h1 id="ingest-title" class="font-semibold text-base flex-1 min-w-0 truncate">${escapeHtml(title)}</h1>
      <div class="flex border border-border rounded-md overflow-hidden shrink-0">
        <button id="ingest-tab-form" class="ingest-tab px-3 py-1.5 text-xs font-medium bg-surface-3">Form</button>
        <button id="ingest-tab-json" class="ingest-tab px-3 py-1.5 text-xs font-medium text-muted-fg">JSON</button>
      </div>
      <button id="ingest-cancel" class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3 shrink-0">Cancel</button>
      <button id="ingest-submit" class="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90 shrink-0">${mode === "amend" ? "Save Amendment" : "Create Company"}</button>
    </div>

    <div class="flex-1 min-h-0 flex overflow-hidden">
      <nav id="ingest-section-nav" class="w-56 shrink-0 border-r border-border overflow-y-auto p-3 flex flex-col gap-0.5">
        ${INGEST_SECTIONS.map(navButton).join("")}
        <div id="ingest-custom-sections-block" class="hidden mt-4 pt-3 border-t border-border">
          <div class="text-xs font-medium text-muted-fg uppercase tracking-wide px-2.5 mb-1">Custom Sections</div>
          <div id="ingest-custom-sections-nav" class="flex flex-col gap-1"></div>
          <button id="ingest-add-section" type="button" class="text-left px-2.5 py-1.5 rounded-md text-sm text-ok hover:bg-surface-3 w-full">+ Add Section</button>
        </div>
      </nav>

      <div id="ingest-content" class="flex-1 min-w-0 overflow-y-auto p-6">
        <div class="max-w-2xl">
        <div id="ingest-errors" class="hidden mb-3 rounded-md bg-danger/10 border border-danger/30 p-3 text-sm text-danger"></div>

        <div id="ingest-form-panel">
          <div id="ingest-change-note-wrap" class="hidden mb-4">
            <label class="block text-sm">Change Note <span class="text-muted-fg">(required - why is the thesis being amended?)</span>
              <textarea id="f-change-note" rows="2" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"></textarea>
            </label>
          </div>

          <div id="ingest-panel-basics" class="ingest-section-panel">
            <div class="grid grid-cols-2 gap-3">
              <label class="text-sm">Company ID
                <input id="f-company-id" placeholder="TICKER_OR_SLUG" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
              </label>
              <label class="text-sm">Name
                <input id="f-name" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
              </label>
              <label class="text-sm">Broad Industry
                <select id="f-industry" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">${industryOptions}</select>
              </label>
              <label class="text-sm">Specific Niche
                <select id="f-niche" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"></select>
              </label>
              <label class="text-sm">Operating Model
                <select id="f-operating-model" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
                  ${OPERATING_MODELS.map((m) => `<option value="${m}">${m}</option>`).join("")}
                </select>
              </label>
              <label class="text-sm">Currency
                <input id="f-currency" value="INR" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
              </label>
              <label class="text-sm">Status
                <select id="f-status" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
                  <option value="on_track">on_track</option>
                  <option value="watch_closely">watch_closely</option>
                  <option value="broken">broken</option>
                </select>
              </label>
              <label class="text-sm">Last Reviewed
                <input id="f-last-reviewed" type="date" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
              </label>
            </div>
          </div>

          <div id="ingest-panel-business" class="ingest-section-panel hidden">
            <label class="block text-sm">What It Does
              <textarea id="f-what-it-does" rows="3" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"></textarea>
            </label>
            <div class="mt-4">
              <div class="text-sm font-medium">Revenue Split</div>
              <div id="f-revenue-split" class="space-y-1 mt-1"></div>
              <button type="button" data-add="revenue-split" class="text-xs text-ok mt-1">+ Add segment</button>
            </div>
          </div>

          <div id="ingest-panel-growth" class="ingest-section-panel hidden">
            <div class="text-sm font-medium">The Growth Engine <span class="text-muted-fg font-normal">- what's driving forward growth, one driver per row</span></div>
            <div id="f-growth-engine" class="space-y-1 mt-1"></div>
            <button type="button" data-add="growth" class="text-xs text-ok mt-1">+ Add driver</button>
          </div>

          <div id="ingest-panel-change" class="ingest-section-panel hidden">
            <label class="block text-sm">The Big Change - Summary
              <textarea id="f-big-change-summary" rows="3" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"></textarea>
            </label>
            <label class="block text-sm mt-3">Expected Completion
              <input id="f-expected-completion" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
            </label>
          </div>

          <div id="ingest-panel-proof" class="ingest-section-panel hidden">
            <div class="text-sm font-medium">Hard Evidence <span class="text-muted-fg font-normal">- one concrete data point per row</span></div>
            <div id="f-hard-evidence" class="space-y-1 mt-1"></div>
            <button type="button" data-add="evidence" class="text-xs text-ok mt-1">+ Add evidence</button>

            <div class="mt-5">
              <div class="text-sm font-medium">Model-Specific Metrics
                <span class="text-muted-fg font-normal">- from the metric registry for the selected operating model</span>
              </div>
              <div id="f-metrics-fields" class="grid grid-cols-2 gap-3 mt-1"></div>
            </div>
          </div>

          <div id="ingest-panel-kill" class="ingest-section-panel hidden">
            <div class="text-sm font-medium">What Can Kill It <span class="text-muted-fg font-normal">(needs &ge; 1 severity=kill entry)</span></div>
            <div id="f-kill-triggers" class="space-y-2 mt-1"></div>
            <button type="button" data-add="kill-trigger" class="text-xs text-ok mt-1">+ Add redline</button>
          </div>

          <div id="ingest-panel-believe" class="ingest-section-panel hidden">
            <div class="text-sm font-medium">Why We Believe It <span class="text-muted-fg font-normal">(&ge;3 entries, &ge;1 Premise, exactly 1 Conclusion)</span></div>
            <div id="f-why-believe" class="space-y-1 mt-1"></div>
            <button type="button" data-add="believe" class="text-xs text-ok mt-1">+ Add reasoning step</button>
          </div>

          <div id="ingest-panel-health" class="ingest-section-panel hidden">
            <label class="block text-sm">Latest Quarter Review
              <textarea id="f-latest-review" rows="4" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"></textarea>
            </label>
          </div>

          <div id="ingest-panel-references" class="ingest-section-panel hidden">
            <div class="text-sm font-medium">References</div>
            <div id="f-references" class="space-y-1 mt-1"></div>
            <button type="button" data-add="reference" class="text-xs text-ok mt-1">+ Add reference</button>
          </div>
        </div>

        <div id="ingest-json-panel" class="hidden">
          <details class="rounded-md border border-border mb-3">
            <summary class="cursor-pointer px-3 py-2 text-sm font-medium">Converting an existing write-up? Copy a prompt for that</summary>
            <div class="px-3 pb-3">
              <p class="text-xs text-muted-fg mb-2">Copy this prompt into ChatGPT/Claude/etc. alongside your existing thesis notes. It has our exact schema baked in, so the LLM can ask you clarifying questions and hand back JSON in the right shape - paste that JSON below and validate/submit as usual.</p>
              <textarea id="conversion-prompt" readonly rows="6" class="w-full rounded-md border border-border px-2 py-1.5 text-xs font-mono bg-surface-2"></textarea>
              <button id="copy-conversion-prompt" type="button" class="text-xs text-ok mt-2">Copy prompt</button>
            </div>
          </details>
          <textarea id="ingest-json-textarea" rows="24" spellcheck="false"
            class="w-full rounded-md border border-border px-2 py-1.5 text-xs font-mono"
            placeholder="Paste a full thesis payload here"></textarea>
          <button id="json-validate" type="button" class="text-xs text-ok mt-2">Validate structure</button>
        </div>
        </div>
      </div>
    </div>`;
}

export function renderMetricsFields(metrics, existingValues = {}) {
  if (!metrics.length) return `<div class="text-xs text-muted-fg col-span-2">No metrics registered for this operating model yet.</div>`;
  return metrics
    .map(
      (m) => `<label class="text-xs">
        ${escapeHtml(m.label)} <span class="text-muted-fg">(${m.unit})</span>
        <input type="number" step="any" data-metric-key="${escapeHtml(m.metric_key)}"
          value="${existingValues[m.metric_key] ?? ""}"
          class="metric-input mt-0.5 w-full rounded-md border border-border px-2 py-1 text-sm" />
      </label>`
    )
    .join("");
}

export function renderRevenueSplitRow(segment = "", sharePct = "") {
  return `<div class="flex gap-2 items-center revenue-split-row">
    <input placeholder="Segment" value="${escapeHtml(segment)}" class="rs-segment flex-1 rounded-md border border-border px-2 py-1 text-sm" />
    <input type="number" step="any" placeholder="%" value="${sharePct}" class="rs-share w-20 rounded-md border border-border px-2 py-1 text-sm" />
    <button type="button" data-remove-row class="text-muted-fg hover:text-danger">&times;</button>
  </div>`;
}

export function renderReferenceRow(title = "", url = "") {
  return `<div class="flex gap-2 items-center reference-row">
    <input placeholder="Title" value="${escapeHtml(title)}" class="ref-title flex-1 rounded-md border border-border px-2 py-1 text-sm" />
    <input placeholder="URL" value="${escapeHtml(url)}" class="ref-url flex-[2] rounded-md border border-border px-2 py-1 text-sm" />
    <button type="button" data-remove-row class="text-muted-fg hover:text-danger">&times;</button>
  </div>`;
}

export function renderKillTriggerRow(metrics, trigger = {}) {
  const options = metrics
    .map((m) => `<option value="${escapeHtml(m.metric_key)}" ${trigger.metric_key === m.metric_key ? "selected" : ""}>${escapeHtml(m.label)}</option>`)
    .join("");
  return `<div class="kill-trigger-row rounded-md border border-border p-2 space-y-1">
    <div class="flex gap-2">
      <input placeholder="Label / display sentence" value="${escapeHtml(trigger.label || "")}" class="kt-label flex-1 rounded-md border border-border px-2 py-1 text-sm" />
      <button type="button" data-remove-row class="text-muted-fg hover:text-danger">&times;</button>
    </div>
    <div class="grid grid-cols-6 gap-1">
      <select class="kt-metric col-span-2 rounded-md border border-border px-1 py-1 text-xs">
        <option value="">(manual check)</option>
        ${options}
      </select>
      <select class="kt-operator rounded-md border border-border px-1 py-1 text-xs">
        ${["<", "<=", ">", ">=", "==", "!="].map((op) => `<option ${trigger.operator === op ? "selected" : ""}>${op}</option>`).join("")}
      </select>
      <input class="kt-threshold rounded-md border border-border px-1 py-1 text-xs" type="number" step="any" placeholder="threshold" value="${trigger.threshold ?? ""}" />
      <select class="kt-severity rounded-md border border-border px-1 py-1 text-xs">
        <option value="kill" ${trigger.severity !== "warn" ? "selected" : ""}>kill</option>
        <option value="warn" ${trigger.severity === "warn" ? "selected" : ""}>warn</option>
      </select>
      <input class="kt-grace rounded-md border border-border px-1 py-1 text-xs" type="number" min="1" placeholder="grace" value="${trigger.grace_periods ?? 1}" />
    </div>
    <input class="kt-action w-full rounded-md border border-border px-2 py-1 text-xs" placeholder="Action (e.g. Exit position)" value="${escapeHtml(trigger.action || "")}" />
  </div>`;
}

export function renderGrowthRow(text = "") {
  return `<div class="flex gap-2 items-center growth-row">
    <input placeholder="e.g. New capacity coming online in Q3" value="${escapeHtml(text)}" class="ge-text flex-1 rounded-md border border-border px-2 py-1 text-sm" />
    <button type="button" data-remove-row class="text-muted-fg hover:text-danger">&times;</button>
  </div>`;
}

export function renderEvidenceRow(text = "") {
  return `<div class="flex gap-2 items-center evidence-row">
    <input placeholder="e.g. Order book up 22% YoY per Q2 filing" value="${escapeHtml(text)}" class="ev-text flex-1 rounded-md border border-border px-2 py-1 text-sm" />
    <button type="button" data-remove-row class="text-muted-fg hover:text-danger">&times;</button>
  </div>`;
}

const BELIEVE_KINDS = ["Premise", "Inference", "Conclusion"];

export function renderBelieveRow(kind = "Premise", text = "") {
  return `<div class="flex gap-2 items-center believe-row">
    <select class="bl-kind w-28 shrink-0 rounded-md border border-border px-1 py-1 text-xs">
      ${BELIEVE_KINDS.map((k) => `<option value="${k}" ${k === kind ? "selected" : ""}>${k}</option>`).join("")}
    </select>
    <input placeholder="Reasoning text" value="${escapeHtml(text)}" class="bl-text flex-1 rounded-md border border-border px-2 py-1 text-sm" />
    <button type="button" data-remove-row class="text-muted-fg hover:text-danger">&times;</button>
  </div>`;
}

// Splits a stored "Premise: ..." style string back into {kind, text} for
// re-editing. Falls back to Premise/whole-string if the prefix is missing
// (older freeform entries, or hand-written JSON imports).
export function splitBelieveEntry(entry) {
  const match = /^\s*(Premise|Inference|Conclusion)\s*:\s*(.*)$/is.exec(entry || "");
  if (match) return { kind: match[1][0].toUpperCase() + match[1].slice(1).toLowerCase(), text: match[2] };
  return { kind: "Premise", text: entry || "" };
}
