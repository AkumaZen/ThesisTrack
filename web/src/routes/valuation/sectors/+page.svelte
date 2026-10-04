<script lang="ts">
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import BasketRow from '$lib/valuation/components/BasketRow.svelte';
	import NewBasketForm from '$lib/valuation/components/NewBasketForm.svelte';
	import { sectorApi } from '$lib/valuation/sectorClient';
	import { trackView, type ViewTracker } from '$lib/viewMemory.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The filter and the place on the page are remembered for this tab (lib/viewMemory.ts).
	const memory: ViewTracker<'baskets'> = trackView({
		view: 'baskets',
		userId: () => data.user?.id,
		read: () => ({ query }),
		apply: (s) => (query = s.query)
	});
	let query = $state(memory.initial.query);
	// Which major sectors are expanded. Stays across edits (invalidateAll re-runs load, not this).
	let expanded = $state<Record<string, boolean>>({});

	const basketByKey = $derived(new Map(data.baskets.map((b) => [b.key, b])));
	const assignedKeys = $derived(new Set(data.majors.flatMap((m) => m.subsectorKeys)));
	const unassigned = $derived(data.baskets.filter((b) => !assignedKeys.has(b.key)));

	function nameOf(symbol: string) {
		return data.names[symbol] ?? symbol;
	}

	const q = $derived(query.trim().toLowerCase());

	function basketMatches(b: { label: string; symbols: string[] }) {
		if (!q) return true;
		return (
			b.label.toLowerCase().includes(q) ||
			b.symbols.some((s) => s.toLowerCase().includes(q) || nameOf(s).toLowerCase().includes(q))
		);
	}

	// A major shows when it, or anything inside it, matches the filter; while filtering, every
	// matching major auto-expands so the hit is visible without extra clicks.
	const visibleMajors = $derived(
		data.majors
			.map((m) => {
				const baskets = m.subsectorKeys
					.map((k) => basketByKey.get(k))
					.filter((b): b is NonNullable<typeof b> => b != null);
				const majorHit = !q || m.label.toLowerCase().includes(q);
				const shown = majorHit ? baskets : baskets.filter(basketMatches);
				return { major: m, baskets, shown, visible: majorHit || shown.length > 0 };
			})
			.filter((x) => x.visible)
	);
	const visibleUnassigned = $derived(unassigned.filter(basketMatches));

	function isOpen(key: string) {
		return q ? true : (expanded[key] ?? false);
	}

	let status = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

	async function refresh() {
		await invalidateAll();
	}

	// --- add sector ---
	let newMajorLabel = $state('');
	let addingMajor = $state(false);

	async function addMajor() {
		addingMajor = true;
		status = null;
		const res = await sectorApi<{ key: string; label: string }>('POST', '/api/valuation/sectors/majors', {
			label: newMajorLabel
		});
		addingMajor = false;
		if (!res.ok) {
			status = { kind: 'error', text: res.message };
			return;
		}
		newMajorLabel = '';
		expanded[res.data.key] = true;
		status = { kind: 'ok', text: `Created sector "${res.data.label}". Add a basket to it below.` };
		await refresh();
	}

	// --- per-major: rename / delete / add basket ---
	let renamingMajor = $state<string | null>(null);
	let majorLabelDraft = $state('');
	let confirmDeleteMajor = $state<string | null>(null);
	let majorBusy = $state<string | null>(null);

	function startRenameMajor(key: string, label: string) {
		renamingMajor = key;
		majorLabelDraft = label;
	}

	async function saveRenameMajor(key: string) {
		majorBusy = key;
		const res = await sectorApi('PATCH', `/api/valuation/sectors/majors/${key}`, { label: majorLabelDraft });
		majorBusy = null;
		if (!res.ok) {
			status = { kind: 'error', text: res.message };
			return;
		}
		renamingMajor = null;
		status = { kind: 'ok', text: 'Sector renamed.' };
		await refresh();
	}

	async function deleteMajor(key: string, label: string, basketCount: number) {
		majorBusy = key;
		const res = await sectorApi('DELETE', `/api/valuation/sectors/majors/${key}`);
		majorBusy = null;
		confirmDeleteMajor = null;
		if (!res.ok) {
			status = { kind: 'error', text: res.message };
			return;
		}
		status = {
			kind: 'ok',
			text:
				basketCount > 0
					? `Deleted sector "${label}". Its ${basketCount} basket${basketCount === 1 ? '' : 's'} moved to Unassigned (or stay in other sectors).`
					: `Deleted sector "${label}".`
		};
		await refresh();
	}

	const majorOptions = $derived(data.majors.map((m) => ({ key: m.key, label: m.label })));

	function majorsOf(basketKey: string) {
		return data.majors.filter((m) => m.subsectorKeys.includes(basketKey)).map((m) => m.key);
	}

	function expandAll(open: boolean) {
		for (const m of data.majors) expanded[m.key] = open;
	}
</script>

<svelte:head>
	<title>Manage Sectors · ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Sector baskets</h1>
		<div class="sub">
			Edit the sector &rarr; basket &rarr; company taxonomy. Every company is verified against
			Screener.in before it's added, and changes apply immediately for everyone.
		</div>
	</div>
</div>

<div class="wrap">
	<div class="sm-toolbar">
		<input
			class="sm-input sm-search"
			type="search"
			aria-label="Filter sectors, baskets and companies"
			placeholder="Filter sectors, baskets or companies…"
			bind:value={query}
		/>
		<button class="sm-btn" type="button" onclick={() => expandAll(true)}>Expand all</button>
		<button class="sm-btn" type="button" onclick={() => expandAll(false)}>Collapse all</button>
	</div>

	<form
		class="sm-toolbar sm-new-major"
		onsubmit={(e) => {
			e.preventDefault();
			addMajor();
		}}
	>
		<input
			class="sm-input"
			aria-label="New sector name"
			placeholder="New sector name, e.g. Renewable Storage"
			bind:value={newMajorLabel}
			maxlength="80"
			disabled={addingMajor}
		/>
		<button
			class="sm-btn sm-btn-primary"
			type="submit"
			disabled={addingMajor || !newMajorLabel.trim()}
		>
			Add sector
		</button>
	</form>

	{#if status}
		<p class="sm-msg sm-msg-{status.kind} sm-status" role="status">{status.text}</p>
	{/if}

	{#if visibleMajors.length === 0 && visibleUnassigned.length === 0}
		<p class="sm-empty">Nothing matches "{query}".</p>
	{/if}

	{#each visibleMajors as { major, baskets, shown } (major.key)}
		<section class="sm-major" data-major={major.key}>
			<div class="sm-major-head">
				<button
					class="sm-toggle"
					type="button"
					aria-expanded={isOpen(major.key)}
					aria-controls="major-body-{major.key}"
					onclick={() => (expanded[major.key] = !isOpen(major.key))}
				>
					<span class="sm-caret" aria-hidden="true">{isOpen(major.key) ? '▾' : '▸'}</span>
					{#if renamingMajor !== major.key}
						<span class="sm-major-title">{major.label}</span>
						<span class="sm-count">{baskets.length} basket{baskets.length === 1 ? '' : 's'}</span>
					{/if}
				</button>

				{#if renamingMajor === major.key}
					<form
						class="sm-inline-form"
						onsubmit={(e) => {
							e.preventDefault();
							saveRenameMajor(major.key);
						}}
					>
						<input
							class="sm-input"
							aria-label="Sector name"
							bind:value={majorLabelDraft}
							maxlength="80"
							disabled={majorBusy === major.key}
						/>
						<button
							class="sm-btn sm-btn-primary"
							type="submit"
							disabled={majorBusy === major.key || !majorLabelDraft.trim()}>Save</button
						>
						<button class="sm-btn" type="button" onclick={() => (renamingMajor = null)}
							>Cancel</button
						>
					</form>
				{:else}
					<div class="sm-actions">
						<a
							class="sm-btn sm-btn-link"
							href={resolve('/valuation/sector-rotation/[key]', { key: major.key })}>View rotation</a
						>
						<button
							class="sm-btn"
							type="button"
							onclick={() => startRenameMajor(major.key, major.label)}>Rename</button
						>
						{#if confirmDeleteMajor === major.key}
							<span class="sm-confirm">
								Delete sector? Its baskets are kept.
								<button
									class="sm-btn sm-btn-danger"
									type="button"
									disabled={majorBusy === major.key}
									onclick={() => deleteMajor(major.key, major.label, baskets.length)}
									>Yes, delete</button
								>
								<button class="sm-btn" type="button" onclick={() => (confirmDeleteMajor = null)}
									>Cancel</button
								>
							</span>
						{:else}
							<button
								class="sm-btn sm-btn-quiet-danger"
								type="button"
								onclick={() => (confirmDeleteMajor = major.key)}>Delete</button
							>
						{/if}
					</div>
				{/if}
			</div>

			{#if isOpen(major.key)}
				<div class="sm-major-body" id="major-body-{major.key}">
					{#each shown as basket (basket.key)}
						<BasketRow
							{basket}
							names={data.names}
							majors={majorOptions}
							assignedMajorKeys={majorsOf(basket.key)}
							viewMajorKey={major.key}
							onchanged={refresh}
						/>
					{/each}
					{#if shown.length === 0}
						<p class="sm-empty">No baskets yet - add the first one below.</p>
					{/if}

					<NewBasketForm
						majorKey={major.key}
						majorLabel={major.label}
						onchanged={refresh}
						oncreated={(text) => (status = { kind: 'ok', text })}
					/>
				</div>
			{/if}
		</section>
	{/each}

	{#if visibleUnassigned.length > 0}
		<section class="sm-major sm-unassigned" data-major="__unassigned">
			<div class="sm-major-head">
				<span class="sm-major-title">Unassigned baskets</span>
				<span class="sm-count">{visibleUnassigned.length}</span>
			</div>
			<div class="sm-major-body">
				<p class="sm-hint">
					These baskets aren't in any sector, so they don't appear on Sector Rotation. Assign them
					with "Move / assign", or delete them.
				</p>
				{#each visibleUnassigned as basket (basket.key)}
					<BasketRow
						{basket}
						names={data.names}
						majors={majorOptions}
						assignedMajorKeys={[]}
						viewMajorKey={null}
						onchanged={refresh}
					/>
				{/each}
			</div>
		</section>
	{/if}
</div>
