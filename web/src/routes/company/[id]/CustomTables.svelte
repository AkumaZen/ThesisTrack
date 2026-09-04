<script lang="ts">
	// Custom "Data Tables" section for a company: create/edit/delete tables
	// with Excel-like columns (frontend/components/customTables.js ported to
	// Svelte 5), plus row CRUD. Self-contained - the parent company page just
	// mounts <CustomTables {companyId} />, no shared state with the
	// observation/decision/price/health-check panels.
	import { onMount } from 'svelte';
	import { api, ApiError } from '$lib/api';

	let { companyId }: { companyId: string } = $props();

	type ColumnDef = { key: string; label: string; type: 'text' | 'number' | 'date' | 'enum'; options?: string[] | null };
	type TableRow = { id: number; row_data: Record<string, unknown> };
	type TableSummary = { id: number; name: string; columns: ColumnDef[]; section: string | null; row_count: number };
	type TableDetail = TableSummary & { rows: TableRow[] };

	const COLUMN_TYPES = ['text', 'number', 'date', 'enum'] as const;

	let tables = $state<TableSummary[]>([]);
	let loading = $state(true);
	let error = $state('');

	let openTable = $state<TableDetail | null>(null);
	let openTableError = $state('');

	// Table-builder form state (create or edit)
	let builderOpen = $state(false);
	let builderEditingId = $state<number | null>(null);
	let builderName = $state('');
	let builderColumns = $state<{ key: string; label: string; type: string; optionsCsv: string }[]>([]);
	let builderError = $state('');

	// Row form state (add or edit)
	let rowFormOpen = $state(false);
	let rowFormEditingId = $state<number | null>(null);
	let rowFormValues = $state<Record<string, string>>({});
	let rowFormError = $state('');

	async function load() {
		loading = true;
		error = '';
		try {
			tables = (await api.listTables(companyId)) as TableSummary[];
		} catch (e) {
			error = String(e);
		} finally {
			loading = false;
		}
	}

	onMount(load);
	$effect(() => {
		companyId;
		load();
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

	async function submitBuilder() {
		builderError = '';
		const columns = builderColumns
			.filter((c) => c.key.trim() && c.label.trim())
			.map((c) => ({
				key: c.key.trim(),
				label: c.label.trim(),
				type: c.type,
				options: c.type === 'enum' ? c.optionsCsv.split(',').map((o) => o.trim()).filter(Boolean) : undefined
			}));
		try {
			if (builderEditingId != null) {
				await api.patchTable(builderEditingId, { name: builderName, columns });
			} else {
				await api.createTable(companyId, { name: builderName, columns });
			}
			builderOpen = false;
			await load();
			if (openTable && builderEditingId === openTable.id) {
				openTable = (await api.getTable(openTable.id)) as TableDetail;
			}
		} catch (e) {
			builderError = apiErrorMessage(e);
		}
	}

	async function openTableGrid(id: number) {
		openTableError = '';
		try {
			openTable = (await api.getTable(id)) as TableDetail;
		} catch (e) {
			openTableError = apiErrorMessage(e);
		}
	}

	function closeTableGrid() {
		openTable = null;
	}

	async function deleteTable(id: number) {
		if (!confirm('Delete this table and all its rows?')) return;
		try {
			await api.deleteTable(id);
			if (openTable?.id === id) openTable = null;
			await load();
		} catch (e) {
			error = apiErrorMessage(e);
		}
	}

	function openRowForm(row?: TableRow) {
		if (!openTable) return;
		rowFormError = '';
		if (row) {
			rowFormEditingId = row.id;
			rowFormValues = Object.fromEntries(openTable.columns.map((c) => [c.key, String(row.row_data[c.key] ?? '')]));
		} else {
			rowFormEditingId = null;
			rowFormValues = Object.fromEntries(openTable.columns.map((c) => [c.key, '']));
		}
		rowFormOpen = true;
	}

	function closeRowForm() {
		rowFormOpen = false;
	}

	async function submitRowForm() {
		if (!openTable) return;
		rowFormError = '';
		const rowData = Object.fromEntries(Object.entries(rowFormValues).filter(([, v]) => v !== ''));
		try {
			if (rowFormEditingId != null) {
				await api.updateRow(openTable.id, rowFormEditingId, rowData);
			} else {
				await api.createRow(openTable.id, rowData);
			}
			rowFormOpen = false;
			openTable = (await api.getTable(openTable.id)) as TableDetail;
			await load();
		} catch (e) {
			rowFormError = apiErrorMessage(e);
		}
	}

	async function deleteRow(rowId: number) {
		if (!openTable || !confirm('Delete this row?')) return;
		try {
			await api.deleteRow(openTable.id, rowId);
			openTable = (await api.getTable(openTable.id)) as TableDetail;
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

<section class="mt-6">
	<div class="flex items-center justify-between">
		<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Data Tables</h3>
		<button type="button" onclick={() => openBuilder()} class="text-xs text-ok">+ New Table</button>
	</div>

	{#if error}
		<div class="mt-2 rounded-md bg-danger/10 border border-danger/30 p-2 text-xs text-danger">{error}</div>
	{/if}

	{#if loading}
		<div class="text-xs text-muted-fg mt-2">Loading...</div>
	{:else if !tables.length}
		<div class="text-xs text-muted-fg mt-2">No custom tables yet.</div>
	{:else}
		<div class="mt-2 space-y-2">
			{#each tables as t (t.id)}
				<div class="flex items-center justify-between rounded-md border border-border px-3 py-2">
					<div>
						<span class="text-sm font-medium">{t.name}</span>
						<span class="text-xs text-muted-fg ml-2">{t.columns.length} columns &middot; {t.row_count} rows{t.section ? ` · ${t.section}` : ''}</span>
					</div>
					<div class="flex items-center gap-2">
						<button type="button" onclick={() => openTableGrid(t.id)} class="text-xs px-2 py-1 rounded-md border border-border hover:bg-surface-3">Open</button>
						<button type="button" onclick={() => openBuilder(t)} class="text-xs px-2 py-1 rounded-md border border-border hover:bg-surface-3">Edit Columns</button>
						<button type="button" onclick={() => deleteTable(t.id)} class="text-xs px-2 py-1 rounded-md border border-border hover:text-danger">Delete</button>
					</div>
				</div>
			{/each}
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
				<button onclick={submitBuilder} class="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90"
					>{builderEditingId != null ? 'Save Changes' : 'Create Table'}</button
				>
			</div>
		</div>
	</div>
{/if}

<!-- Table grid modal -->
{#if openTable}
	<div class="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4" onclick={closeTableGrid} role="presentation">
		<div class="bg-bg-ink rounded-xl border border-border w-full max-w-3xl" onclick={(e) => e.stopPropagation()} role="presentation">
			<div class="flex items-center justify-between px-5 py-3 border-b border-border">
				<h2 class="font-semibold">{openTable.name}</h2>
				<button onclick={closeTableGrid} class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
			</div>
			<div class="p-5 overflow-y-auto" style="max-height: 65vh">
				{#if openTableError}
					<div class="mb-3 rounded-md bg-danger/10 border border-danger/30 p-2 text-sm text-danger">{openTableError}</div>
				{/if}
				<div class="overflow-x-auto rounded-md border border-border">
					<table class="w-full text-sm">
						<thead>
							<tr class="bg-surface-2">
								{#each openTable.columns as c (c.key)}
									<th class="text-left px-3 py-2 font-medium text-xs uppercase tracking-wide text-muted-fg whitespace-nowrap">{c.label}</th>
								{/each}
								<th class="px-3 py-2"></th>
							</tr>
						</thead>
						<tbody>
							{#each openTable.rows as row (row.id)}
								<tr class="border-t border-border">
									{#each openTable.columns as c (c.key)}
										<td class="px-3 py-2 whitespace-nowrap">{formatCell(row.row_data[c.key])}</td>
									{/each}
									<td class="px-3 py-2 text-right whitespace-nowrap">
										<button onclick={() => openRowForm(row)} class="text-xs px-2 py-0.5 rounded-md border border-border hover:bg-surface-3">Edit</button>
										<button onclick={() => deleteRow(row.id)} class="text-xs px-2 py-0.5 rounded-md border border-border hover:text-danger">Delete</button>
									</td>
								</tr>
							{:else}
								<tr><td colspan={openTable.columns.length + 1} class="px-3 py-6 text-center text-muted-fg">No rows yet.</td></tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if openTable.columns.length}
					<button onclick={() => openRowForm()} class="text-xs text-ok mt-3">+ Add Row</button>
				{:else}
					<div class="text-xs text-muted-fg mt-3">This table has no columns yet - edit it to add some.</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- Row form modal -->
{#if rowFormOpen && openTable}
	<div class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onclick={closeRowForm} role="presentation">
		<div class="bg-bg-ink rounded-xl border border-border w-full max-w-md" onclick={(e) => e.stopPropagation()} role="presentation">
			<div class="flex items-center justify-between px-5 py-3 border-b border-border">
				<h2 class="font-semibold">{rowFormEditingId != null ? 'Edit Row' : 'Add Row'}</h2>
				<button onclick={closeRowForm} class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
			</div>
			<div class="p-5">
				{#each openTable.columns as c (c.key)}
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
				<button onclick={submitRowForm} class="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90"
					>{rowFormEditingId != null ? 'Save' : 'Add'}</button
				>
			</div>
		</div>
	</div>
{/if}
