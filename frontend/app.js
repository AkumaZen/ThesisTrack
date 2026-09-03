import {
  api,
  ApiError,
  clearSession,
  getApiKey,
  getEmail,
  getRole,
  getToken,
  isReadOnly,
  setApiKey,
  setSession,
} from "./api.js";
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
import { renderGuidanceFilterBar, renderGuidanceList, renderGuidanceAddForm } from "./components/guidance.js";
import {
  renderTablesInDrawer,
  renderColumnRow,
  renderTableBuilderForm,
  renderTableGrid,
  renderRowForm,
} from "./components/customTables.js";

const state = {
  filters: readFiltersFromUrl(),
  taxonomy: [],
  metricDefsByKey: {},
  metricsCache: {},
  view: "cards",
  guidanceFilters: { company_id: "", block_key: "", status: "open" },
  guidanceCompanies: null,
};

// ---------- toast ----------
function toast(message, kind = "ok") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = `fixed bottom-4 right-4 z-50 rounded-md px-4 py-2 text-sm shadow-lg ${
    kind === "error" ? "bg-danger text-white" : "bg-good text-accent-ink"
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
  document.getElementById("drawer-guidance").addEventListener("click", () => {
    state.guidanceFilters = { company_id: companyId, block_key: "", status: "open" };
    setView("guidance");
  });
  document.getElementById("drawer-new-table").addEventListener("click", () => openTableBuilder(companyId));
  loadTablesIntoDrawer(companyId);
  gateWriteUI();
}

function closeDrawer() {
  document.getElementById("drawer").classList.add("hidden");
  document.getElementById("drawer-overlay").classList.add("hidden");
}

// ---------- custom tables ----------
async function loadTablesIntoDrawer(companyId) {
  const container = document.getElementById("drawer-tables");
  try {
    const tables = await api.listTables(companyId);
    container.innerHTML = renderTablesInDrawer(tables);
    container.querySelectorAll("[data-open-table]").forEach((btn) => {
      btn.addEventListener("click", () => openTableGrid(Number(btn.dataset.openTable)));
    });
    if (!isReadOnly()) {
      container.querySelectorAll("[data-delete-table]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Delete this table and all its rows?")) return;
          await api.deleteTable(Number(btn.dataset.deleteTable));
          await loadTablesIntoDrawer(companyId);
        });
      });
    } else {
      container.querySelectorAll("[data-delete-table]").forEach((btn) => btn.classList.add("hidden"));
    }
  } catch (e) {
    container.innerHTML = `<div class="text-xs text-danger">Failed to load tables.</div>`;
  }
}

function openTableBuilder(companyId) {
  showModal(renderTableBuilderForm());
  const columnsContainer = document.getElementById("table-columns");
  function addColumnRow(col) {
    columnsContainer.insertAdjacentHTML("beforeend", renderColumnRow(col));
  }
  addColumnRow();
  document.getElementById("modal-panel").addEventListener("click", (e) => {
    if (e.target.dataset.add === "table-column") addColumnRow();
    if (e.target.hasAttribute("data-remove-row")) e.target.closest(".table-column-row")?.remove();
  });
  document.getElementById("modal-close-x").addEventListener("click", closeModal);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("table-builder-submit").addEventListener("click", async () => {
    const name = document.getElementById("table-name").value.trim();
    const columns = [...columnsContainer.querySelectorAll(".table-column-row")]
      .map((row) => {
        const key = row.querySelector(".col-key").value.trim();
        const label = row.querySelector(".col-label").value.trim();
        const type = row.querySelector(".col-type").value;
        const optionsRaw = row.querySelector(".col-options").value.trim();
        const options = optionsRaw
          ? optionsRaw.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined;
        return { key, label, type, options };
      })
      .filter((c) => c.key && c.label);
    try {
      await api.createTable(companyId, { name, columns });
      toast("Table created");
      closeModal();
      await loadTablesIntoDrawer(companyId);
    } catch (e) {
      const box = document.getElementById("table-builder-errors");
      box.textContent = errorMessage(e);
      box.classList.remove("hidden");
    }
  });
}

async function openTableGrid(tableId) {
  const table = await api.getTable(tableId);
  const readOnly = isReadOnly();
  showModal(renderTableGrid(table, readOnly));
  document.getElementById("modal-close-x").addEventListener("click", closeModal);
  if (readOnly) return;

  document.querySelectorAll("[data-edit-row]").forEach((btn) => {
    btn.addEventListener("click", () => openRowForm(table, Number(btn.dataset.editRow)));
  });
  document.querySelectorAll("[data-delete-row]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this row?")) return;
      await api.deleteRow(tableId, Number(btn.dataset.deleteRow));
      await openTableGrid(tableId);
    });
  });
  document.getElementById("table-add-row")?.addEventListener("click", () => openRowForm(table, null));
}

function openRowForm(table, rowId) {
  const existingRow = rowId ? table.rows.find((r) => r.id === rowId) : null;
  showModal(renderRowForm(table.columns, existingRow?.row_data || {}, rowId));
  document.getElementById("modal-close-x").addEventListener("click", closeModal);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("row-form-submit").addEventListener("click", async () => {
    const rowData = {};
    document.querySelectorAll("[data-row-field]").forEach((field) => {
      if (field.value !== "") rowData[field.dataset.rowField] = field.value;
    });
    try {
      if (rowId) {
        await api.updateRow(table.id, rowId, { row_data: rowData });
      } else {
        await api.createRow(table.id, { row_data: rowData });
      }
      await openTableGrid(table.id);
    } catch (e) {
      const box = document.getElementById("row-form-errors");
      box.textContent = errorMessage(e);
      box.classList.remove("hidden");
    }
  });
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
    <div class="flex items-center justify-between px-5 py-3 border-b border-border">
      <h2 class="font-semibold">Post Observations - ${detail.name}</h2>
      <button id="modal-close-x" class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
    </div>
    <div class="p-5 space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <label class="text-sm">Period (e.g. FY26Q1)
          <input id="obs-period" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
        </label>
        <label class="text-sm">Period End
          <input id="obs-period-end" type="date" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
        </label>
      </div>
      <div id="obs-metrics" class="grid grid-cols-2 gap-3">${renderMetricsFields(metrics)}</div>
    </div>
    <div class="px-5 py-3 border-t border-border flex justify-end gap-2">
      <button id="modal-cancel" class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Cancel</button>
      <button id="obs-submit" class="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90">Post</button>
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
      toast(newProposals ? `Posted - ${newProposals} new proposal(s) raised` : "Observations posted");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  });
}

// ---------- health check quick modal ----------
function openHealthCheckModal(detail) {
  showModal(`
    <div class="flex items-center justify-between px-5 py-3 border-b border-border">
      <h2 class="font-semibold">Log Health Check - ${detail.name}</h2>
      <button id="modal-close-x" class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
    </div>
    <div class="p-5 space-y-3">
      <label class="text-sm block">Period
        <input id="hc-period" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
      </label>
      <label class="text-sm block">Verdict
        <select id="hc-verdict" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
          <option value="on_track">on_track</option>
          <option value="watch_closely">watch_closely</option>
          <option value="broken">broken</option>
        </select>
      </label>
      <label class="text-sm block">Note ${detail.active_override ? '<span class="text-danger">(required - an override is active)</span>' : ""}
        <textarea id="hc-note" rows="3" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"></textarea>
      </label>
    </div>
    <div class="px-5 py-3 border-t border-border flex justify-end gap-2">
      <button id="modal-cancel" class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Cancel</button>
      <button id="hc-submit" class="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90">Submit</button>
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
    <div class="flex items-center justify-between px-5 py-3 border-b border-border">
      <h2 class="font-semibold">Run AI Review - ${detail.name}</h2>
      <button id="modal-close-x" class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
    </div>
    <div class="p-5 space-y-3">
      <label class="text-sm block">Period
        <input id="air-period" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
      </label>
      <label class="text-sm block">Narrative (optional)
        <textarea id="air-narrative" rows="3" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"></textarea>
      </label>
      <p class="text-xs text-muted-fg">This only creates a proposal for the review queue - it never changes the company's status directly.</p>
    </div>
    <div class="px-5 py-3 border-t border-border flex justify-end gap-2">
      <button id="modal-cancel" class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Cancel</button>
      <button id="air-submit" class="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90">Run Review</button>
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
      toast("AI review proposal created - see Review Queue");
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
    jsonTab.className = "ingest-tab px-4 py-2 text-sm font-medium border-b-2 border-accent";
    formTab.className = "ingest-tab px-4 py-2 text-sm font-medium border-b-2 border-transparent text-muted-fg";
    formPanel.classList.add("hidden");
    jsonPanel.classList.remove("hidden");
    document.getElementById("ingest-json-textarea").value = JSON.stringify(collectFormPayload(), null, 2);
  });
  formTab.addEventListener("click", () => {
    formTab.className = "ingest-tab px-4 py-2 text-sm font-medium border-b-2 border-accent";
    jsonTab.className = "ingest-tab px-4 py-2 text-sm font-medium border-b-2 border-transparent text-muted-fg";
    jsonPanel.classList.add("hidden");
    formPanel.classList.remove("hidden");
  });
  buildConversionPrompt()
    .then((text) => {
      document.getElementById("conversion-prompt").value = text;
    })
    .catch(() => {
      document.getElementById("conversion-prompt").value = "Could not build the prompt (failed to load schema/metrics).";
    });
  document.getElementById("copy-conversion-prompt").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById("conversion-prompt").value);
      toast("Prompt copied");
    } catch (e) {
      toast("Copy failed - select the text manually", "error");
    }
  });

  document.getElementById("json-validate").addEventListener("click", async () => {
    try {
      const payload = JSON.parse(document.getElementById("ingest-json-textarea").value);
      const errors = await validateAgainstContract(payload);
      showErrors(errors);
      if (!errors.length) toast("Structurally valid against contracts/thesis.schema.json - full business-rule validation happens on submit.");
    } catch (e) {
      showErrors([`Invalid JSON: ${e.message}`]);
    }
  });

  document.getElementById("ingest-close").addEventListener("click", closeModal);
  document.getElementById("ingest-cancel").addEventListener("click", closeModal);

  if (mode === "amend" && existing) {
    document.getElementById("ingest-submit").textContent = "Save Amendment";
    // amend only needs thesis_data + change_note - jump straight to JSON tab, prefilled
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
// Not a full JSON Schema engine (no anyOf/pattern/format support) - checks
// required fields, types, and enums recursively via $ref/$defs. Real
// business-rule validation (revenue split sums, metric registry membership,
// etc.) is server-side; this exists to catch obvious shape errors before
// a round trip, per BUILD_PLAN.md §8 point 4.
let _schemaCache = null;

async function loadContractSchema() {
  if (!_schemaCache) _schemaCache = await fetch("/contracts/thesis.schema.json").then((r) => r.json());
  return _schemaCache;
}

// Builds the "convert an existing thesis externally" prompt live from the
// same schema/taxonomy/metric-registry endpoints json-validate already uses,
// so it can never drift out of sync with what the server actually accepts.
async function buildConversionPrompt() {
  const [schema, allMetrics] = await Promise.all([loadContractSchema(), api.getMetrics()]);
  const industries = state.taxonomy
    .map((i) => `${i.name}: ${(i.niches || []).map((n) => n.name).join(", ")}`)
    .join("\n");
  const metricsByModel = {};
  for (const m of allMetrics) {
    const key = m.operating_model || "universal (any operating model)";
    (metricsByModel[key] ||= []).push(`${m.metric_key} (${m.label}, unit=${m.unit})`);
  }
  const metricsText = Object.entries(metricsByModel)
    .map(([model, keys]) => `  ${model}:\n    ${keys.join("\n    ")}`)
    .join("\n");

  return `You are converting an existing, free-form investment thesis write-up into a structured JSON object for an internal thesis-tracking system.

I will paste my existing notes/write-up in this conversation. Read them and produce a single JSON object that matches the JSON Schema below EXACTLY - field names, nesting, and types must match. If anything required is missing or ambiguous from my notes, ASK ME before guessing.

Rules to follow:
- classification.broad_industry and classification.specific_niche must be chosen from this controlled list (ask me to pick if my notes don't map cleanly):
${industries}
- classification.operating_model must be one of: factory, subscription, money_lending, retail_stores, services.
- proof_points.model_specific_metrics and what_can_kill_it[].metric_key, if used, must use metric_key values from this registry (only keys valid for my chosen operating_model, or listed under "universal"):
${metricsText}
- why_we_believe_it must be an array of strings, at least 3 entries, at least one starting with "Premise" and exactly one starting with "Conclusion".
- what_can_kill_it needs at least one entry with severity="kill"; each entry either sets manual_check=true or provides metric_key+operator+threshold.
- the_business.revenue_split shares must sum to ~100.

Once you have everything, output ONLY the JSON object (no markdown code fences, no commentary) matching this schema:

${JSON.stringify(schema, null, 2)}`;
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
  gateWriteUI();
}

// ---------- guidance tracker ----------
async function loadGuidanceView() {
  if (!state.guidanceCompanies) {
    const res = await api.listCompanies({ page_size: 200, sort: "name" });
    state.guidanceCompanies = res.items;
  }
  const items = await api.listGuidance({
    company_id: state.guidanceFilters.company_id || undefined,
    block_key: state.guidanceFilters.block_key || undefined,
    status: state.guidanceFilters.status || undefined,
  });
  const readOnly = isReadOnly();
  const container = document.getElementById("guidance-view");
  container.innerHTML = renderGuidanceFilterBar(state.guidanceCompanies, state.guidanceFilters) + renderGuidanceList(items, readOnly);

  document.getElementById("guidance-filter-company").addEventListener("change", (e) => {
    state.guidanceFilters.company_id = e.target.value;
    loadGuidanceView();
  });
  document.getElementById("guidance-filter-block").addEventListener("change", (e) => {
    state.guidanceFilters.block_key = e.target.value;
    loadGuidanceView();
  });
  document.getElementById("guidance-filter-status").addEventListener("change", (e) => {
    state.guidanceFilters.status = e.target.value;
    loadGuidanceView();
  });

  if (readOnly) {
    document.getElementById("guidance-add")?.classList.add("hidden");
  } else {
    document.getElementById("guidance-add").addEventListener("click", openGuidanceAddForm);
    container.querySelectorAll("[data-resolve]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await api.resolveGuidance(Number(btn.dataset.resolve));
        toast("Marked resolved");
        await loadGuidanceView();
      });
    });
    container.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this guidance note?")) return;
        await api.deleteGuidance(Number(btn.dataset.delete));
        await loadGuidanceView();
      });
    });
  }

  container.querySelectorAll("[data-open-company]").forEach((btn) => {
    btn.addEventListener("click", () => openDrawer(btn.dataset.openCompany));
  });
}

function openGuidanceAddForm() {
  showModal(renderGuidanceAddForm(state.guidanceCompanies, state.guidanceFilters.company_id));
  document.getElementById("modal-close-x").addEventListener("click", closeModal);
  document.getElementById("modal-cancel").addEventListener("click", closeModal);
  document.getElementById("guidance-submit").addEventListener("click", async () => {
    const companyId = document.getElementById("guidance-company").value;
    const blockKey = document.getElementById("guidance-block").value;
    const note = document.getElementById("guidance-note").value.trim();
    if (!companyId || !note) {
      toast("Pick a company and write a note", "error");
      return;
    }
    try {
      await api.createGuidance(companyId, { block_key: blockKey, note });
      toast("Guidance added");
      closeModal();
      await loadGuidanceView();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
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
  document.getElementById("guidance-view").classList.toggle("hidden", view !== "guidance");
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.nav === view);
  });
  if (view === "review") loadReviewQueue().catch((e) => toast(errorMessage(e), "error"));
  if (view === "guidance") loadGuidanceView().catch((e) => toast(errorMessage(e), "error"));
}

// ---------- read-only gating (UX-only; the backend is the real boundary) ----------
function gateWriteUI() {
  const readOnly = isReadOnly();
  document.getElementById("nav-new-company").classList.toggle("hidden", readOnly);
  for (const id of ["drawer-amend", "drawer-observations", "drawer-health-check", "drawer-ai-review", "drawer-new-table"]) {
    document.getElementById(id)?.classList.toggle("hidden", readOnly);
  }
  if (readOnly) {
    document.querySelectorAll("[data-resolve]").forEach((btn) => (btn.disabled = true));
    document.querySelectorAll(".resolve-note").forEach((input) => (input.disabled = true));
  }
}

// ---------- login ----------
function isAuthenticated() {
  return Boolean(getToken() || getApiKey());
}

function showLoginScreen() {
  document.getElementById("login-overlay").classList.remove("hidden");

  const showError = (msg) => {
    const el = document.getElementById("login-error");
    el.textContent = msg;
    el.classList.remove("hidden");
  };

  document.getElementById("login-submit").addEventListener("click", async () => {
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    try {
      const resp = await api.login(email, password);
      setSession(resp.access_token, resp.email, resp.role);
      document.getElementById("login-overlay").classList.add("hidden");
      startApp();
    } catch (e) {
      showError(errorMessage(e));
    }
  });

  document.getElementById("login-api-key-submit").addEventListener("click", () => {
    const key = document.getElementById("login-api-key").value;
    if (!key) return;
    setApiKey(key);
    document.getElementById("login-overlay").classList.add("hidden");
    startApp();
  });
}

function wireSessionHeader() {
  const badge = document.getElementById("session-badge");
  if (getToken()) {
    badge.textContent = `${getEmail()} (${getRole()})`;
  } else {
    badge.textContent = "API key session";
  }
  document.getElementById("nav-sign-out").addEventListener("click", () => {
    clearSession();
    setApiKey("");
    location.reload();
  });
}

// ---------- theme ----------
function currentTheme() {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function wireThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  const applyLabel = () => {
    btn.textContent = currentTheme() === "dark" ? "Light mode" : "Dark mode";
  };
  applyLabel();
  btn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch (e) {}
    applyLabel();
  });
}

// ---------- init ----------
async function startApp() {
  wireThemeToggle();
  wireSessionHeader();
  gateWriteUI();

  document.getElementById("nav-companies").addEventListener("click", () => setView("cards"));
  document.getElementById("nav-review-queue").addEventListener("click", () => setView("review"));
  document.getElementById("nav-guidance").addEventListener("click", () => setView("guidance"));
  document.getElementById("nav-export").addEventListener("click", openExportPanel);
  document.getElementById("nav-new-company").addEventListener("click", () => openIngestModal("create", null));
  setView("cards");

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

function init() {
  if (isAuthenticated()) {
    startApp();
  } else {
    showLoginScreen();
  }
}

init();
