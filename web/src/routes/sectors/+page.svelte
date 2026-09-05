<script lang="ts">
	// Sectors - groups of companies for a rollup health view across their
	// theses. Initial data comes from +page.ts's load() (see that file) so
	// the router waits for it before swapping this page in, instead of the
	// old onMount fetch that raced the navigation and flashed "Loading...".
	// Write actions (create/add/remove/delete) still call refresh() directly.
	import { api, ApiError } from '$lib/api';
	import { session } from '$lib/session.svelte';
	import { OPERATING_MODEL_LABELS, STATUS_STYLES } from '$lib/format';
	import type { PageData } from './$types';
	import type { Sector, Company } from './+page';

	let { data }: { data: PageData } = $props();

	const OPERATING_MODEL_OPTIONS = Object.entries(OPERATING_MODEL_LABELS);

	let sectors = $derived(data.sectors);
	let allCompanies = $derived(data.allCompanies);
	let error = $state('');

	let q = $state('');
	let view = $state<'cards' | 'table'>('cards');
	let sectorFilter = $state('');
	let nicheFilter = $state('');

	let sectorNames = $derived([...new Set(sectors.map((s) => s.name))].sort());
	let nicheNames = $derived([...new Set(sectors.flatMap((s) => s.companies.map((c) => c.specific_niche)))].sort());

	let filtered = $derived(
		sectors
			.filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()))
			.filter((s) => !sectorFilter || s.name === sectorFilter)
			.filter((s) => !nicheFilter || s.companies.some((c) => c.specific_niche === nicheFilter))
			.map((s) => (nicheFilter ? { ...s, companies: s.companies.filter((c) => c.specific_niche === nicheFilter) } : s))
	);
	let totalCompanies = $derived(sectors.reduce((sum, s) => sum + s.company_count, 0));

	async function refresh() {
		error = '';
		try {
			const resp = (await api.getSectors()) as { items: Sector[] };
			sectors = resp.items;
		} catch (e) {
			error = String(e);
		}
	}

	// --- Create sector modal ---
	let showCreate = $state(false);
	let createName = $state('');
	let createDescription = $state('');
	let createOperatingModel = $state<string>('');
	let createCompanyIds = $state<string[]>([]);
	let createCompanySearch = $state('');
	let creating = $state(false);

	let createCandidates = $derived(
		createCompanySearch.trim()
			? allCompanies.filter((c) => c.name.toLowerCase().includes(createCompanySearch.trim().toLowerCase()))
			: allCompanies
	);

	function openCreate() {
		createName = '';
		createDescription = '';
		createOperatingModel = '';
		createCompanyIds = [];
		createCompanySearch = '';
		showCreate = true;
	}

	function toggleCreateCompany(id: string) {
		createCompanyIds = createCompanyIds.includes(id)
			? createCompanyIds.filter((x) => x !== id)
			: [...createCompanyIds, id];
	}

	async function submitCreate() {
		if (!createName.trim()) return;
		creating = true;
		error = '';
		try {
			await api.createSector({
				name: createName.trim(),
				description: createDescription.trim(),
				operating_model: createOperatingModel || null,
				company_ids: createCompanyIds
			});
			showCreate = false;
			await refresh();
		} catch (e) {
			error = e instanceof ApiError ? String((e.body as { detail?: string })?.detail ?? e.message) : String(e);
		} finally {
			creating = false;
		}
	}

	// --- Add-company panel (per sector) ---
	let addPanelSectorId = $state<number | null>(null);
	let addSearch = $state('');
	let addSelected = $state<string[]>([]);
	let adding = $state(false);

	function openAddPanel(sector: Sector) {
		addPanelSectorId = sector.id;
		addSearch = '';
		addSelected = [];
	}

	function closeAddPanel() {
		addPanelSectorId = null;
	}

	function candidatesFor(sector: Sector) {
		const existing = new Set(sector.companies.map((c) => c.company_id));
		const pool = allCompanies.filter((c) => !existing.has(c.company_id));
		return addSearch.trim() ? pool.filter((c) => c.name.toLowerCase().includes(addSearch.trim().toLowerCase())) : pool;
	}

	function toggleAddSelected(id: string) {
		addSelected = addSelected.includes(id) ? addSelected.filter((x) => x !== id) : [...addSelected, id];
	}

	async function submitAdd() {
		if (addPanelSectorId === null || !addSelected.length) return;
		adding = true;
		error = '';
		try {
			await api.addCompaniesToSector(addPanelSectorId, addSelected);
			closeAddPanel();
			await refresh();
		} catch (e) {
			error = e instanceof ApiError ? String((e.body as { detail?: string })?.detail ?? e.message) : String(e);
		} finally {
			adding = false;
		}
	}

	async function removeCompany(sector: Sector, companyId: string) {
		try {
			await api.removeCompanyFromSector(sector.id, companyId);
			await refresh();
		} catch (e) {
			error = e instanceof ApiError ? String((e.body as { detail?: string })?.detail ?? e.message) : String(e);
		}
	}

	// --- Delete sector ---
	let confirmDeleteId = $state<number | null>(null);

	async function deleteSector(sector: Sector) {
		if (confirmDeleteId !== sector.id) {
			confirmDeleteId = sector.id;
			return;
		}
		try {
			await api.deleteSector(sector.id);
			confirmDeleteId = null;
			await refresh();
		} catch (e) {
			error = e instanceof ApiError ? String((e.body as { detail?: string })?.detail ?? e.message) : String(e);
		}
	}
</script>

<div class="flex items-center justify-between mb-1">
	<h2 class="text-xl font-semibold">Sectors</h2>
	{#if !session.isReadOnly}
		<button onclick={openCreate} class="text-sm px-3 py-1.5 rounded-md bg-fg text-bg hover:brightness-90"
			>+ Create Sector</button
		>
	{/if}
</div>
<p class="text-sm text-muted-fg mb-4">
	{sectors.length} sector{sectors.length === 1 ? '' : 's'} &middot; {totalCompanies} company{totalCompanies === 1
		? ''
		: 'ies'} total
</p>

{#if error}
	<div class="mb-3 rounded-md bg-danger/10 border border-danger/30 p-2 text-sm text-danger">{error}</div>
{/if}

<div class="rounded-lg border border-border bg-surface p-3 mb-4 flex flex-wrap items-center gap-3">
	<input
		bind:value={q}
		placeholder="Search sectors by name..."
		class="flex-1 min-w-[200px] rounded-md border border-border px-2 py-1.5 text-sm"
	/>
	<select bind:value={sectorFilter} class="rounded-md border border-border px-2 py-1.5 text-sm">
		<option value="">All sectors</option>
		{#each sectorNames as n (n)}
			<option value={n}>{n}</option>
		{/each}
	</select>
	<select bind:value={nicheFilter} class="rounded-md border border-border px-2 py-1.5 text-sm">
		<option value="">All niches</option>
		{#each nicheNames as n (n)}
			<option value={n}>{n}</option>
		{/each}
	</select>
	<div class="flex items-center gap-1 rounded-md border border-border p-0.5">
		<button
			onclick={() => (view = 'cards')}
			class="text-xs px-2 py-1 rounded {view === 'cards' ? 'bg-fg text-bg' : 'hover:bg-surface-3'}"
			>Cards</button
		>
		<button
			onclick={() => (view = 'table')}
			class="text-xs px-2 py-1 rounded {view === 'table' ? 'bg-fg text-bg' : 'hover:bg-surface-3'}"
			>Table</button
		>
	</div>
</div>

{#if !filtered.length}
	<div class="text-center text-muted-fg py-16">No sectors match.</div>
{:else if view === 'table'}
	<div class="rounded-lg border border-border bg-surface overflow-x-auto">
		<table class="w-full text-sm">
			<thead class="border-b border-border text-xs text-muted-fg">
				<tr>
					<th class="text-left px-3 py-2 font-medium">Name</th>
					<th class="text-left px-3 py-2 font-medium">Operating Model</th>
					<th class="text-left px-3 py-2 font-medium">Companies</th>
					<th class="text-left px-3 py-2 font-medium">Health</th>
					<th class="text-right px-3 py-2 font-medium">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as sector (sector.id)}
					<tr class="border-b border-border last:border-b-0">
						<td class="px-3 py-2 font-medium">{sector.name}</td>
						<td class="px-3 py-2 text-muted-fg"
							>{sector.operating_model ? (OPERATING_MODEL_LABELS[sector.operating_model] ?? sector.operating_model) : 'Mixed'}</td
						>
						<td class="px-3 py-2">{sector.company_count}</td>
						<td class="px-3 py-2">
							<div class="flex items-center gap-2 text-xs">
								<span class="text-good">{sector.health_counts.on_track} on track</span>
								<span class="text-warn">{sector.health_counts.watch_closely} watch</span>
								<span class="text-danger">{sector.health_counts.broken} broken</span>
							</div>
						</td>
						<td class="px-3 py-2 text-right">
							{#if !session.isReadOnly}
								<button
									onclick={() => deleteSector(sector)}
									class="text-xs px-2 py-1 rounded-md border border-border hover:text-danger"
									>{confirmDeleteId === sector.id ? 'Confirm delete?' : 'Delete'}</button
								>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
		{#each filtered as sector (sector.id)}
			<div class="rounded-lg border border-border bg-surface p-4">
				<div class="flex items-start justify-between gap-2">
					<div>
						<div class="font-semibold text-fg">{sector.name}</div>
						{#if sector.description}
							<p class="text-xs text-muted-fg mt-0.5">{sector.description}</p>
						{/if}
					</div>
					<span class="text-xs px-2 py-0.5 rounded-full bg-surface-3 text-muted-fg shrink-0"
						>{sector.operating_model ? (OPERATING_MODEL_LABELS[sector.operating_model] ?? sector.operating_model) : 'Mixed'}</span
					>
				</div>

				<div class="mt-3 flex items-center gap-3 text-xs">
					<span class="flex items-center gap-1"
						><span class="inline-block h-2 w-2 rounded-full {STATUS_STYLES.on_track.dot}"></span>{sector.health_counts
							.on_track} on track</span
					>
					<span class="flex items-center gap-1"
						><span class="inline-block h-2 w-2 rounded-full {STATUS_STYLES.watch_closely.dot}"></span>{sector.health_counts
							.watch_closely} watch</span
					>
					<span class="flex items-center gap-1"
						><span class="inline-block h-2 w-2 rounded-full {STATUS_STYLES.broken.dot}"></span>{sector.health_counts
							.broken} broken</span
					>
				</div>

				<div class="mt-3 pt-3 border-t border-border grid grid-cols-2 sm:grid-cols-3 gap-2">
					{#each sector.companies as c (c.company_id)}
						{@const style = STATUS_STYLES[c.status ?? ''] ?? null}
						<div class="rounded-md border border-border p-2.5 relative hover:border-muted-fg transition-colors">
							{#if !session.isReadOnly}
								<button
									onclick={() => removeCompany(sector, c.company_id)}
									class="absolute top-1.5 right-1.5 text-muted-fg hover:text-danger text-xs leading-none shrink-0"
									title="Remove from sector">&times;</button
								>
							{/if}
							<a href="/company/{c.company_id}" class="block pr-4 group" title={c.name}>
								<div class="text-[11px] font-mono text-muted-fg tracking-wide">{c.company_id}</div>
								<div class="text-xs font-medium leading-snug mt-0.5 line-clamp-2 group-hover:text-accent">{c.name}</div>
							</a>
							<div class="mt-1.5 flex items-center gap-1">
								{#if style}
									<span class="inline-block h-1.5 w-1.5 rounded-full {style.dot}"></span>
									<span class="text-xs text-muted-fg">{style.label}</span>
								{:else}
									<span class="text-xs text-muted-fg italic">No thesis yet</span>
								{/if}
							</div>
						</div>
					{/each}
					{#if !session.isReadOnly}
						<button
							onclick={() => openAddPanel(sector)}
							class="rounded-md border border-dashed border-border p-2 text-xs text-muted-fg hover:text-accent hover:border-accent flex items-center justify-center min-h-[3.25rem]"
							>+ Add Company</button
						>
					{/if}
				</div>

				{#if !session.isReadOnly}
					<div class="mt-3 flex justify-end">
						<button onclick={() => deleteSector(sector)} class="text-xs px-2 py-1 rounded-md border border-border hover:text-danger"
							>{confirmDeleteId === sector.id ? 'Confirm delete?' : 'Delete Sector'}</button
						>
					</div>
				{/if}

				{#if addPanelSectorId === sector.id}
					<div class="mt-3 pt-3 border-t border-border">
						<input
							bind:value={addSearch}
							placeholder="Search companies to add..."
							class="w-full rounded-md border border-border px-2 py-1.5 text-sm mb-2"
						/>
						<div class="max-h-48 overflow-y-auto space-y-1">
							{#each candidatesFor(sector) as c (c.company_id)}
								<label class="flex items-center gap-2 text-sm px-1 py-0.5 rounded hover:bg-surface-3">
									<input type="checkbox" checked={addSelected.includes(c.company_id)} onchange={() => toggleAddSelected(c.company_id)} />
									{c.name}
								</label>
							{:else}
								<p class="text-xs text-muted-fg px-1">No matching companies.</p>
							{/each}
						</div>
						<div class="mt-2 flex justify-end gap-2">
							<button onclick={closeAddPanel} class="text-xs px-2 py-1 rounded-md border border-border hover:bg-surface-3">Cancel</button>
							<button
								disabled={adding || !addSelected.length}
								onclick={submitAdd}
								class="text-xs px-2 py-1 rounded-md bg-fg text-bg hover:brightness-90 disabled:opacity-50">Add</button
							>
						</div>
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

{#if showCreate}
	<div
		class="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4"
		role="presentation"
		onclick={() => (showCreate = false)}
		onkeydown={(e) => e.key === 'Escape' && (showCreate = false)}
	>
		<div
			class="bg-bg-ink rounded-xl shadow-md border border-border w-full max-w-lg max-h-[85vh] overflow-y-auto"
			role="dialog"
			aria-modal="true"
			aria-labelledby="create-sector-title"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<div class="flex items-center justify-between px-5 py-3 border-b border-border">
				<h2 id="create-sector-title" class="font-semibold">Create Sector</h2>
				<button onclick={() => (showCreate = false)} class="text-muted-fg hover:text-fg text-xl leading-none">&times;</button>
			</div>
			<div class="p-5 space-y-3">
				<label class="block text-sm"
					>Name
					<input bind:value={createName} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
				</label>
				<label class="block text-sm"
					>Operating Model
					<select bind:value={createOperatingModel} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
						<option value="">No specific model</option>
						{#each OPERATING_MODEL_OPTIONS as [key, label] (key)}
							<option value={key}>{label}</option>
						{/each}
					</select>
				</label>
				<label class="block text-sm"
					>Description
					<textarea
						bind:value={createDescription}
						rows="3"
						class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"
					></textarea>
				</label>
				<div class="text-sm">
					<span class="block mb-1">Companies ({createCompanyIds.length} selected)</span>
					<input
						bind:value={createCompanySearch}
						placeholder="Search companies..."
						class="w-full rounded-md border border-border px-2 py-1.5 text-sm mb-2"
					/>
					<div class="max-h-48 overflow-y-auto space-y-1 border border-border rounded-md p-2">
						{#each createCandidates as c (c.company_id)}
							<label class="flex items-center gap-2 text-sm px-1 py-0.5 rounded hover:bg-surface-3">
								<input type="checkbox" checked={createCompanyIds.includes(c.company_id)} onchange={() => toggleCreateCompany(c.company_id)} />
								{c.name}
							</label>
						{:else}
							<p class="text-xs text-muted-fg px-1">No matching companies.</p>
						{/each}
					</div>
				</div>
			</div>
			<div class="px-5 py-3 border-t border-border flex justify-end gap-2">
				<button onclick={() => (showCreate = false)} class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3"
					>Cancel</button
				>
				<button
					disabled={creating || !createName.trim()}
					onclick={submitCreate}
					class="text-sm px-3 py-1.5 rounded-md bg-fg text-bg hover:brightness-90 disabled:opacity-50">Create</button
				>
			</div>
		</div>
	</div>
{/if}
