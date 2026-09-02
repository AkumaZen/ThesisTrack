import { api, getApiKey, setApiKey, ApiError } from "./api.js";
import { readFiltersFromUrl, writeFiltersToUrl, toQueryParams } from "./state.js";
import { renderHeaderStats, renderCards } from "./components/cards.js";
import { renderFacetBar } from "./components/facets.js";
import { renderDrawer } from "./components/drawer.js";
import {
  renderIngestModalShell,
  renderMetricsFields,
  renderRevenueSplitRow,
  renderReferenceRow,
  renderKillTriggerRow,
} from "./components/ingest.js";
import { renderReviewQueue } from "./components/reviewQueue.js";
import { renderExportPanel, renderExportStats } from "./components/exportPanel.js";

const state = {
  filters: readFiltersFromUrl(),
  taxonomy: [],
  metricDefsByKey: {},
  metricsCache: {},
  view: "cards",
};

// ---------- toast ----------
function toast(message, kind = "ok") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = `fixed bottom-4 right-4 z-50 rounded-md px-4 py-2 text-sm text-white shadow-lg ${
    kind === "error" ? "bg-rose-600" : "bg-slate-800"
  }`;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 4000);
}

function errorMessage(err) {
  if (err instanceof ApiError) {
    if (err.body?.errors) return err.body.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
    if (err.body?.detail) return typeof err.body.detail === "string" ? err.body.detail : JSON.stringify(err.body.detail);
    return err.message;
  }
  return String(err);
}

// ---------- metrics registry ----------
async function metricsFor(operatingModel) {
  if (!state.metricsCache[operatingModel]) {
    state.metricsCache[operatingModel] = await api.getMetrics(operatingModel);
  }
  return state.metricsCache[operatingModel];
}

async function loadMetricDefsIndex() {
  const all = await api.getMetrics();
  state.metricDefsByKey = Object.fromEntries(all.map((m) => [m.metric_key, m]));
}

// ---------- header + cards ----------
async function loadHeaderStats() {
  const resp = await api.listCompanies({ page: 1, page_size: 200, sort: "name" });
  document.getElementById("header-stats").innerHTML = renderHeaderStats(resp.items);
}

async function loadCards() {
  const resp = await api.listCompanies(toQueryParams(state.filters));
  document.getElementById("cards-grid").innerHTML = renderCards(resp.items, state.metricDefsByKey);
}

async function refreshCompanies() {
  await Promise.all([loadHeaderStats(), loadCards()]);
}

function renderFacets() {
  document.getElementById("facet-bar").innerHTML = renderFacetBar(state.taxonomy, state.filters);
  wireFacetBar();
}

function wireFacetBar() {
  const bar = document.getElementById("facet-bar");
  bar.querySelectorAll(".facet-input").forEach((input) => {
    input.addEventListener("change", () => {
      const facet = input.dataset.facet;
      const cur = new Set(state.filters[facet] || []);
      if (input.checked) cur.add(input.value);
      else cur.delete(input.value);
      state.filters[facet] = [...cur];
      state.filters.page = 1;
      applyFilters();
    });
  });
  document.getElementById("search-input").addEventListener(
    "input",
    debounce((e) => {
      state.filters.q = e.target.value || undefined;
      state.filters.page = 1;
      applyFilters();
    }, 300)
  );
  document.getElementById("review-due-toggle").addEventListener("change", (e) => {
    state.filters.review_due = e.target.checked || undefined;
    applyFilters();
  });
  document.getElementById("sort-select").addEventListener("change", (e) => {
    state.filters.sort = e.target.value;
    applyFilters();
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function applyFilters() {
  writeFiltersToUrl(state.filters);
  loadCards().catch((e) => toast(errorMessage(e), "error"));
}

// ---------- drawer ----------
async function openDrawer(companyId) {
  const detail = await api.getCompany(companyId);
  document.getElementById("drawer").innerHTML = renderDrawer(detail);
  document.getElementById("drawer").classList.remove("hidden");
  document.getElementById("drawer-overlay").classList.remove("hidden");
  document.getElementById("drawer-close").addEventListener("click", closeDrawer);
  document.getElementById("drawer-overlay").addEventListener("click", closeDrawer);
  document.getElementById("drawer-amend").addEventListener("click", () => openIngestModal("amend", detail));
  document.getElementById("drawer-observations").addEventListener("click", () => openObservationsModal(detail));
  document.getElementById("drawer-health-check").addEventListener("click", () => openHealthCheckModal(detail));
  document.getElementById("drawer-ai-review").addEventListener("click", () => openAiReviewModal(detail));
}

function closeDrawer() {
  document.getElementById("drawer").classList.add("hidden");
  document.getElementById("drawer-overlay").classList.add("hidden");
}

// ---------- generic modal ----------
function showModal(html) {
  document.getElementById("modal-panel").innerHTML = html;
  document.getElementById("modal-overlay").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  document.getElementById("modal-panel").innerHTML = "";
}

document.getElementById("modal-overlay").addEventListener("click", (e) => {
  if (e.target.id === "modal-overlay") closeModal();
});

// ---------- observations quick modal ----------
async function openObservationsModal(detail) {
  const metrics = await metricsFor(detail.operating_model);
  showModal(`
    <div class="flex items-center justify-between px-5 py-3 border-b border-slate-200">
      <h2 class="font-semibold">Post Observations — ${detail.name}</h2>
      <button id="modal-close-x" class="text-slate-400 hover:text-slate-700 text-xl leading-none">&times;</button>
    </div>
    <div class="p-5 space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <label class="text-sm">Period (e.g. FY26Q1)
          <input id="obs-period" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
        <label class="text-sm">Period End
          <input id="obs-period-end" type="date" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        </label>
      </div>
      <div id="obs-metrics" class="grid grid-cols-2 gap-3">${renderMetricsFields(metrics)}</div>
    </div>
    <div class="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
      <button id="modal-cancel" class="text-sm px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50">Cancel</button>
      <button id="obs-submit" class="text-sm px-3 py-1.5 rounded-md bg-slate-800 text-white hover:bg-slate-700">Post</button>
    </div>`);
  document.getElementById("modal-close-x").addEventListener("click", closeModal);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("obs-submit").addEventListener("click", async () => {
    const observations = [...document.querySelectorAll("#obs-metrics .metric-input")]
      .filter((i) => i.value !== "")
      .map((i) => ({ metric_key: i.dataset.metricKey, numeric_value: Number(i.value) }));
    try {
      const resp = await api.postObservations(detail.company_id, {
        period: document.getElementById("obs-period").value,
        period_end: document.getElementById("obs-period-end").value,
        observations,
      });
      closeModal();
      closeDrawer();
      await refreshCompanies();
      const newProposals = resp.proposals?.length || 0;
      toast(newProposals ? `Posted — ${newProposals} new proposal(s) raised` : "Observations posted");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  });
}

// ---------- health check quick modal ----------
function openHealthCheckModal(detail) {
  showModal(`
    <div class="flex items-center justify-between px-5 py-3 border-b border-slate-200">
      <h2 class="font-semibold">Log Health Check — ${detail.name}</h2>
      <button id="modal-close-x" class="text-slate-400 hover:text-slate-700 text-xl leading-none">&times;</button>
    </div>
    <div class="p-5 space-y-3">
      <label class="text-sm block">Period
        <input id="hc-period" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
      </label>
      <label class="text-sm block">Verdict
        <select id="hc-verdict" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          <option value="on_track">on_track</option>
          <option value="watch_closely">watch_closely</option>
          <option value="broken">broken</option>
        </select>
      </label>
      <label class="text-sm block">Note ${detail.active_override ? '<span class="text-rose-600">(required — an override is active)</span>' : ""}
        <textarea id="hc-note" rows="3" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"></textarea>
      </label>
    </div>
    <div class="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
      <button id="modal-cancel" class="text-sm px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50">Cancel</button>
      <button id="hc-submit" class="text-sm px-3 py-1.5 rounded-md bg-slate-800 text-white hover:bg-slate-700">Submit</button>
    </div>`);
  document.getElementById("modal-close-x").addEventListener("click", closeModal);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("hc-submit").addEventListener("click", async () => {
    try {
      await api.postHealthCheck(detail.company_id, {
        period: document.getElementById("hc-period").value,
        verdict: document.getElementById("hc-verdict").value,
        note: document.getElementById("hc-note").value,
      });
      closeModal();
      closeDrawer();
      await refreshCompanies();
      toast("Health check logged");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  });
}

// ---------- AI review quick modal ----------
function openAiReviewModal(detail) {
  showModal(`
    <div class="flex items-center justify-between px-5 py-3 border-b border-slate-200">
      <h2 class="font-semibold">Run AI Review — ${detail.name}</h2>
      <button id="modal-close-x" class="text-slate-400 hover:text-slate-700 text-xl leading-none">&times;</button>
    </div>
    <div class="p-5 space-y-3">
      <label class="text-sm block">Period
        <input id="air-period" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
      </label>
      <label class="text-sm block">Narrative (optional)
        <textarea id="air-narrative" rows="3" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"></textarea>
      </label>
      <p class="text-xs text-slate-500">This only creates a proposal for the review queue — it never changes the company's status directly.</p>
    </div>
    <div class="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
      <button id="modal-cancel" class="text-sm px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50">Cancel</button>
      <button id="air-submit" class="text-sm px-3 py-1.5 rounded-md bg-slate-800 text-white hover:bg-slate-700">Run Review</button>
    </div>`);
  document.getElementById("modal-close-x").addEventListener("click", closeModal);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("air-submit").addEventListener("click", async () => {
    try {
      await api.aiReview(detail.company_id, {
        period: document.getElementById("air-period").value,
        narrative: document.getElementById("air-narrative").value || null,
      });
      closeModal();
      closeDrawer();
      toast("AI review proposal created — see Review Queue");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  });
}

// ---------- ingest modal (create + amend) ----------
async function openIngestModal(mode, existing) {
  showModal(renderIngestModalShell(state.taxonomy));

  const industrySelect = document.getElementById("f-industry");
  const nicheSelect = document.getElementById("f-niche");
  const modelSelect = document.getElementById("f-operating-model");

  function refreshNiches() {
    const industry = state.taxonomy.find((i) => i.name === industrySelect.value);
    nicheSelect.innerHTML = (industry?.niches || [])
      .map((n) => `<option value="${n.name}">${n.name}</option>`)
      .join("");
  }
  industrySelect.addEventListener("change", refreshNiches);
  refreshNiches();

  async function refreshMetricsSection(existingValues = {}) {
    const metrics = await metricsFor(modelSelect.value);
    document.getElementById("f-metrics-fields").innerHTML = renderMetricsFields(metrics, existingValues);
    return metrics;
  }
  let currentMetrics = await refreshMetricsSection();
  modelSelect.addEventListener("change", async () => {
    currentMetrics = await refreshMetricsSection();
    document.getElementById("f-kill-triggers").innerHTML = "";
  });

  function addRevenueRow(segment, share) {
    document.getElementById("f-revenue-split").insertAdjacentHTML("beforeend", renderRevenueSplitRow(segment, share));
  }
  function addReferenceRow(title, url) {
    document.getElementById("f-references").insertAdjacentHTML("beforeend", renderReferenceRow(title, url));
  }
  function addKillTriggerRow(trigger) {
    document.getElementById("f-kill-triggers").insertAdjacentHTML("beforeend", renderKillTriggerRow(currentMetrics, trigger || {}));
  }

  document.getElementById("modal-panel").addEventListener("click", (e) => {
    if (e.target.dataset.add === "revenue-split") addRevenueRow();
    if (e.target.dataset.add === "reference") addReferenceRow();
    if (e.target.dataset.add === "kill-trigger") addKillTriggerRow();
    if (e.target.hasAttribute("data-remove-row")) e.target.closest("div[class*='-row']")?.remove();
  });

  // tabs
  const formTab = document.getElementById("ingest-tab-form");
  const jsonTab = document.getElementById("ingest-tab-json");
  const formPanel = document.getElementById("ingest-form-panel");
  const jsonPanel = document.getElementById("ingest-json-panel");
  jsonTab.addEventListener("click", () => {
    jsonTab.className = "ingest-tab px-4 py-2 text-sm font-medium border-b-2 border-slate-800";
    formTab.className = "ingest-tab px-4 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500";
    formPanel.classList.add("hidden");
    jsonPanel.classList.remove("hidden");
    document.getElementById("ingest-json-textarea").value = JSON.stringify(collectFormPayload(), null, 2);
  });
  formTab.addEventListener("click", () => {
    formTab.className = "ingest-tab px-4 py-2 text-sm font-medium border-b-2 border-slate-800";
    jsonTab.className = "ingest-tab px-4 py-2 text-sm font-medium border-b-2 border-transparent text-slate-500";
    jsonPanel.classList.add("hidden");
    formPanel.classList.remove("hidden");
  });
  document.getElementById("json-validate").addEventListener("click", async () => {
    try {
      const payload = JSON.parse(document.getElementById("ingest-json-textarea").value);
      const errors = await validateAgainstContract(payload);
      showErrors(errors);
      if (!errors.length) toast("Structurally valid against contracts/thesis.schema.json — full business-rule validation happens on submit.");
    } catch (e) {
      showErrors([`Invalid JSON: ${e.message}`]);
    }
  });

  document.getElementById("ingest-close").addEventListener("click", closeModal);
  document.getElementById("ingest-cancel").addEventListener("click", closeModal);

  if (mode === "amend" && existing) {
    document.getElementById("ingest-submit").textContent = "Save Amendment";
    // amend only needs thesis_data + change_note — jump straight to JSON tab, prefilled
    jsonTab.click();
    const payload = { thesis_data: existing.current_thesis, change_note: "" };
    document.getElementById("ingest-json-textarea").value = JSON.stringify(payload, null, 2);
  }

  function collectFormPayload() {
    const metricValues = {};
    document.querySelectorAll("#f-metrics-fields .metric-input").forEach((i) => {
      if (i.value !== "") metricValues[i.dataset.metricKey] = Number(i.value);
    });
    const revenueSplit = [...document.querySelectorAll(".revenue-split-row")].map((row) => ({
      segment: row.querySelector(".rs-segment").value,
      share_pct: Number(row.querySelector(".rs-share").value || 0),
    }));
    const references = [...document.querySelectorAll(".reference-row")].map((row) => ({
      title: row.querySelector(".ref-title").value,
      url: row.querySelector(".ref-url").value,
    }));
    const killTriggers = [...document.querySelectorAll(".kill-trigger-row")].map((row) => {
      const metricKey = row.querySelector(".kt-metric").value || null;
      return {
        label: row.querySelector(".kt-label").value,
        metric_key: metricKey || null,
        operator: metricKey ? row.querySelector(".kt-operator").value : null,
        threshold: metricKey ? Number(row.querySelector(".kt-threshold").value || 0) : null,
        severity: row.querySelector(".kt-severity").value,
        action: row.querySelector(".kt-action").value,
        grace_periods: Number(row.querySelector(".kt-grace").value || 1),
        manual_check: !metricKey,
      };
    });

    return {
      company_id: document.getElementById("f-company-id").value.toUpperCase(),
      name: document.getElementById("f-name").value,
      classification: {
        broad_industry: industrySelect.value,
        specific_niche: nicheSelect.value,
        operating_model: modelSelect.value,
        currency: document.getElementById("f-currency").value || "INR",
      },
      status: document.getElementById("f-status").value,
      last_reviewed: document.getElementById("f-last-reviewed").value,
      thesis_data: {
        the_business: {
          what_it_does: document.getElementById("f-what-it-does").value,
          revenue_split: revenueSplit,
        },
        the_growth_engine: document.getElementById("f-growth-engine").value.split("\n").filter(Boolean),
        the_big_change: {
          summary: document.getElementById("f-big-change-summary").value,
          expected_completion: document.getElementById("f-expected-completion").value,
        },
        proof_points: {
          hard_evidence: document.getElementById("f-hard-evidence").value.split("\n").filter(Boolean),
          model_specific_metrics: metricValues,
        },
        what_can_kill_it: killTriggers,
        why_we_believe_it: document.getElementById("f-why-believe").value.split("\n").filter(Boolean),
        health_check: {
          latest_quarter_review: document.getElementById("f-latest-review").value,
          historical_checks: [],
        },
        references,
      },
    };
  }

  document.getElementById("ingest-submit").addEventListener("click", async () => {
    const usingJson = !jsonPanel.classList.contains("hidden");
    let payload;
    try {
      payload = usingJson ? JSON.parse(document.getElementById("ingest-json-textarea").value) : collectFormPayload();
    } catch (e) {
      showErrors([`Invalid JSON: ${e.message}`]);
      return;
    }
    try {
      if (mode === "amend" && existing) {
        await api.amendThesis(existing.company_id, payload);
        toast("Thesis amended");
      } else {
        await api.createCompany(payload);
        toast("Company created");
      }
      closeModal();
      closeDrawer();
      state.metricDefsByKey = state.metricDefsByKey; // unchanged, but refresh cards for new/updated data
      await refreshCompanies();
    } catch (e) {
      if (e instanceof ApiError && e.body?.errors) {
        showErrors(e.body.errors.map((err) => `${err.field}: ${err.message}`));
      } else {
        showErrors([errorMessage(e)]);
      }
    }
  });
}

// ---------- lightweight client-side contract validation ----------
// Not a full JSON Schema engine (no anyOf/pattern/format support) — checks
// required fields, types, and enums recursively via $ref/$defs. Real
// business-rule validation (revenue split sums, metric registry membership,
// etc.) is server-side; this exists to catch obvious shape errors before
// a round trip, per BUILD_PLAN.md §8 point 4.
let _schemaCache = null;

async function loadContractSchema() {
  if (!_schemaCache) _schemaCache = await fetch("/contracts/thesis.schema.json").then((r) => r.json());
  return _schemaCache;
}

function resolveRef(schema, root) {
  if (schema?.$ref) {
    const name = schema.$ref.replace("#/$defs/", "");
    return root.$defs?.[name] || {};
  }
  return schema;
}

function validateNode(value, schema, root, path, errors) {
  schema = resolveRef(schema, root);
  if (!schema || Object.keys(schema).length === 0) return;

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`);
    return;
  }
  const type = schema.type;
  if (type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push(`${path}: expected an object`);
      return;
    }
    for (const req of schema.required || []) {
      if (!(req in value)) errors.push(`${path}.${req}: required field missing`);
    }
    for (const [key, propSchema] of Object.entries(schema.properties || {})) {
      if (key in value) validateNode(value[key], propSchema, root, `${path}.${key}`, errors);
    }
  } else if (type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected an array`);
      return;
    }
    if (schema.minItems && value.length < schema.minItems) {
      errors.push(`${path}: needs at least ${schema.minItems} item(s), got ${value.length}`);
    }
    value.forEach((item, i) => validateNode(item, schema.items || {}, root, `${path}[${i}]`, errors));
  } else if (type === "string" && typeof value !== "string") {
    errors.push(`${path}: expected a string`);
  } else if ((type === "number" || type === "integer") && typeof value !== "number") {
    errors.push(`${path}: expected a number`);
  } else if (type === "boolean" && typeof value !== "boolean") {
    errors.push(`${path}: expected a boolean`);
  }
}

async function validateAgainstContract(payload) {
  const schema = await loadContractSchema();
  const errors = [];
  validateNode(payload, schema, schema, "$", errors);
  return errors;
}

function showErrors(messages) {
  const box = document.getElementById("ingest-errors");
  if (!box) return;
  if (!messages.length) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = messages.map((m) => `<div>${m}</div>`).join("");
}

// ---------- review queue ----------
async function loadReviewQueue() {
  const proposals = await api.listProposals("pending");
  document.getElementById("review-queue-view").innerHTML = renderReviewQueue(proposals);
  document.getElementById("review-queue-view").querySelectorAll("[data-resolve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest("[data-proposal-id]");
      const proposalId = card.dataset.proposalId;
      const note = card.querySelector(".resolve-note").value;
      try {
        await api.resolveProposal(proposalId, { action: btn.dataset.resolve, note: note || undefined });
        toast(`Proposal ${btn.dataset.resolve}ed`);
        await Promise.all([loadReviewQueue(), refreshCompanies()]);
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    });
  });
}

// ---------- export ----------
function openExportPanel() {
  showModal(renderExportPanel());
  document.getElementById("export-close").addEventListener("click", closeModal);
  document.getElementById("export-load-stats").addEventListener("click", async () => {
    const params = {
      format: document.getElementById("export-format").value,
      split: document.getElementById("export-split").value,
      include_open: document.getElementById("export-include-open").checked,
    };
    try {
      const stats = await api.exportStats(params);
      const box = document.getElementById("export-stats");
      box.classList.remove("hidden");
      box.innerHTML = renderExportStats(stats);
      const dl = document.getElementById("export-download");
      dl.classList.remove("hidden");
      dl.href = api.exportUrl({ task: document.getElementById("export-task").value, ...params });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  });
}

// ---------- nav / views ----------
function setView(view) {
  state.view = view;
  document.getElementById("cards-grid").classList.toggle("hidden", view !== "cards");
  document.getElementById("facet-bar").classList.toggle("hidden", view !== "cards");
  document.getElementById("review-queue-view").classList.toggle("hidden", view !== "review");
  if (view === "review") loadReviewQueue().catch((e) => toast(errorMessage(e), "error"));
}

// ---------- init ----------
async function init() {
  document.getElementById("api-key-input").value = getApiKey();
  document.getElementById("api-key-input").addEventListener("change", (e) => {
    setApiKey(e.target.value);
    refreshCompanies().catch((err) => toast(errorMessage(err), "error"));
  });

  document.getElementById("nav-companies").addEventListener("click", () => setView("cards"));
  document.getElementById("nav-review-queue").addEventListener("click", () => setView("review"));
  document.getElementById("nav-export").addEventListener("click", openExportPanel);
  document.getElementById("nav-new-company").addEventListener("click", () => openIngestModal("create", null));

  document.getElementById("cards-grid").addEventListener("click", (e) => {
    const btn = e.target.closest(".card-open");
    if (btn) openDrawer(btn.dataset.companyId).catch((err) => toast(errorMessage(err), "error"));
  });

  try {
    state.taxonomy = await api.getTaxonomy();
    await loadMetricDefsIndex();
    renderFacets();
    await refreshCompanies();
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}

init();
