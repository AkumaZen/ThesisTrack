<script lang="ts">
	import '$lib/valuation/styles/marketIntel.css';
	import { invalidateAll } from '$app/navigation';
	import CompanyPicker from '$lib/components/CompanyPicker.svelte';
	import { sectorApi } from '$lib/valuation/sectorClient';
	import { formatMeetingDay } from '$lib/valuation/boardMeetings';
	import { FLAG_COLORS, flagCss, MAX_FLAG_LABEL, MAX_NAME } from '$lib/valuation/watchlistSections';
	import type { SymbolHit } from '$lib/valuation/symbolSearch';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let newName = $state('');
	let busy = $state(false);
	let status = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
	// Which company's flag editor is open, as "sectionId:SYMBOL".
	let editing = $state<string | null>(null);
	let editColor = $state<string | null>(null);
	let editLabel = $state('');

	async function run(label: string, call: () => Promise<{ ok: boolean; message?: string }>) {
		busy = true;
		const res = await call();
		busy = false;
		status = res.ok ? { kind: 'ok', text: label } : { kind: 'error', text: res.message ?? 'Something went wrong.' };
		if (res.ok) await invalidateAll();
		return res.ok;
	}

	async function createSection(e: SubmitEvent) {
		e.preventDefault();
		const name = newName.trim();
		if (name && (await run(`Added the section "${name}".`, () => sectorApi('POST', '/api/valuation/watchlist-sections', { name })))) newName = '';
	}

	const deleteSection = (id: number, name: string) => {
		if (confirm(`Delete the section "${name}"? The companies stay where else you track them.`)) run(`Deleted "${name}".`, () => sectorApi('DELETE', `/api/valuation/watchlist-sections/${id}`));
	};

	const addCompany = (sectionId: number, symbol: string, name: string) =>
		run(`Added ${name}.`, () => sectorApi('POST', `/api/valuation/watchlist-sections/${sectionId}/items`, { symbol, name }));

	const removeCompany = (sectionId: number, symbol: string) =>
		run(`Removed ${symbol}.`, () => sectorApi('DELETE', `/api/valuation/watchlist-sections/${sectionId}/items/${encodeURIComponent(symbol)}`));

	function openEditor(sectionId: number, item: { nseSymbol: string; flagColor: string | null; flagLabel: string | null }) {
		editing = `${sectionId}:${item.nseSymbol}`;
		editColor = item.flagColor;
		editLabel = item.flagLabel ?? '';
	}

	async function saveFlag(sectionId: number, symbol: string) {
		if (await run(`Saved the flag on ${symbol}.`, () => sectorApi('PATCH', `/api/valuation/watchlist-sections/${sectionId}/items/${encodeURIComponent(symbol)}`, { color: editColor, label: editLabel }))) editing = null;
	}
</script>

<svelte:head>
	<title>My lists - ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>My lists</h1>
		<div class="sub">
			Group companies into named sections, flag the ones that need attention with a colour and a short label,
			and see each section's upcoming results. The lists are yours alone.
		</div>
	</div>
</div>

<div class="wrap mi">
	<form class="mi-box" onsubmit={createSection} aria-labelledby="mi-new">
		<h2 id="mi-new">New section</h2>
		<div class="mi-row">
			<label class="mi-field" style="flex: 1 1 14rem;">
				Name
				<input class="sm-input" bind:value={newName} maxlength={MAX_NAME} autocomplete="off" placeholder="e.g. Defence, Waiting for a dip" />
			</label>
			<button class="sm-btn sm-btn-primary" type="submit" disabled={busy || !newName.trim()}>Add section</button>
		</div>
	</form>

	{#if status}<p class="sm-msg sm-msg-{status.kind}" role="status">{status.text}</p>{/if}

	{#if data.sections.length === 0}
		<p class="sm-empty" data-testid="lists-empty">No sections yet. Create one above, then add companies to it.</p>
	{/if}

	{#each data.sections as s (s.id)}
		{@const have = new Set(s.items.map((i) => i.nseSymbol))}
		{@const quick = data.tracked.filter((t) => !have.has(t.nseSymbol)).slice(0, 12)}
		<section class="mi-box" aria-labelledby="sec-{s.id}" data-testid="section">
			<div class="mi-row" style="justify-content: space-between;">
				<h2 id="sec-{s.id}">{s.name} <span class="mi-muted">({s.items.length})</span></h2>
				<button class="sm-btn" type="button" disabled={busy} onclick={() => deleteSection(s.id, s.name)} aria-label="Delete section {s.name}">Delete section</button>
			</div>

			{#if s.items.length}
				<ul class="mi-list">
					{#each s.items as i (i.nseSymbol)}
						{@const key = `${s.id}:${i.nseSymbol}`}
						<li class="mi-item">
							<div class="mi-title">
								<a href="/valuation/company/{encodeURIComponent(i.nseSymbol)}">{i.nseSymbol}</a>
								<span class="mi-muted"> {i.companyName}</span>
							</div>
							{#if i.flagColor || i.flagLabel}
								<span class="mi-flag" data-testid="flag"><span class="mi-dot" style="--dot: {flagCss(i.flagColor) ?? 'transparent'}"></span>{i.flagLabel ?? ''}</span>
							{/if}
							<div class="mi-row">
								<button class="sm-btn" type="button" aria-expanded={editing === key} onclick={() => (editing === key ? (editing = null) : openEditor(s.id, i))}>Flag</button>
								<button class="sm-btn" type="button" disabled={busy} onclick={() => removeCompany(s.id, i.nseSymbol)} aria-label="Remove {i.nseSymbol} from {s.name}">Remove</button>
							</div>
							{#if editing === key}
								<div class="mi-box" role="group" aria-label="Flag for {i.nseSymbol}">
									<div class="mi-swatches">
										<button class="mi-swatch" type="button" aria-pressed={editColor === null} onclick={() => (editColor = null)}>None</button>
										{#each FLAG_COLORS as c (c.key)}
											<button class="mi-swatch" type="button" style="--dot: {c.css}" aria-label={c.label} aria-pressed={editColor === c.key} onclick={() => (editColor = c.key)}></button>
										{/each}
									</div>
									<label class="mi-field">
										Label (optional)
										<input class="sm-input" bind:value={editLabel} maxlength={MAX_FLAG_LABEL} autocomplete="off" placeholder="e.g. Check pledge" />
									</label>
									<div class="mi-row">
										<button class="sm-btn sm-btn-primary" type="button" disabled={busy} onclick={() => saveFlag(s.id, i.nseSymbol)}>Save flag</button>
										<button class="sm-btn" type="button" onclick={() => (editing = null)}>Cancel</button>
									</div>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="sm-hint">Empty. Search below to add companies.</p>
			{/if}

			<div class="mi-field">
				<label for="add-{s.id}">Add a company</label>
				<CompanyPicker id="add-{s.id}" label="Search a company to add to {s.name}" placeholder="Type a name or ticker" disabled={busy} onPick={(hit: SymbolHit) => addCompany(s.id, hit.nseSymbol ?? hit.symbol, hit.name)} />
			</div>
			{#if quick.length}
				<div class="mi-field">
					From your tracked companies
					<ul class="tag-list">
						{#each quick as t (t.nseSymbol)}
							<li><button class="tag" type="button" disabled={busy} onclick={() => addCompany(s.id, t.nseSymbol, t.companyName)} aria-label="Add {t.companyName} to {s.name}">+ {t.nseSymbol}</button></li>
						{/each}
					</ul>
				</div>
			{/if}

			<h3 class="mi-sub">Upcoming results</h3>
			{#if s.calendar.length}
				<ul class="mi-list" data-testid="section-calendar">
					{#each s.calendar as m (m.nseSymbol + m.meetingDate + m.isResults)}
						<li class="mi-item">
							<div class="mi-meta"><span>{formatMeetingDay(m.meetingDate)}</span><span class="tag {m.isResults ? 'tag-info' : ''}">{m.isResults ? 'Results' : m.purpose}</span></div>
							<div class="mi-title">{m.nseSymbol} <span class="mi-muted">{m.companyName}</span></div>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="sm-hint">No board meetings or results dates are stored yet for this section.</p>
			{/if}
		</section>
	{/each}
</div>
