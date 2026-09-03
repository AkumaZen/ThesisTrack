import { escapeHtml } from "./format.js";

const OPERATING_MODELS = ["factory", "subscription", "money_lending", "retail_stores", "services"];

export function renderIngestModalShell(taxonomy) {
  const industryOptions = taxonomy
    .map((i) => `<option value="${escapeHtml(i.name)}">${escapeHtml(i.name)}</option>`)
    .join("");

  return `
    <div class="flex items-center justify-between px-5 py-3 border-b border-slate-200">
      <h2 class="font-semibold">New Company / Thesis</h2>
      <button id="ingest-close" class="text-slate-400 hover:text-slate-700 text-xl leading-none">&times;</button>
    </div>
    <div class="flex border-b border-slate-200">
      <button id="ingest-tab-form" class="ingest-tab px-4 py-2 text-sm font-medium border-b-2 border-slate-800">Form</button>
      <button id="ingest-tab-json" class="ingest-tab px-4 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500">JSON</button>
    </div>
    <div class="p-5 overflow-y-auto" style="max-height: 70vh">
      <div id="ingest-errors" class="hidden mb-3 rounded-md bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800"></div>

      <div id="ingest-form-panel">
        <div class="grid grid-cols-2 gap-3">
          <label class="text-sm">Company ID
            <input id="f-company-id" placeholder="TICKER_OR_SLUG" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label class="text-sm">Name
            <input id="f-name" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label class="text-sm">Broad Industry
            <select id="f-industry" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">${industryOptions}</select>
          </label>
          <label class="text-sm">Specific Niche
            <select id="f-niche" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"></select>
          </label>
          <label class="text-sm">Operating Model
            <select id="f-operating-model" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              ${OPERATING_MODELS.map((m) => `<option value="${m}">${m}</option>`).join("")}
            </select>
          </label>
          <label class="text-sm">Currency
            <input id="f-currency" value="INR" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
          <label class="text-sm">Status
            <select id="f-status" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="on_track">on_track</option>
              <option value="watch_closely">watch_closely</option>
              <option value="broken">broken</option>
            </select>
          </label>
          <label class="text-sm">Last Reviewed
            <input id="f-last-reviewed" type="date" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
        </div>

        <label class="block text-sm mt-4">What It Does
          <textarea id="f-what-it-does" rows="2" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"></textarea>
        </label>

        <div class="mt-3">
          <div class="text-sm font-medium">Revenue Split</div>
          <div id="f-revenue-split" class="space-y-1 mt-1"></div>
          <button type="button" data-add="revenue-split" class="text-xs text-blue-600 mt-1">+ Add segment</button>
        </div>

        <label class="block text-sm mt-4">The Growth Engine <span class="text-slate-400">(one per line)</span>
          <textarea id="f-growth-engine" rows="2" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"></textarea>
        </label>

        <div class="grid grid-cols-2 gap-3 mt-3">
          <label class="text-sm">The Big Change - Summary
            <textarea id="f-big-change-summary" rows="2" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"></textarea>
          </label>
          <label class="text-sm">Expected Completion
            <input id="f-expected-completion" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
          </label>
        </div>

        <label class="block text-sm mt-3">Hard Evidence <span class="text-slate-400">(one per line)</span>
          <textarea id="f-hard-evidence" rows="2" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"></textarea>
        </label>

        <div class="mt-4">
          <div class="text-sm font-medium">Model-Specific Metrics
            <span class="text-slate-400 font-normal">- from the metric registry for the selected operating model</span>
          </div>
          <div id="f-metrics-fields" class="grid grid-cols-2 gap-3 mt-1"></div>
        </div>

        <div class="mt-4">
          <div class="text-sm font-medium">What Can Kill It <span class="text-slate-400">(needs &ge; 1 severity=kill entry)</span></div>
          <div id="f-kill-triggers" class="space-y-2 mt-1"></div>
          <button type="button" data-add="kill-trigger" class="text-xs text-blue-600 mt-1">+ Add redline</button>
        </div>

        <label class="block text-sm mt-4">Why We Believe It <span class="text-slate-400">(one per line, &ge;3 entries, start lines with "Premise" / "Inference" / "Conclusion" - exactly one Conclusion)</span>
          <textarea id="f-why-believe" rows="4" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"></textarea>
        </label>

        <label class="block text-sm mt-3">Latest Quarter Review
          <textarea id="f-latest-review" rows="2" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"></textarea>
        </label>

        <div class="mt-3">
          <div class="text-sm font-medium">References</div>
          <div id="f-references" class="space-y-1 mt-1"></div>
          <button type="button" data-add="reference" class="text-xs text-blue-600 mt-1">+ Add reference</button>
        </div>
      </div>

      <div id="ingest-json-panel" class="hidden">
        <textarea id="ingest-json-textarea" rows="24" spellcheck="false"
          class="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs font-mono"
          placeholder="Paste a full thesis payload here"></textarea>
        <button id="json-validate" type="button" class="text-xs text-blue-600 mt-2">Validate structure</button>
      </div>
    </div>
    <div class="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
      <button id="ingest-cancel" class="text-sm px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50">Cancel</button>
      <button id="ingest-submit" class="text-sm px-3 py-1.5 rounded-md bg-slate-800 text-white hover:bg-slate-700">Create Company</button>
    </div>`;
}

export function renderMetricsFields(metrics, existingValues = {}) {
  if (!metrics.length) return `<div class="text-xs text-slate-400 col-span-2">No metrics registered for this operating model yet.</div>`;
  return metrics
    .map(
      (m) => `<label class="text-xs">
        ${escapeHtml(m.label)} <span class="text-slate-400">(${m.unit})</span>
        <input type="number" step="any" data-metric-key="${escapeHtml(m.metric_key)}"
          value="${existingValues[m.metric_key] ?? ""}"
          class="metric-input mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
      </label>`
    )
    .join("");
}

export function renderRevenueSplitRow(segment = "", sharePct = "") {
  return `<div class="flex gap-2 items-center revenue-split-row">
    <input placeholder="Segment" value="${escapeHtml(segment)}" class="rs-segment flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm" />
    <input type="number" step="any" placeholder="%" value="${sharePct}" class="rs-share w-20 rounded-md border border-slate-300 px-2 py-1 text-sm" />
    <button type="button" data-remove-row class="text-slate-400 hover:text-rose-600">&times;</button>
  </div>`;
}

export function renderReferenceRow(title = "", url = "") {
  return `<div class="flex gap-2 items-center reference-row">
    <input placeholder="Title" value="${escapeHtml(title)}" class="ref-title flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm" />
    <input placeholder="URL" value="${escapeHtml(url)}" class="ref-url flex-[2] rounded-md border border-slate-300 px-2 py-1 text-sm" />
    <button type="button" data-remove-row class="text-slate-400 hover:text-rose-600">&times;</button>
  </div>`;
}

export function renderKillTriggerRow(metrics, trigger = {}) {
  const options = metrics
    .map((m) => `<option value="${escapeHtml(m.metric_key)}" ${trigger.metric_key === m.metric_key ? "selected" : ""}>${escapeHtml(m.label)}</option>`)
    .join("");
  return `<div class="kill-trigger-row rounded-md border border-slate-200 p-2 space-y-1">
    <div class="flex gap-2">
      <input placeholder="Label / display sentence" value="${escapeHtml(trigger.label || "")}" class="kt-label flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm" />
      <button type="button" data-remove-row class="text-slate-400 hover:text-rose-600">&times;</button>
    </div>
    <div class="grid grid-cols-6 gap-1">
      <select class="kt-metric col-span-2 rounded-md border border-slate-300 px-1 py-1 text-xs">
        <option value="">(manual check)</option>
        ${options}
      </select>
      <select class="kt-operator rounded-md border border-slate-300 px-1 py-1 text-xs">
        ${["<", "<=", ">", ">=", "==", "!="].map((op) => `<option ${trigger.operator === op ? "selected" : ""}>${op}</option>`).join("")}
      </select>
      <input class="kt-threshold rounded-md border border-slate-300 px-1 py-1 text-xs" type="number" step="any" placeholder="threshold" value="${trigger.threshold ?? ""}" />
      <select class="kt-severity rounded-md border border-slate-300 px-1 py-1 text-xs">
        <option value="kill" ${trigger.severity !== "warn" ? "selected" : ""}>kill</option>
        <option value="warn" ${trigger.severity === "warn" ? "selected" : ""}>warn</option>
      </select>
      <input class="kt-grace rounded-md border border-slate-300 px-1 py-1 text-xs" type="number" min="1" placeholder="grace" value="${trigger.grace_periods ?? 1}" />
    </div>
    <input class="kt-action w-full rounded-md border border-slate-300 px-2 py-1 text-xs" placeholder="Action (e.g. Exit position)" value="${escapeHtml(trigger.action || "")}" />
  </div>`;
}
