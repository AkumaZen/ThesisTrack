<script lang="ts">
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import type { Stage, StageScanResult } from '$lib/valuation/stageScan';
	import { downloadWorkbook, FORMATS, todayStamp } from '$lib/valuation/exportXlsx';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Results keyed by symbol. Cached ones arrive with the page; the rest are fetched one at a
	// time below. Filtering and sorting only ever read this object - they never refetch.
	const initialResults: Record<string, StageScanResult | null> = untrack(() => ({
		...data.cached
	}));
	let results = $state(initialResults);
	let failed = $state<Record<string, string>>({});
	const noHistory = $derived(Object.values(results).filter((r) => r === null).length);
	const pending = $derived(data.symbols.filter((s) => !(s in results) && !(s in failed)));

	$effect(() => {
		let cancelled = false;
		(async () => {
			for (const symbol of data.symbols) {
				if (cancelled) return;
				if (symbol in results) continue;
				try {
					const res = await fetch(`/api/valuation/stage-scan/${encodeURIComponent(symbol)}`);
					if (res.ok) results[symbol] = (await res.json()) as StageScanResult;
					else if (res.status === 404) results[symbol] = null;
					else failed[symbol] = `HTTP ${res.status}`;
				} catch {
					failed[symbol] = 'network error';
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	const STAGES: { id: Stage; short: string; tone: string }[] = [
		{ id: 'Confirmed Stage 2 Breakout', short: 'Breakout', tone: 'good' },
		{ id: 'Near Stage 2 Breakout', short: 'Near breakout', tone: 'watch' },
		{ id: 'Stage 2 Advancing', short: 'Stage 2', tone: 'good-soft' },
		{ id: 'Stage 1 Base', short: 'Stage 1 base', tone: 'neutral' },
		{ id: 'Stage 3', short: 'Stage 3', tone: 'warn' },
		{ id: 'Stage 4', short: 'Stage 4', tone: 'bad' },
		{ id: 'Not classified / insufficient data', short: 'Unclassified', tone: 'neutral' }
	];
	const stageInfo = (s: Stage) => STAGES.find((x) => x.id === s)!;

	let stageFilter = $state<Stage | 'all'>('Near Stage 2 Breakout');
	let basketFilter = $state('');
	let query = $state('');

	type SortKey = 'name' | 'stage' | 'price' | 'distance' | 'base' | 'volume' | 'rs' | 'breakout';
	let sort = $state<{ key: SortKey; dir: 1 | -1 }>({ key: 'distance', dir: 1 });

	const baskets = $derived(
		[...new Set(Object.values(data.basketsBySymbol).flat())].sort((a, b) => a.localeCompare(b))
	);
	const nameOf = (s: string) => data.names[s] ?? s;

	const loaded = $derived(
		data.symbols
			.map((symbol) => ({ symbol, r: results[symbol] }))
			.filter((x): x is { symbol: string; r: StageScanResult } => x.r != null)
	);
	const counts = $derived(
		Object.fromEntries(STAGES.map((s) => [s.id, loaded.filter((x) => x.r.stage === s.id).length]))
	);

	function sortValue(x: { symbol: string; r: StageScanResult }, key: SortKey) {
		switch (key) {
			case 'name':
				return nameOf(x.symbol);
			case 'stage':
				return STAGES.findIndex((s) => s.id === x.r.stage);
			case 'price':
				return x.r.effectivePrice;
			case 'distance':
				return x.r.distanceToBreakoutPct;
			case 'base':
				return x.r.base?.durationDays ?? null;
			case 'volume':
				return x.r.volumeRatio;
			case 'rs':
				return x.r.mansfieldRS;
			case 'breakout':
				return x.r.breakout?.date ?? null;
		}
	}

	const rows = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const out = loaded.filter(
			(x) =>
				(stageFilter === 'all' || x.r.stage === stageFilter) &&
				(!basketFilter || data.basketsBySymbol[x.symbol]?.includes(basketFilter)) &&
				(!q || x.symbol.toLowerCase().includes(q) || nameOf(x.symbol).toLowerCase().includes(q))
		);
		return out.sort((a, b) => {
			const va = sortValue(a, sort.key);
			const vb = sortValue(b, sort.key);
			// Blanks always last, whichever way the column is sorted.
			if (va == null && vb == null) return 0;
			if (va == null) return 1;
			if (vb == null) return -1;
			const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
			return c * sort.dir;
		});
	});

	function sortBy(key: SortKey) {
		sort =
			sort.key === key
				? { key, dir: sort.dir === 1 ? -1 : 1 }
				: { key, dir: key === 'name' || key === 'distance' || key === 'stage' ? 1 : -1 };
	}

	const COLUMNS: { key: SortKey; label: string; title: string }[] = [
		{ key: 'name', label: 'Company', title: '' },
		{ key: 'stage', label: 'Stage', title: 'Weinstein stage from daily closes' },
		{ key: 'price', label: 'Price', title: 'Live price in market hours, else the last close' },
		{
			key: 'distance',
			label: 'To breakout',
			title: 'How far price is below base resistance (negative = above it)'
		},
		{ key: 'base', label: 'Base', title: 'Base length in trading days' },
		{ key: 'volume', label: 'Volume', title: 'Last close volume vs the 20-day average' },
		{
			key: 'rs',
			label: 'Mansfield RS',
			title: 'Relative strength vs NIFTY 500 against its own 200-day average'
		},
		{ key: 'breakout', label: 'Last breakout', title: 'Most recent confirmed breakout close' }
	];

	let exporting = $state(false);
	/** The rows as filtered and sorted on screen. */
	async function exportExcel() {
		exporting = true;
		try {
			await downloadWorkbook(`breakout-scanner-${todayStamp()}`, [
				{
					name: 'Breakout scanner',
					notes: [
						`Stage 2 breakout scanner, exported ${new Date().toLocaleString('en-IN')}.`,
						`Filter: ${stageFilter === 'all' ? 'all stages' : stageFilter}${basketFilter ? `, ${basketFilter}` : ''}${query.trim() ? `, search "${query.trim()}"` : ''}.`
					],
					columns: [
						{ header: 'Company', width: 34 },
						{ header: 'Ticker', width: 14 },
						{ header: 'Stage', width: 26 },
						{ header: 'Price', format: FORMATS.price },
						{ header: '50-DMA', format: FORMATS.price },
						{ header: '200-DMA', format: FORMATS.price },
						{ header: 'Resistance', format: FORMATS.price },
						{ header: 'Support', format: FORMATS.price },
						{ header: 'To breakout %', format: '0.0', width: 14 },
						{ header: 'Base days', format: FORMATS.int },
						{ header: 'Volume vs 20D', format: FORMATS.ratio, width: 14 },
						{ header: 'Volume building', width: 15 },
						{ header: 'Mansfield RS', format: '0.0', width: 13 },
						{ header: 'RS trend' },
						{ header: 'Last breakout', width: 14 },
						{ header: 'Sector basket', width: 34 }
					],
					rows: rows.map(({ symbol, r }) => [
						nameOf(symbol),
						symbol,
						r.stage,
						r.effectivePrice,
						r.sma50,
						r.sma200,
						r.base?.resistance,
						r.base?.support,
						r.distanceToBreakoutPct,
						r.base?.durationDays,
						r.volumeRatio,
						r.volumeSurgeWarning ? 'Yes' : '',
						r.mansfieldRS,
						r.mansfieldRSTrend,
						r.breakout?.date.slice(0, 10),
						data.basketsBySymbol[symbol]?.join('; ')
					])
				}
			]);
		} finally {
			exporting = false;
		}
	}

	const fmt = (n: number | null | undefined, d = 1) =>
		n == null
			? '-'
			: n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
	const signed = (n: number | null | undefined) =>
		n == null ? '-' : `${n > 0 ? '+' : ''}${fmt(n)}`;
	const trendArrow = (t: string | null) => (t === 'rising' ? '↑' : t === 'falling' ? '↓' : '');
</script>

<svelte:head>
	<title>Breakout scanner · ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Stage 2 breakout scanner</h1>
		<div class="sub">
			Every stock in the sector baskets, classified by Weinstein stage from daily closes. A breakout
			only counts once a day closes above the base on heavy volume; live prices never confirm one on
			their own. Thresholds are on the <a href={resolve('/valuation/settings')}>Settings</a> page.
		</div>
	</div>
</div>

<div class="wrap wrap-wide scanner-page">
	<div class="scan-chips no-print" role="group" aria-label="Filter by stage">
		<button
			type="button"
			class="al-chip"
			class:al-chip-on={stageFilter === 'all'}
			aria-pressed={stageFilter === 'all'}
			onclick={() => (stageFilter = 'all')}>All <span>{loaded.length}</span></button
		>
		{#each STAGES as s (s.id)}
			<button
				type="button"
				class="al-chip"
				class:al-chip-on={stageFilter === s.id}
				aria-pressed={stageFilter === s.id}
				data-testid="stage-chip"
				onclick={() => (stageFilter = s.id)}>{s.short} <span>{counts[s.id]}</span></button
			>
		{/each}
	</div>

	<div class="scan-toolbar no-print">
		<label>
			<span class="sr-only">Search companies</span>
			<input
				class="sm-input"
				type="search"
				placeholder="Search company or ticker"
				bind:value={query}
			/>
		</label>
		<label>
			<span class="sr-only">Sector basket</span>
			<select class="sm-input" bind:value={basketFilter}>
				<option value="">All sector baskets</option>
				{#each baskets as b (b)}<option value={b}>{b}</option>{/each}
			</select>
		</label>
		<button
			class="wl-strip-btn"
			type="button"
			data-testid="export-excel"
			disabled={exporting || rows.length === 0}
			onclick={exportExcel}>{exporting ? 'Exporting…' : 'Excel'}</button
		>
		<span class="hint" aria-live="polite" data-testid="scan-progress">
			{#if pending.length > 0}
				Scanning… {data.symbols.length - pending.length} of {data.symbols.length} done
			{:else}
				{loaded.length} of {data.symbols.length} stocks scanned{noHistory
					? `; ${noHistory} have no price history`
					: ''}{Object.keys(failed).length
					? `; ${Object.keys(failed).length} failed (reload to retry)`
					: ''}
			{/if}
		</span>
	</div>

	<div class="table-scroll">
		<table class="scan-table" data-testid="scan-table">
			<thead>
				<tr>
					{#each COLUMNS as c (c.key)}
						<th
							aria-sort={sort.key === c.key
								? sort.dir === 1
									? 'ascending'
									: 'descending'
								: undefined}
							class:num={c.key !== 'name' && c.key !== 'stage' && c.key !== 'breakout'}
						>
							<button type="button" class="th-sort" title={c.title} onclick={() => sortBy(c.key)}
								>{c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</button
							>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each rows as { symbol, r } (symbol)}
					<tr data-testid="scan-row">
						<td>
							<a href={resolve('/valuation/company/[symbol]', { symbol })}>{nameOf(symbol)}</a>
							<span class="scan-sub">{symbol} · {data.basketsBySymbol[symbol]?.[0] ?? ''}</span>
						</td>
						<td>
							<span class="scan-stage scan-{stageInfo(r.stage).tone}"
								>{stageInfo(r.stage).short}</span
							>
							{#if r.intradayAboveResistance && r.stage !== 'Confirmed Stage 2 Breakout'}
								<span class="scan-sub">Above resistance today, awaiting close</span>
							{/if}
							{#if r.volumeSurgeWarning}<span class="scan-sub scan-surge">Volume building</span
								>{/if}
						</td>
						<td class="num">{fmt(r.effectivePrice, 2)}</td>
						<td class="num"
							>{r.distanceToBreakoutPct == null ? '-' : `${fmt(r.distanceToBreakoutPct)}%`}</td
						>
						<td class="num">{r.base ? `${r.base.durationDays}d` : '-'}</td>
						<td class="num" title={r.volumeTier}
							>{r.volumeRatio == null ? '-' : `${fmt(r.volumeRatio)}x`}</td
						>
						<td class="num">{signed(r.mansfieldRS)} {trendArrow(r.mansfieldRSTrend)}</td>
						<td
							>{r.breakout
								? `${r.breakout.date.slice(0, 10)} (${r.breakout.ageDays}d ago)`
								: '-'}</td
						>
					</tr>
				{:else}
					<tr>
						<td colspan={COLUMNS.length} class="muted scan-empty" data-testid="scan-empty">
							{pending.length > 0
								? 'Nothing matches yet - more stocks are still being scanned.'
								: 'No stocks match these filters.'}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
