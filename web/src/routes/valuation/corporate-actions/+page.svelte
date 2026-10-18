<script lang="ts">
	import '$lib/valuation/styles/marketIntel.css';
	import { formatMeetingDay } from '$lib/valuation/boardMeetings';
	import { ACTION_LABELS, actionSummary, type ActionKind } from '$lib/valuation/corporateActions';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const kinds = Object.keys(ACTION_LABELS) as ActionKind[];
	const href = (kind: string | null, page = 1) => {
		const p = new URLSearchParams();
		if (kind) p.set('kind', kind);
		if (page > 1) p.set('page', String(page));
		const q = p.toString();
		return `/valuation/corporate-actions${q ? `?${q}` : ''}`;
	};

	// Grouped by ex-date, in the order the server sent them (soonest first).
	const groups = $derived.by(() => {
		const out: { exDate: string; rows: PageData['items'] }[] = [];
		for (const row of data.items) {
			const last = out[out.length - 1];
			if (last && last.exDate === row.exDate) last.rows.push(row);
			else out.push({ exDate: row.exDate, rows: [row] });
		}
		return out;
	});
</script>

<svelte:head>
	<title>Upcoming ex-dates - ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Upcoming ex-dates</h1>
		<div class="sub">
			Dividends, splits, bonus issues, rights issues and buybacks going ex from today ({formatMeetingDay(data.today)}), from NSE.
			A company's own dividend history is on its company page.
		</div>
	</div>
</div>

<div class="wrap mi">
	<ul class="mi-chips" aria-label="Type of action">
		<li><a class="mi-chip" href={href(null)} aria-current={data.kind === null ? 'true' : undefined}>All</a></li>
		{#each kinds as k (k)}
			<li><a class="mi-chip" href={href(k)} aria-current={data.kind === k ? 'true' : undefined}>{ACTION_LABELS[k]}</a></li>
		{/each}
	</ul>

	{#if groups.length === 0}
		<p class="sm-empty" data-testid="actions-empty">No upcoming corporate actions of this type are stored yet.</p>
	{:else}
		<div class="mi-list" data-testid="actions">
			{#each groups as g (g.exDate)}
				<section class="mi-box" aria-label="Ex-date {g.exDate}">
					<h2 class="mi-h">{formatMeetingDay(g.exDate)}</h2>
					<ul class="mi-list">
						{#each g.rows as a (a.id)}
							<li class="mi-item">
								<div class="mi-meta">
									<span class="mi-tag" class:mi-tag-hi={a.kind !== 'other'}>{ACTION_LABELS[a.kind as ActionKind] ?? a.kind}</span>
									{#if a.recordDate}<span>Record date {a.recordDate}</span>{/if}
								</div>
								<div class="mi-title">
									<a href="/valuation/company/{encodeURIComponent(a.nseSymbol)}">{a.nseSymbol}</a>
									<span class="mi-muted"> {a.companyName}</span>
								</div>
								<p class="mi-text">
									{actionSummary(a)}{a.yieldPct != null ? ` (${a.yieldPct}% of the stored price)` : ''}
								</p>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}

	{#if data.page > 1 || data.hasMore}
		<nav class="mi-pager" aria-label="Pages">
			{#if data.page > 1}<a href={href(data.kind, data.page - 1)} rel="prev">Earlier</a>{:else}<span></span>{/if}
			{#if data.hasMore}<a href={href(data.kind, data.page + 1)} rel="next">Later</a>{/if}
		</nav>
	{/if}
</div>
