<script lang="ts">
	// Ports frontend/components/exportPanel.js + the export wiring in
	// frontend/app.js into a real route. The old app rendered this as a modal
	// panel opened from a nav button and downloaded via a plain <a href> link;
	// here it's its own page, and the download is fetched with the session's
	// auth header (a bare <a href> would 401 against this backend's auth
	// model, same as it would have against the old one) then handed to the
	// browser as a blob so "Download JSONL" still behaves like a file download.
	import { api, ApiError } from '$lib/api';
	import { session } from '$lib/session.svelte';

	type ExportStats = {
		row_count: number;
		row_count_by_task: Record<string, number>;
		class_balance: Record<string, Record<string, number>>;
		by_operating_model: Record<string, Record<string, number>>;
		leakage_violations: number;
		companies_by_split: Record<string, number>;
	};

	let task = $state<'verdict' | 'thesis_synthesis' | 'redline_extraction'>('verdict');
	let format = $state<'anthropic' | 'openai' | 'llama'>('anthropic');
	let split = $state<'train' | 'eval' | 'all'>('train');
	let includeOpen = $state(false);
	let stats = $state<ExportStats | null>(null);
	let error = $state('');
	let loadingStats = $state(false);
	let downloading = $state(false);

	async function loadStats() {
		error = '';
		loadingStats = true;
		try {
			stats = (await api.getExportStats({ split, include_open: includeOpen })) as ExportStats;
		} catch (e) {
			error = e instanceof ApiError ? String((e.body as { detail?: string })?.detail ?? e.message) : String(e);
		} finally {
			loadingStats = false;
		}
	}

	async function download() {
		error = '';
		downloading = true;
		try {
			const url = api.exportTrainingDataUrl({ task, format, split, include_open: includeOpen });
			const headers: Record<string, string> = {};
			if (session.token) headers['Authorization'] = `Bearer ${session.token}`;
			else if (session.apiKey) headers['X-API-Key'] = session.apiKey;

			const resp = await fetch(url, { headers });
			if (!resp.ok) {
				const body = await resp.text();
				throw new ApiError(resp.status, body);
			}
			const blob = await resp.blob();
			const objectUrl = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = objectUrl;
			a.download = `${task}-${split}-${format}.jsonl`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(objectUrl);
		} catch (e) {
			error = e instanceof ApiError ? String(e.body ?? e.message) : String(e);
		} finally {
			downloading = false;
		}
	}
</script>

<div class="max-w-2xl">
	<h1 class="font-semibold text-lg mb-1">Export Training Data</h1>
	<p class="text-sm text-muted-fg mb-4">
		Export reviewed thesis/verdict/redline data as SFT training rows (BUILD_PLAN.md §7).
	</p>

	{#if error}
		<div class="mb-3 rounded-md bg-danger/10 border border-danger/30 p-2 text-sm text-danger">{error}</div>
	{/if}

	<div class="bg-bg-ink rounded-xl border border-border p-5 space-y-3">
		<label class="block text-sm"
			>Task
			<select bind:value={task} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
				<option value="verdict">verdict</option>
				<option value="thesis_synthesis">thesis_synthesis</option>
				<option value="redline_extraction">redline_extraction</option>
			</select>
		</label>
		<label class="block text-sm"
			>Format
			<select bind:value={format} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
				<option value="anthropic">anthropic</option>
				<option value="openai">openai</option>
				<option value="llama">llama</option>
			</select>
		</label>
		<label class="block text-sm"
			>Split
			<select bind:value={split} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
				<option value="train">train</option>
				<option value="eval">eval</option>
				<option value="all">all</option>
			</select>
		</label>
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" bind:checked={includeOpen} />
			Include open (unresolved-outcome) companies
		</label>

		<div class="flex items-center gap-2 pt-1">
			<button
				onclick={loadStats}
				disabled={loadingStats}
				class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3 disabled:opacity-50"
			>
				{loadingStats ? 'Loading...' : 'Load Dataset Summary'}
			</button>
			<button
				onclick={download}
				disabled={downloading}
				class="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90 disabled:opacity-50"
			>
				{downloading ? 'Downloading...' : 'Download JSONL'}
			</button>
		</div>

		{#if stats}
			<div class="text-sm bg-surface-2 rounded-md p-3 space-y-1">
				<div><strong>Rows:</strong> {stats.row_count}</div>
				<div><strong>Rows by task:</strong> {JSON.stringify(stats.row_count_by_task)}</div>
				<div><strong>Class balance:</strong> {JSON.stringify(stats.class_balance)}</div>
				<div><strong>By operating model:</strong> {JSON.stringify(stats.by_operating_model)}</div>
				<div><strong>Leakage violations:</strong> {stats.leakage_violations}</div>
				<div><strong>Companies by split:</strong> {JSON.stringify(stats.companies_by_split)}</div>
			</div>
		{/if}
	</div>
</div>
