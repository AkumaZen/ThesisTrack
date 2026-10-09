<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	import CompanyPicker from '$lib/components/CompanyPicker.svelte';
	import type { SymbolHit } from '$lib/valuation/symbolSearch';
	import { session } from '$lib/session.svelte';
	import {
		DEFAULT_METRIC_KEYS,
		SECTION_ORDER,
		SECTION_TITLES,
		UNIT_HINT,
		buildCatalog,
		formatValue,
		metricKey,
		valueAt,
		yearColumns,
		type CatalogEntry,
		type CompareStatements,
		type Unit
	} from '$lib/valuation/compareMetrics';

	let { data }: { data: PageData } = $props();

	type Load =
		| { status: 'waiting' }
		| { status: 'loading' }
		| { status: 'ok'; data: CompareStatements }
		| { status: 'error'; message: string };

	// ---- companies -----------------------------------------------------------------------------

	// Chips start from the address (a new navigation resets them) and grow as companies are picked.
	let chosen = $derived(data.symbols.map((symbol) => ({ symbol, name: symbol })));
	const full = $derived(chosen.length >= data.maxSymbols);

	let loads = $state<Record<string, Load>>({});

	// Each uncached company costs the server about a dozen Screener calls, and every serverless
	// instance paces Screener on its own, so a full table fired at once could trip Screener's
	// limits or run past the time limit. Two at a time; the rest wait their turn.
	const MAX_PARALLEL = 2;
	let running = 0;
	const queue: (() => void)[] = [];

	async function fetchCompany(symbol: string, refresh = false) {
		loads[symbol] = { status: 'waiting' };
		if (running >= MAX_PARALLEL) await new Promise<void>((go) => queue.push(go));
		running++;
		loads[symbol] = { status: 'loading' };
		try {
			const res = await fetch(
				`/api/valuation/compare/${encodeURIComponent(symbol)}${refresh ? '?refresh=1' : ''}`
			);
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.message ?? `Could not load (${res.status})`);
			}
			loads[symbol] = { status: 'ok', data: await res.json() };
		} catch (e) {
			loads[symbol] = { status: 'error', message: e instanceof Error ? e.message : 'Could not load' };
		} finally {
			running--;
			queue.shift()?.();
		}
	}

	// Fetch whichever compared companies have not been requested yet, each on its own request.
	$effect(() => {
		for (const symbol of data.symbols) {
			if (!loads[symbol]) void fetchCompany(symbol);
		}
	});

	function nameOf(symbol: string, fallback: string) {
		const l = loads[symbol];
		return l?.status === 'ok' ? l.data.name : fallback;
	}

	function addCompany(hit: SymbolHit) {
		if (full || chosen.some((c) => c.symbol === hit.symbol)) return;
		chosen = [...chosen, { symbol: hit.symbol, name: hit.name }];
	}
	function removeCompany(symbol: string) {
		chosen = chosen.filter((c) => c.symbol !== symbol);
	}
	const pending = $derived(chosen.map((c) => c.symbol).join(',') !== data.symbols.join(','));

	function submit() {
		// Encoded one by one so a symbol such as M&M survives the address; the commas stay literal.
		const symbols = chosen
			.map((c) => encodeURIComponent(c.symbol))
			.slice(0, data.maxSymbols)
			.join(',');
		goto(resolve(symbols ? `/valuation/compare?symbols=${symbols}` : '/valuation/compare'));
	}

	// ---- preferences (per person, this browser) ------------------------------------------------

	const YEAR_CHOICES = [2, 3, 5];
	let selected = $state<string[]>([...DEFAULT_METRIC_KEYS]);
	let yearCount = $state(2);

	const prefsKey = $derived(`tt:v1:${session.user?.id ?? 'anon'}:compare:prefs`);

	$effect(() => {
		try {
			const raw = localStorage.getItem(prefsKey);
			if (!raw) return;
			const saved = JSON.parse(raw) as { metrics?: unknown; years?: unknown };
			if (Array.isArray(saved.metrics) && saved.metrics.every((k) => typeof k === 'string')) {
				selected = saved.metrics;
			}
			if (typeof saved.years === 'number' && YEAR_CHOICES.includes(saved.years)) yearCount = saved.years;
		} catch {
			// Unreadable or blocked storage: keep the defaults.
		}
	});

	function savePrefs() {
		try {
			localStorage.setItem(prefsKey, JSON.stringify({ metrics: selected, years: yearCount }));
		} catch {
			// Storage blocked (private window): the choice still applies for this visit.
		}
	}

	function setYears(n: number) {
		yearCount = n;
		savePrefs();
	}

	// ---- metrics -------------------------------------------------------------------------------

	const loaded = $derived(
		data.symbols.flatMap((s) => {
			const l = loads[s];
			return l?.status === 'ok' ? [l.data] : [];
		})
	);
	const catalog = $derived(buildCatalog(loaded));
	const selectedSet = $derived(new Set(selected));
	const shownCount = $derived(catalog.filter((m) => selectedSet.has(m.key)).length);

	/** Selected metrics grouped by section, in statement order. A sub-row is indented only when
	 *  its parent row is shown too; otherwise it would look like part of the row above it. */
	const groups = $derived(
		SECTION_ORDER.map((id) => ({
			id,
			title: SECTION_TITLES[id],
			metrics: catalog
				.filter((m) => m.section === id && selectedSet.has(m.key))
				.map((m) => ({ ...m, indent: m.parent != null && selectedSet.has(metricKey(id, m.parent)) }))
		})).filter((g) => g.metrics.length > 0)
	);

	function toggleMetric(key: string, on: boolean) {
		selected = on ? [...selected, key] : selected.filter((k) => k !== key);
		savePrefs();
	}
	/** Turns a section's metrics on or off: only those the search shows, when there is a search. */
	function setSection(items: CatalogEntry[], on: boolean) {
		const keys = new Set(items.map((m) => m.key));
		const rest = selected.filter((k) => !keys.has(k));
		selected = on ? [...rest, ...keys] : rest;
		savePrefs();
	}
	function resetDefaults() {
		selected = [...DEFAULT_METRIC_KEYS];
		savePrefs();
	}
	function selectAll() {
		selected = [...new Set([...selected, ...catalog.map((m) => m.key)])];
		savePrefs();
	}
	function selectNone() {
		selected = [];
		savePrefs();
	}

	// ---- metric picker -------------------------------------------------------------------------

	let dialog = $state<HTMLDialogElement>();
	let query = $state('');
	const pickerSections = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const match = (m: CatalogEntry) =>
			!q || m.label.toLowerCase().includes(q) || (m.parent ?? '').toLowerCase().includes(q);
		return SECTION_ORDER.map((id) => {
			const all = catalog.filter((m) => m.section === id);
			const on = all.filter((m) => selectedSet.has(m.key)).length;
			const items = all.filter(match);
			const itemsOn = items.filter((m) => selectedSet.has(m.key)).length;
			return { id, title: SECTION_TITLES[id], all, on, items, itemsOn };
		}).filter((s) => s.items.length > 0);
	});

	// ---- table ---------------------------------------------------------------------------------

	// The table runs its full height down the page; only its sideways-scroll box scrolls. CSS sticky
	// cells stick within the nearest scroll box, which here never scrolls vertically, so the header
	// rows are moved down by hand instead: just under the site header while the table passes under
	// it, never past the table's last row.
	let shellEl = $state<HTMLDivElement>();
	$effect(() => {
		const header = document.querySelector<HTMLElement>('.shell');
		const el = shellEl;
		if (!el) return;
		let frame = 0;
		const place = () => {
			frame = 0;
			const box = el.querySelector<HTMLElement>('.cmp-scroll');
			const head = box?.querySelector<HTMLElement>('thead');
			if (!box || !head) return;
			const top = Math.max(0, header?.getBoundingClientRect().bottom ?? 0);
			const room = box.clientHeight - head.offsetHeight;
			const shift = Math.min(Math.max(0, top - box.getBoundingClientRect().top - box.clientTop), Math.max(0, room));
			head.style.transform = shift > 0 ? `translateY(${shift}px)` : '';
		};
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(place);
		};
		const observer = new ResizeObserver(schedule);
		observer.observe(el);
		if (header) observer.observe(header);
		addEventListener('scroll', schedule, { passive: true });
		addEventListener('resize', schedule);
		schedule();
		return () => {
			observer.disconnect();
			removeEventListener('scroll', schedule);
			removeEventListener('resize', schedule);
			cancelAnimationFrame(frame);
		};
	});

	/** Per company: its year columns, oldest first with the latest last. */
	const columns = $derived(
		data.symbols.map((symbol) => {
			const load: Load = loads[symbol] ?? { status: 'waiting' };
			const years = load.status === 'ok' ? yearColumns(load.data, yearCount) : [];
			// Keep the group's width while loading or failed, so the header doesn't jump.
			const slots = years.length > 0 ? years : Array.from({ length: yearCount }, () => '');
			return { symbol, load, years: slots };
		})
	);
	const totalCols = $derived(1 + columns.reduce((n, c) => n + c.years.length, 0));

	/** "Mar 2026" -> "FY26"; other year ends keep their month ("Dec 25"). */
	function shortYear(label: string) {
		const m = /^(\w{3})\w*\s+\d{2}(\d{2})$/.exec(label);
		if (!m) return label;
		return m[1] === 'Mar' ? `FY${m[2]}` : `${m[1]} ${m[2]}`;
	}

	/** A cell's text: blank until the company's figures arrive, a dash where it has no value. */
	function cell(load: Load, key: string, year: string, unit: Unit) {
		if (load.status === 'waiting' || load.status === 'loading') return '';
		return formatValue(load.status === 'ok' && year ? valueAt(load.data, key, year) : null, unit);
	}
</script>

<svelte:head>
	<title>Compare Companies · ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Compare companies</h1>
		<div class="sub">
			Consolidated figures side by side for up to {data.maxSymbols} companies. Choose the metrics you want to see.
		</div>
	</div>
</div>

<div class="cmp-shell" bind:this={shellEl}>
	<div class="cmp-picker">
		<label for="compareSymbols" class="field-label cmp-picker-label">
			Companies to compare (up to {data.maxSymbols})
		</label>
		{#if chosen.length}
			<ul class="cmp-chips" aria-label="Companies chosen">
				{#each chosen as c (c.symbol)}
					<li class="cmp-chip">
						{nameOf(c.symbol, c.name)} <span class="cmp-chip-ticker">{c.symbol}</span>
						<button
							type="button"
							aria-label="Remove {nameOf(c.symbol, c.name)}"
							onclick={() => removeCompany(c.symbol)}>×</button
						>
					</li>
				{/each}
			</ul>
		{/if}
		<div class="compare-row">
			<CompanyPicker
				id="compareSymbols"
				label="Add a company to compare"
				placeholder={full ? `Up to ${data.maxSymbols} companies` : 'Add a company: type a name or ticker'}
				disabled={full}
				onPick={addCompany}
			/>
			<button class="btn btn-primary compare-go" onclick={submit} disabled={!pending}>Compare</button>
		</div>
		{#if pending && data.symbols.length > 0}
			<p class="cmp-pending">Press Compare to update the table with your changes.</p>
		{/if}
	</div>

{#if data.symbols.length > 0}
	<section aria-label="Comparison">
		<div class="cmp-toolbar">
			<button
				type="button"
				class="btn btn-ghost cmp-customize"
				onclick={() => dialog?.showModal()}
				disabled={catalog.length === 0}
			>
				Customize metrics
				<span class="cmp-count">{shownCount} of {catalog.length || '…'}</span>
			</button>

			<div class="cmp-years" role="group" aria-label="Years per company">
				<span class="cmp-years-label">Years</span>
				{#each YEAR_CHOICES as n (n)}
					<button type="button" class:on={yearCount === n} aria-pressed={yearCount === n} onclick={() => setYears(n)}
						>{n}</button
					>
				{/each}
			</div>

			<p class="cmp-note">₹ Cr unless marked. Market figures are current; shareholding is as at each year end.</p>
		</div>

		<div class="cmp-scroll">
			<table class="cmp-table">
				<thead>
					<tr>
						<th class="cmp-metric-col" rowspan="2" scope="col">Metric</th>
						{#each columns as c (c.symbol)}
							<th class="cmp-co" colspan={c.years.length} scope="colgroup">
								<div class="cmp-co-head">
									{#if c.load.status === 'ok'}
										<a
											class="cmp-co-name"
											title={c.load.data.name}
											href={resolve('/valuation/company/[symbol]', { symbol: c.symbol })}>{c.load.data.name}</a
										>
									{:else}
										<span class="cmp-co-name">{c.symbol}</span>
									{/if}
									<span class="cmp-co-meta">
										<span class="cmp-co-ticker">{c.symbol}</span>
										{#if c.load.status === 'ok' && c.load.data.basis !== 'consolidated'}
											<span class="cmp-flag" title="Screener has no consolidated figures for this company"
												>Standalone only</span
											>
										{/if}
										{#if c.load.status === 'ok'}
											<button
												type="button"
												class="cmp-refresh"
												title="Fetch fresh figures from Screener"
												aria-label="Refresh {c.symbol}"
												onclick={() => fetchCompany(c.symbol, true)}>↻</button
											>
										{/if}
									</span>
									{#if c.load.status === 'waiting'}
										<span class="cmp-status">Waiting to load…</span>
									{:else if c.load.status === 'loading'}
										<span class="cmp-status">Loading figures…</span>
									{:else if c.load.status === 'error'}
										<span class="cmp-status cmp-status-bad">
											{c.load.message}
											<button type="button" class="link-btn" onclick={() => fetchCompany(c.symbol)}>Retry</button>
										</span>
									{/if}
								</div>
							</th>
						{/each}
					</tr>
					<tr>
						{#each columns as c (c.symbol)}
							{#each c.years as y, i}
								<th
									class="cmp-year"
									class:cmp-first={i === 0}
									class:cmp-latest={i === c.years.length - 1}
									scope="col"
									title={y}>{y ? shortYear(y) : '·'}</th
								>
							{/each}
						{/each}
					</tr>
				</thead>
				<tbody>
					{#if catalog.length > 0 && groups.length === 0}
						<tr>
							<td class="cmp-empty" colspan={totalCols}>
								No metrics selected.
								<button type="button" class="link-btn" onclick={resetDefaults}>Restore the defaults</button>
							</td>
						</tr>
					{/if}
					{#each groups as g (g.id)}
						<tr class="cmp-section">
							<th class="cmp-section-title" scope="rowgroup">{g.title}</th>
							<td colspan={totalCols - 1}></td>
						</tr>
						{#each g.metrics as m (m.key)}
							<tr class:cmp-sub={m.indent}>
								<th class="cmp-metric" scope="row">
									<span class="cmp-metric-label">{m.label}</span>
									{#if m.unit !== 'cr'}<span class="cmp-unit">{UNIT_HINT[m.unit]}</span>{/if}
								</th>
								{#each columns as c (c.symbol)}
									{#if g.id === 'mkt'}
										{@const text = cell(c.load, m.key, 'now', m.unit)}
										<td class="cmp-val cmp-first cmp-now" class:neg={text.startsWith('-')} colspan={c.years.length}
											>{text}</td
										>
									{:else}
										{#each c.years as y, i}
											{@const text = cell(c.load, m.key, y, m.unit)}
											<td
												class="cmp-val"
												class:cmp-first={i === 0}
												class:cmp-latest={i === c.years.length - 1}
												class:neg={text.startsWith('-')}>{text}</td
											>
										{/each}
									{/if}
								{/each}
							</tr>
						{/each}
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/if}
</div>

<dialog class="cmp-dialog" bind:this={dialog} aria-labelledby="cmpDialogTitle" onclose={() => (query = '')}>
	<div class="cmp-dialog-head">
		<h2 id="cmpDialogTitle">Choose metrics</h2>
		<button type="button" class="cmp-x" aria-label="Close" onclick={() => dialog?.close()}>×</button>
	</div>
	<div class="cmp-dialog-tools">
		<input type="search" placeholder="Search metrics" aria-label="Search metrics" bind:value={query} />
		<div class="cmp-dialog-actions">
			<span class="cmp-count">{shownCount} of {catalog.length} shown</span>
			<button type="button" class="link-btn" onclick={resetDefaults}>Defaults</button>
			<button type="button" class="link-btn" onclick={selectAll}>All</button>
			<button type="button" class="link-btn" onclick={selectNone}>None</button>
		</div>
	</div>
	<div class="cmp-dialog-body">
		{#each pickerSections as s (s.id)}
			<fieldset class="cmp-group">
				<legend>
					<label class="cmp-group-toggle">
						<input
							type="checkbox"
							checked={s.itemsOn === s.items.length}
							indeterminate={s.itemsOn > 0 && s.itemsOn < s.items.length}
							onchange={(e) => setSection(s.items, e.currentTarget.checked)}
						/>
						{s.title}
						<span class="cmp-count">{s.on}/{s.all.length}</span>
					</label>
				</legend>
				<ul>
					{#each s.items as m (m.key)}
						<li class:cmp-sub={m.parent}>
							<label>
								<input
									type="checkbox"
									checked={selectedSet.has(m.key)}
									onchange={(e) => toggleMetric(m.key, e.currentTarget.checked)}
								/>
								<span>{m.label}</span>
								{#if m.parent}<span class="cmp-parent">in {m.parent}</span>{/if}
							</label>
						</li>
					{/each}
				</ul>
			</fieldset>
		{:else}
			<p class="cmp-empty">No metric matches “{query}”.</p>
		{/each}
	</div>
	<div class="cmp-dialog-foot">
		<button type="button" class="btn btn-primary" onclick={() => dialog?.close()}>Done</button>
	</div>
</dialog>

<style>
	/* Picker, toolbar and grid share the band's left edge. The grid uses the full page width;
	   extra companies scroll sideways inside .cmp-scroll, with the metric column and both header
	   rows (company names and years) held in place. */
	.cmp-shell {
		padding: var(--space-4) 0 var(--space-4);
		font-family: var(--font-sans);
	}
	.cmp-picker {
		max-width: 760px;
	}
	.cmp-picker-label {
		display: block;
		margin-bottom: 6px;
	}
	.cmp-pending {
		margin: var(--space-2) 0 0;
		font-size: 13px;
		color: var(--warn);
	}

	.cmp-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		margin: var(--space-5) 0 var(--space-3);
	}
	.cmp-customize {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 40px;
		border: var(--border-w) solid var(--ink);
	}
	.cmp-count {
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 500;
		color: var(--muted);
	}
	.cmp-years {
		display: inline-flex;
		align-items: center;
		border: var(--border-w) solid var(--ink);
	}
	.cmp-years-label {
		padding: 0 10px;
		font-size: 12px;
		font-weight: 600;
		color: var(--muted);
	}
	.cmp-years button {
		min-width: 38px;
		min-height: 36px;
		border: none;
		border-left: 1px solid var(--rule);
		background: var(--bg);
		color: var(--ink);
		font-family: var(--font-mono);
		font-size: 13px;
		cursor: pointer;
	}
	.cmp-years button.on {
		background: var(--ink);
		color: var(--bg);
	}
	.cmp-note {
		margin: 0 0 0 auto;
		font-size: 12px;
		color: var(--muted);
	}

	/* As wide as its columns need, up to the page width; beyond that it scrolls sideways.
	   Never scrolls vertically: the table runs its full height down the page. */
	.cmp-scroll {
		width: fit-content;
		max-width: 100%;
		overflow-x: auto;
		overflow-y: hidden;
		overscroll-behavior-x: contain;
		border: var(--border-w) solid var(--ink);
		background: var(--bg);
	}
	/* Grows with its content; only .cmp-scroll scrolls sideways, never the page. */
	.cmp-table {
		width: max-content;
		margin: 0;
		border-collapse: separate;
		border-spacing: 0;
		font-family: var(--font-mono);
		font-size: 13px;
	}
	/* Resets the shared .vd table look (uppercase mono headers, zebra rows) for this grid. */
	.cmp-table th,
	.cmp-table td {
		border-bottom: 1px solid var(--rule);
		background: var(--bg);
		text-transform: none;
		letter-spacing: 0;
	}

	/* Company names and years stay in view while scrolling down the page (moved by the script). */
	.cmp-table thead {
		position: relative;
		z-index: 2;
		will-change: transform;
	}
	.cmp-table thead th {
		background: var(--surface);
		color: var(--ink);
		text-transform: none;
	}
	.cmp-table thead tr:first-child th {
		vertical-align: top;
	}
	.cmp-table thead tr:nth-child(2) th {
		border-bottom: var(--border-w) solid var(--ink);
	}

	/* The metric column stays on the left while scrolling sideways. Narrow: long names wrap. */
	.cmp-metric-col,
	.cmp-metric,
	.cmp-table .cmp-section-title {
		position: sticky;
		left: 0;
		z-index: 1;
		width: 168px;
		min-width: 168px;
		max-width: 168px;
		text-align: left;
		border-right: var(--border-w) solid var(--ink);
	}
	.cmp-table thead .cmp-metric-col {
		z-index: 3;
		vertical-align: bottom;
		padding: 10px 12px;
		border-bottom: var(--border-w) solid var(--ink);
		font-family: var(--font-sans);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted);
	}

	.cmp-table .cmp-co {
		padding: 12px 16px;
		text-align: left;
		border-left: var(--border-w) solid var(--ink);
		letter-spacing: 0;
	}
	.cmp-co-head {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}
	.cmp-co-name {
		font-family: var(--font-sans);
		font-size: 14px;
		font-weight: 700;
		line-height: 1.25;
		color: var(--ink);
		text-decoration: none;
		/* One line, so the header stays short. */
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	a.cmp-co-name:hover {
		color: var(--accent);
		text-decoration: underline;
	}
	.cmp-co-meta {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.cmp-co-ticker {
		font-family: var(--font-mono);
		font-size: 11.5px;
		font-weight: 500;
		color: var(--muted);
	}
	.cmp-flag {
		padding: 1px 6px;
		border: 1px solid currentColor;
		background: var(--warn-soft);
		color: var(--warn);
		font-family: var(--font-sans);
		font-size: 10.5px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.cmp-refresh {
		margin-left: auto;
		padding: 2px 4px;
		border: none;
		background: none;
		color: var(--muted);
		font-size: 15px;
		line-height: 1;
		cursor: pointer;
	}
	.cmp-refresh:hover {
		color: var(--ink);
	}
	.cmp-status {
		font-family: var(--font-sans);
		font-size: 12px;
		font-weight: 500;
		color: var(--muted);
	}
	.cmp-status-bad {
		color: var(--danger);
		white-space: normal;
	}

	.cmp-table .cmp-year {
		min-width: 112px;
		padding: 8px 16px;
		text-align: right;
		font-family: var(--font-sans);
		font-size: 11.5px;
		font-weight: 600;
		letter-spacing: 0.03em;
		color: var(--muted);
	}
	.cmp-table thead .cmp-year.cmp-latest {
		background: var(--accent-soft);
		color: var(--ink);
	}

	/* Each company's group opens with a heavy rule, so its columns read as one block. */
	.cmp-table .cmp-first {
		border-left: var(--border-w) solid var(--ink);
	}

	.cmp-section th,
	.cmp-section td {
		background: var(--surface);
		border-bottom: 1px solid var(--ink);
	}
	.cmp-table .cmp-section-title {
		padding: 14px 12px 6px;
		font-family: var(--font-display);
		font-size: 12.5px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.cmp-table .cmp-metric {
		padding: 10px 12px;
		font-family: var(--font-sans);
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
	}
	.cmp-metric-label {
		white-space: normal;
	}
	.cmp-unit {
		margin-left: 6px;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 500;
		color: var(--muted);
	}
	.cmp-table .cmp-sub .cmp-metric {
		padding-left: 24px;
		font-weight: 500;
		color: var(--muted);
	}

	.cmp-table .cmp-val {
		padding: 10px 16px;
		text-align: right;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.cmp-table .cmp-val.cmp-latest {
		background: #f7f9ff;
		font-weight: 600;
	}
	.cmp-table .cmp-val.cmp-now {
		text-align: center;
		font-weight: 600;
	}
	.cmp-table .cmp-val.neg {
		color: var(--danger);
	}
	.cmp-table tbody tr:not(.cmp-section):hover > * {
		background: var(--accent-soft);
	}

	.cmp-table .cmp-empty,
	.cmp-dialog .cmp-empty {
		padding: 24px 16px;
		font-family: var(--font-sans);
		color: var(--muted);
		text-align: left;
	}
	.link-btn {
		padding: 0;
		border: none;
		background: none;
		color: var(--accent);
		font: inherit;
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}

	/* Metric picker: a panel on the right that scrolls inside itself. */
	.cmp-dialog {
		width: min(460px, 100vw);
		max-width: 100vw;
		height: 100dvh;
		max-height: 100dvh;
		margin: 0 0 0 auto;
		padding: 0;
		border: none;
		border-left: var(--border-w) solid var(--ink);
		box-shadow: var(--shadow-hard-lg);
		background: var(--bg);
		color: var(--ink);
		flex-direction: column;
	}
	.cmp-dialog[open] {
		display: flex;
	}
	.cmp-dialog::backdrop {
		background: rgba(10, 10, 10, 0.35);
	}
	.cmp-dialog-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 18px 20px 10px;
	}
	.cmp-dialog-head h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 20px;
		font-weight: 600;
	}
	.cmp-x {
		padding: 4px 8px;
		border: none;
		background: none;
		font-size: 24px;
		line-height: 1;
		cursor: pointer;
	}
	.cmp-dialog-tools {
		padding: 0 20px 12px;
		border-bottom: var(--border-w) solid var(--ink);
	}
	.cmp-dialog-tools input[type='search'] {
		width: 100%;
		min-height: 40px;
		padding: 0 12px;
		border: var(--border-w) solid var(--ink);
		font: inherit;
		font-size: 14px;
	}
	.cmp-dialog-actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-top: 10px;
		font-size: 13px;
	}
	.cmp-dialog-actions .cmp-count {
		margin-right: auto;
	}
	.cmp-dialog-body {
		flex: 1;
		overflow-y: auto;
		padding: 8px 20px 20px;
	}
	.cmp-group {
		margin: 0;
		padding: 14px 0 6px;
		border: none;
		border-bottom: 1px solid var(--rule);
	}
	.cmp-group legend {
		width: 100%;
		padding: 0;
		float: left;
	}
	.cmp-group-toggle {
		display: flex;
		align-items: center;
		gap: 10px;
		font-family: var(--font-display);
		font-size: 13px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		cursor: pointer;
	}
	.cmp-group-toggle .cmp-count {
		margin-left: auto;
	}
	.cmp-group ul {
		clear: both;
		margin: 0;
		padding: 6px 0 0;
		list-style: none;
	}
	.cmp-group li label {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 6px 0;
		font-size: 14px;
		cursor: pointer;
	}
	.cmp-group li.cmp-sub label {
		padding-left: 26px;
	}
	.cmp-group input[type='checkbox'] {
		flex: none;
		width: 16px;
		height: 16px;
		accent-color: var(--accent);
		transform: translateY(2px);
	}
	.cmp-parent {
		font-size: 12px;
		color: var(--muted);
	}
	.cmp-dialog-foot {
		display: flex;
		justify-content: flex-end;
		padding: 12px 20px;
		border-top: var(--border-w) solid var(--ink);
	}

	@media (max-width: 640px) {
		.cmp-note {
			flex-basis: 100%;
			margin-left: 0;
		}
		.cmp-metric-col,
		.cmp-metric,
		.cmp-section-title {
			width: 116px;
			min-width: 116px;
			max-width: 116px;
		}
		.cmp-table .cmp-metric,
		.cmp-table .cmp-section-title {
			padding-left: 12px;
			padding-right: 10px;
		}
		.cmp-table .cmp-sub .cmp-metric {
			padding-left: 22px;
		}
		.cmp-table .cmp-year {
			min-width: 92px;
		}
	}
</style>
