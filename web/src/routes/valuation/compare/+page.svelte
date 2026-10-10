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
		metricRuns,
		moveMetric,
		shownMetrics,
		sortByValue,
		sortValue,
		valueAt,
		yearColumns,
		type CatalogEntry,
		type CompareStatements,
		type SortDir,
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

	const YEAR_CHOICES = [1, 2, 3, 5];
	let selected = $state<string[]>([...DEFAULT_METRIC_KEYS]);
	let yearCount = $state(2);
	/** True once the person has put the rows in their own order; `selected` then holds that order. */
	let arranged = $state(false);

	const prefsKey = $derived(`tt:v1:${session.user?.id ?? 'anon'}:compare:prefs`);

	$effect(() => {
		try {
			const raw = localStorage.getItem(prefsKey);
			if (!raw) return;
			const saved = JSON.parse(raw) as { metrics?: unknown; years?: unknown; arranged?: unknown };
			if (Array.isArray(saved.metrics) && saved.metrics.every((k) => typeof k === 'string')) {
				selected = saved.metrics;
			}
			if (typeof saved.years === 'number' && YEAR_CHOICES.includes(saved.years)) yearCount = saved.years;
			arranged = saved.arranged === true;
		} catch {
			// Unreadable or blocked storage: keep the defaults.
		}
	});

	function savePrefs() {
		try {
			localStorage.setItem(prefsKey, JSON.stringify({ metrics: selected, years: yearCount, arranged }));
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
	/** The table's rows in display order: statement order, or the person's own once arranged. */
	const shown = $derived(shownMetrics(catalog, selected, arranged));
	const shownCount = $derived(shown.length);
	/** Rows in runs of one section, each run under its own header. */
	const groups = $derived(metricRuns(shown));

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
		arranged = false;
		savePrefs();
	}
	/** Moves the shown metric at `from` to `to`; the table follows this order from then on. */
	function moveTo(from: number, to: number) {
		if (from === to) return;
		selected = moveMetric(selected, shown.map((m) => m.key), from, to);
		arranged = true;
		savePrefs();
	}
	function statementOrder() {
		arranged = false;
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
	let tab = $state<'choose' | 'arrange'>('choose');
	/** The row being dragged in the Arrange list, and the slot it would land in. */
	let dragFrom = $state<number | null>(null);
	let dropAt = $state<number | null>(null);

	let arrangeEl = $state<HTMLOListElement>();
	/** Where the pointer was at the last dragover, anywhere in the panel. */
	let pointer = { x: 0, y: 0 };
	let scrollFrame = 0;
	/** Within this distance of the list's top or bottom edge (or past it), the list scrolls. */
	const EDGE_PX = 72;
	const MAX_SPEED_PX = 22;

	/** The slot under the pointer, held inside the list so a pointer above or below it picks the
	 *  first or last visible slot. */
	function slotAtPointer(list: HTMLElement): number | null {
		const area = list.getBoundingClientRect();
		const y = Math.min(Math.max(pointer.y, area.top + 1), area.bottom - 1);
		const x = Math.min(Math.max(pointer.x, area.left + 1), area.right - 1);
		const li = document.elementFromPoint(x, y)?.closest<HTMLElement>('li[data-index]');
		if (!li || !list.contains(li)) return dropAt;
		const i = Number(li.dataset.index);
		const box = li.getBoundingClientRect();
		return y < box.top + box.height / 2 ? i : i + 1;
	}

	/**
	 * Runs every frame while a row is dragged: scrolls the list when the pointer is near or past
	 * its top or bottom (faster the closer it gets), and keeps the drop slot under the pointer as
	 * rows scroll past. Browsers only scroll a few pixels from the very edge on their own, and
	 * fire no events while the pointer holds still.
	 */
	function dragLoop() {
		const list = arrangeEl;
		if (dragFrom == null || !list) return;
		const area = list.getBoundingClientRect();
		const depth =
			pointer.y < area.top + EDGE_PX
				? -(area.top + EDGE_PX - pointer.y)
				: pointer.y > area.bottom - EDGE_PX
					? pointer.y - (area.bottom - EDGE_PX)
					: 0;
		if (depth !== 0) list.scrollTop += Math.sign(depth) * Math.ceil(Math.min(1, Math.abs(depth) / EDGE_PX) * MAX_SPEED_PX);
		dropAt = slotAtPointer(list);
		scrollFrame = requestAnimationFrame(dragLoop);
	}

	function dragStart(e: DragEvent, i: number, key: string) {
		dragFrom = i;
		pointer = { x: e.clientX, y: e.clientY };
		e.dataTransfer?.setData('text/plain', key);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		cancelAnimationFrame(scrollFrame);
		scrollFrame = requestAnimationFrame(dragLoop);
	}
	/** Anywhere in the panel, so the list keeps scrolling with the pointer above or below it. Both
	 *  dragenter and dragover are cancelled: an uncancelled dragenter makes the browser treat the
	 *  spot as no drop target, and it then sends no dragover at all. */
	function panelDragOver(e: DragEvent) {
		if (dragFrom == null) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		pointer = { x: e.clientX, y: e.clientY };
	}
	function dragEnd() {
		cancelAnimationFrame(scrollFrame);
		dragFrom = dropAt = null;
	}
	function drop(e: DragEvent) {
		if (dragFrom == null) return;
		e.preventDefault();
		pointer = { x: e.clientX, y: e.clientY };
		const at = arrangeEl ? slotAtPointer(arrangeEl) : dropAt;
		if (at != null) moveTo(dragFrom, at > dragFrom ? at - 1 : at);
		dragEnd();
	}
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

	// The table scrolls inside its own box so its header rows can stay put while reading down. The
	// box is at most as tall as the screen minus the site header and the page space below the box:
	// scrolled to the very bottom, the box's top (and so its header) still sits just under the site
	// header. Both heights change with the window width (the sub-menu wraps), so they are measured.
	let shellEl = $state<HTMLDivElement>();
	$effect(() => {
		const header = document.querySelector<HTMLElement>('.shell');
		const el = shellEl;
		if (!header || !el) return;
		const measure = () => {
			const box = el.querySelector('.cmp-scroll');
			const below = box ? document.documentElement.scrollHeight - (box.getBoundingClientRect().bottom + scrollY) : 0;
			el.style.setProperty('--cmp-reserved-h', `${header.offsetHeight + Math.max(0, below)}px`);
		};
		// Measured on the next frame: setting the height resizes `el`, which would otherwise notify
		// this same observer again within one frame ("ResizeObserver loop" errors).
		let frame = 0;
		const observer = new ResizeObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(measure);
		});
		observer.observe(header);
		observer.observe(el);
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
		};
	});

	/** Companies ranked by one metric, chosen by clicking its name; null keeps the chosen order. */
	let sort = $state<{ key: string; dir: SortDir } | null>(null);

	/** First click ranks high to low, the next low to high, the third clears the ranking. */
	function sortBy(key: string) {
		sort = sort?.key !== key ? { key, dir: 'desc' } : sort.dir === 'desc' ? { key, dir: 'asc' } : null;
	}
	const sortLabel = $derived(sort ? (catalog.find((m) => m.key === sort!.key)?.label ?? null) : null);

	/** Per company: its year columns, oldest first with the latest last, in ranked order if any. */
	const columns = $derived.by(() => {
		const list = data.symbols.map((symbol) => {
			const load: Load = loads[symbol] ?? { status: 'waiting' };
			const years = load.status === 'ok' ? yearColumns(load.data, yearCount) : [];
			// Keep the group's width while loading or failed, so the header doesn't jump.
			const slots = years.length > 0 ? years : Array.from({ length: yearCount }, () => '');
			return { symbol, load, years: slots };
		});
		const by = sort;
		if (!by) return list;
		return sortByValue(list, (c) => (c.load.status === 'ok' ? sortValue(c.load.data, by.key, c.years) : null), by.dir);
	});
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
			<button
				type="button"
				class="btn btn-ghost cmp-customize"
				onclick={() => {
					tab = 'arrange';
					dialog?.showModal();
				}}
				disabled={shownCount < 2}>Arrange rows</button
			>
			{#if arranged}
				<button type="button" class="link-btn cmp-order-reset" onclick={statementOrder}>Back to statement order</button>
			{/if}

			<div class="cmp-years" role="group" aria-label="Years per company">
				<span class="cmp-years-label">Years</span>
				{#each YEAR_CHOICES as n (n)}
					<button type="button" class:on={yearCount === n} aria-pressed={yearCount === n} onclick={() => setYears(n)}
						>{n}</button
					>
				{/each}
			</div>

			{#if sort && sortLabel}
				<p class="cmp-sorted">
					Ranked by <strong>{sortLabel}</strong>, {sort.dir === 'desc' ? 'high to low' : 'low to high'}
					<button type="button" class="link-btn" onclick={() => (sort = null)}>Clear</button>
				</p>
			{/if}

			<p class="cmp-note">₹ Cr unless marked. Market figures are current; shareholding is as at each year end.</p>
		</div>

		<div class="cmp-scroll">
			<table class="cmp-table" class:cmp-single={yearCount === 1} style:--cmp-years={yearCount} style:--cmp-cols={totalCols - 1}>
				<colgroup>
					<col class="cmp-col-metric" />
					{#each columns as c (c.symbol)}
						{#each c.years as _, i (i)}<col class="cmp-col-year" />{/each}
					{/each}
				</colgroup>
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
									class:cmp-latest={c.years.length > 1 && i === c.years.length - 1}
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
							{@const dir = sort?.key === m.key ? sort.dir : null}
							<tr class:cmp-sub={m.indent}>
								<th class="cmp-metric" scope="row">
									<button
										type="button"
										class="cmp-sort"
										class:on={dir != null}
										aria-pressed={dir != null}
										title={dir === 'desc'
											? 'Ranked high to low. Click for low to high'
											: dir === 'asc'
												? 'Ranked low to high. Click to clear'
												: `Rank companies by ${m.label}`}
										onclick={() => sortBy(m.key)}
									>
										<span class="cmp-metric-label">{m.label}</span>
										{#if m.unit !== 'cr'}<span class="cmp-unit">{UNIT_HINT[m.unit]}</span>{/if}
										<span class="cmp-sort-mark" aria-hidden="true">{dir === 'desc' ? '▼' : dir === 'asc' ? '▲' : '↕'}</span>
									</button>
								</th>
								{#each columns as c (c.symbol)}
									{#if g.section === 'mkt'}
										{@const text = cell(c.load, m.key, 'now', m.unit)}
										<td
												class="cmp-val cmp-first cmp-now"
												class:cmp-emph={c.years.length > 1}
												class:neg={text.startsWith('-')}
												colspan={c.years.length}
											>{text}</td
										>
									{:else}
										{#each c.years as y, i}
											{@const text = cell(c.load, m.key, y, m.unit)}
											<td
												class="cmp-val"
												class:cmp-first={i === 0}
												class:cmp-latest={c.years.length > 1 && i === c.years.length - 1}
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

<dialog
	class="cmp-dialog"
	bind:this={dialog}
	aria-labelledby="cmpDialogTitle"
	ondragenter={panelDragOver}
	ondragover={panelDragOver}
	ondrop={drop}
	onclose={() => {
		query = '';
		tab = 'choose';
	}}
>
	<div class="cmp-dialog-head">
		<h2 id="cmpDialogTitle">Metrics</h2>
		<button type="button" class="cmp-x" aria-label="Close" onclick={() => dialog?.close()}>×</button>
	</div>
	<div class="cmp-tabs" role="tablist" aria-label="Metrics">
		<button type="button" role="tab" aria-selected={tab === 'choose'} class:on={tab === 'choose'} onclick={() => (tab = 'choose')}
			>Choose</button
		>
		<button type="button" role="tab" aria-selected={tab === 'arrange'} class:on={tab === 'arrange'} onclick={() => (tab = 'arrange')}
			>Arrange <span class="cmp-count">{shownCount}</span></button
		>
	</div>
	{#if tab === 'arrange'}
		<div class="cmp-dialog-tools">
			<p class="cmp-arrange-help">Drag rows, or use the arrows. The table shows them in this order.</p>
			<div class="cmp-dialog-actions">
				<span class="cmp-count">{arranged ? 'Your order' : 'Statement order'}</span>
				{#if arranged}<button type="button" class="link-btn" onclick={statementOrder}>Statement order</button>{/if}
			</div>
		</div>
		<ol class="cmp-dialog-body cmp-arrange" bind:this={arrangeEl}>
			{#each shown as m, i (m.key)}
				<li
					draggable="true"
					data-index={i}
					class:dragging={dragFrom === i}
					class:drop-before={dropAt === i && dragFrom !== i && dragFrom !== i - 1}
					class:drop-after={dropAt === i + 1 && i === shown.length - 1 && dragFrom !== i}
					ondragstart={(e) => dragStart(e, i, m.key)}
					ondragend={dragEnd}
				>
					<span class="cmp-grip" aria-hidden="true">⠿</span>
					<span class="cmp-arrange-label">
						<span class="cmp-arrange-name">{m.label}</span>
						<span class="cmp-parent">{SECTION_TITLES[m.section]}{m.parent ? ` · ${m.parent}` : ''}</span>
					</span>
					<button type="button" class="cmp-move" aria-label="Move {m.label} up" disabled={i === 0} onclick={() => moveTo(i, i - 1)}
						>↑</button
					>
					<button
						type="button"
						class="cmp-move"
						aria-label="Move {m.label} down"
						disabled={i === shown.length - 1}
						onclick={() => moveTo(i, i + 1)}>↓</button
					>
				</li>
			{:else}
				<li class="cmp-empty">No metrics shown yet.</li>
			{/each}
		</ol>
	{:else}
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
	{/if}
	<div class="cmp-dialog-foot">
		<button type="button" class="btn btn-primary" onclick={() => dialog?.close()}>Done</button>
	</div>
</dialog>

<style>
	/* Picker, toolbar and grid share the band's left edge. The grid uses the full page width;
	   the table scrolls inside .cmp-scroll, with the metric column and both header rows (company
	   names and years) held in place. */
	.cmp-shell {
		padding: var(--space-4) 0 var(--space-2);
		font-family: var(--font-sans);
	}
	/* The table is the end of the page: drop the layout's bottom padding so the box can be a full
	   screen tall below the site header. */
	:global(.app-main:has(.cmp-shell)) {
		padding-bottom: 0;
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

	/* As wide as its columns need, up to the page width, and at most a full screen tall below the
	   site header; beyond either it scrolls inside. Sticky cells only stick within the box that
	   scrolls them, so the table has to scroll here, not with the page, to keep its header. At
	   the end of the table the wheel carries on scrolling the page. */
	.cmp-scroll {
		width: fit-content;
		max-width: 100%;
		max-height: calc(100dvh - var(--cmp-reserved-h, 200px) - var(--space-2));
		overflow: auto;
		overscroll-behavior-x: contain;
		border: var(--border-w) solid var(--ink);
		background: var(--bg);
	}
	/* Every company gets the same width, so figures sit on one regular grid however long a name
	   is: room for a two-line name at one year, and for the figures themselves at more years.
	   Capped at the box, long names wrap first; only when the figures alone are too wide does
	   .cmp-scroll scroll sideways (never the page). */
	.cmp-table {
		--metric-w: 168px;
		--company-min: 150px;
		--year-min: 92px;
		--year-w: max(calc(var(--company-min) / var(--cmp-years, 1)), var(--year-min));
		width: calc(var(--metric-w) + var(--cmp-cols, 1) * var(--year-w));
		max-width: 100%;
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

	/* Company names and years stay at the top while scrolling down the table. */
	.cmp-table thead {
		position: sticky;
		top: 0;
		z-index: 2;
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
	.cmp-col-metric {
		width: var(--metric-w);
	}
	.cmp-col-year {
		width: var(--year-w);
	}
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
		padding: 10px;
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
		font-size: 13.5px;
		font-weight: 700;
		line-height: 1.25;
		color: var(--ink);
		text-decoration: none;
		/* Wraps onto at most two lines (full name on hover), so the figures, not a long name, set
		   how wide a company's columns are. Breaks only between words. */
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		white-space: normal;
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

	/* Wide enough for figures such as 1,23,456 or ₹1,392; the numbers set the width, not padding. */
	.cmp-table .cmp-year {
		min-width: 64px;
		padding: 8px 10px;
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
		/* Wraps between words, so a long title never widens the metric column. */
		white-space: normal;
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
	/* The whole name cell is the sort control; the arrow shows on hover, or stays when ranked. */
	.cmp-sort {
		display: flex;
		align-items: baseline;
		width: 100%;
		padding: 0;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.cmp-sort:hover .cmp-metric-label {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.cmp-sort-mark {
		margin-left: auto;
		padding-left: 6px;
		font-size: 10px;
		color: var(--muted);
		opacity: 0;
	}
	.cmp-sort:hover .cmp-sort-mark,
	.cmp-sort:focus-visible .cmp-sort-mark {
		opacity: 1;
	}
	.cmp-sort.on .cmp-sort-mark {
		opacity: 1;
		color: var(--accent);
	}
	.cmp-sorted {
		margin: 0;
		font-size: 13px;
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
		padding: 10px;
		text-align: right;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.cmp-table .cmp-val.cmp-latest {
		background: #f7f9ff;
		font-weight: 600;
	}
	/* Today's market figures line up on the same right edge as every other figure (under the
	   latest year when several are shown), and carry its weight only beside other years. */
	.cmp-table .cmp-val.cmp-now.cmp-emph {
		font-weight: 600;
	}
	/* One year per company: each column holds a single figure, so figures, years and company
	   headers sit centred in it. With several years they keep one right edge to compare across. */
	.cmp-single .cmp-val,
	.cmp-single thead .cmp-year,
	.cmp-single thead .cmp-co {
		text-align: center;
	}
	.cmp-single .cmp-co-head {
		align-items: center;
	}
	.cmp-single .cmp-co-meta {
		justify-content: center;
	}
	.cmp-single .cmp-refresh {
		margin-left: 0;
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
	.cmp-order-reset {
		font-size: 13px;
	}
	.cmp-tabs {
		display: flex;
		padding: 0 20px;
		gap: var(--space-4);
		border-bottom: 1px solid var(--rule);
	}
	.cmp-tabs button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 0;
		border: none;
		border-bottom: 3px solid transparent;
		margin-bottom: -1px;
		background: none;
		color: var(--muted);
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
	}
	.cmp-tabs button.on {
		border-bottom-color: var(--ink);
		color: var(--ink);
	}
	.cmp-dialog-tools:has(.cmp-arrange-help) {
		padding-top: 12px;
	}
	.cmp-arrange-help {
		margin: 0;
		font-size: 13px;
		color: var(--muted);
	}
	.cmp-arrange {
		margin: 0;
		padding-top: 4px;
		list-style: none;
	}
	.cmp-arrange li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 0;
		border-top: 2px solid transparent;
		border-bottom: 1px solid var(--rule);
		background: var(--bg);
		cursor: grab;
	}
	.cmp-arrange li.dragging {
		opacity: 0.4;
	}
	.cmp-arrange li.drop-before {
		border-top-color: var(--accent);
	}
	.cmp-arrange li.drop-after {
		border-bottom: 2px solid var(--accent);
	}
	.cmp-grip {
		color: var(--muted);
		font-size: 16px;
		line-height: 1;
	}
	.cmp-arrange-label {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		font-size: 14px;
	}
	.cmp-move {
		width: 32px;
		height: 32px;
		border: 1px solid var(--rule);
		background: var(--bg);
		color: var(--ink);
		font-size: 15px;
		line-height: 1;
		cursor: pointer;
	}
	.cmp-move:hover:not(:disabled) {
		border-color: var(--ink);
	}
	.cmp-move:disabled {
		color: var(--rule);
		cursor: default;
	}
	.cmp-dialog-foot {
		display: flex;
		justify-content: flex-end;
		padding: 12px 20px;
		border-top: var(--border-w) solid var(--ink);
	}

	@media (max-width: 640px) {
		.cmp-table {
			--metric-w: 116px;
			--company-min: 96px;
			--year-min: 72px;
		}
		.cmp-note {
			flex-basis: 100%;
			margin-left: 0;
		}
		.cmp-metric-col,
		.cmp-metric,
		.cmp-table .cmp-section-title {
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
			min-width: 56px;
		}
	}
</style>
