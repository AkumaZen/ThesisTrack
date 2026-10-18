<script lang="ts">
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import BatchLoadPanel from '$lib/valuation/components/BatchLoadPanel.svelte';
	import { FINANCIALS_BATCH_SIZE } from '$lib/valuation/financialsLoad';
	import {
		filterResults,
		quarterOptions,
		sortResults,
		type ResultsSortKey
	} from '$lib/valuation/quarterlyResults';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let query = $state('');
	let industry = $state('');
	let basket = $state('');
	let list = $state('');
	let quarter = $state('');
	let sort = $state<{ key: ResultsSortKey; dir: 1 | -1 }>({ key: 'quarter', dir: -1 });

	const canLoad = $derived(Boolean(data.user?.role && data.user.role !== 'read_only'));
	const quarters = $derived(quarterOptions(data.rows));
	const listSymbols = $derived(
		list ? new Set(data.lists.find((l) => l.key === list)?.symbols ?? []) : null
	);
	const filtered = $derived(filterResults(data.rows, { query, industry, basket, symbols: listSymbols, quarter }));
	const rows = $derived(sortResults(filtered, sort.key, sort.dir));

	const STEP = 100;
	let visible = $state(STEP);
	const filterKey = $derived(JSON.stringify([query, industry, basket, list, quarter, sort]));
	$effect(() => {
		void filterKey;
		untrack(() => (visible = STEP));
	});
	const shown = $derived(rows.slice(0, visible));

	const COLUMNS: { key: ResultsSortKey; label: string; title: string; text?: boolean }[] = [
		{ key: 'name', label: 'Company', title: '', text: true },
		{ key: 'quarter', label: 'Quarter', title: 'Latest reported quarter', text: true },
		{ key: 'sales', label: 'Revenue', title: 'Revenue of the quarter, Rs crore' },
		{ key: 'salesYoY', label: 'Rev YoY', title: 'Revenue vs the same quarter a year earlier' },
		{ key: 'salesQoQ', label: 'Rev QoQ', title: 'Revenue vs the quarter before' },
		{ key: 'netProfit', label: 'PAT', title: 'Net profit of the quarter, Rs crore' },
		{ key: 'profitYoY', label: 'PAT YoY', title: 'Net profit vs the same quarter a year earlier' },
		{ key: 'profitQoQ', label: 'PAT QoQ', title: 'Net profit vs the quarter before' },
		{ key: 'opm', label: 'EBITDA %', title: 'Operating profit margin of the quarter' },
		{ key: 'opmYoYPp', label: 'Margin YoY', title: 'Change in operating margin vs a year earlier, percentage points' },
		{ key: 'opmQoQPp', label: 'Margin QoQ', title: 'Change in operating margin vs the quarter before, percentage points' }
	];

	function sortBy(key: ResultsSortKey) {
		sort = sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' ? 1 : -1 };
	}

	const fmt = (n: number | null, d = 1) =>
		n == null ? '-' : n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
	const signed = (n: number | null, suffix: string) => (n == null ? '-' : `${n > 0 ? '+' : ''}${fmt(n)}${suffix}`);
	const tone = (n: number | null) => (n == null || n === 0 ? '' : n > 0 ? 'res-up' : 'res-down');
</script>

<svelte:head>
	<title>Quarterly results · ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Quarterly results</h1>
		<div class="sub">
			The latest reported quarter of every company with stored Screener results, against the same
			quarter a year earlier (YoY) and the quarter before (QoQ). EBITDA % is the operating margin;
			margin changes are in percentage points. A blank means the comparison quarter is not stored or
			its base is zero or negative.
		</div>
	</div>
</div>

<div class="wrap wrap-wide res-page">
	{#if canLoad}
		<BatchLoadPanel
			label="Load missing financials"
			noun="financial statements"
			missingUrl="/api/valuation/financials/missing"
			batchUrl="/api/valuation/financials/batch"
			batchSize={FINANCIALS_BATCH_SIZE}
			missing={data.missing}
			testId="load-financials"
			onFinished={() => invalidateAll()}
		/>
	{:else if data.missing > 0}
		<p class="scan-note">{data.missing} scanner companies have no stored results yet. An editor can load them.</p>
	{/if}

	<div class="scan-toolbar no-print">
		<label>
			<span class="sr-only">Search companies</span>
			<input class="sm-input" type="search" placeholder="Search company or ticker" bind:value={query} data-testid="res-search" />
		</label>
		<label>
			<span class="sr-only">Industry</span>
			<select class="sm-input" bind:value={industry} data-testid="res-industry">
				<option value="">All industries</option>
				{#each data.industries as i (i)}<option value={i}>{i}</option>{/each}
			</select>
		</label>
		<label>
			<span class="sr-only">Sector basket</span>
			<select class="sm-input" bind:value={basket} data-testid="res-basket">
				<option value="">All sector baskets</option>
				{#each data.baskets as b (b)}<option value={b}>{b}</option>{/each}
			</select>
		</label>
		<label>
			<span class="sr-only">Watchlist</span>
			<select class="sm-input" bind:value={list} data-testid="res-list">
				<option value="">All companies</option>
				{#each data.lists as l (l.key)}<option value={l.key}>{l.name} ({l.symbols.length})</option>{/each}
			</select>
		</label>
		<label>
			<span class="sr-only">Quarter</span>
			<select class="sm-input" bind:value={quarter} data-testid="res-quarter">
				<option value="">Any quarter</option>
				{#each quarters as q (q.label)}<option value={q.label}>{q.label} ({q.count})</option>{/each}
			</select>
		</label>
		<span class="hint" aria-live="polite" data-testid="res-count">{rows.length} of {data.rows.length} companies</span>
	</div>

	<div class="table-scroll">
		<table class="res-table" data-testid="res-table">
			<thead>
				<tr>
					{#each COLUMNS as c (c.key)}
						<th
							class:text={c.text}
							aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
						>
							<button type="button" class="th-sort" title={c.title} onclick={() => sortBy(c.key)}
								>{c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button
							>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each shown as r (r.symbol)}
					<tr data-testid="res-row">
						<td class="res-name">
							<a href={resolve('/valuation/company/[symbol]', { symbol: r.symbol })}>{r.name}</a>
							<span class="scan-sub">{r.symbol} · {r.industry ?? r.sector ?? 'Unclassified'}</span>
						</td>
						<td class="text">{r.quarter}</td>
						<td class="num">{fmt(r.sales, 0)}</td>
						<td class="num {tone(r.salesYoY)}">{signed(r.salesYoY, '%')}</td>
						<td class="num {tone(r.salesQoQ)}">{signed(r.salesQoQ, '%')}</td>
						<td class="num">{fmt(r.netProfit, 0)}</td>
						<td class="num {tone(r.profitYoY)}">{signed(r.profitYoY, '%')}</td>
						<td class="num {tone(r.profitQoQ)}">{signed(r.profitQoQ, '%')}</td>
						<td class="num">{r.opm == null ? '-' : `${fmt(r.opm)}%`}</td>
						<td class="num {tone(r.opmYoYPp)}">{signed(r.opmYoYPp, ' pp')}</td>
						<td class="num {tone(r.opmQoQPp)}">{signed(r.opmQoQPp, ' pp')}</td>
					</tr>
				{:else}
					<tr>
						<td colspan={COLUMNS.length} class="muted scan-empty" data-testid="res-empty">
							{data.rows.length === 0
								? 'No quarterly results are stored yet. Load the missing financials above, or open a company.'
								: 'No companies match these filters.'}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if rows.length > shown.length}
		<p class="scan-more no-print">
			<button type="button" class="wl-strip-btn" onclick={() => (visible += STEP)}
				>Show {Math.min(STEP, rows.length - shown.length)} more</button
			>
			<span class="hint">{shown.length} of {rows.length} shown</span>
		</p>
	{/if}
</div>
