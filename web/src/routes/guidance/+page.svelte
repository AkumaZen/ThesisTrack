<script lang="ts">
	// Ports frontend/components/guidance.js (renderGuidanceFilterBar/List/AddForm)
	// + the guidance wiring in frontend/app.js into a real route. Guidance notes
	// are always company-scoped in this schema (guidance_notes.company_id is
	// NOT NULL) - there is no "global" guidance concept to port. Initial data
	// (default filters) comes from +page.ts's load(); changing a filter still
	// refetches directly via refresh(), same as before.
	import { api, ApiError } from '$lib/api';
	import { session } from '$lib/session.svelte';
	import type { PageData } from './$types';
	import type { Guidance, Company } from './+page';

	let { data }: { data: PageData } = $props();

	const BLOCK_KEYS = [
		'general',
		'the_business',
		'the_growth_engine',
		'the_big_change',
		'proof_points',
		'what_can_kill_it',
		'why_we_believe_it',
		'health_check',
		'references'
	];

	function blockLabel(key: string) {
		if (key === 'general') return 'General';
		return key
			.split('_')
			.map((w) => w[0].toUpperCase() + w.slice(1))
			.join(' ');
	}

	const METRIC_LABELS: Record<string, string> = { revenue: 'Revenue', margin: 'Margin', other: 'Other' };

	function targetLabel(item: Guidance) {
		if (!item.target_metric) return null;
		const metric = item.target_metric === 'other' ? item.target_metric_label || 'Other' : METRIC_LABELS[item.target_metric];
		const value = item.target_value != null ? `${item.target_value}${item.target_unit || ''}` : null;
		const parts = [metric, value].filter(Boolean).join(' ');
		return item.target_period ? `${parts} · ${item.target_period}` : parts;
	}

	function formatResultsDate(dateStr: string) {
		return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
	}

	// "Due" once the expected date has passed and nobody's checked yet -
	// prompts the analyst to go verify the target rather than letting it sit.
	function isResultsDue(item: Guidance) {
		if (!item.expected_results_date || item.outcome !== 'pending') return false;
		return new Date(item.expected_results_date + 'T00:00:00').getTime() <= Date.now();
	}

	// This app's palette is deliberately monochrome (--good/--danger both
	// resolve to plain ink, see layout.css) - but achieved vs missed needs to
	// actually read as different at a glance, so this one feature breaks that
	// convention on purpose with real green/red rather than the neutral tokens.
	const OUTCOME_STYLES: Record<string, string> = {
		achieved: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
		missed: 'bg-red-500/10 text-red-700 dark:text-red-400',
		pending: 'bg-surface-3 text-muted-fg'
	};
	const OUTCOME_CARD_STYLES: Record<string, string> = {
		achieved: 'border-emerald-500/30 bg-emerald-500/5',
		missed: 'border-red-500/30 bg-red-500/5',
		pending: 'border-border bg-surface-2'
	};

	// Items already arrive latest-first from the server; grouping by company
	// must preserve that, and the groups themselves float to the top in order
	// of whichever company has the most recent guidance - so "latest on top"
	// holds both within a company's notes and across the whole page.
	let items = $derived(data.items);
	let companies = $derived(data.companies);
	let groupedItems = $derived.by(() => {
		const groups = new Map<string, { company_id: string; company_name: string; items: typeof items }>();
		for (const item of items) {
			const group = groups.get(item.company_id) ?? {
				company_id: item.company_id,
				company_name: item.company_name || item.company_id,
				items: []
			};
			group.items.push(item);
			groups.set(item.company_id, group);
		}
		return [...groups.values()].sort(
			(a, b) => new Date(b.items[0].created_at).getTime() - new Date(a.items[0].created_at).getTime()
		);
	});
	let error = $state('');

	let filterCompany = $state('');
	let filterBlock = $state('');
	let filterStatus = $state('open');

	let showAddForm = $state(false);
	let addCompany = $state(data.companies[0]?.company_id ?? '');
	let addBlock = $state('general');
	let addNote = $state('');
	let addTargetMetric = $state<'' | 'revenue' | 'margin' | 'other'>('');
	let addTargetMetricLabel = $state('');
	let addTargetValue = $state<number | ''>('');
	let addTargetUnit = $state('');
	let addTargetPeriod = $state('');
	let addExpectedResultsDate = $state('');
	let adding = $state(false);
	let outcomeUpdating = $state<Record<number, boolean>>({});

	async function refresh() {
		error = '';
		try {
			items = (await api.listGuidance({
				company_id: filterCompany || undefined,
				block_key: filterBlock || undefined,
				status: filterStatus || undefined
			})) as Guidance[];
		} catch (e) {
			error = String(e);
		}
	}

	// Skip the first run - load() already fetched the default-filter view,
	// so only refetch once the user actually changes a filter.
	let firstFilterRun = true;
	$effect(() => {
		[filterCompany, filterBlock, filterStatus];
		if (firstFilterRun) {
			firstFilterRun = false;
			return;
		}
		refresh();
	});

	function openAddForm() {
		if (!addCompany) addCompany = companies[0]?.company_id ?? '';
		addBlock = 'general';
		addNote = '';
		addTargetMetric = '';
		addTargetMetricLabel = '';
		addTargetValue = '';
		addTargetUnit = '';
		addTargetPeriod = '';
		addExpectedResultsDate = '';
		showAddForm = true;
	}

	async function submitAdd() {
		if (!addCompany || !addNote.trim()) return;
		adding = true;
		error = '';
		try {
			await api.createGuidance(addCompany, {
				block_key: addBlock,
				note: addNote.trim(),
				target_metric: addTargetMetric || null,
				target_metric_label: addTargetMetric === 'other' ? addTargetMetricLabel.trim() || null : null,
				target_value: addTargetValue !== '' ? Number(addTargetValue) : null,
				target_unit: addTargetUnit.trim() || null,
				target_period: addTargetPeriod.trim() || null,
				expected_results_date: addExpectedResultsDate || null
			});
			showAddForm = false;
			await refresh();
		} catch (e) {
			error = e instanceof ApiError ? String((e.body as { detail?: string })?.detail ?? e.message) : String(e);
		} finally {
			adding = false;
		}
	}

	async function resolveNote(item: Guidance) {
		try {
			await api.resolveGuidance(item.id);
			await refresh();
		} catch (e) {
			error = e instanceof ApiError ? String((e.body as { detail?: string })?.detail ?? e.message) : String(e);
		}
	}

	async function markOutcome(item: Guidance, outcome: 'achieved' | 'missed') {
		outcomeUpdating = { ...outcomeUpdating, [item.id]: true };
		try {
			await api.resolveGuidance(item.id, outcome);
			await refresh();
		} catch (e) {
			error = e instanceof ApiError ? String((e.body as { detail?: string })?.detail ?? e.message) : String(e);
		} finally {
			const { [item.id]: _drop, ...rest } = outcomeUpdating;
			outcomeUpdating = rest;
		}
	}

	async function deleteNote(item: Guidance) {
		try {
			await api.deleteGuidance(item.id);
			items = items.filter((x) => x.id !== item.id);
		} catch (e) {
			error = e instanceof ApiError ? String((e.body as { detail?: string })?.detail ?? e.message) : String(e);
		}
	}
</script>

<div class="flex items-center justify-between mb-1">
	<h2 class="text-xl font-semibold">Guidance</h2>
	{#if !session.isReadOnly}
		<button onclick={openAddForm} class="text-sm px-3 py-1.5 rounded-md bg-fg text-bg hover:brightness-90"
			>+ Add Guidance</button
		>
	{/if}
</div>
<p class="text-sm text-muted-fg mb-4">Notes for what an analyst should look into or keep in mind on a thesis block.</p>

{#if error}
	<div class="mb-3 rounded-md bg-danger/10 border border-danger/30 p-2 text-sm text-danger">{error}</div>
{/if}

<div class="rounded-lg border border-border bg-surface p-4 mb-4 flex flex-wrap items-end gap-4">
	<label class="text-sm"
		>Company
		<select bind:value={filterCompany} class="mt-1 block rounded-md border border-border px-2 py-1.5 text-sm">
			<option value="">All companies</option>
			{#each companies as c (c.company_id)}
				<option value={c.company_id}>{c.name}</option>
			{/each}
		</select>
	</label>
	<label class="text-sm"
		>Block
		<select bind:value={filterBlock} class="mt-1 block rounded-md border border-border px-2 py-1.5 text-sm">
			<option value="">All blocks</option>
			{#each BLOCK_KEYS as k (k)}
				<option value={k}>{blockLabel(k)}</option>
			{/each}
		</select>
	</label>
	<label class="text-sm"
		>Status
		<select bind:value={filterStatus} class="mt-1 block rounded-md border border-border px-2 py-1.5 text-sm">
			<option value="open">Open</option>
			<option value="resolved">Resolved</option>
			<option value="">All</option>
		</select>
	</label>
</div>

{#if !items.length}
	<div class="text-center text-muted-fg py-16">No guidance notes match these filters.</div>
{:else}
	<div class="space-y-5">
		{#each groupedItems as group (group.company_id)}
			<div class="rounded-lg border border-border bg-surface p-4">
				<div class="flex items-center gap-2 mb-3">
					<a href="/company/{group.company_id}" class="font-medium hover:text-accent">{group.company_name}</a>
					<span class="text-xs px-2 py-0.5 rounded-full bg-surface-3 text-muted-fg"
						>{group.items.length} note{group.items.length === 1 ? '' : 's'}</span
					>
				</div>
				<div class="space-y-3">
					{#each group.items as item (item.id)}
						{@const target = targetLabel(item)}
						<div class="rounded-md border p-3 {OUTCOME_CARD_STYLES[item.outcome]}">
							<div class="flex items-start justify-between gap-3">
								<div>
									<div class="flex items-center gap-2 flex-wrap">
										<span class="text-xs px-2 py-0.5 rounded-full bg-surface-3 text-muted-fg">{blockLabel(item.block_key)}</span>
										{#if target}
											<span class="text-xs px-2 py-0.5 rounded-full bg-surface-3 text-fg font-medium">{target}</span>
										{/if}
										{#if item.target_metric}
											<span class="text-xs px-2 py-0.5 rounded-full font-medium {OUTCOME_STYLES[item.outcome]}"
												>{item.outcome}</span
											>
											{#if isResultsDue(item)}
												<span
													class="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400"
													>Results due - check it</span
												>
											{/if}
										{:else}
											<span
												class="text-xs px-2 py-0.5 rounded-full {item.status === 'open'
													? 'bg-warn/10 text-warn'
													: 'bg-good/10 text-good'}">{item.status}</span
											>
										{/if}
									</div>
									<p class="text-sm mt-2 whitespace-pre-wrap">{item.note}</p>
									{#if item.expected_results_date}
										<p class="text-xs text-muted-fg mt-1">Results expected {formatResultsDate(item.expected_results_date)}</p>
									{/if}
									<p class="text-xs text-muted-fg mt-2 font-mono">
										{item.created_by} &middot; {new Date(item.created_at).toLocaleString()}
										{#if item.resolved_at}
											&middot; resolved by {item.resolved_by || ''}
											{new Date(item.resolved_at).toLocaleString()}
										{/if}
									</p>
								</div>
								{#if !session.isReadOnly}
									<div class="flex items-center gap-2 shrink-0">
										{#if item.status === 'open' && item.target_metric}
											<button
												disabled={outcomeUpdating[item.id]}
												onclick={() => markOutcome(item, 'achieved')}
												class="text-xs px-2 py-1 rounded-md border border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
												>Achieved</button
											>
											<button
												disabled={outcomeUpdating[item.id]}
												onclick={() => markOutcome(item, 'missed')}
												class="text-xs px-2 py-1 rounded-md border border-red-500/40 text-red-700 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50"
												>Missed</button
											>
										{:else if item.status === 'open'}
											<button
												onclick={() => resolveNote(item)}
												class="text-xs px-2 py-1 rounded-md border border-border hover:bg-surface-3">Resolve</button
											>
										{/if}
										<button
											onclick={() => deleteNote(item)}
											class="text-xs px-2 py-1 rounded-md border border-border hover:text-danger">Delete</button
										>
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	</div>
{/if}

{#if showAddForm}
	<div
		class="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4"
		role="presentation"
		onclick={() => (showAddForm = false)}
		onkeydown={(e) => e.key === 'Escape' && (showAddForm = false)}
	>
		<div
			class="bg-bg-ink rounded-xl shadow-md border border-border w-full max-w-md"
			role="dialog"
			aria-modal="true"
			aria-labelledby="guidance-modal-title"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<div class="flex items-center justify-between px-5 py-3 border-b border-border">
				<h2 id="guidance-modal-title" class="font-semibold">Add Guidance</h2>
				<button onclick={() => (showAddForm = false)} class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
			</div>
			<div class="p-5 space-y-3">
				<label class="block text-sm"
					>Company
					<select bind:value={addCompany} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
						{#each companies as c (c.company_id)}
							<option value={c.company_id}>{c.name}</option>
						{/each}
					</select>
				</label>
				<label class="block text-sm"
					>Block
					<select bind:value={addBlock} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
						{#each BLOCK_KEYS as k (k)}
							<option value={k}>{blockLabel(k)}</option>
						{/each}
					</select>
				</label>
				<label class="block text-sm"
					>Note
					<textarea
						bind:value={addNote}
						rows="4"
						class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"
						placeholder="What should the analyst look into or keep in mind on this block?"
					></textarea>
				</label>

				<div class="pt-1 border-t border-border">
					<div class="text-xs font-semibold uppercase tracking-wide text-muted-fg mt-3 mb-2">
						Management guidance target <span class="font-normal normal-case">(optional)</span>
					</div>
					<div class="grid grid-cols-2 gap-3">
						<label class="block text-sm"
							>Metric
							<select bind:value={addTargetMetric} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
								<option value="">None</option>
								<option value="revenue">Revenue</option>
								<option value="margin">Margin</option>
								<option value="other">Other</option>
							</select>
						</label>
						<label class="block text-sm"
							>Period
							<input
								type="text"
								bind:value={addTargetPeriod}
								placeholder="e.g. Q2 FY26"
								class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"
							/>
						</label>
					</div>
					{#if addTargetMetric === 'other'}
						<label class="block text-sm mt-3"
							>Metric name
							<input
								type="text"
								bind:value={addTargetMetricLabel}
								placeholder="e.g. EBITDA"
								class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"
							/>
						</label>
					{/if}
					{#if addTargetMetric}
						<div class="grid grid-cols-2 gap-3 mt-3">
							<label class="block text-sm"
								>Target value
								<input
									type="number"
									step="any"
									bind:value={addTargetValue}
									placeholder="e.g. 15"
									class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"
								/>
							</label>
							<label class="block text-sm"
								>Unit
								<input
									type="text"
									bind:value={addTargetUnit}
									placeholder="e.g. % or INR cr"
									class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"
								/>
							</label>
						</div>
						<label class="block text-sm mt-3"
							>Results expected on
							<input
								type="date"
								bind:value={addExpectedResultsDate}
								class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"
							/>
							<span class="block text-xs text-muted-fg mt-1"
								>When that quarter's numbers should be out - so you know when to come check this.</span
							>
						</label>
					{/if}
				</div>
			</div>
			<div class="px-5 py-3 border-t border-border flex justify-end gap-2">
				<button onclick={() => (showAddForm = false)} class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3"
					>Cancel</button
				>
				<button
					disabled={adding || !addNote.trim()}
					onclick={submitAdd}
					class="text-sm px-3 py-1.5 rounded-md bg-fg text-bg hover:brightness-90 disabled:opacity-50">Add</button
				>
			</div>
		</div>
	</div>
{/if}
