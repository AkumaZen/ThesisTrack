<script lang="ts">
	import '$lib/valuation/styles/marketIntel.css';
	import { ACTION_LABELS, actionSummary, type ActionKind, type DividendStats } from '$lib/valuation/corporateActions';
	import type { HoldingEvent } from '$lib/valuation/insiderTrades';

	// Self-contained: give it an NSE symbol and it loads the company's corporate actions, dividend
	// history ratios and insider/SAST holding-change history from /api/valuation/company-filings.
	// Mount it anywhere inside the .vd shell (the company page, a card, a drawer).
	let { symbol }: { symbol: string } = $props();

	interface ActionItem {
		id: number;
		kind: string;
		subject: string;
		amount: number | null;
		ratio: string | null;
		exDate: string;
		recordDate: string | null;
		upcoming: boolean;
	}
	interface Payload {
		stale: boolean;
		price: number | null;
		actions: ActionItem[];
		dividends: DividendStats;
		holdings: HoldingEvent[];
	}

	let payload = $state<Payload | null>(null);
	let loading = $state(true);
	let failed = $state(false);

	let token = 0;
	$effect(() => {
		const current = symbol;
		const mine = ++token;
		loading = true;
		failed = false;
		payload = null;
		fetch(`/api/valuation/company-filings/${encodeURIComponent(current)}`)
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
			.then((body: Payload) => {
				if (mine === token) payload = body;
			})
			.catch(() => {
				if (mine === token) failed = true;
			})
			.finally(() => {
				if (mine === token) loading = false;
			});
	});

	const upcoming = $derived(payload?.actions.filter((a) => a.upcoming).reverse() ?? []);
	const past = $derived(payload?.actions.filter((a) => !a.upcoming).slice(0, 12) ?? []);
	const signed = (n: number) => (n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2));
	const qty = (n: number) => Math.abs(n).toLocaleString('en-IN');
	const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
</script>

<div class="mi" data-testid="company-filings">
	{#if loading}
		<p class="sm-hint">Loading corporate actions and holding changes...</p>
	{:else if failed || !payload}
		<p class="sm-hint">Could not load corporate actions and holding changes. Try again in a moment.</p>
	{:else}
		{#if payload.stale}
			<p class="sm-hint">NSE did not respond, so this may not include the latest filings.</p>
		{/if}

		<details class="mi-details" open data-testid="corporate-actions">
			<summary>Corporate actions and dividends</summary>
			{#if payload.dividends.last || payload.dividends.ttmPerShare > 0}
				<dl class="mi-facts">
					<div><dt>Dividend, last 12 months</dt><dd>Rs {payload.dividends.ttmPerShare} per share</dd></div>
					<div><dt>Yield on stored price</dt><dd>{payload.dividends.yieldPct == null ? 'n/a' : `${payload.dividends.yieldPct}%`}</dd></div>
					{#if payload.dividends.last}
						<div><dt>Last ex-date</dt><dd>{payload.dividends.last.exDate} (Rs {payload.dividends.last.amount})</dd></div>
					{/if}
				</dl>
			{/if}
			{#if payload.dividends.years.length}
				<div class="mi-table-wrap">
					<table class="mi-table">
						<caption class="sm-hint" style="text-align: left;">Dividend per share by financial year{payload.dividends.years.some((y) => y.payoutPct != null) ? ', payout on Screener EPS' : ''}</caption>
						<thead><tr><th scope="col">Year</th><th scope="col">Dividend (Rs)</th><th scope="col">EPS (Rs)</th><th scope="col">Payout</th></tr></thead>
						<tbody>
							{#each payload.dividends.years as y (y.fy)}
								<tr><th scope="row">{y.fy}</th><td>{y.perShare}</td><td>{y.eps ?? 'n/a'}</td><td>{y.payoutPct == null ? 'n/a' : `${y.payoutPct}%`}</td></tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			{#if upcoming.length}
				<h3 class="mi-sub">Upcoming</h3>
				<ul class="mi-list">
					{#each upcoming as a (a.id)}
						<li class="mi-item">
							<div class="mi-meta"><span class="tag tag-info">{ACTION_LABELS[a.kind as ActionKind] ?? a.kind}</span><span>Ex-date {a.exDate}</span>{#if a.recordDate}<span>Record {a.recordDate}</span>{/if}</div>
							<p class="mi-text">{actionSummary(a)}</p>
						</li>
					{/each}
				</ul>
			{/if}
			{#if past.length}
				<h3 class="mi-sub">Recent</h3>
				<ul class="mi-list">
					{#each past as a (a.id)}
						<li class="mi-item">
							<div class="mi-meta"><span class="tag">{ACTION_LABELS[a.kind as ActionKind] ?? a.kind}</span><span>Ex-date {a.exDate}</span>{#if a.recordDate}<span>Record {a.recordDate}</span>{/if}</div>
							<p class="mi-text">{actionSummary(a)}</p>
						</li>
					{/each}
				</ul>
			{/if}
			{#if !upcoming.length && !past.length}
				<p class="sm-hint">NSE lists no dividends, splits, bonus issues, rights or buybacks for this company.</p>
			{/if}
		</details>

		<details class="mi-details" open data-testid="holding-history">
			<summary>Holding changes (insider trades and SAST)</summary>
			{#if payload.holdings.length}
				<ul class="mi-list">
					{#each payload.holdings as e, n (e.at + e.person + n)}
						<li class="mi-item">
							<div class="mi-meta">
								<span>{day(e.at)}</span>
								<span class="tag">{e.source}</span>
								<span class="tag {e.category === 'Promoters' ? 'tag-info' : ''}">{e.category}</span>
							</div>
							<div class="mi-title">{e.person}</div>
							<p class="mi-text">
								<span class={e.shares != null && e.shares > 0 ? 'mi-side-buy' : e.shares != null && e.shares < 0 ? 'mi-side-sell' : ''}>{e.action}</span>
								{#if e.shares != null}{qty(e.shares)} shares{/if}
								{#if e.changePp != null}, {signed(e.changePp)} pts{/if}
								{#if e.afterPct != null}, holding now {e.afterPct.toFixed(2)}%{/if}
							</p>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="sm-hint">No insider trades or substantial acquisitions are on file for this company.</p>
			{/if}
		</details>
	{/if}
</div>
