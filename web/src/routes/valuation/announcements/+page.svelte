<script lang="ts">
	import '$lib/valuation/styles/marketIntel.css';
	import { invalidateAll } from '$app/navigation';
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
		<div class="sub">
			Every NSE corporate announcement, stored here so you can filter and scan it. Pick a preset scan, search a
			word, or save your own keywords.
		</div>
	</div>
</div>

<div class="wrap mi">
	<section class="mi-box" aria-labelledby="mi-scans">
		<h2 id="mi-scans">Preset scans</h2>
		<ul class="tag-list" aria-label="Preset scans">
			<li><a class="tag" href={href({ scan: null })} aria-current={!f.scan ? 'true' : undefined}>All</a></li>
			{#each PRESET_SCANS as s (s.key)}
				<li><a class="tag" href={href({ scan: s })} aria-current={f.scan === s.key ? 'true' : undefined}>{s.label}</a></li>
			{/each}
		</ul>
		{#if scan}
			<p class="sm-hint">Showing filings that mention: {scan.terms.join(', ')}.</p>
		{/if}
	</section>

	<form class="mi-box" method="get" action="/valuation/announcements" aria-labelledby="mi-filter">
		<h2 id="mi-filter">Filter</h2>
		{#if f.scan}<input type="hidden" name="scan" value={f.scan} />{/if}
		<div class="mi-form">
			<label class="mi-field">Company or ticker<input class="sm-input" name="company" value={f.company} maxlength="60" autocomplete="off" placeholder="e.g. HFCL" /></label>
			<label class="mi-field">Keyword<input class="sm-input" name="q" value={f.keyword ?? ''} maxlength="60" autocomplete="off" placeholder="e.g. warrants" /></label>
			<label class="mi-field">
				Type
				<select name="tag">
					<option value="">All types</option>
					{#each feedTags as t (t)}
						<option value={t} selected={f.tag === t}>{TAG_LABELS[t]}</option>
					{/each}
				</select>
			</label>
			<label class="mi-field">From<input class="sm-input" type="date" name="from" value={f.from ?? ''} /></label>
			<label class="mi-field">To<input class="sm-input" type="date" name="to" value={f.to ?? ''} /></label>
		</div>
		<div class="mi-row">
			<button class="sm-btn sm-btn-primary" type="submit">Apply filters</button>
			<a class="sm-btn mi-link" href="/valuation/announcements">Clear</a>
			{#if f.keyword && !savedMatch}
				<button class="sm-btn" type="button" disabled={busy} onclick={() => saveKeyword(f.keyword!)}>Save "{f.keyword}" as a keyword</button>
			{/if}
		</div>
	</form>

	<section class="mi-box" aria-labelledby="mi-kw">
		<h2 id="mi-kw">Your keywords</h2>
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
			<label class="mi-field" style="flex: 1 1 12rem;">
				Add a keyword
				<input class="sm-input" bind:value={newKeyword} maxlength="60" autocomplete="off" />
			</label>
			<button class="sm-btn" type="submit" disabled={busy || !newKeyword.trim()}>Save keyword</button>
		</form>
		{#if status}<p class="sm-msg sm-msg-{status.kind}" role="status">{status.text}</p>{/if}
	</section>

	<section class="mi-box" aria-labelledby="mi-trend" data-testid="trending">
		<h2 id="mi-trend">Trending words, last 7 days</h2>
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
	</section>

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
					<div class="mi-meta">
						<span>{when(a.announcedAt)}</span>
						<span class="tag {TAG_TONE[tagOf(a.tag)]}">{TAG_LABELS[tagOf(a.tag)]}</span>
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
					{#if a.pdfUrl}
						<a class="mi-link" href={a.pdfUrl} target="_blank" rel="noopener noreferrer">Open PDF</a>
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
