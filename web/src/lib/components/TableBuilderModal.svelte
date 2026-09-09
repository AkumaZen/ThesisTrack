<script lang="ts">
	// Shared "define a data table" builder: name + Excel-like columns editor
	// + CSV/paste import. Extracted out of company/[id]/CustomTables.svelte so
	// the exact same builder UI/logic is used both there (immediate create
	// against an existing company) and on the ingest form's Custom Sections
	// (deferred - the company doesn't exist yet, so the caller just collects
	// the built definition and creates it after the company itself is
	// created). One change here reaches both call sites.
	export type ColumnDef = { key: string; label: string; type: 'text' | 'number' | 'date' | 'enum'; options?: string[] };
	export type BuilderColumn = { key: string; label: string; type: string; optionsCsv: string };
	export type BuiltTable = { name: string; columns: ColumnDef[]; rows: Record<string, string>[] };

	let {
		open = $bindable(false),
		title,
		submitLabel = 'Create Table',
		allowImport = true,
		initialName = '',
		initialColumns = [],
		onSubmit
	}: {
		open?: boolean;
		title: string;
		submitLabel?: string;
		allowImport?: boolean;
		initialName?: string;
		initialColumns?: BuilderColumn[];
		onSubmit: (built: BuiltTable) => Promise<void> | void;
	} = $props();

	const COLUMN_TYPES = ['text', 'number', 'date', 'enum'] as const;

	let builderName = $state('');
	let builderColumns = $state<BuilderColumn[]>([]);
	let builderError = $state('');
	let builderBusy = $state(false);
	let importedRows = $state<string[][]>([]);
	let importFileName = $state('');
	let templateOpen = $state(false);

	$effect(() => {
		if (open) {
			builderName = initialName;
			builderColumns = initialColumns.length ? initialColumns.map((c) => ({ ...c })) : [];
			builderError = '';
			importedRows = [];
			importFileName = '';
			templateOpen = false;
		}
	});

	function close() {
		open = false;
	}

	function addColumn() {
		builderColumns = [...builderColumns, { key: '', label: '', type: 'text', optionsCsv: '' }];
	}
	function removeColumn(i: number) {
		builderColumns = builderColumns.filter((_, idx) => idx !== i);
	}
	function clearImport() {
		importedRows = [];
		importFileName = '';
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

	function parseDelimitedText(text: string): string[][] {
		const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.length);
		if (!lines.length) return [];
		const delimiter = lines[0].includes('\t') ? '\t' : ',';
		return lines.map((l) => l.split(delimiter).map((c) => c.trim()));
	}

	function inferColumnType(dataRows: string[][], colIndex: number): 'text' | 'number' {
		const values = dataRows.map((r) => r[colIndex]).filter((v): v is string => v !== undefined && v !== '');
		if (values.length && values.every((v) => v !== '' && !Number.isNaN(Number(v)))) return 'number';
		return 'text';
	}

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

	function handleBuilderPaste(e: ClipboardEvent) {
		const text = e.clipboardData?.getData('text/plain');
		if (!text || !text.trim()) return;
		e.preventDefault();
		applyParsedImport(parseDelimitedText(text), 'Pasted from clipboard');
	}

	async function submit() {
		builderError = '';
		const columns: ColumnDef[] = builderColumns
			.filter((c) => c.key.trim() && c.label.trim())
			.map((c) => ({
				key: slugifyKey(c.key),
				label: c.label.trim(),
				type: c.type as ColumnDef['type'],
				options: c.type === 'enum' ? c.optionsCsv.split(',').map((o) => o.trim()).filter(Boolean) : undefined
			}));
		const rows = importedRows
			.map((cells) => {
				const obj: Record<string, string> = {};
				columns.forEach((c, i) => {
					if (cells[i] !== undefined && cells[i] !== '') obj[c.key] = cells[i];
				});
				return obj;
			})
			.filter((r) => Object.keys(r).length);

		builderBusy = true;
		try {
			await onSubmit({ name: builderName, columns, rows });
			open = false;
		} catch (e) {
			builderError = e instanceof Error ? e.message : String(e);
		} finally {
			builderBusy = false;
		}
	}
</script>

{#if open}
	<div class="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4" onclick={close} role="presentation">
		<div class="bg-bg-ink rounded-xl border border-border w-full max-w-lg" onclick={(e) => e.stopPropagation()} role="presentation">
			<div class="flex items-center justify-between px-5 py-3 border-b border-border">
				<h2 class="font-semibold">{title}</h2>
				<button onclick={close} class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
			</div>
			<div class="p-5 overflow-y-auto" style="max-height: 65vh">
				<label class="block text-sm"
					>Table Name
					<input bind:value={builderName} placeholder="e.g. Shareholding Pattern" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
				</label>
				{#if allowImport}
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
								<button type="button" onclick={() => removeColumn(i)} class="text-muted-fg hover:text-danger text-center">&times;</button>
							</div>
						{/each}
					</div>
					<button type="button" onclick={addColumn} class="text-xs text-ok mt-2">+ Add Column</button>
				</div>
				{#if builderError}
					<div class="mt-3 rounded-md bg-danger/10 border border-danger/30 p-2 text-sm text-danger">{builderError}</div>
				{/if}
			</div>
			<div class="px-5 py-3 border-t border-border flex justify-end gap-2">
				<button onclick={close} class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Cancel</button>
				<button disabled={builderBusy} onclick={submit} class="text-sm px-3 py-1.5 rounded-md bg-fg text-bg hover:brightness-90 disabled:opacity-50"
					>{builderBusy ? 'Saving...' : submitLabel}</button
				>
			</div>
		</div>
	</div>
{/if}
