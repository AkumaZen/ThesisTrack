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
		<div class="sub">
			Trades by promoters, directors and other insiders (SEBI PIT) and substantial acquisitions or sales
			(SAST Regulation 29), as disclosed to NSE. Search a shareholder's name to follow one person across companies.
		</div>
	</div>
</div>

<div class="wrap mi">
	<div class="mi-tabs" role="group" aria-label="Disclosure type">
		<a class="mi-chip" href={tabHref(null)} aria-current={data.tab === 'pit' ? 'true' : undefined}>Insider trades</a>
		<a class="mi-chip" href={tabHref('sast')} aria-current={data.tab === 'sast' ? 'true' : undefined}>Substantial acquisitions (SAST)</a>
	</div>

	<form class="mi-box" method="get" action="/valuation/insider-trades" aria-labelledby="mi-filter">
		<h2 id="mi-filter">Filter</h2>
		{#if data.tab === 'sast'}<input type="hidden" name="tab" value="sast" />{/if}
		<div class="mi-form">
			<label class="mi-field">Company or ticker<input class="sm-input" name="company" value={f.company} maxlength="60" autocomplete="off" /></label>
			<label class="mi-field">Shareholder name<input class="sm-input" name="person" value={f.person} maxlength="60" autocomplete="off" placeholder="e.g. Jhunjhunwala" /></label>
			<label class="mi-field">
				Person category
				<select name="category">
					<option value="">All</option>
					{#each PERSON_CATEGORIES as c (c)}
						<option value={c} selected={f.category === c}>{c}</option>
					{/each}
				</select>
			</label>
			<label class="mi-field">
				Buy or sell
				<select name="side">
					<option value="">All</option>
					<option value="buy" selected={f.side === 'buy'}>Buy / acquisition</option>
					<option value="sell" selected={f.side === 'sell'}>Sell / disposal</option>
					{#if data.tab === 'pit'}<option value="pledge" selected={f.side === 'pledge'}>Pledge</option>{/if}
				</select>
			</label>
			{#if data.tab === 'pit'}
				<label class="mi-field">Minimum value (Rs lakh)<input class="sm-input" type="number" min="0" step="any" inputmode="decimal" name="minLakh" value={f.minValue ? f.minValue / 100_000 : ''} /></label>
			{/if}
			<label class="mi-field">From<input class="sm-input" type="date" name="from" value={f.from ?? ''} /></label>
			<label class="mi-field">To<input class="sm-input" type="date" name="to" value={f.to ?? ''} /></label>
		</div>
		<div class="mi-row">
			<button class="sm-btn sm-btn-primary" type="submit">Apply filters</button>
			<a class="sm-btn mi-link" href={data.tab === 'sast' ? '/valuation/insider-trades?tab=sast' : '/valuation/insider-trades'}>Clear</a>
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
					<div class="mi-meta">
						<span>{when(t.broadcastAt)}</span>
						<span class="mi-tag">{t.personCategory}</span>
						<span class={side === 'buy' ? 'mi-side-buy' : side === 'sell' ? 'mi-side-sell' : ''}>{t.txnType}</span>
					</div>
					<div class="mi-title">
						<a href="/valuation/company/{encodeURIComponent(t.nseSymbol)}">{t.nseSymbol}</a>
						<span class="mi-muted"> {t.companyName}</span>
					</div>
					<div class="mi-title">{t.personName}</div>
					<dl class="mi-facts">
						<div><dt>Shares</dt><dd>{qty(t.quantity)}</dd></div>
						<div><dt>Value</dt><dd>{rupees(t.value)}</dd></div>
						<div><dt>Holding before</dt><dd>{pct(t.beforePct)}</dd></div>
						<div><dt>Holding after</dt><dd>{pct(t.afterPct)}</dd></div>
						<div><dt>Mode</dt><dd>{t.mode || 'n/a'}</dd></div>
					</dl>
					{#if t.sourceUrl}<a class="mi-link" href={t.sourceUrl} target="_blank" rel="noopener noreferrer">Open filing</a>{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<ul class="mi-list" data-testid="sast-list">
			{#each sast as s (s.id)}
				<li class="mi-item">
					<div class="mi-meta">
						<span>{when(s.disclosedAt)}</span>
						<span class="mi-tag" class:mi-tag-hi={s.isPromoter}>{s.isPromoter ? 'Promoter' : 'Acquirer'}</span>
						<span class={s.action.toLowerCase().startsWith('acq') ? 'mi-side-buy' : 'mi-side-sell'}>{s.action}</span>
					</div>
					<div class="mi-title">
						<a href="/valuation/company/{encodeURIComponent(s.nseSymbol)}">{s.nseSymbol}</a>
						<span class="mi-muted"> {s.companyName}</span>
					</div>
					<div class="mi-title">{s.acquirerName}</div>
					<dl class="mi-facts">
						<div><dt>Shares acquired</dt><dd>{qty(s.sharesAcquired)}</dd></div>
						<div><dt>Shares sold</dt><dd>{qty(s.sharesSold)}</dd></div>
						<div><dt>Change</dt><dd>{pct(s.pctAcquired ?? s.pctSold)}</dd></div>
						<div><dt>Holding after</dt><dd>{pct(s.pctAfter)}</dd></div>
						<div><dt>Mode</dt><dd>{s.mode || 'n/a'}</dd></div>
					</dl>
					<p class="mi-text mi-muted">{s.regulation}{s.periodText ? `, ${s.periodText}` : ''}</p>
					{#if s.sourceUrl}<a class="mi-link" href={s.sourceUrl} target="_blank" rel="noopener noreferrer">Open filing</a>{/if}
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
