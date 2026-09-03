import { escapeHtml } from "./format.js";

// Canonical pillar identifiers as the backend stores them (app/pillars.py),
// paired with a display label. Shared by the table builder's "Section"
// picker and by app.js when it groups a company's tables by section.
export const PILLAR_SECTIONS = [
  { value: "the_business", label: "1. The Business" },
  { value: "the_growth_engine", label: "2. The Growth Engine" },
  { value: "the_big_change", label: "3. The Big Change" },
  { value: "proof_points", label: "4. Proof Points" },
  { value: "what_can_kill_it", label: "5. What Can Kill It" },
  { value: "why_we_believe_it", label: "6. Why We Believe It" },
  { value: "health_check", label: "7. Health Check" },
  { value: "references", label: "References" },
];

// An unattached custom table, promoted to a first-class left-nav entry -
// same visual weight as any of the 7 pillars, named after the table itself,
// so "make this its own section" (the Section picker's "(unattached)"
// option) actually reads as a real section rather than a row in a list.
export function renderTableNavButton(table) {
  return `<button type="button" data-open-table="${table.id}" class="ingest-section-btn text-left px-2.5 py-1.5 rounded-md text-sm text-muted-fg hover:bg-surface-3 hover:text-fg w-full truncate" title="${escapeHtml(table.name)}">${escapeHtml(table.name)}</button>`;
}

export function renderTablesInDrawer(tables) {
  if (!tables.length) {
    return `<div class="text-xs text-muted-fg">No custom tables yet.</div>`;
  }
  return tables
    .map(
      (t) => `
      <div class="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <div>
          <span class="text-sm font-medium">${escapeHtml(t.name)}</span>
          <span class="text-xs text-muted-fg ml-2">${t.columns.length} columns &middot; ${t.row_count} rows</span>
        </div>
        <div class="flex items-center gap-2">
          <button data-open-table="${t.id}" class="text-xs px-2 py-1 rounded-md border border-border hover:bg-surface-3">Open</button>
          <button data-delete-table="${t.id}" class="text-xs px-2 py-1 rounded-md border border-border hover:text-danger">Delete</button>
        </div>
      </div>`
    )
    .join("");
}

export function renderColumnRow(column = {}) {
  return `<div class="table-column-row grid grid-cols-12 gap-1 items-center">
    <input placeholder="key (e.g. promoter_pct)" value="${escapeHtml(column.key || "")}" class="col-key col-span-3 rounded-md border border-border px-2 py-1 text-xs font-mono" />
    <input placeholder="Label" value="${escapeHtml(column.label || "")}" class="col-label col-span-3 rounded-md border border-border px-2 py-1 text-xs" />
    <select class="col-type col-span-2 rounded-md border border-border px-1 py-1 text-xs">
      ${["text", "number", "date", "enum"]
        .map((t) => `<option value="${t}" ${column.type === t ? "selected" : ""}>${t}</option>`)
        .join("")}
    </select>
    <input placeholder="Options (enum only, comma-separated)" value="${escapeHtml((column.options || []).join(", "))}" class="col-options col-span-3 rounded-md border border-border px-2 py-1 text-xs" />
    <button type="button" data-remove-row class="text-muted-fg hover:text-danger text-center">&times;</button>
  </div>`;
}

// Tier 1 (Excel-like columns, editable anytime, not just at creation) and
// Tier 2 (attach the table to one of the 7 pillars) share this one form:
// pass an existing `table` to edit it in place (name/columns/section can
// all change after creation - deleting a column just stops showing that
// key in the grid, existing row data for it is left alone rather than
// destroyed), or `defaultSection` to preset the picker when opened via a
// pillar panel's own "+ Add Table Here" button.
export function renderTableBuilderForm(table = null, defaultSection = null) {
  const sectionValue = table ? table.section : defaultSection;
  const sectionOptions = PILLAR_SECTIONS.map(
    (s) => `<option value="${s.value}" ${sectionValue === s.value ? "selected" : ""}>${escapeHtml(s.label)}</option>`
  ).join("");
  return `
    <div class="flex items-center justify-between px-5 py-3 border-b border-border">
      <h2 class="font-semibold">${table ? "Edit Data Table" : "New Data Table"}</h2>
      <button id="modal-close-x" class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
    </div>
    <div class="p-5 overflow-y-auto" style="max-height: 70vh">
      <label class="block text-sm">Table Name
        <input id="table-name" value="${escapeHtml(table?.name || "")}" placeholder="e.g. Shareholding Pattern" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
      </label>
      <label class="block text-sm mt-3">Section <span class="text-muted-fg">(optional - shows this table inside that pillar instead of the flat Custom Sections list)</span>
        <select id="table-section" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
          <option value="">(unattached)</option>
          ${sectionOptions}
        </select>
      </label>
      <div class="mt-4">
        <div class="text-sm font-medium">Columns <span class="text-muted-fg font-normal">- add, remove, or rename these anytime, even after rows exist</span></div>
        <div id="table-columns" class="space-y-1 mt-1"></div>
        <button type="button" data-add="table-column" class="text-xs text-ok mt-2">+ Add Column</button>
      </div>
      <div id="table-builder-errors" class="hidden mt-3 rounded-md bg-danger/10 border border-danger/30 p-2 text-sm text-danger"></div>
    </div>
    <div class="px-5 py-3 border-t border-border flex justify-end gap-2">
      <button id="modal-cancel" class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Cancel</button>
      <button id="table-builder-submit" class="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90">${table ? "Save Changes" : "Create Table"}</button>
    </div>`;
}

function formatCell(value, column) {
  if (value === undefined || value === null || value === "") return `<span class="text-muted-fg">-</span>`;
  if (column.type === "number") return `<span class="font-mono">${escapeHtml(String(value))}</span>`;
  if (column.type === "enum") return `<span class="text-xs px-2 py-0.5 rounded-full bg-surface-3">${escapeHtml(String(value))}</span>`;
  return escapeHtml(String(value));
}

export function renderTableGrid(table, readOnly) {
  const columns = table.columns;
  return `
    <div class="flex items-center justify-between px-5 py-3 border-b border-border">
      <h2 class="font-semibold">${escapeHtml(table.name)}</h2>
      <div class="flex items-center gap-3">
        ${readOnly ? "" : `<button id="table-edit-columns" class="text-xs px-2 py-1 rounded-md border border-border hover:bg-surface-3">Edit Columns</button>`}
        ${readOnly ? "" : `<button id="table-delete" class="text-xs px-2 py-1 rounded-md border border-border hover:text-danger">Delete Table</button>`}
        <button id="modal-close-x" class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
      </div>
    </div>
    <div class="p-5 overflow-y-auto" style="max-height: 70vh">
      <div class="overflow-x-auto rounded-md border border-border">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-surface-2">
              ${columns.map((c) => `<th class="text-left px-3 py-2 font-medium text-xs uppercase tracking-wide text-muted-fg whitespace-nowrap">${escapeHtml(c.label)}</th>`).join("")}
              ${readOnly ? "" : `<th class="px-3 py-2"></th>`}
            </tr>
          </thead>
          <tbody>
            ${
              table.rows.length
                ? table.rows
                    .map(
                      (row) => `
              <tr class="border-t border-border" data-row-id="${row.id}">
                ${columns.map((c) => `<td class="px-3 py-2 whitespace-nowrap">${formatCell(row.row_data[c.key], c)}</td>`).join("")}
                ${
                  readOnly
                    ? ""
                    : `<td class="px-3 py-2 text-right whitespace-nowrap">
                        <button data-edit-row="${row.id}" class="text-xs px-2 py-0.5 rounded-md border border-border hover:bg-surface-3">Edit</button>
                        <button data-delete-row="${row.id}" class="text-xs px-2 py-0.5 rounded-md border border-border hover:text-danger">Delete</button>
                      </td>`
                }
              </tr>`
                    )
                    .join("")
                : `<tr><td colspan="${columns.length + 1}" class="px-3 py-6 text-center text-muted-fg">No rows yet.</td></tr>`
            }
          </tbody>
        </table>
      </div>
      ${!readOnly && columns.length ? `<button id="table-add-row" class="text-xs text-ok mt-3">+ Add Row</button>` : ""}
      ${!columns.length ? `<div class="text-xs text-muted-fg mt-3">This table has no columns yet - edit it to add some.</div>` : ""}
    </div>`;
}

export function renderRowForm(columns, existingRowData = {}, rowId = null) {
  const fields = columns
    .map((c) => {
      const value = existingRowData[c.key] ?? "";
      if (c.type === "enum") {
        return `<label class="text-sm block mt-2">${escapeHtml(c.label)}
          <select data-row-field="${escapeHtml(c.key)}" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
            <option value="">-</option>
            ${(c.options || []).map((o) => `<option value="${escapeHtml(o)}" ${o === value ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
          </select>
        </label>`;
      }
      const inputType = c.type === "number" ? "number" : c.type === "date" ? "date" : "text";
      return `<label class="text-sm block mt-2">${escapeHtml(c.label)}
        <input data-row-field="${escapeHtml(c.key)}" type="${inputType}" step="any" value="${escapeHtml(String(value))}" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
      </label>`;
    })
    .join("");
  return `
    <div class="flex items-center justify-between px-5 py-3 border-b border-border">
      <h2 class="font-semibold">${rowId ? "Edit Row" : "Add Row"}</h2>
      <button id="modal-close-x" class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
    </div>
    <div class="p-5">
      ${fields}
      <div id="row-form-errors" class="hidden mt-3 rounded-md bg-danger/10 border border-danger/30 p-2 text-sm text-danger"></div>
    </div>
    <div class="px-5 py-3 border-t border-border flex justify-end gap-2">
      <button id="modal-cancel" class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Cancel</button>
      <button id="row-form-submit" data-row-id="${rowId || ""}" class="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90">${rowId ? "Save" : "Add"}</button>
    </div>`;
}
