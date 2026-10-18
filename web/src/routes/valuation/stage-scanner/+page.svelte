<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { untrack } from 'svelte';
	import type { Stage, StageScanResult } from '$lib/valuation/stageScan';
	import { downloadWorkbook, FORMATS, todayStamp } from '$lib/valuation/exportXlsx';
	import ViewResetButton from '$lib/valuation/components/ViewResetButton.svelte';
	import LoadHistoryPanel from '$lib/valuation/components/LoadHistoryPanel.svelte';
	import { trackView, type ViewTracker } from '$lib/viewMemory.svelte';
	import type { SCANNER_STAGE_KEYS, SCANNER_MCAP_KEYS, SCANNER_SIGNAL_KEYS } from '$lib/viewMemory';
	import { MCAP_BANDS, formatCr, mcapBand, mcapPeriodLabel } from '$lib/valuation/mcapUniverse.js';
	import {
		SIGNALS,
		matchesFilters,
		sectorOptions,
		type ScanEntry,
		type ScanFilters
	} from '$lib/valuation/scannerFilters';
	import ChartGrid from '$lib/valuation/components/ChartGrid.svelte';
	import ViewToggle from '$lib/valuation/components/ViewToggle.svelte';
	import { changeVsPrev, type GridItem } from '$lib/valuation/chartGrid';
	import PresetBadges from '$lib/valuation/components/PresetBadges.svelte';
	import {
		PRESETS,
		matchedPresets,
		percentileRanks,
		presetDetail,
		rsBasis,
		type PresetId,
		type PresetInput
	} from '$lib/valuation/presetScans';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Results keyed by symbol. Cached ones arrive with the page; the rest are fetched in batches
	// below. Filtering and sorting only ever read this object - they never refetch.
	// Companies with no stored prices have nothing to scan (scans read stored prices only): they start
	// as "no price history" without a request, until Load missing history fetches them.
	const initialResults: Record<string, StageScanResult | null> = untrack(() => {
		const start: Record<string, StageScanResult | null> = { ...data.cached };
		for (const s of data.noSeries) if (!(s in start)) start[s] = null;
		return start;
	});
	let results = $state(initialResults);
	let failed = $state<Record<string, string>>({});
	const noHistory = $derived(Object.values(results).filter((r) => r === null).length);
	const pending = $derived(data.symbols.filter((s) => !(s in results) && !(s in failed)));

	// Missing scans are fetched 50 at a time (one Angel One quote request per batch for the live
	// overlay). If a batch request itself fails, its symbols are fetched one by one as before.
	const SCAN_BATCH = 50;

	async function scanOne(symbol: string) {
		try {
			const res = await fetch(`/api/valuation/stage-scan/${encodeURIComponent(symbol)}`);
			if (res.ok) results[symbol] = (await res.json()) as StageScanResult;
			else if (res.status === 404) results[symbol] = null;
			else failed[symbol] = `HTTP ${res.status}`;
		} catch {
			failed[symbol] = 'network error';
		}
	}

	async function scanBatch(symbols: string[]) {
		try {
			const res = await fetch(`/api/valuation/stage-scan-batch?symbols=${encodeURIComponent(symbols.join(','))}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const body = (await res.json()) as {
				results: { symbol: string; result: StageScanResult | null; error?: string }[];
			};
			for (const item of body.results) {
				if (item.error) failed[item.symbol] = item.error;
				else results[item.symbol] = item.result;
			}
		} catch {
			for (const symbol of symbols) await scanOne(symbol);
		}
	}

	// One scan pass at a time; a newer pass (or leaving the page) stops the older one. Reads are
	// untracked so the pass is not restarted by its own results.
	let scanRun = 0;
	async function scanMissing() {
		const run = ++scanRun;
		const missing = untrack(() => data.symbols.filter((s) => !(s in results)));
		for (let i = 0; i < missing.length; i += SCAN_BATCH) {
			if (run !== scanRun) return;
			await scanBatch(missing.slice(i, i + SCAN_BATCH));
		}
	}
	$effect(() => {
		void scanMissing();
		return () => {
			scanRun++;
		};
	});

	// Companies of the market cap list whose history was just loaded: scan them now.
	let loadedNow = $state<string[]>([]);
	const missingHistory = $derived(
		data.noSeries.filter((s) => s in data.mcapBySymbol && !loadedNow.includes(s)).length
	);
	function historyLoaded(symbols: string[]) {
		loadedNow = [...loadedNow, ...symbols];
		for (const s of symbols) {
			delete results[s];
			delete failed[s];
		}
		void scanMissing();
	}
	const canLoadHistory = $derived(Boolean(data.user?.role && data.user.role !== 'read_only'));

	type StageKey = Exclude<(typeof SCANNER_STAGE_KEYS)[number], 'all'>;
	const STAGES: { id: Stage; key: StageKey; short: string; tone: string }[] = [
		{ id: 'Confirmed Stage 2 Breakout', key: 'breakout', short: 'Breakout', tone: 'good' },
		{ id: 'Near Stage 2 Breakout', key: 'near', short: 'Near breakout', tone: 'watch' },
		{ id: 'Stage 2 Advancing', key: 'stage2', short: 'Stage 2', tone: 'good-soft' },
		{ id: 'Stage 1 Base', key: 'stage1', short: 'Stage 1 base', tone: 'neutral' },
		{ id: 'Stage 3', key: 'stage3', short: 'Stage 3', tone: 'warn' },
		{ id: 'Stage 4', key: 'stage4', short: 'Stage 4', tone: 'bad' },
		{ id: 'Not classified / insufficient data', key: 'unclassified', short: 'Unclassified', tone: 'neutral' }
	];
	const stageInfo = (s: Stage) => STAGES.find((x) => x.id === s)!;
	const stageOf = (key: StageKey | 'all'): Stage | 'all' =>
		key === 'all' ? 'all' : STAGES.find((s) => s.key === key)!.id;
	const keyOf = (stage: Stage | 'all'): StageKey | 'all' =>
		stage === 'all' ? 'all' : stageInfo(stage).key;

	type SortKey = 'name' | 'stage' | 'price' | 'distance' | 'base' | 'volume' | 'rs' | 'breakout' | 'mcap';
	type McapKey = (typeof SCANNER_MCAP_KEYS)[number];
	type SignalKey = (typeof SCANNER_SIGNAL_KEYS)[number];

	// Sector baskets, plus "Unclassified" for the market cap list's companies that sit in none.
	const sectors = $derived(
		sectorOptions(
			Object.values(data.basketsBySymbol).flat(),
			data.symbols.some((s) => !data.basketsBySymbol[s]?.length)
		)
	);
	// A remembered sector that no longer exists means every sector.
	const knownBasket = (b: string) => (b && sectors.includes(b) ? b : '');
	const mcapNote = $derived(mcapPeriodLabel(data.mcapAsOf ?? ''));

	// Stage, sort and basket are remembered for this person, the search and scroll for this tab
	// (lib/viewMemory.ts); stage, sort and basket also show in the address, so a view can be shared.
	const memory: ViewTracker<'scanner'> = trackView({
		view: 'scanner',
		userId: () => data.user?.id,
		read: () => ({
			stage: keyOf(stageFilter),
			sort: sort.key,
			dir: sort.dir === 1 ? 'asc' : 'desc',
			basket: basketFilter,
			mcap: bandFilter,
			signal: signalFilter,
			query
		}),
		apply: (s) => {
			stageFilter = stageOf(s.stage);
			sort = { key: s.sort, dir: s.dir === 'asc' ? 1 : -1 };
			basketFilter = knownBasket(s.basket);
			bandFilter = s.mcap;
			signalFilter = s.signal;
			query = s.query;
		}
	});
	let stageFilter = $state<Stage | 'all'>(stageOf(memory.initial.stage));
	let basketFilter = $state(untrack(() => knownBasket(memory.initial.basket)));
	let bandFilter = $state<McapKey>(memory.initial.mcap);
	let signalFilter = $state<SignalKey>(memory.initial.signal);
	let query = $state(memory.initial.query);
	let sort = $state<{ key: SortKey; dir: 1 | -1 }>({
		key: memory.initial.sort,
		dir: memory.initial.dir === 'asc' ? 1 : -1
	});
	const nameOf = (s: string) => data.names[s] ?? s;

	const loaded = $derived(
		data.symbols
			.map((symbol) => ({ symbol, r: results[symbol] }))
			.filter((x): x is { symbol: string; r: StageScanResult } => x.r != null)
			.map(
				({ symbol, r }): ScanEntry => ({
					symbol,
					r,
					name: nameOf(symbol),
					baskets: data.basketsBySymbol[symbol] ?? [],
					mcapCr: data.mcapBySymbol[symbol] ?? null
				})
			)
	);
	const filters = $derived<ScanFilters>({
		stage: stageFilter,
		sector: basketFilter,
		band: bandFilter,
		signal: signalFilter,
		query
	});
	// The stage chips count within the other filters, so they show what each chip would give.
	const scoped = $derived(loaded.filter((x) => matchesFilters(x, { ...filters, stage: 'all' })));
	const counts = $derived(
		Object.fromEntries(STAGES.map((s) => [s.id, scoped.filter((x) => x.r.stage === s.id).length]))
	);

	function sortValue(x: ScanEntry, key: SortKey) {
		switch (key) {
			case 'mcap':
				return x.mcapCr;
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

	// Preset scans. The choice is kept in the address (?preset=near-high) so a scan can be shared.
	const presetFromUrl = page.url.searchParams.get('preset');
	let presetFilter = $state<PresetId | 'all'>(
		PRESETS.some((p) => p.id === presetFromUrl) ? (presetFromUrl as PresetId) : 'all'
	);
	function pickPreset(next: PresetId | 'all') {
		presetFilter = next;
		const url = new URL(page.url);
		if (next === 'all') url.searchParams.delete('preset');
		else url.searchParams.set('preset', next);
		replaceState(url, page.state);
	}
	// Without a stored Nifty 500, relative strength falls back to rank within the scanned universe.
	const rank3m = $derived(percentileRanks(new Map(loaded.map((x) => [x.symbol, x.r.presets?.ret3m ?? null]))));
	const rank6m = $derived(percentileRanks(new Map(loaded.map((x) => [x.symbol, x.r.presets?.ret6m ?? null]))));
	function presetInput(x: ScanEntry): PresetInput {
		const a = rank3m.get(x.symbol);
		const b = rank6m.get(x.symbol);
		return {
			stage: x.r.stage,
			metrics: x.r.presets,
			growth: data.growth[x.symbol] ?? null,
			universeRank: a != null && b != null ? { r3m: a, r6m: b } : null
		};
	}
	const matches = $derived(new Map(loaded.map((x) => [x.symbol, matchedPresets(presetInput(x))])));
	const inScope = $derived(loaded.filter((x) => matchesFilters(x, filters)));
	// Like the stage chips, the preset chips count within the search, sector, market cap and signal
	// filters but across EVERY stage, so a count does not shrink to the selected stage tab.
	const presetCounts = $derived(
		Object.fromEntries(
			PRESETS.map((p) => [p.id, scoped.filter((x) => matches.get(x.symbol)?.includes(p.id)).length])
		)
	);
	const growthCoverage = $derived(loaded.filter((x) => data.growth[x.symbol]).length);
	const usesUniverseRank = $derived(loaded.some((x) => rsBasis(x.r.presets) === 'universe'));
	const activePreset = $derived(PRESETS.find((p) => p.id === presetFilter) ?? null);

	// List or chart grid for the results.
	let layout = $state<'list' | 'grid'>('list');

	const rows = $derived.by(() => {
		const out = inScope.filter(
			(x) => presetFilter === 'all' || matches.get(x.symbol)?.includes(presetFilter)
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

	// ~1,700 rows would make every sort and filter re-render a very long table: show a page at a time.
	const ROWS_STEP = 100;
	let visible = $state(ROWS_STEP);
	const filterKey = $derived(JSON.stringify([filters, sort, presetFilter]));
	$effect(() => {
		void filterKey;
		untrack(() => (visible = ROWS_STEP));
	});
	const shown = $derived(rows.slice(0, visible));

	const gridItems = $derived<GridItem[]>(
		rows.map(({ symbol, r }) => ({
			symbol,
			name: nameOf(symbol),
			price: r.effectivePrice,
			changePct: changeVsPrev(r.effectivePrice, r.presets?.prevClose)
		}))
	);

	// Companies on the list that Angel One cannot price: listed apart, never fetched.
	const noPriceRows = $derived(
		data.noPriceSource.filter(
			(c) =>
				(bandFilter === 'all' || mcapBand(c.marketCapCr) === bandFilter) &&
				(!query.trim() || c.name.toLowerCase().includes(query.trim().toLowerCase()))
		)
	);

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
		{ key: 'breakout', label: 'Last breakout', title: 'Most recent confirmed breakout close' },
		{ key: 'mcap', label: 'Avg mcap', title: 'Six-month average market cap, Rs crore (AMFI), not a live figure' }
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
						`Filter: ${stageFilter === 'all' ? 'all stages' : stageFilter}${basketFilter ? `, ${basketFilter}` : ''}${bandFilter !== 'all' ? `, ${MCAP_BANDS.find((b) => b.key === bandFilter)?.label}` : ''}${signalFilter !== 'all' ? `, ${SIGNALS.find((x) => x.key === signalFilter)?.label}` : ''}${query.trim() ? `, search "${query.trim()}"` : ''}.`
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
						{ header: 'Sector basket', width: 34 },
						{ header: `${mcapNote} (Rs Cr)`, format: FORMATS.int, width: 20 }
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
						data.basketsBySymbol[symbol]?.join('; '),
						data.mcapBySymbol[symbol]
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
			Every stock in the sector baskets and the Rs 500 to 20,000 Cr market cap list, classified by
			Weinstein stage from daily closes. A breakout
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
			onclick={() => (stageFilter = 'all')}>All <span>{scoped.length}</span></button
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

	<div class="preset-chips no-print" role="group" aria-label="Preset scans" data-testid="preset-chips">
		<span class="preset-chips-label">Preset scan</span>
		<button
			type="button"
			class="al-chip"
			class:al-chip-on={presetFilter === 'all'}
			aria-pressed={presetFilter === 'all'}
			onclick={() => pickPreset('all')}>None</button
		>
		{#each PRESETS as p (p.id)}
			<button
				type="button"
				class="al-chip"
				class:al-chip-on={presetFilter === p.id}
				aria-pressed={presetFilter === p.id}
				title={p.description}
				data-testid="preset-chip"
				onclick={() => pickPreset(p.id)}>{p.label} <span>{presetCounts[p.id]}</span></button
			>
		{/each}
	</div>
	{#if activePreset}
		<p class="preset-note" data-testid="preset-note">
			{activePreset.description}
			{#if activePreset.id === 'relative-strength' && usesUniverseRank}
				No Nifty 500 series is stored for some of these, so they are ranked inside our own universe instead.
			{/if}
			{#if activePreset.id === 'growth-stage2'}
				Quarterly results are stored for {growthCoverage} of {loaded.length} scanned stocks; the rest cannot be judged.
			{/if}
		</p>
	{/if}

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
			<span class="sr-only">Sector</span>
			<select class="sm-input" bind:value={basketFilter} data-testid="sector-filter">
				<option value="">All sectors</option>
				{#each sectors as b (b)}<option value={b}>{b}</option>{/each}
			</select>
		</label>
		<label>
			<span class="sr-only">Market cap, {mcapNote}</span>
			<select class="sm-input" bind:value={bandFilter} data-testid="mcap-filter">
				<option value="all">All market caps</option>
				{#each MCAP_BANDS as b (b.key)}<option value={b.key}>{b.label}</option>{/each}
			</select>
		</label>
		<label>
			<span class="sr-only">Breakout type</span>
			<select class="sm-input" bind:value={signalFilter} data-testid="signal-filter">
				{#each SIGNALS as sg (sg.key)}<option value={sg.key}>{sg.label}</option>{/each}
			</select>
		</label>
		<ViewToggle bind:value={layout} />
		<button
			class="wl-strip-btn"
			type="button"
			data-testid="export-excel"
			disabled={exporting || rows.length === 0}
			onclick={exportExcel}>{exporting ? 'Exporting…' : 'Excel'}</button
		>
		<ViewResetButton onReset={() => memory.reset()} />
		<span class="hint" aria-live="polite" data-testid="scan-progress">
			{#if pending.length > 0}
				Scanning… {data.symbols.length - pending.length} of {data.symbols.length} done
			{:else}
				{loaded.length} of {data.symbols.length} stocks scanned, {rows.length} shown{noHistory
					? `; ${noHistory} have no price history`
					: ''}{Object.keys(failed).length
					? `; ${Object.keys(failed).length} failed (reload to retry)`
					: ''}
			{/if}
		</span>
	</div>

	{#if data.mcapAsOf}
		<p class="scan-note" data-testid="mcap-note">
			{mcapNote}: a six-month average from AMFI, not a live market cap, so companies near a band edge
			may sit on the other side today.
		</p>
	{/if}

	{#if canLoadHistory && data.mcapAsOf}
		<LoadHistoryPanel missing={missingHistory} onFinished={historyLoaded} />
	{/if}

	{#if layout === 'grid'}
		<ChartGrid items={gridItems} fetchCloses />
	{:else}
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
					{#if activePreset}<th scope="col">Why it matches</th>{/if}
				</tr>
			</thead>
			<tbody>
				{#each shown as entry (entry.symbol)}
					{@const symbol = entry.symbol}
					{@const r = entry.r}
					<tr data-testid="scan-row">
						<td>
							<a href={resolve('/valuation/company/[symbol]', { symbol })}>{nameOf(symbol)}</a>
							<span class="scan-sub">{symbol} · {data.basketsBySymbol[symbol]?.[0] ?? 'Unclassified'}</span>
							<PresetBadges ids={matches.get(symbol) ?? []} />
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
						<td class="num" title={mcapNote}>{formatCr(data.mcapBySymbol[symbol])}</td>
							{#if activePreset}<td class="scan-why">{presetDetail(activePreset.id, presetInput(entry)) || '-'}</td>{/if}
					</tr>
				{:else}
					<tr>
						<td colspan={COLUMNS.length + (activePreset ? 1 : 0)} class="muted scan-empty" data-testid="scan-empty">
							{pending.length > 0
								? 'Nothing matches yet - more stocks are still being scanned.'
								: 'No stocks match these filters.'}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if rows.length > shown.length}
		<p class="scan-more no-print">
			<button type="button" class="wl-strip-btn" data-testid="scan-more" onclick={() => (visible += ROWS_STEP)}
				>Show {Math.min(ROWS_STEP, rows.length - shown.length)} more</button
			>
			<span class="hint">{shown.length} of {rows.length} shown</span>
		</p>
	{/if}

	{/if}

	{#if noPriceRows.length > 0}
		<details class="scan-nopx" data-testid="no-price-source">
			<summary>No price source ({noPriceRows.length})</summary>
			<p class="hint">
				Angel One has no instrument for these companies, so they are never fetched or scanned.
			</p>
			<ul>
				{#each noPriceRows as c (c.name)}
					<li>{c.name} <span class="scan-sub">{formatCr(c.marketCapCr)} · No price source</span></li>
				{/each}
			</ul>
		</details>
	{/if}
</div>
