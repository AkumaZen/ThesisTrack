<script lang="ts">
	// Self-contained "one data table" card: header (name, column/row count,
	// Hide/Show, Edit Columns, Delete) + the expanded grid (rows, paste-import,
	// per-row Edit/Delete, Add Row). Extracted out of CustomTables.svelte so the
	// exact same rendering - the REAL table, not a name chip - can be embedded
	// inline wherever a table block appears inside a Section, on both the
	// company page (CustomTables.svelte) and the company page's pillar-notes
	// display (thesis-level notes authored on the ingest form). One table must
	// never render as two different things in two different places.
	import { api, ApiError } from '$lib/api';
	import TableBuilderModal, { type BuiltTable } from './TableBuilderModal.svelte';

	type ColumnDef = { key: string; label: string; type: 'text' | 'number' | 'date' | 'enum'; options?: string[] | null };
	type TableRow = { id: number; row_data: Record<string, unknown> };
	export type TableSummary = { id: number; name: string; columns: ColumnDef[]; section: string | null; row_count: number };
	type TableDetail = TableSummary & { rows: TableRow[] };

	let {
		table,
		defaultExpanded = true,
		onChanged,
		onDeleted
	}: {
		table: TableSummary;
		defaultExpanded?: boolean;
		// Fired after any row/column mutation - lets a parent that's holding its
		// own copy of the table summary (name/column/row-count) refresh it.
		onChanged?: () => void;
		onDeleted?: () => void;
	} = $props();

	function apiErrorMessage(e: unknown): string {
		if (e instanceof ApiError) {
			const body = e.body as { message?: string } | string;
			return typeof body === 'string' ? body : (body?.message ?? e.message);
		}
		return String(e);
	}

	function parseDelimitedText(text: string): string[][] {
		const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.length);
		if (!lines.length) return [];
		const delimiter = lines[0].includes('\t') ? '\t' : ',';
		return lines.map((l) => l.split(delimiter).map((c) => c.trim()));
	}

	let expanded = $state(defaultExpanded);
	let detail = $state<TableDetail | null>(null);
	let detailError = $state('');
	let loadingDetail = $state(false);

	async function loadDetail() {
		loadingDetail = true;
		detailError = '';
		try {
			detail = (await api.getTable(table.id)) as TableDetail;
		} catch (e) {
			detailError = apiErrorMessage(e);
		} finally {
			loadingDetail = false;
		}
	}

	$effect(() => {
		table.id;
		if (expanded) loadDetail();
	});

	function toggle() {
		expanded = !expanded;
	}

	let builderOpen = $state(false);

	async function handleBuilderSubmit(built: BuiltTable) {
		try {
			await api.patchTable(table.id, { name: built.name, columns: built.columns });
			await loadDetail();
			onChanged?.();
		} catch (e) {
			throw new Error(apiErrorMessage(e));
		}
	}

	async function deleteTable() {
		if (!confirm('Delete this table and all its rows?')) return;
		try {
			await api.deleteTable(table.id);
			onDeleted?.();
		} catch (e) {
			detailError = apiErrorMessage(e);
		}
	}

	let rowFormOpen = $state(false);
	let rowFormEditingId = $state<number | null>(null);
	let rowFormValues = $state<Record<string, string>>({});
	let rowFormError = $state('');

	function openRowForm(row?: TableRow) {
		if (!detail) return;
		rowFormError = '';
		if (row) {
			rowFormEditingId = row.id;
			rowFormValues = Object.fromEntries(detail.columns.map((c) => [c.key, String(row.row_data[c.key] ?? '')]));
		} else {
			rowFormEditingId = null;
			rowFormValues = Object.fromEntries(detail.columns.map((c) => [c.key, '']));
		}
		rowFormOpen = true;
	}

	function closeRowForm() {
		rowFormOpen = false;
	}

	async function submitRowForm() {
		rowFormError = '';
		const rowData = Object.fromEntries(Object.entries(rowFormValues).filter(([, v]) => v !== ''));
		try {
			if (rowFormEditingId != null) {
				await api.updateRow(table.id, rowFormEditingId, rowData);
			} else {
				await api.createRow(table.id, rowData);
			}
			rowFormOpen = false;
			await loadDetail();
			onChanged?.();
		} catch (e) {
			rowFormError = apiErrorMessage(e);
		}
	}

	async function deleteRow(rowId: number) {
		if (!confirm('Delete this row?')) return;
		try {
			await api.deleteRow(table.id, rowId);
			await loadDetail();
			onChanged?.();
		} catch (e) {
			detailError = apiErrorMessage(e);
		}
	}

	async function handlePaste(e: ClipboardEvent) {
		const text = e.clipboardData?.getData('text/plain');
		if (!text || !text.trim() || !detail || !detail.columns.length) return;
		e.preventDefault();

		const parsed = parseDelimitedText(text);
		if (!parsed.length) return;
		const first = parsed[0];
		const looksLikeHeader = first.every((cell, i) => {
			const col = detail!.columns[i];
			return col && (cell.toLowerCase() === col.label.toLowerCase() || cell.toLowerCase() === col.key.toLowerCase());
		});
		const dataLines = looksLikeHeader ? parsed.slice(1) : parsed;

		const rows = dataLines
			.map((cells) => {
				const obj: Record<string, string> = {};
				detail!.columns.forEach((c, i) => {
					if (cells[i] !== undefined && cells[i] !== '') obj[c.key] = cells[i];
				});
				return obj;
			})
			.filter((r) => Object.keys(r).length);
		if (!rows.length) return;

		detailError = '';
		try {
			await api.createRowsBulk(table.id, rows);
			await loadDetail();
			onChanged?.();
		} catch (err) {
			detailError = apiErrorMessage(err);
		}
	}

	function formatCell(value: unknown): string {
		if (value === undefined || value === null || value === '') return '-';
		return String(value);
	}
</script>

<div class="rounded-md border border-border">
	<div class="flex items-center justify-between px-3 py-2">
		<button type="button" onclick={toggle} class="flex items-center gap-2 text-left cursor-pointer" aria-expanded={expanded}>
			<span class="text-muted-fg text-xs transition-transform" class:rotate-90={expanded}>&#9656;</span>
			<span class="text-sm font-medium">{table.name}</span>
			<span class="text-xs text-muted-fg">{(detail ?? table).columns.length} columns &middot; {detail?.rows.length ?? table.row_count} rows</span>
		</button>
		<div class="flex items-center gap-2">
			<button type="button" onclick={toggle} class="text-xs px-2 py-1 rounded-md border border-border hover:bg-surface-3 cursor-pointer">
				{expanded ? 'Hide' : 'Show'}
			</button>
			<button type="button" onclick={() => (builderOpen = true)} class="text-xs px-2 py-1 rounded-md border border-border hover:bg-surface-3 cursor-pointer">Edit Columns</button>
			<button type="button" onclick={deleteTable} class="text-xs px-2 py-1 rounded-md border border-border hover:text-danger cursor-pointer">Delete</button>
		</div>
	</div>

	{#if expanded}
		<div class="border-t border-border p-3">
			{#if detailError}
				<div class="mb-3 rounded-md bg-danger/10 border border-danger/30 p-2 text-xs text-danger">{detailError}</div>
			{/if}
			{#if !detail}
				<div class="text-xs text-muted-fg">{loadingDetail ? 'Loading rows...' : ''}</div>
			{:else}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -- custom paste
				     target (Ctrl+V bulk row import), no standard ARIA role fits it. -->
				<div
					class="overflow-x-auto rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-fg/30"
					tabindex="0"
					role="application"
					aria-label="{table.name} grid - click then paste rows with Ctrl+V"
					onpaste={handlePaste}
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
										<button onclick={() => openRowForm(row)} class="text-xs px-2 py-0.5 rounded-md border border-border hover:bg-surface-3 cursor-pointer">Edit</button>
										<button onclick={() => deleteRow(row.id)} class="text-xs px-2 py-0.5 rounded-md border border-border hover:text-danger cursor-pointer">Delete</button>
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
						<button onclick={() => openRowForm()} class="text-xs text-ok">+ Add Row</button>
						<span class="text-xs text-muted-fg">Tip: click the table above and paste (Ctrl+V) rows copied from Excel/Sheets</span>
					</div>
				{:else}
					<div class="text-xs text-muted-fg mt-3">This table has no columns yet - edit it to add some.</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<TableBuilderModal
	bind:open={builderOpen}
	title="Edit Data Table"
	submitLabel="Save Changes"
	allowImport={false}
	initialName={table.name}
	initialColumns={table.columns.map((c) => ({ key: c.key, label: c.label, type: c.type, optionsCsv: (c.options ?? []).join(', ') }))}
	onSubmit={handleBuilderSubmit}
/>

{#if rowFormOpen && detail}
	<div class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onclick={closeRowForm} role="presentation">
		<div class="bg-bg-ink rounded-xl border border-border w-full max-w-md" onclick={(e) => e.stopPropagation()} role="presentation">
			<div class="flex items-center justify-between px-5 py-3 border-b border-border">
				<h2 class="font-semibold">{rowFormEditingId != null ? 'Edit Row' : 'Add Row'}</h2>
				<button onclick={closeRowForm} class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
			</div>
			<div class="p-5">
				{#each detail.columns as c (c.key)}
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
