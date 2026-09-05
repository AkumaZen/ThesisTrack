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

	const COLUMN_TYPES = ['text', 'number', 'date', 'enum'] as const;

	let allTables = $state<TableSummary[]>([]);
	let tables = $derived(allTables.filter((t) => (section ? t.section === section : !t.section)));
	let loading = $state(true);
	let error = $state('');

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
			allTables = (await api.listTables(companyId)) as TableSummary[];
			// Expand every table by default the first time it's seen, and
			// load its rows so the grid is already there to look at.
			for (const t of tables) {
				if (!expandedIds.has(t.id)) expandedIds.add(t.id);
			}
			expandedIds = new Set(expandedIds);
			await Promise.all(tables.filter((t) => expandedIds.has(t.id) && !tableDetails[t.id]).map((t) => loadDetail(t.id)));
		} catch (e) {
			error = String(e);
		} finally {
			loading = false;
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

	function formatCell(value: unknown): string {
		if (value === undefined || value === null || value === '') return '-';
		return String(value);
	}
</script>

<section class={compact ? 'mt-2' : 'mt-6'}>
	{#if !compact}
		<div class="flex items-center justify-between">
			<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">{heading}</h3>
			<button type="button" onclick={() => openBuilder()} class="text-xs text-ok">+ New Table</button>
		</div>
	{/if}

	{#if error}
		<div class="mt-2 rounded-md bg-danger/10 border border-danger/30 p-2 text-xs text-danger">{error}</div>
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
								<div class="overflow-x-auto rounded-md border border-border">
									<table class="w-full text-sm">
										<thead>
											<tr class="bg-surface-2">
												{#each detail.columns as c (c.key)}
													<th class="text-left px-3 py-2 font-medium text-xs uppercase tracking-wide text-muted-fg whitespace-nowrap">{c.label}</th>
												{/each}
												<th class="px-3 py-2"></th>
											</tr>
										</thead>
										<tbody>
											{#each detail.rows as row (row.id)}
												<tr class="border-t border-border">
													{#each detail.columns as c (c.key)}
														<td class="px-3 py-2 whitespace-nowrap">{formatCell(row.row_data[c.key])}</td>
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
									<button onclick={() => openRowForm(t.id)} class="text-xs text-ok mt-3">+ Add Row</button>
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
		<div class="mt-1 flex items-center justify-end">
			<button type="button" onclick={() => openBuilder()} class="text-xs text-ok">+ Add Table</button>
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
