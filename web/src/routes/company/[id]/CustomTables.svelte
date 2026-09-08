<script lang="ts">
	// Custom "Data Tables" section for a company: create/edit/delete tables
	// with Excel-like columns (frontend/components/customTables.js ported to
	// Svelte 5), plus row CRUD. Self-contained - the parent company page just
	// mounts <CustomTables {companyId} />, no shared state with the
	// observation/decision/price/health-check panels.
	//
	// Grids render inline (expanded by default) rather than behind an "Open"
	// button + modal - the data is the point of this section, so it should be
	// visible without an extra click. A user can still collapse a table they
	// don't want to see right now via the Hide/Show toggle.
	import { api, ApiError } from '$lib/api';

	// `section` filters/tags tables to one thesis pillar (e.g. "the_business")
	// when set - used when this component is mounted inside a pillar section
	// on the company page. Leave unset for the top-level "Custom Sections"
	// block, which only shows/creates untagged tables.
	let {
		companyId,
		section = null,
		heading = 'Data Tables',
		compact = false,
		onTablesChange
	}: {
		companyId: string;
		section?: string | null;
		heading?: string;
		compact?: boolean;
		onTablesChange?: (tables: { id: number; name: string }[]) => void;
	} = $props();

	type ColumnDef = { key: string; label: string; type: 'text' | 'number' | 'date' | 'enum'; options?: string[] | null };
	type TableRow = { id: number; row_data: Record<string, unknown> };
	type TableSummary = { id: number; name: string; columns: ColumnDef[]; section: string | null; row_count: number };
	type TableDetail = TableSummary & { rows: TableRow[] };
	type Note = { id: number; heading: string; body: string; section: string | null; created_by: string; created_at: string };

	const COLUMN_TYPES = ['text', 'number', 'date', 'enum'] as const;

	let allTables = $state<TableSummary[]>([]);
	let tables = $derived(allTables.filter((t) => (section ? t.section === section : !t.section)));
	let allNotes = $state<Note[]>([]);
	let notes = $derived(allNotes.filter((n) => (section ? n.section === section : !n.section)));
	let loading = $state(true);
	let error = $state('');

	// Splits pasted/imported tabular text into cells - Excel/Sheets copy
	// paste tab-separated, a plain .csv file is comma-separated. Deliberately
	// simple (no quoted-field handling) - good enough for the numeric/short-
	// text data these tables actually hold, and matches what the column
	// builder's own inputs already assume.
	function parseDelimitedText(text: string): string[][] {
		const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.length);
		if (!lines.length) return [];
		const delimiter = lines[0].includes('\t') ? '\t' : ',';
		return lines.map((l) => l.split(delimiter).map((c) => c.trim()));
	}

	// Which tables are expanded (grid visible) and the loaded detail (rows)
	// for each. New tables default to expanded - collapsing is opt-in.
	let expandedIds = $state<Set<number>>(new Set());
	let tableDetails = $state<Record<number, TableDetail>>({});
	let detailErrors = $state<Record<number, string>>({});

	// Table-builder form state (create or edit)
	let builderOpen = $state(false);
	let builderEditingId = $state<number | null>(null);
	let builderName = $state('');
	let builderColumns = $state<{ key: string; label: string; type: string; optionsCsv: string }[]>([]);
	let builderError = $state('');
	// CSV/paste import (create-only - importing into an existing table's
	// already-defined columns is what paste-to-import on the grid itself is
	// for). importFileName doubles as the staged-import's source label,
	// whether it came from a file or a clipboard paste.
	let importedRows = $state<string[][]>([]);
	let importFileName = $state('');
	let templateOpen = $state(false);

	// Note-builder form state (create or edit) - heading and body are two
	// separate fields on purpose, not one free-text block.
	let noteBuilderOpen = $state(false);
	let noteBuilderEditingId = $state<number | null>(null);
	let noteHeading = $state('');
	let noteBody = $state('');
	let noteError = $state('');

	// Row form state (add or edit) - targets whichever table's "+ Add Row" /
	// "Edit" was clicked, not a single globally "open" table anymore.
	let rowFormOpen = $state(false);
	let rowFormTableId = $state<number | null>(null);
	let rowFormEditingId = $state<number | null>(null);
	let rowFormValues = $state<Record<string, string>>({});
	let rowFormError = $state('');
	let rowFormTable = $derived(rowFormTableId != null ? tableDetails[rowFormTableId] : null);

	async function load() {
		loading = true;
		error = '';
		try {
			const fetched = (await api.listTables(companyId)) as TableSummary[];
			allTables = fetched;
			// Expand every table by default the first time it's seen, and
			// load its rows so the grid is already there to look at. Filter
			// directly off the freshly-fetched array rather than the
			// `tables` derived, since reading a derived value immediately
			// after its dependency changes isn't guaranteed to reflect the
			// update yet within the same synchronous block.
			const own = fetched.filter((t) => (section ? t.section === section : !t.section));
			// Compact (per-pillar) mounts default collapsed - each table's
			// row/column-count summary is already visible in its header bar,
			// so expanding every embedded table on every section was the main
			// source of page-length clutter. The standalone "Custom Sections"
			// block (compact=false) is the dedicated data destination, so it
			// keeps the original expand-by-default behavior.
			if (!compact) {
				for (const t of own) {
					if (!expandedIds.has(t.id)) expandedIds.add(t.id);
				}
				expandedIds = new Set(expandedIds);
			}
			// Fetch concurrently for speed, but merge into tableDetails/
			// detailErrors in one assignment each once everything has
			// settled - N concurrent loadDetail() calls each doing their
			// own `tableDetails = {...tableDetails, [id]: x}` is a lost-
			// update race (whichever resolves last wins, silently dropping
			// the others), which left most tables stuck on "Loading rows..."
			// forever even though every request succeeded.
			const toLoad = own.filter((t) => expandedIds.has(t.id) && !tableDetails[t.id]);
			const results = await Promise.allSettled(toLoad.map((t) => api.getTable(t.id) as Promise<TableDetail>));
			const newDetails = { ...tableDetails };
			const newErrors = { ...detailErrors };
			results.forEach((r, i) => {
				const id = toLoad[i].id;
				if (r.status === 'fulfilled') {
					newDetails[id] = r.value;
					newErrors[id] = '';
				} else {
					newErrors[id] = apiErrorMessage(r.reason);
				}
			});
			tableDetails = newDetails;
			detailErrors = newErrors;
		} catch (e) {
			error = String(e);
		} finally {
			loading = false;
		}
	}

	async function loadNotes() {
		try {
			allNotes = (await api.listNotes(companyId)) as Note[];
		} catch (e) {
			// Soft-fail - a notes-load error shouldn't blank out the tables
			// that already loaded fine.
			error = error || apiErrorMessage(e);
		}
	}

	async function loadDetail(id: number) {
		detailErrors = { ...detailErrors, [id]: '' };
		try {
			tableDetails = { ...tableDetails, [id]: (await api.getTable(id)) as TableDetail };
		} catch (e) {
			detailErrors = { ...detailErrors, [id]: apiErrorMessage(e) };
		}
	}

	function toggleTable(id: number) {
		const next = new Set(expandedIds);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
			if (!tableDetails[id]) loadDetail(id);
		}
		expandedIds = next;
	}

	$effect(() => {
		companyId;
		load();
		loadNotes();
	});

	$effect(() => {
		onTablesChange?.(tables.map((t) => ({ id: t.id, name: t.name })));
	});

	function apiErrorMessage(e: unknown): string {
		if (e instanceof ApiError) {
			const body = e.body as { message?: string } | string;
			return typeof body === 'string' ? body : (body?.message ?? e.message);
		}
		return String(e);
	}

	function openBuilder(table?: TableSummary) {
		builderError = '';
		importedRows = [];
		importFileName = '';
		templateOpen = false;
		if (table) {
			builderEditingId = table.id;
			builderName = table.name;
			builderColumns = table.columns.map((c) => ({ key: c.key, label: c.label, type: c.type, optionsCsv: (c.options ?? []).join(', ') }));
		} else {
			builderEditingId = null;
			builderName = '';
			builderColumns = [];
		}
		builderOpen = true;
	}

	function inferColumnType(dataRows: string[][], colIndex: number): 'text' | 'number' {
		const values = dataRows.map((r) => r[colIndex]).filter((v): v is string => v !== undefined && v !== '');
		if (values.length && values.every((v) => v !== '' && !Number.isNaN(Number(v)))) return 'number';
		return 'text';
	}

	// Shared by CSV-file import and paste-to-create: the header row becomes
	// the column builder (name + inferred type), the rest stage as a preview
	// to bulk-insert right after the table is created. Only offered when
	// creating a new table - importing into an existing table's already-
	// defined columns is what paste-to-import on the live grid is for.
	function applyParsedImport(parsed: string[][], sourceLabel: string) {
		if (!parsed.length) return;
		const [header, ...dataRows] = parsed;
		builderColumns = header.map((h, i) => ({
			key: slugifyKey(h),
			label: h.trim() || `column_${i + 1}`,
			type: inferColumnType(dataRows, i),
			optionsCsv: ''
		}));
		importedRows = dataRows.filter((r) => r.some((c) => c !== ''));
		importFileName = sourceLabel;
	}

	function handleCsvFile(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => applyParsedImport(parseDelimitedText(String(reader.result ?? '')), file.name);
		reader.readAsText(file);
		input.value = '';
	}

	// Ctrl+V directly into the builder (before any columns exist) - the
	// pasted block's first line becomes the columns, same inference as CSV
	// import, so a table can be built from a spreadsheet selection in one
	// paste instead of round-tripping through a saved .csv file.
	function handleBuilderPaste(e: ClipboardEvent) {
		const text = e.clipboardData?.getData('text/plain');
		if (!text || !text.trim()) return;
		e.preventDefault();
		applyParsedImport(parseDelimitedText(text), 'Pasted from clipboard');
	}

	function clearImport() {
		importedRows = [];
		importFileName = '';
	}

	function closeBuilder() {
		builderOpen = false;
	}

	function addBuilderColumn() {
		builderColumns = [...builderColumns, { key: '', label: '', type: 'text', optionsCsv: '' }];
	}
	function removeBuilderColumn(i: number) {
		builderColumns = builderColumns.filter((_, idx) => idx !== i);
	}

	// The API requires lowercase snake_case keys (they end up as JSON object
	// keys read back programmatically for SFT export). Normalize here so
	// typing a normal label like "Shishir" or "Total Shares" into the key
	// field just works instead of round-tripping a 422.
	function slugifyKey(raw: string): string {
		return raw
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9_]+/g, '_')
			.replace(/^[^a-z]+/, '')
			.replace(/_+/g, '_')
			.replace(/_$/, '')
			.slice(0, 50);
	}

	async function submitBuilder() {
		builderError = '';
		const columns = builderColumns
			.filter((c) => c.key.trim() && c.label.trim())
			.map((c) => ({
				key: slugifyKey(c.key),
				label: c.label.trim(),
				type: c.type,
				options: c.type === 'enum' ? c.optionsCsv.split(',').map((o) => o.trim()).filter(Boolean) : undefined
			}));
		try {
			let id = builderEditingId;
			if (id != null) {
				await api.patchTable(id, { name: builderName, columns });
			} else {
				const created = (await api.createTable(companyId, { name: builderName, columns, section })) as { id: number };
				id = created.id;
				if (importedRows.length) {
					const rows = importedRows
						.map((cells) => {
							const obj: Record<string, string> = {};
							columns.forEach((c, i) => {
								if (cells[i] !== undefined && cells[i] !== '') obj[c.key] = cells[i];
							});
							return obj;
						})
						.filter((r) => Object.keys(r).length);
					if (rows.length) await api.createRowsBulk(id, rows);
				}
			}
			builderOpen = false;
			await load();
			expandedIds = new Set(expandedIds).add(id);
			await loadDetail(id);
		} catch (e) {
			builderError = apiErrorMessage(e);
		}
	}

	async function deleteTable(id: number) {
		if (!confirm('Delete this table and all its rows?')) return;
		try {
			await api.deleteTable(id);
			delete tableDetails[id];
			tableDetails = { ...tableDetails };
			await load();
		} catch (e) {
			error = apiErrorMessage(e);
		}
	}

	function openRowForm(tableId: number, row?: TableRow) {
		const table = tableDetails[tableId];
		if (!table) return;
		rowFormError = '';
		rowFormTableId = tableId;
		if (row) {
			rowFormEditingId = row.id;
			rowFormValues = Object.fromEntries(table.columns.map((c) => [c.key, String(row.row_data[c.key] ?? '')]));
		} else {
			rowFormEditingId = null;
			rowFormValues = Object.fromEntries(table.columns.map((c) => [c.key, '']));
		}
		rowFormOpen = true;
	}

	function closeRowForm() {
		rowFormOpen = false;
	}

	async function submitRowForm() {
		if (rowFormTableId == null) return;
		rowFormError = '';
		const rowData = Object.fromEntries(Object.entries(rowFormValues).filter(([, v]) => v !== ''));
		try {
			if (rowFormEditingId != null) {
				await api.updateRow(rowFormTableId, rowFormEditingId, rowData);
			} else {
				await api.createRow(rowFormTableId, rowData);
			}
			rowFormOpen = false;
			await loadDetail(rowFormTableId);
			await load();
		} catch (e) {
			rowFormError = apiErrorMessage(e);
		}
	}

	async function deleteRow(tableId: number, rowId: number) {
		if (!confirm('Delete this row?')) return;
		try {
			await api.deleteRow(tableId, rowId);
			await loadDetail(tableId);
			await load();
		} catch (e) {
			error = apiErrorMessage(e);
		}
	}

	// Ctrl+V anywhere inside a table's grid bulk-imports rows: each pasted
	// line becomes a row, cells map to columns by position. If the first
	// pasted line looks like a repeat of the header (matches column
	// labels/keys), it's dropped instead of becoming a garbage row - that's
	// the common case when someone selects and copies straight out of a
	// spreadsheet including its header row.
	async function handleTablePaste(tableId: number, e: ClipboardEvent) {
		const text = e.clipboardData?.getData('text/plain');
		if (!text || !text.trim()) return;
		const table = tableDetails[tableId];
		if (!table || !table.columns.length) return;
		e.preventDefault();

		const parsed = parseDelimitedText(text);
		if (!parsed.length) return;
		const first = parsed[0];
		const looksLikeHeader = first.every((cell, i) => {
			const col = table.columns[i];
			return col && (cell.toLowerCase() === col.label.toLowerCase() || cell.toLowerCase() === col.key.toLowerCase());
		});
		const dataLines = looksLikeHeader ? parsed.slice(1) : parsed;

		const rows = dataLines
			.map((cells) => {
				const obj: Record<string, string> = {};
				table.columns.forEach((c, i) => {
					if (cells[i] !== undefined && cells[i] !== '') obj[c.key] = cells[i];
				});
				return obj;
			})
			.filter((r) => Object.keys(r).length);
		if (!rows.length) return;

		detailErrors = { ...detailErrors, [tableId]: '' };
		try {
			await api.createRowsBulk(tableId, rows);
			await loadDetail(tableId);
			await load();
		} catch (err) {
			detailErrors = { ...detailErrors, [tableId]: apiErrorMessage(err) };
		}
	}

	function openNoteBuilder(note?: Note) {
		noteError = '';
		if (note) {
			noteBuilderEditingId = note.id;
			noteHeading = note.heading;
			noteBody = note.body;
		} else {
			noteBuilderEditingId = null;
			noteHeading = '';
			noteBody = '';
		}
		noteBuilderOpen = true;
	}

	function closeNoteBuilder() {
		noteBuilderOpen = false;
	}

	async function submitNoteBuilder() {
		noteError = '';
		if (!noteHeading.trim() || !noteBody.trim()) {
			noteError = 'Both a heading and the note text are required.';
			return;
		}
		try {
			if (noteBuilderEditingId != null) {
				await api.patchNote(noteBuilderEditingId, { heading: noteHeading.trim(), body: noteBody.trim() });
			} else {
				await api.createNote(companyId, { heading: noteHeading.trim(), body: noteBody.trim(), section });
			}
			noteBuilderOpen = false;
			await loadNotes();
		} catch (e) {
			noteError = apiErrorMessage(e);
		}
	}

	async function deleteNoteItem(id: number) {
		if (!confirm('Delete this note?')) return;
		try {
			await api.deleteNote(id);
			await loadNotes();
		} catch (e) {
			error = apiErrorMessage(e);
		}
	}

	function formatCell(value: unknown): string {
		if (value === undefined || value === null || value === '') return '-';
		return String(value);
	}
</script>

<section class={compact ? 'mt-2' : 'mt-6'}>
	{#if !compact}
		<div class="flex items-center justify-between">
			<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">{heading}</h3>
			<div class="flex items-center gap-1">
				<button
					type="button"
					onclick={() => openNoteBuilder()}
					class="text-xs text-ok px-2 py-1 rounded-md cursor-pointer hover:bg-ok/10 transition-colors">+ Add Note</button
				>
				<button
					type="button"
					onclick={() => openBuilder()}
					class="text-xs text-ok px-2 py-1 rounded-md cursor-pointer hover:bg-ok/10 transition-colors">+ New Table</button
				>
			</div>
		</div>
	{/if}

	{#if error}
		<div class="mt-2 rounded-md bg-danger/10 border border-danger/30 p-2 text-xs text-danger">{error}</div>
	{/if}

	{#if notes.length}
		<div class="mt-2 space-y-2">
			{#each notes as n (n.id)}
				<div class="rounded-md border border-border p-3">
					<div class="flex items-start justify-between gap-3">
						<h4 class="text-sm font-semibold">{n.heading}</h4>
						<div class="flex items-center gap-2 shrink-0">
							<button type="button" onclick={() => openNoteBuilder(n)} class="text-xs px-2 py-0.5 rounded-md border border-border hover:bg-surface-3 cursor-pointer">Edit</button>
							<button type="button" onclick={() => deleteNoteItem(n.id)} class="text-xs px-2 py-0.5 rounded-md border border-border hover:text-danger cursor-pointer">Delete</button>
						</div>
					</div>
					<p class="text-sm text-muted-fg mt-1 whitespace-pre-wrap">{n.body}</p>
				</div>
			{/each}
		</div>
	{/if}

	{#if loading}
		<div class="text-xs text-muted-fg mt-2">Loading...</div>
	{:else if tables.length}
		<div class="mt-2 space-y-3">
			{#each tables as t (t.id)}
				{@const expanded = expandedIds.has(t.id)}
				{@const detail = tableDetails[t.id]}
				<div class="rounded-md border border-border">
					<div class="flex items-center justify-between px-3 py-2">
						<button
							type="button"
							onclick={() => toggleTable(t.id)}
							class="flex items-center gap-2 text-left cursor-pointer"
							aria-expanded={expanded}
						>
							<span class="text-muted-fg text-xs transition-transform" class:rotate-90={expanded}>&#9656;</span>
							<span class="text-sm font-medium">{t.name}</span>
							<span class="text-xs text-muted-fg">{t.columns.length} columns &middot; {t.row_count} rows</span>
						</button>
						<div class="flex items-center gap-2">
							<button type="button" onclick={() => toggleTable(t.id)} class="text-xs px-2 py-1 rounded-md border border-border hover:bg-surface-3 cursor-pointer">
								{expanded ? 'Hide' : 'Show'}
							</button>
							<button type="button" onclick={() => openBuilder(t)} class="text-xs px-2 py-1 rounded-md border border-border hover:bg-surface-3 cursor-pointer">Edit Columns</button>
							<button type="button" onclick={() => deleteTable(t.id)} class="text-xs px-2 py-1 rounded-md border border-border hover:text-danger cursor-pointer">Delete</button>
						</div>
					</div>

					{#if expanded}
						<div class="border-t border-border p-3">
							{#if detailErrors[t.id]}
								<div class="mb-3 rounded-md bg-danger/10 border border-danger/30 p-2 text-xs text-danger">{detailErrors[t.id]}</div>
							{/if}
							{#if !detail}
								<div class="text-xs text-muted-fg">Loading rows...</div>
							{:else}
								<!-- svelte-ignore a11y_no_noninteractive_tabindex -- this is a custom
								     paste target (Ctrl+V bulk row import), not a real ARIA widget, so
								     no standard interactive role fits it. -->
								<div
									class="overflow-x-auto rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-fg/30"
									tabindex="0"
									role="application"
									aria-label="{t.name} grid - click then paste rows with Ctrl+V"
									onpaste={(e) => handleTablePaste(t.id, e)}
								>
									<table class="w-full text-sm">
										<thead>
											<tr class="bg-surface-2">
												{#each detail.columns as c (c.key)}
													<th class="px-3 py-2 font-medium text-xs uppercase tracking-wide text-muted-fg whitespace-nowrap {c.type === 'number' ? 'text-right' : 'text-left'}">{c.label}</th>
												{/each}
												<th class="px-3 py-2"></th>
											</tr>
										</thead>
										<tbody>
											{#each detail.rows as row (row.id)}
												<tr class="border-t border-border">
													{#each detail.columns as c (c.key)}
														<td class="px-3 py-2 whitespace-nowrap {c.type === 'number' ? 'font-mono text-right' : ''}">{formatCell(row.row_data[c.key])}</td>
													{/each}
													<td class="px-3 py-2 text-right whitespace-nowrap">
														<button onclick={() => openRowForm(t.id, row)} class="text-xs px-2 py-0.5 rounded-md border border-border hover:bg-surface-3 cursor-pointer">Edit</button>
														<button onclick={() => deleteRow(t.id, row.id)} class="text-xs px-2 py-0.5 rounded-md border border-border hover:text-danger cursor-pointer">Delete</button>
													</td>
												</tr>
											{:else}
												<tr><td colspan={detail.columns.length + 1} class="px-3 py-6 text-center text-muted-fg">No rows yet.</td></tr>
											{/each}
										</tbody>
									</table>
								</div>
								{#if detail.columns.length}
									<div class="flex items-center justify-between mt-3">
										<button onclick={() => openRowForm(t.id)} class="text-xs text-ok">+ Add Row</button>
										<span class="text-xs text-muted-fg">Tip: click the table above and paste (Ctrl+V) rows copied from Excel/Sheets</span>
									</div>
								{:else}
									<div class="text-xs text-muted-fg mt-3">This table has no columns yet - edit it to add some.</div>
								{/if}
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{:else if !compact}
		<div class="text-xs text-muted-fg mt-2">No custom tables yet.</div>
	{/if}

	{#if compact}
		<div class="mt-1 flex items-center justify-end gap-1">
			<button
				type="button"
				onclick={() => openNoteBuilder()}
				class="text-xs text-ok px-2 py-1 rounded-md cursor-pointer hover:bg-ok/10 transition-colors">+ Add Note</button
			>
			<button
				type="button"
				onclick={() => openBuilder()}
				class="text-xs text-ok px-2 py-1 rounded-md cursor-pointer hover:bg-ok/10 transition-colors">+ Add Table</button
			>
		</div>
	{/if}
</section>

<!-- Table builder modal -->
{#if builderOpen}
	<div class="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4" onclick={closeBuilder} role="presentation">
		<div class="bg-bg-ink rounded-xl border border-border w-full max-w-lg" onclick={(e) => e.stopPropagation()} role="presentation">
			<div class="flex items-center justify-between px-5 py-3 border-b border-border">
				<h2 class="font-semibold">{builderEditingId != null ? 'Edit Data Table' : 'New Data Table'}</h2>
				<button onclick={closeBuilder} class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
			</div>
			<div class="p-5 overflow-y-auto" style="max-height: 65vh">
				<label class="block text-sm"
					>Table Name
					<input bind:value={builderName} placeholder="e.g. Shareholding Pattern" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
				</label>
				{#if builderEditingId == null}
					<div class="mt-3 rounded-md border border-dashed border-border p-3">
						<div class="flex items-center justify-between">
							<span class="text-sm font-medium">Import columns &amp; rows <span class="text-muted-fg font-normal">- optional</span></span>
							<button type="button" onclick={() => (templateOpen = !templateOpen)} class="text-xs text-ok shrink-0">
								{templateOpen ? 'Hide' : 'Preview'} template
							</button>
						</div>
						{#if templateOpen}
							<div class="mt-2 rounded-md bg-surface-2 p-2">
								<p class="text-xs text-muted-fg mb-1.5">
									First row = column names, each row after = one data row. Copy this shape straight out of Excel/Sheets, or write a
									.csv the same way.
								</p>
								<table class="text-xs font-mono border-collapse w-full">
									<thead>
										<tr>
											<th class="text-left px-2 py-1 border border-border bg-surface-3">Quarter</th>
											<th class="text-left px-2 py-1 border border-border bg-surface-3">Revenue</th>
											<th class="text-left px-2 py-1 border border-border bg-surface-3">Margin</th>
										</tr>
									</thead>
									<tbody>
										<tr>
											<td class="px-2 py-1 border border-border">FY25Q1</td>
											<td class="px-2 py-1 border border-border">120.5</td>
											<td class="px-2 py-1 border border-border">18.2</td>
										</tr>
										<tr>
											<td class="px-2 py-1 border border-border">FY25Q2</td>
											<td class="px-2 py-1 border border-border">135.0</td>
											<td class="px-2 py-1 border border-border">19.1</td>
										</tr>
									</tbody>
								</table>
							</div>
						{/if}
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -- custom paste
						     target (Ctrl+V), no standard interactive ARIA role fits it. -->
						<div
							class="mt-2 rounded-md border border-border border-dashed bg-surface-2 px-3 py-4 text-center text-xs text-muted-fg cursor-text focus:outline-none focus:ring-2 focus:ring-fg/30 focus:border-solid"
							tabindex="0"
							role="textbox"
							aria-label="Paste table data here"
							onpaste={handleBuilderPaste}
						>
							Click here, then paste (Ctrl+V) rows copied from Excel/Sheets
						</div>
						<div class="mt-2 flex items-center gap-2 text-xs text-muted-fg">
							<span>or</span>
							<input
								type="file"
								accept=".csv,text/csv"
								onchange={handleCsvFile}
								class="block flex-1 text-xs file:mr-2 file:rounded-md file:border file:border-border file:bg-surface file:px-2 file:py-1 file:text-xs"
							/>
						</div>
						{#if importFileName}
							<div class="mt-2 flex items-center justify-between text-xs text-muted-fg">
								<span>{importFileName} &middot; {importedRows.length} row{importedRows.length === 1 ? '' : 's'} staged</span>
								<button type="button" onclick={clearImport} class="text-danger hover:underline">Clear</button>
							</div>
							{#if importedRows.length}
								<div class="mt-2 overflow-x-auto rounded-md border border-border">
									<table class="w-full text-xs">
										<thead>
											<tr class="bg-surface-3">
												{#each builderColumns as col, i (i)}
													<th class="px-2 py-1 text-left font-medium whitespace-nowrap">{col.label || col.key}</th>
												{/each}
											</tr>
										</thead>
										<tbody>
											{#each importedRows.slice(0, 5) as row, r (r)}
												<tr class="border-t border-border">
													{#each builderColumns as col, i (i)}
														<td class="px-2 py-1 whitespace-nowrap">{row[i] ?? ''}</td>
													{/each}
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
								{#if importedRows.length > 5}
									<div class="mt-1 text-xs text-muted-fg">+{importedRows.length - 5} more row{importedRows.length - 5 === 1 ? '' : 's'} staged</div>
								{/if}
							{/if}
						{/if}
					</div>
				{/if}
				<div class="mt-4">
					<div class="text-sm font-medium">Columns <span class="text-muted-fg font-normal">- add, remove, or rename anytime</span></div>
					<div class="space-y-1 mt-1">
						{#each builderColumns as col, i (i)}
							<div class="grid grid-cols-12 gap-1 items-center">
								<input placeholder="key" bind:value={col.key} class="col-span-3 rounded-md border border-border px-2 py-1 text-xs font-mono" />
								<input placeholder="Label" bind:value={col.label} class="col-span-3 rounded-md border border-border px-2 py-1 text-xs" />
								<select bind:value={col.type} class="col-span-2 rounded-md border border-border px-1 py-1 text-xs">
									{#each COLUMN_TYPES as ct (ct)}
										<option value={ct}>{ct}</option>
									{/each}
								</select>
								<input placeholder="Options (enum, comma-sep)" bind:value={col.optionsCsv} class="col-span-3 rounded-md border border-border px-2 py-1 text-xs" />
								<button type="button" onclick={() => removeBuilderColumn(i)} class="text-muted-fg hover:text-danger text-center">&times;</button>
							</div>
						{/each}
					</div>
					<button type="button" onclick={addBuilderColumn} class="text-xs text-ok mt-2">+ Add Column</button>
				</div>
				{#if builderError}
					<div class="mt-3 rounded-md bg-danger/10 border border-danger/30 p-2 text-sm text-danger">{builderError}</div>
				{/if}
			</div>
			<div class="px-5 py-3 border-t border-border flex justify-end gap-2">
				<button onclick={closeBuilder} class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Cancel</button>
				<button onclick={submitBuilder} class="text-sm px-3 py-1.5 rounded-md bg-fg text-bg hover:brightness-90"
					>{builderEditingId != null ? 'Save Changes' : 'Create Table'}</button
				>
			</div>
		</div>
	</div>
{/if}

<!-- Note builder modal -->
{#if noteBuilderOpen}
	<div class="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4" onclick={closeNoteBuilder} role="presentation">
		<div class="bg-bg-ink rounded-xl border border-border w-full max-w-lg" onclick={(e) => e.stopPropagation()} role="presentation">
			<div class="flex items-center justify-between px-5 py-3 border-b border-border">
				<h2 class="font-semibold">{noteBuilderEditingId != null ? 'Edit Note' : 'Add Note'}</h2>
				<button onclick={closeNoteBuilder} class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
			</div>
			<div class="p-5 space-y-3">
				<label class="block text-sm"
					>Heading
					<input bind:value={noteHeading} placeholder="e.g. Management Commentary" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
				</label>
				<label class="block text-sm"
					>Note
					<textarea bind:value={noteBody} rows="6" placeholder="Write the note text here..." class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"
					></textarea>
				</label>
				{#if noteError}
					<div class="rounded-md bg-danger/10 border border-danger/30 p-2 text-sm text-danger">{noteError}</div>
				{/if}
			</div>
			<div class="px-5 py-3 border-t border-border flex justify-end gap-2">
				<button onclick={closeNoteBuilder} class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Cancel</button>
				<button onclick={submitNoteBuilder} class="text-sm px-3 py-1.5 rounded-md bg-fg text-bg hover:brightness-90"
					>{noteBuilderEditingId != null ? 'Save Changes' : 'Add Note'}</button
				>
			</div>
		</div>
	</div>
{/if}

<!-- Row form modal -->
{#if rowFormOpen && rowFormTable}
	<div class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onclick={closeRowForm} role="presentation">
		<div class="bg-bg-ink rounded-xl border border-border w-full max-w-md" onclick={(e) => e.stopPropagation()} role="presentation">
			<div class="flex items-center justify-between px-5 py-3 border-b border-border">
				<h2 class="font-semibold">{rowFormEditingId != null ? 'Edit Row' : 'Add Row'}</h2>
				<button onclick={closeRowForm} class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
			</div>
			<div class="p-5">
				{#each rowFormTable.columns as c (c.key)}
					<label class="text-sm block mt-2"
						>{c.label}
						{#if c.type === 'enum'}
							<select bind:value={rowFormValues[c.key]} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
								<option value="">-</option>
								{#each c.options ?? [] as o (o)}
									<option value={o}>{o}</option>
								{/each}
							</select>
						{:else}
							<input
								type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
								step="any"
								bind:value={rowFormValues[c.key]}
								class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"
							/>
						{/if}
					</label>
				{/each}
				{#if rowFormError}
					<div class="mt-3 rounded-md bg-danger/10 border border-danger/30 p-2 text-sm text-danger">{rowFormError}</div>
				{/if}
			</div>
			<div class="px-5 py-3 border-t border-border flex justify-end gap-2">
				<button onclick={closeRowForm} class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Cancel</button>
				<button onclick={submitRowForm} class="text-sm px-3 py-1.5 rounded-md bg-fg text-bg hover:brightness-90"
					>{rowFormEditingId != null ? 'Save' : 'Add'}</button
				>
			</div>
		</div>
	</div>
{/if}
