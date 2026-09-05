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

	let items = $derived(data.items);
	let companies = $derived(data.companies);
	let error = $state('');

	let filterCompany = $state('');
	let filterBlock = $state('');
	let filterStatus = $state('open');

	let showAddForm = $state(false);
	let addCompany = $state(data.companies[0]?.company_id ?? '');
	let addBlock = $state('general');
	let addNote = $state('');
	let adding = $state(false);

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
		showAddForm = true;
	}

	async function submitAdd() {
		if (!addCompany || !addNote.trim()) return;
		adding = true;
		error = '';
		try {
			await api.createGuidance(addCompany, { block_key: addBlock, note: addNote.trim() });
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
	<div class="space-y-3">
		{#each items as item (item.id)}
			<div class="rounded-lg border border-border bg-surface p-4">
				<div class="flex items-start justify-between gap-3">
					<div>
						<div class="flex items-center gap-2">
							<a href="/company/{item.company_id}" class="font-medium hover:text-accent"
								>{item.company_name || item.company_id}</a
							>
							<span class="text-xs px-2 py-0.5 rounded-full bg-surface-3 text-muted-fg">{blockLabel(item.block_key)}</span>
							<span
								class="text-xs px-2 py-0.5 rounded-full {item.status === 'open' ? 'bg-warn/10 text-warn' : 'bg-good/10 text-good'}"
								>{item.status}</span
							>
						</div>
						<p class="text-sm mt-2 whitespace-pre-wrap">{item.note}</p>
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
							{#if item.status === 'open'}
								<button
									onclick={() => resolveNote(item)}
									class="text-xs px-2 py-1 rounded-md border border-border hover:bg-surface-3">Resolve</button
								>
							{/if}
							<button onclick={() => deleteNote(item)} class="text-xs px-2 py-1 rounded-md border border-border hover:text-danger"
								>Delete</button
							>
						</div>
					{/if}
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
