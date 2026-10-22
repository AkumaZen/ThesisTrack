<script lang="ts">
	import '$lib/valuation/styles/marketIntel.css';
	import { insiderQuery, PERSON_CATEGORIES, sideOf } from '$lib/valuation/insiderTrades';
	import type { InsiderRow, SastRow } from '$lib/valuation/server/marketIntelStore';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const f = $derived(data.filters);
	const tabKey = $derived(data.tab === 'sast' ? 'sast' : null);
	const href = (page = 1, tab: 'sast' | null = tabKey) => `/valuation/insider-trades${insiderQuery(f, page, tab)}`;
	const tabHref = (tab: 'sast' | null) => `/valuation/insider-trades${insiderQuery({ ...f, page: 1 }, 1, tab)}`;

	/** Any filter applied (as opposed to an empty store). */
	const filtered = $derived(insiderQuery({ ...f, page: 1 }, 1, null) !== '');

	const pit = $derived(data.tab === 'pit' ? (data.items as InsiderRow[]) : []);
	const sast = $derived(data.tab === 'sast' ? (data.items as SastRow[]) : []);

	const when = (iso: string) =>
		new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
	const qty = (n: number | null) => (n == null ? 'n/a' : n.toLocaleString('en-IN'));
	const pct = (n: number | null) => (n == null ? 'n/a' : `${n.toFixed(2)}%`);
	/** Rupees in crore / lakh, as Indian markets read them. */
	function rupees(n: number): string {
		if (!n) return 'n/a';
		if (n >= 1e7) return `Rs ${(n / 1e7).toFixed(2)} Cr`;
		if (n >= 1e5) return `Rs ${(n / 1e5).toFixed(2)} L`;
		return `Rs ${n.toLocaleString('en-IN')}`;
	}
</script>

<svelte:head>
	<title>Insider trades - ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Insider trades and SAST</h1>
		<div class="sub">Insider trades and substantial acquisitions, as disclosed to NSE.</div>
		<details class="calm-disclosure no-print">
			<summary>How this works</summary>
			<p>
				Insider trades are by promoters, directors and other insiders (SEBI PIT); substantial acquisitions
				or sales are SAST Regulation 29 disclosures. Search a shareholder's name to follow one person
				across companies.
			</p>
		</details>
	</div>
</div>

<div class="wrap mi calm-flat">
	<div class="mi-tabs" role="group" aria-label="Disclosure type">
		<a class="tag" href={tabHref(null)} aria-current={data.tab === 'pit' ? 'true' : undefined}>Insider trades</a>
		<a class="tag" href={tabHref('sast')} aria-current={data.tab === 'sast' ? 'true' : undefined}>Substantial acquisitions (SAST)</a>
	</div>

	<form class="calm-toolbar" method="get" action="/valuation/insider-trades" aria-label="Filter disclosures">
		{#if data.tab === 'sast'}<input type="hidden" name="tab" value="sast" />{/if}
		<label class="calm-field"><span class="sr-only">Company or ticker</span><input name="company" value={f.company} maxlength="60" autocomplete="off" placeholder="Company or ticker" /></label>
		<label class="calm-field"><span class="sr-only">Shareholder name</span><input name="person" value={f.person} maxlength="60" autocomplete="off" placeholder="Shareholder name" /></label>
		<label class="calm-field">
			<span class="sr-only">Person category</span>
			<select name="category" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
				<option value="">All categories</option>
				{#each PERSON_CATEGORIES as c (c)}
					<option value={c} selected={f.category === c}>{c}</option>
				{/each}
			</select>
		</label>
		<label class="calm-field">
			<span class="sr-only">Buy or sell</span>
			<select name="side" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
				<option value="">Buy or sell</option>
				<option value="buy" selected={f.side === 'buy'}>Buy / acquisition</option>
				<option value="sell" selected={f.side === 'sell'}>Sell / disposal</option>
				{#if data.tab === 'pit'}<option value="pledge" selected={f.side === 'pledge'}>Pledge</option>{/if}
			</select>
		</label>
		<details class="calm-disclosure calm-more" open={Boolean(f.from || f.to || f.minValue)}>
			<summary>More filters</summary>
			<div class="calm-more-body">
				{#if data.tab === 'pit'}
					<label class="calm-field">Minimum value (Rs lakh)<input type="number" min="0" step="any" inputmode="decimal" name="minLakh" value={f.minValue ? f.minValue / 100_000 : ''} /></label>
				{/if}
				<label class="calm-field">From<input type="date" name="from" value={f.from ?? ''} onchange={(e) => e.currentTarget.form?.requestSubmit()} /></label>
				<label class="calm-field">To<input type="date" name="to" value={f.to ?? ''} onchange={(e) => e.currentTarget.form?.requestSubmit()} /></label>
			</div>
		</details>
		<div class="calm-end">
			<button class="calm-btn" type="submit">Apply</button>
			<a class="calm-btn" href={data.tab === 'sast' ? '/valuation/insider-trades?tab=sast' : '/valuation/insider-trades'}>Clear</a>
		</div>
	</form>

	{#if data.items.length === 0}
		<p class="sm-empty" data-testid="insider-empty">
			{#if filtered}
				Nothing matches these filters.
			{:else if data.tab === 'pit'}
				No insider trades are stored. NSE's insider-trade (PIT) feed has published no recent filings, so this list stays empty until it does; the Substantial acquisitions (SAST) tab has current disclosures.
			{:else}
				No substantial acquisition disclosures are stored yet.
			{/if}
		</p>
	{:else if data.tab === 'pit'}
		<ul class="mi-list" data-testid="insider-list">
			{#each pit as t (t.id)}
				{@const side = sideOf(t.txnType)}
				<li class="mi-item">
					<div class="mi-meta ins-meta">
						<span>{when(t.broadcastAt)}</span>
						<span class="tag">{t.personCategory}</span>
						<span class={side === 'buy' ? 'mi-side-buy' : side === 'sell' ? 'mi-side-sell' : ''}>{t.txnType}</span>
						{#if t.sourceUrl}<a class="ins-link" href={t.sourceUrl} target="_blank" rel="noopener noreferrer">Open filing</a>{/if}
					</div>
					<div class="mi-title">
						<a href="/valuation/company/{encodeURIComponent(t.nseSymbol)}">{t.nseSymbol}</a>
						<span class="mi-muted"> {t.companyName}, {t.personName}</span>
					</div>
					<p class="ins-facts" title="Shares, value, holding before to after, mode">
						{qty(t.quantity)} shares · {rupees(t.value)} · {pct(t.beforePct)} to {pct(t.afterPct)} · {t.mode || 'n/a'}
					</p>
				</li>
			{/each}
		</ul>
	{:else}
		<ul class="mi-list" data-testid="sast-list">
			{#each sast as s (s.id)}
				<li class="mi-item">
					<div class="mi-meta ins-meta">
						<span>{when(s.disclosedAt)}</span>
						<span class="tag {s.isPromoter ? 'tag-info' : ''}">{s.isPromoter ? 'Promoter' : 'Acquirer'}</span>
						<span class={s.action.toLowerCase().startsWith('acq') ? 'mi-side-buy' : 'mi-side-sell'}>{s.action}</span>
						{#if s.sourceUrl}<a class="ins-link" href={s.sourceUrl} target="_blank" rel="noopener noreferrer">Open filing</a>{/if}
					</div>
					<div class="mi-title">
						<a href="/valuation/company/{encodeURIComponent(s.nseSymbol)}">{s.nseSymbol}</a>
						<span class="mi-muted"> {s.companyName}, {s.acquirerName}</span>
					</div>
					<p class="ins-facts" title="Shares acquired, shares sold, change, holding after, mode, regulation">
						{qty(s.sharesAcquired)} acquired · {qty(s.sharesSold)} sold · change {pct(s.pctAcquired ?? s.pctSold)} · holding after {pct(s.pctAfter)} · {s.mode || 'n/a'} · {s.regulation}{s.periodText ? `, ${s.periodText}` : ''}
					</p>
				</li>
			{/each}
		</ul>
	{/if}

	{#if f.page > 1 || data.hasMore}
		<nav class="mi-pager" aria-label="Pages">
			{#if f.page > 1}<a href={href(f.page - 1)} rel="prev">Newer</a>{:else}<span></span>{/if}
			{#if data.hasMore}<a href={href(f.page + 1)} rel="next">Older</a>{/if}
		</nav>
	{/if}
</div>

<style>
	.ins-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px 10px;
	}
	/* Category tags read as plain text here; the colour of Buy and Sell carries the meaning. */
	.ins-meta :global(.tag) {
		border: 0;
		background: none;
		box-shadow: none;
		padding: 0;
		font-weight: 500;
		text-transform: none;
		letter-spacing: 0;
		color: var(--muted);
	}
	.ins-meta :global(.tag-info) {
		color: var(--ink);
	}
	.ins-link {
		font-size: 12px;
		font-weight: 500;
		color: var(--muted);
		text-decoration: underline;
	}
	.ins-link:hover {
		color: var(--ink);
	}
	.ins-facts {
		margin: 2px 0 0;
		font-size: 13px;
		color: var(--muted);
	}
</style>
