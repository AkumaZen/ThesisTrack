<script lang="ts">
	import '$lib/valuation/styles/marketIntel.css';
	import { goto, invalidateAll } from '$app/navigation';
	import { sectorApi } from '$lib/valuation/sectorClient';
	import { feedQuery, feedTags, presetScan, PRESET_SCANS } from '$lib/valuation/announcementScans';
	import { TAG_LABELS, TAG_TONE, isAnnouncementTag, type AnnouncementTag } from '$lib/valuation/announcementTags';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const f = $derived(data.filters);
	const scan = $derived(presetScan(f.scan));
	let busy = $state(false);
	let status = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
	let newKeyword = $state('');

	// Links keep every current filter except the ones named.
	const href = (over: Record<string, unknown> = {}, page = 1) =>
		`/valuation/announcements${feedQuery({ ...f, scan: presetScan(f.scan), tag: f.tag, ...over } as Parameters<typeof feedQuery>[0], page)}`;

	const tagOf = (tag: string | null): AnnouncementTag => (isAnnouncementTag(tag) ? tag : 'other');
	const savedMatch = $derived(f.keyword ? data.keywords.some((k) => k.keyword.toLowerCase() === f.keyword!.toLowerCase()) : false);

	const when = (iso: string) =>
		new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
	const day = (iso: string | null) =>
		iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : 'n/a';

	function pickScan(key: string) {
		void goto(href({ scan: PRESET_SCANS.find((x) => x.key === key) ?? null }));
	}

	async function saveKeyword(keyword: string) {
		busy = true;
		status = null;
		const res = await sectorApi('POST', '/api/valuation/announcement-keywords', { keyword });
		busy = false;
		if (!res.ok) {
			status = { kind: 'error', text: res.message };
			return;
		}
		newKeyword = '';
		status = { kind: 'ok', text: `Saved "${keyword}".` };
		await invalidateAll();
	}

	async function removeKeyword(id: number, keyword: string) {
		const res = await sectorApi('DELETE', `/api/valuation/announcement-keywords/${id}`);
		status = res.ok ? { kind: 'ok', text: `Removed "${keyword}".` } : { kind: 'error', text: res.message };
		await invalidateAll();
	}
</script>

<svelte:head>
	<title>Announcements - ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Market announcements</h1>
		<div class="sub">Every NSE corporate announcement, stored so you can scan it.</div>
	</div>
</div>

<div class="wrap mi ann">
	<form class="ann-bar" method="get" action="/valuation/announcements" aria-label="Filter announcements">
		{#if f.scan}<input type="hidden" name="scan" value={f.scan} />{/if}
		<label class="ann-field">
			<span class="sr-only">Preset scan</span>
			<select value={f.scan ?? ''} onchange={(e) => pickScan(e.currentTarget.value)} data-testid="preset-scan">
				<option value="">No preset scan</option>
				{#each PRESET_SCANS as s (s.key)}
					<option value={s.key}>{s.label}</option>
				{/each}
			</select>
		</label>
		<label class="ann-field">
			<span class="sr-only">Company or ticker</span>
			<input class="sm-input" name="company" value={f.company} maxlength="60" autocomplete="off" placeholder="Company or ticker" />
		</label>
		<label class="ann-field">
			<span class="sr-only">Keyword</span>
			<input class="sm-input" name="q" value={f.keyword ?? ''} maxlength="60" autocomplete="off" placeholder="Keyword" />
		</label>
		<label class="ann-field">
			<span class="sr-only">Type</span>
			<select name="tag" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
				<option value="">All types</option>
				{#each feedTags as t (t)}
					<option value={t} selected={f.tag === t}>{TAG_LABELS[t]}</option>
				{/each}
			</select>
		</label>
		<details class="calm-disclosure ann-more" open={Boolean(f.from || f.to)}>
			<summary>Dates</summary>
			<div class="ann-dates">
				<label class="ann-field">From<input class="sm-input" type="date" name="from" value={f.from ?? ''} onchange={(e) => e.currentTarget.form?.requestSubmit()} /></label>
				<label class="ann-field">To<input class="sm-input" type="date" name="to" value={f.to ?? ''} onchange={(e) => e.currentTarget.form?.requestSubmit()} /></label>
			</div>
		</details>
		<div class="ann-ends">
			<button class="quiet" type="submit">Apply</button>
			<a class="quiet" href="/valuation/announcements">Clear</a>
		</div>
	</form>
	{#if scan}
		<p class="sm-hint">Showing filings that mention: {scan.terms.join(', ')}.</p>
	{/if}
	{#if f.keyword && !savedMatch}
		<p class="sm-hint">
			<button class="quiet" type="button" disabled={busy} onclick={() => saveKeyword(f.keyword!)}>Save "{f.keyword}" as a keyword</button>
		</p>
	{/if}

	<div class="ann-panels">
		<details class="calm-disclosure ann-panel" open={Boolean(status)}>
			<summary>Your keywords ({data.keywords.length})</summary>
			{#if data.keywords.length}
				<ul class="tag-list" aria-label="Saved keywords">
					{#each data.keywords as k (k.id)}
						<li class="mi-row">
							<a class="tag" href={href({ keyword: k.keyword, company: '', tag: null, scan: null })} aria-current={f.keyword?.toLowerCase() === k.keyword.toLowerCase() ? 'true' : undefined}>{k.keyword}</a>
							<button class="tag" type="button" aria-label="Remove keyword {k.keyword}" onclick={() => removeKeyword(k.id, k.keyword)}>x</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="sm-hint">No saved keywords yet. Add one below, for example "warrants" or "slump sale".</p>
			{/if}
			<form
				class="mi-row"
				onsubmit={(e) => {
					e.preventDefault();
					if (newKeyword.trim()) saveKeyword(newKeyword);
				}}
			>
				<label class="ann-field ann-grow">
					<span class="sr-only">Add a keyword</span>
					<input class="sm-input" bind:value={newKeyword} maxlength="60" autocomplete="off" placeholder="Add a keyword" />
				</label>
				<button class="sm-btn" type="submit" disabled={busy || !newKeyword.trim()}>Save keyword</button>
			</form>
			{#if status}<p class="sm-msg sm-msg-{status.kind}" role="status">{status.text}</p>{/if}
		</details>

		<details class="calm-disclosure ann-panel" data-testid="trending">
			<summary>Trending words, last 7 days</summary>
			{#if data.trending.length}
				<ul class="tag-list" aria-label="Trending words">
					{#each data.trending as w (w.word)}
						<li>
							<a class="tag" href={href({ keyword: w.word, company: '', tag: null, scan: null })}>
								{w.word}
								<small>{w.current}{w.change > 0 ? ` +${w.change}` : w.change < 0 ? ` ${w.change}` : ''}</small>
							</a>
						</li>
					{/each}
				</ul>
				<p class="sm-hint">Count of filings using the word, with the change from the week before.</p>
			{:else}
				<p class="sm-hint">Not enough filings stored yet to see a trend.</p>
			{/if}
		</details>
	</div>
	<p class="sm-hint" data-testid="coverage">
		{data.coverage.total.toLocaleString('en-IN')} filings stored, from {day(data.coverage.earliest)} to {day(data.coverage.latest)}.
		Page {f.page}.
	</p>

	{#if data.items.length === 0}
		<p class="sm-empty" data-testid="feed-empty">No announcements match these filters.</p>
	{:else}
		<ul class="mi-list" data-testid="feed">
			{#each data.items as a (a.id)}
				<li class="mi-item">
					<div class="mi-meta ann-meta">
						<span>{when(a.announcedAt)}</span>
						<span class="tag {TAG_TONE[tagOf(a.tag)]}">{TAG_LABELS[tagOf(a.tag)]}</span>
						{#if a.pdfUrl}
							<a class="ann-pdf" href={a.pdfUrl} target="_blank" rel="noopener noreferrer">Open PDF</a>
						{/if}
					</div>
					<div class="mi-title">
						<a href="/valuation/company/{encodeURIComponent(a.nseSymbol)}">{a.nseSymbol}</a>
						<span class="mi-muted"> {a.companyName}</span>
					</div>
					<div class="mi-title">{a.subject}</div>
					{#if a.summary}
						<p class="mi-text">{a.summary}</p>
					{:else if a.details && a.details !== a.subject}
						<p class="mi-text mi-muted">{a.details}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if f.page > 1 || data.hasMore}
		<nav class="mi-pager" aria-label="Pages">
			{#if f.page > 1}<a href={href({}, f.page - 1)} rel="prev">Newer</a>{:else}<span></span>{/if}
			{#if data.hasMore}<a href={href({}, f.page + 1)} rel="next">Older</a>{/if}
		</nav>
	{/if}
</div>

<style>
	.ann {
		gap: 0.75rem;
	}
	.ann-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 12px;
	}
	.ann-field {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
		font-size: 0.75rem;
		font-weight: 600;
		flex: 1 1 11rem;
		max-width: 16rem;
	}
	.ann-field select,
	.ann-field :global(.sm-input) {
		width: 100%;
		min-height: 2.5rem;
		box-sizing: border-box;
		border: var(--border-w) solid var(--ink);
		background: var(--bg);
		color: var(--ink);
		font: inherit;
		font-size: 0.875rem;
		padding: 0.3rem 0.5rem;
	}
	.ann-grow {
		flex: 1 1 12rem;
		max-width: none;
	}
	.ann-more[open] {
		flex-basis: 100%;
	}
	.ann-dates {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 12px;
		margin-top: 8px;
	}
	.ann-ends {
		align-items: center;
		display: flex;
		gap: 14px;
		margin-left: auto;
	}
	.quiet {
		line-height: 1.4;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		padding: 4px 2px;
		border: 0;
		background: none;
		color: var(--muted);
		cursor: pointer;
		text-decoration: none;
	}
	.quiet:hover:not(:disabled) {
		color: var(--ink);
		text-decoration: underline;
	}
	.ann-panels {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 8px 24px;
	}
	.ann-panel {
		min-width: 0;
		max-width: 100%;
	}
	.ann-panel[open] {
		flex-basis: 100%;
	}
	.ann-panel > :global(*:not(summary)) {
		margin-top: 8px;
	}
	.ann-panel :global(.tag-list) {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		list-style: none;
		padding: 0;
	}
	.ann :global(.mi-list) {
		gap: 0;
	}
	.ann :global(.mi-item) {
		border: 0;
		border-top: 1px solid var(--rule);
		padding: 0.9rem 0;
		background: none;
	}
	.ann-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px 10px;
	}
	.ann-meta :global(.tag) {
		border: 0;
		background: none;
		box-shadow: none;
		padding: 0;
		font-weight: 500;
		text-transform: none;
		letter-spacing: 0;
		color: var(--muted);
	}
	.ann-pdf {
		font-size: 12px;
		font-weight: 500;
		color: var(--muted);
		text-decoration: underline;
	}
	.ann-pdf:hover {
		color: var(--ink);
	}
	@media (max-width: 640px) {
		.ann-field {
			flex: 1 1 calc(50% - 6px);
			max-width: none;
		}
		.ann-ends {
			margin-left: 0;
		}
	}
</style>