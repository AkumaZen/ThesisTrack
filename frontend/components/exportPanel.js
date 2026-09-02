export function renderExportPanel() {
  return `
    <div class="flex items-center justify-between px-5 py-3 border-b border-slate-200">
      <h2 class="font-semibold">Export Training Data</h2>
      <button id="export-close" class="text-slate-400 hover:text-slate-700 text-xl leading-none">&times;</button>
    </div>
    <div class="p-5 space-y-3">
      <label class="block text-sm">Task
        <select id="export-task" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          <option value="verdict">verdict</option>
          <option value="thesis_synthesis">thesis_synthesis</option>
          <option value="redline_extraction">redline_extraction</option>
        </select>
      </label>
      <label class="block text-sm">Format
        <select id="export-format" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          <option value="anthropic">anthropic</option>
          <option value="openai">openai</option>
          <option value="llama">llama</option>
        </select>
      </label>
      <label class="block text-sm">Split
        <select id="export-split" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
          <option value="train">train</option>
          <option value="eval">eval</option>
          <option value="all">all</option>
        </select>
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" id="export-include-open" />
        Include open (unresolved-outcome) companies
      </label>
      <button id="export-load-stats" class="text-sm px-3 py-1.5 rounded-md border border-slate-300 hover:bg-slate-50">Load Dataset Summary</button>
      <div id="export-stats" class="text-sm bg-slate-50 rounded-md p-3 hidden"></div>
      <a id="export-download" class="hidden text-sm px-3 py-1.5 rounded-md bg-slate-800 text-white hover:bg-slate-700 inline-block text-center"
         href="#" target="_blank" rel="noopener">Download JSONL</a>
    </div>`;
}

export function renderExportStats(stats) {
  return `
    <div><strong>Rows:</strong> ${stats.row_count ?? 0}</div>
    <div><strong>Class balance:</strong> ${JSON.stringify(stats.class_balance ?? {})}</div>
    <div><strong>By operating model:</strong> ${JSON.stringify(stats.by_operating_model ?? {})}</div>
    <div><strong>Leakage violations:</strong> ${stats.leakage_violations ?? 0}</div>`;
}
