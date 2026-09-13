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
	import { tick } from 'svelte';
	import { api, ApiError } from '$lib/api';
	import TableBuilderModal, { type BuiltTable } from '$lib/components/TableBuilderModal.svelte';
	import TableCard from '$lib/components/TableCard.svelte';

	// `section` filters/tags tables to one thesis pillar (e.g. "the_business")
	// when set - used when this component is mounted inside a pillar section
	// on the company page. Leave unset for the top-level "Custom Sections"
	// block, which only shows/creates untagged tables.
	let {
		companyId,
		section = null,
		heading = 'Data Tables',
		compact = false,
		onTablesChange,
		excludeTableIds = []
	}: {
		companyId: string;
		section?: string | null;
		heading?: string;
		compact?: boolean;
		onTablesChange?: (tables: { id: number; name: string }[]) => void;
		// Table ids already embedded elsewhere on the page (e.g. inside a
		// thesis-level pillar note authored on the ingest form) - excluded from
		// this component's own "orphan tables" list so the same table never
		// renders twice.
		excludeTableIds?: number[];
	} = $props();

	type ColumnDef = { key: string; label: string; type: 'text' | 'number' | 'date' | 'enum'; options?: string[] | null };
	type TableRow = { id: number; row_data: Record<string, unknown> };
	type TableSummary = { id: number; name: string; columns: ColumnDef[]; section: string | null; row_count: number };
	type TableDetail = TableSummary & { rows: TableRow[] };
	type NoteBlock = { type: 'text'; text: string } | { type: 'table'; table_id: number };
	type Note = { id: number; heading: string; body: string; blocks: NoteBlock[]; section: string | null; created_by: string; created_at: string };

	let allTables = $state<TableSummary[]>([]);
	let tables = $derived(allTables.filter((t) => (section ? t.section === section : !t.section)));
	let allNotes = $state<Note[]>([]);
	let notes = $derived(allNotes.filter((n) => (section ? n.section === section : !n.section)));
	// A table embedded as a block inside a Section renders inline, inside that
	// Section's own bordered card - it must not also render a second time down
	// in the plain table list below. Only tables nobody has embedded anywhere
	// (legacy/orphaned data) still show there.
	let referencedTableIds = $derived(
		new Set([
			...allNotes.flatMap((n) => (n.blocks ?? []).filter((b) => b.type === 'table').map((b) => b.table_id)),
			...excludeTableIds
		])
	);
	let orphanTables = $derived(tables.filter((t) => !referencedTableIds.has(t.id)));
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

	// Table-builder (create only, from "+ Add Table" inside the Section
	// builder) - editing an existing table is handled by that table's own
	// TableCard instance below, each with its own builder modal.
	let builderOpen = $state(false);
	let builderInitialName = $state('');
	let builderInitialColumns = $state<{ key: string; label: string; type: string; optionsCsv: string }[]>([]);

	// Note-builder form state (create or edit) - a note is a heading plus an
	// ordered sequence of blocks (free text or an embedded table), built up
	// with "+ Add Text" / "+ Add Table" in whatever order/mix the analyst
	// wants - not a single free-text block anymore.
	let noteBuilderOpen = $state(false);
	let noteBuilderEditingId = $state<number | null>(null);
	let noteHeading = $state('');
	let noteBlocks = $state<NoteBlock[]>([]);
	let noteError = $state('');

	function tableSummaryById(id: number): TableSummary | undefined {
		return allTables.find((t) => t.id === id);
	}

	// Old notes saved before blocks existed have an empty blocks array but a
	// real body - fall back to treating that body as a single text block.
	function blocksForDisplay(n: Note): NoteBlock[] {
		return n.blocks?.length ? n.blocks : [{ type: 'text', text: n.body }];
	}

	async function load() {
		loading = true;
		error = '';
		try {
			allTables = (await api.listTables(companyId)) as TableSummary[];
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

	function openBuilder() {
		builderInitialName = '';
		builderInitialColumns = [];
		builderOpen = true;
	}

	async function handleBuilderSubmit(built: BuiltTable) {
		try {
			const created = (await api.createTable(companyId, { name: built.name, columns: built.columns, section })) as { id: number };
			if (built.rows.length) await api.createRowsBulk(created.id, built.rows);
			await load();
			// Opened from inside the Add Section modal ("+ Add Table" in there) -
			// reference it as a block in this section so it reads inline as part
			// of the section's Text/Table sequence (and therefore renders inside
			// that section's boundary, not as a second separate table elsewhere).
			if (noteBuilderOpen) {
				noteBlocks = [...noteBlocks, { type: 'table', table_id: created.id }];
			}
		} catch (e) {
			throw new Error(apiErrorMessage(e));
		}
	}

	function openNoteBuilder(note?: Note) {
		noteError = '';
		if (note) {
			noteBuilderEditingId = note.id;
			noteHeading = note.heading;
			noteBlocks = note.blocks?.length ? note.blocks.map((b) => ({ ...b })) : [{ type: 'text', text: note.body }];
		} else {
			noteBuilderEditingId = null;
			noteHeading = '';
			noteBlocks = [{ type: 'text', text: '' }];
		}
		noteBuilderOpen = true;
	}

	function closeNoteBuilder() {
		noteBuilderOpen = false;
	}

	function addTextBlock() {
		noteBlocks = [...noteBlocks, { type: 'text', text: '' }];
	}

	function removeBlock(index: number) {
		noteBlocks = noteBlocks.filter((_, i) => i !== index);
	}

	// VSCode-style Tab: inserts a literal tab at the cursor instead of jumping
	// focus to the next field, with Shift+Tab removing one level of leading
	// indent from the current line. Only meaningful for text blocks.
	async function handleBlockKeydown(e: KeyboardEvent, index: number) {
		if (e.key !== 'Tab') return;
		const block = noteBlocks[index];
		if (block.type !== 'text') return;
		e.preventDefault();
		const el = e.currentTarget as HTMLTextAreaElement;
		const start = el.selectionStart ?? 0;
		const end = el.selectionEnd ?? 0;
		const value = block.text;

		if (e.shiftKey) {
			const lineStart = value.lastIndexOf('\n', start - 1) + 1;
			if (value[lineStart] === '\t') {
				const next = value.slice(0, lineStart) + value.slice(lineStart + 1);
				noteBlocks = noteBlocks.map((b, i) => (i === index ? { type: 'text', text: next } : b));
				await tick();
				el.selectionStart = el.selectionEnd = Math.max(lineStart, start - 1);
			}
		} else {
			const next = value.slice(0, start) + '\t' + value.slice(end);
			noteBlocks = noteBlocks.map((b, i) => (i === index ? { type: 'text', text: next } : b));
			await tick();
			el.selectionStart = el.selectionEnd = start + 1;
		}
	}

	async function submitNoteBuilder() {
		noteError = '';
		const blocks = noteBlocks.filter((b) => b.type === 'table' || b.text.trim());
		if (!noteHeading.trim() || !blocks.length) {
			noteError = 'A heading and at least one block of text or a table are required.';
			return;
		}
		try {
			if (noteBuilderEditingId != null) {
				await api.patchNote(noteBuilderEditingId, { heading: noteHeading.trim(), blocks });
			} else {
				await api.createNote(companyId, { heading: noteHeading.trim(), blocks, section });
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

</script>

<section class={compact ? 'mt-2' : 'mt-6'}>
	{#if !compact}
		<div class="flex items-center justify-between">
			<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">{heading}</h3>
			<button
				type="button"
				onclick={() => openNoteBuilder()}
				class="text-xs text-ok px-2 py-1 rounded-md cursor-pointer hover:bg-ok/10 transition-colors">+ Add Section</button
			>
		</div>
	{/if}

	{#if error}
		<div class="mt-2 rounded-md bg-danger/10 border border-danger/30 p-2 text-xs text-danger">{error}</div>
	{/if}

	{#if notes.length}
		<div class="mt-2 space-y-3">
			{#each notes as n (n.id)}
				<div class="rounded-md border border-border p-3">
					<div class="flex items-start justify-between gap-3">
						<h4 class="text-sm font-semibold">{n.heading}</h4>
						<div class="flex items-center gap-2 shrink-0">
							<button type="button" onclick={() => openNoteBuilder(n)} class="text-xs px-2 py-0.5 rounded-md border border-border hover:bg-surface-3 cursor-pointer">Edit</button>
							<button type="button" onclick={() => deleteNoteItem(n.id)} class="text-xs px-2 py-0.5 rounded-md border border-border hover:text-danger cursor-pointer">Delete</button>
						</div>
					</div>
					<div class="mt-2 space-y-3">
						{#each blocksForDisplay(n) as block, i (i)}
							{#if block.type === 'text'}
								{#if block.text.trim()}
									<p class="text-sm text-muted-fg whitespace-pre-wrap">{block.text}</p>
								{/if}
							{:else}
								{@const t = tableSummaryById(block.table_id)}
								{#if t}
									<TableCard table={t} defaultExpanded={compact ? false : true} onChanged={load} onDeleted={load} />
								{:else}
									<div class="text-xs text-danger">Table #{block.table_id} not found.</div>
								{/if}
							{/if}
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if loading}
		<div class="text-xs text-muted-fg mt-2">Loading...</div>
	{:else if orphanTables.length}
		<div class="mt-3 space-y-3">
			{#each orphanTables as t (t.id)}
				<TableCard table={t} defaultExpanded={compact ? false : true} onChanged={load} onDeleted={load} />
			{/each}
		</div>
	{:else if !compact && !notes.length}
		<div class="text-xs text-muted-fg mt-2">No sections yet.</div>
	{/if}

	{#if compact}
		<div class="mt-1 flex items-center justify-end gap-1">
			<button
				type="button"
				onclick={() => openNoteBuilder()}
				class="text-xs text-ok px-2 py-1 rounded-md cursor-pointer hover:bg-ok/10 transition-colors">+ Add Section</button
			>
		</div>
	{/if}
</section>

<!-- Note builder modal - "+ Add Table" now lives inside here rather than as
     its own standalone button, since a table is almost always added while
     writing up the note that explains it. Rendered before TableBuilderModal
     below so the table builder (opened from the button inside this modal)
     stacks visually on top of it, both being the same z-40 overlay. -->
{#if noteBuilderOpen}
	<div class="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4" onclick={closeNoteBuilder} role="presentation">
		<div class="bg-bg-ink rounded-xl border border-border w-full max-w-lg" onclick={(e) => e.stopPropagation()} role="presentation">
			<div class="flex items-center justify-between px-5 py-3 border-b border-border">
				<h2 class="font-semibold">{noteBuilderEditingId != null ? 'Edit Section' : 'Add Section'}</h2>
				<button onclick={closeNoteBuilder} class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
			</div>
			<div class="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
				<label class="block text-sm"
					>Heading
					<input bind:value={noteHeading} placeholder="e.g. Management Commentary" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
				</label>

				<!-- The note body - an ordered list of Text/Table blocks the analyst
				     builds up in whatever mix and order they want, not one fixed
				     text area. -->
				<div class="space-y-2">
					{#each noteBlocks as block, i (i)}
						<div class="flex items-start gap-2">
							{#if block.type === 'text'}
								<textarea
									value={block.text}
									oninput={(e) =>
										(noteBlocks = noteBlocks.map((b, idx) => (idx === i ? { type: 'text', text: e.currentTarget.value } : b)))}
									onkeydown={(e) => handleBlockKeydown(e, i)}
									rows="4"
									placeholder="Write text here... (Tab to indent)"
									class="flex-1 rounded-md border border-border px-2 py-1.5 text-sm font-mono"
								></textarea>
							{:else}
								{@const t = tableSummaryById(block.table_id)}
								<div class="flex-1 flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2 py-2 text-xs">
									<span class="text-muted-fg">Table:</span>
									<span class="font-medium text-fg">{t?.name ?? `#${block.table_id}`}</span>
									{#if t}<span class="text-muted-fg">{t.columns.length} columns &middot; {t.row_count} rows</span>{/if}
								</div>
							{/if}
							<button type="button" onclick={() => removeBlock(i)} class="text-muted-fg hover:text-danger mt-1.5 cursor-pointer" aria-label="Remove block"
								>&times;</button
							>
						</div>
					{/each}
				</div>
				<div class="flex items-center gap-3">
					<button
						type="button"
						onclick={addTextBlock}
						class="text-xs text-ok px-2 py-1 -ml-2 rounded-md cursor-pointer hover:bg-ok/10 transition-colors">+ Add Text</button
					>
					<button
						type="button"
						onclick={() => openBuilder()}
						class="text-xs text-ok px-2 py-1 rounded-md cursor-pointer hover:bg-ok/10 transition-colors">+ Add Table</button
					>
				</div>
				{#if noteError}
					<div class="rounded-md bg-danger/10 border border-danger/30 p-2 text-sm text-danger">{noteError}</div>
				{/if}
			</div>
			<div class="px-5 py-3 border-t border-border flex justify-end gap-2">
				<button onclick={closeNoteBuilder} class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Cancel</button>
				<button onclick={submitNoteBuilder} class="text-sm px-3 py-1.5 rounded-md bg-fg text-bg hover:brightness-90"
					>{noteBuilderEditingId != null ? 'Save Changes' : 'Add Section'}</button
				>
			</div>
		</div>
	</div>
{/if}

<TableBuilderModal
	bind:open={builderOpen}
	title="New Data Table"
	submitLabel="Create Table"
	allowImport
	initialName={builderInitialName}
	initialColumns={builderInitialColumns}
	onSubmit={handleBuilderSubmit}
/>
