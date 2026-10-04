<script lang="ts">
	import { resolve } from '$app/paths';
	import { tick } from 'svelte';
	import type { PageData } from './$types';
	import {
		project,
		cagr,
		METHOD_LABELS,
		METHOD_MULTIPLE_LABEL,
		METHODS,
		SCENARIOS,
		freshScenario,
		freshAllAssumptions,
		type MethodId,
		type ScenarioId
	} from '$lib/valuation/valuationEngine';
	import {
		getSavedValuation,
		saveSavedValuation,
		type SavedValuationRecord
	} from '$lib/valuation/savedValuations';
	import { diffValuations } from '$lib/valuation/valuationDiff';
	import { diagnoseValuationMethod } from '$lib/valuation/valuationDiagnosis';
	import { assessBusinessQuality } from '$lib/valuation/businessQuality';
	import { runIntegrityChecks, worstIntegrityStatus } from '$lib/valuation/dataIntegrity';
	import { analyzePeg } from '$lib/valuation/pegAnalysis';
	import type { StageAnalysisResult } from '$lib/valuation/stageAnalysis';
	import StrengthPanel from '$lib/valuation/components/StrengthPanel.svelte';
	import StrengthWhy from '$lib/valuation/components/StrengthWhy.svelte';
	import { emptyStrengthView } from '$lib/valuation/strength';
	import CompanyTeam from '$lib/valuation/components/CompanyTeam.svelte';
	import ListMenu from '$lib/valuation/components/ListMenu.svelte';
	import TemplateMenu from '$lib/valuation/components/TemplateMenu.svelte';
	import type { ValuationTemplate } from '$lib/valuation/templates';
	import type { NamedWatchlist } from '$lib/valuation/watchlists';
	import {
		REVIEW_STATUS_LABELS,
		statusIsStale,
		type CoverageInfo,
		type StatusInfo
	} from '$lib/valuation/team';

	interface DepthLevel {
		price: number;
		quantity: number;
		orders: number;
	}
	interface MarketDepth {
		ltp: number;
		totBuyQuan: number;
		totSellQuan: number;
		tradeVolume: number;
		depth: { buy: DepthLevel[]; sell: DepthLevel[] };
	}

	let { data }: { data: PageData } = $props();
	// Initial value only; the $effect below re-syncs `company` on every navigation and
	// lets a price refresh patch it in between without being overwritten.
	// svelte-ignore state_referenced_locally
	let company = $state(data.company);

	const historyYears = $derived(company.years); // last 2 locked actuals
	const baseSales = $derived(historyYears[historyYears.length - 1]?.sales ?? 0);
	const baseBVPS = $derived(company.bookValuePerShare ?? 0);

	// Takes the company record explicitly (rather than reading the `company` state variable)
	// so it can safely be called from inside the sync $effect below without the effect ending
	// up reading the very state it writes — that self-reference was tripping Svelte's
	// "effect reads and writes the same piece of state" loop guard and, once thrown, was
	// aborting the rest of that mount pass, silently breaking every button on this page.
	function defaultSharesFor(c: PageData['company']): number {
		return c.marketCap && c.cmp ? Math.round((c.marketCap / c.cmp) * 100) / 100 : 100;
	}

	// Initial value only; the $effect below re-syncs `shares` on every navigation.
	// svelte-ignore state_referenced_locally
	let shares = $state(defaultSharesFor(data.company));

	let assumptions = $state(freshAllAssumptions());
	let activeMethod = $state<MethodId>('pe');
	let activeScenario = $state<ScenarioId>('base');

	const diagnosis = $derived(
		diagnoseValuationMethod({
			history: company.history,
			balanceSheet: company.balanceSheet,
			cashConversionCycle: company.cashConversionCycle,
			industry: company.industry
		})
	);

	const quality = $derived(
		assessBusinessQuality({
			pros: company.pros,
			cons: company.cons,
			shareholding: company.shareholding,
			balanceSheet: company.balanceSheet,
			cashConversionCycle: company.cashConversionCycle,
			roe: company.roe
		})
	);
	// Pros/cons are already shown in their own panel below — only surface the extra signals
	// (promoter trend, leverage, cash cycle, ROE) here so nothing is displayed twice.
	const extraQualityFlags = $derived(
		quality.flags.filter((f) => !company.pros.includes(f.text) && !company.cons.includes(f.text))
	);

	const integrityChecks = $derived(
		runIntegrityChecks({
			cmp: company.cmp,
			marketCap: company.marketCap,
			shares,
			stockPE: company.stockPE,
			years: company.years,
			shareholding: company.shareholding
		})
	);
	const integrityStatus = $derived(worstIntegrityStatus(integrityChecks));
	let showIntegrity = $state(false);

	const peg = $derived(analyzePeg({ stockPE: company.stockPE, history: company.history }));

	// Print should show the fully expanded integrity list regardless of how print was
	// triggered (our button or the browser's own Ctrl+P / menu), so this un-collapses it
	// just before the print snapshot is taken and restores it afterwards.
	let showIntegrityBeforePrint = false;
	function onBeforePrint() {
		showIntegrityBeforePrint = showIntegrity;
		if (integrityChecks.length > 0) showIntegrity = true;
	}
	function onAfterPrint() {
		showIntegrity = showIntegrityBeforePrint;
	}
	let exporting = $state(false);
	let exportError = $state<string | null>(null);
	async function exportExcel() {
		exporting = true;
		exportError = null;
		try {
			const [{ downloadWorkbook, todayStamp }, { valuationSheets }] = await Promise.all([
				import('$lib/valuation/exportXlsx'),
				import('$lib/valuation/valuationWorkbook')
			]);
			await downloadWorkbook(
				`valuation-${company.symbol}-${todayStamp()}`,
				valuationSheets({
					name: company.name,
					symbol: company.symbol,
					cmp: company.cmp ?? null,
					shares,
					baseSales,
					baseBookValuePerShare: baseBVPS,
					assumptions,
					activeMethod,
					fairValuePct: data.analysis?.valuation.fairValuePct ?? 80,
					exportedBy: data.user?.username ?? '',
					exportedAt: new Date()
				})
			);
		} catch {
			exportError = 'Could not build the Excel file. Please try again.';
		} finally {
			exporting = false;
		}
	}

	async function handlePrint() {
		onBeforePrint();
		await tick();
		window.print();
	}

	// Tracks which symbol's data is currently loaded into `assumptions`/`shares`, so nothing is
	// ever persisted under another company's key while SvelteKit reuses this component instance
	// across navigations.
	let hydratedFor = $state<string | null>(null);

	// --- Watchlist membership and saving -------------------------------------------------------
	// Opening a company never saves anything. A company joins the shared watchlist only when
	// someone clicks "Add to watchlist"; from then on real edits are autosaved. Every save carries
	// the version it was based on, so if a teammate saved in between, nothing is overwritten and
	// the person is shown who changed what.
	let inWatchlist = $state(false);
	let baseVersion = $state(0);
	let savedName = $state('');
	let lastSavedBy = $state<string | null>(null);
	let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let saveError = $state<string | null>(null);
	let conflict = $state<{
		current: SavedValuationRecord | null;
		changes: string[];
		by: string;
		at: number | null;
	} | null>(null);

	type Content = Pick<
		SavedValuationRecord,
		'assumptions' | 'shares' | 'activeMethod' | 'activeScenario'
	>;
	// The content as last loaded from / written to the server: the base for "what changed"
	// diffs, and the reference that makes a hydration or a no-op effect run save nothing.
	let baseContent: Content | null = null;
	let lastSavedSnapshot = '';

	function content(): Content {
		return $state.snapshot({ assumptions, shares, activeMethod, activeScenario }) as Content;
	}
	const snap = () => JSON.stringify(content());

	function markSaved(version: number, by: string | null) {
		baseVersion = version;
		lastSavedBy = by;
		baseContent = content();
		lastSavedSnapshot = snap();
		saveState = 'saved';
		saveError = null;
	}

	function adopt(record: SavedValuationRecord) {
		assumptions = record.assumptions;
		shares = record.shares;
		activeMethod = record.activeMethod ?? 'pe';
		activeScenario = record.activeScenario ?? 'base';
		savedName = record.name;
		markSaved(record.version ?? 1, record.updatedBy ?? null);
	}

	$effect(() => {
		// Re-syncs from the freshly loaded server data whenever SvelteKit navigates to a new
		// symbol (component instance is reused, so this can't just be a $derived of `data`).
		// Reads only ever come from `data.company` (the prop) here, never from the `company`
		// state variable this same effect writes — see the note on defaultSharesFor above.
		const freshCompany = data.company;
		company = freshCompany;
		const symbol = freshCompany.symbol;

		assumptions = freshAllAssumptions();
		shares = defaultSharesFor(freshCompany);
		activeMethod = 'pe';
		activeScenario = 'base';
		hydratedFor = null;
		inWatchlist = false;
		conflict = null;
		saveState = 'idle';
		saveError = null;
		lastSavedBy = null;
		baseVersion = 0;
		applied = null;
		startedFrom = null;
		const starting = data.startingTemplate;

		// Fetch is async, so hydration can't happen synchronously — the `hydratedFor !== symbol`
		// guard below still prevents both a premature save with defaults and this response
		// clobbering a newer navigation's state (checked again just before it's applied).
		(async () => {
			const record = await getSavedValuation(symbol);
			if (data.company.symbol !== symbol) return;
			if (record) {
				inWatchlist = true;
				adopt(record);
				saveState = 'idle';
			} else if (starting) {
				assumptions = structuredClone(starting.template.assumptions);
				activeMethod = starting.template.activeMethod;
				startedFrom = { name: starting.template.name, reason: starting.reason };
			}
			hydratedFor = symbol;
		})();
	});

	// Saves are queued one after another (never two in flight), and each sends the latest state,
	// so a slow earlier request can never land after a newer one.
	let queue: Promise<void> = Promise.resolve();
	function persist(symbol: string) {
		queue = queue.then(() => saveOnce(symbol)).catch(() => {});
	}

	async function saveOnce(symbol: string) {
		if (company.symbol !== symbol || !inWatchlist || conflict) return;
		const snapshot = snap();
		if (snapshot === lastSavedSnapshot) return;
		saveState = 'saving';
		const res = await saveSavedValuation(symbol, {
			name: savedName,
			lastUpdated: Date.now(),
			...content(),
			baseVersion
		});
		if (company.symbol !== symbol) return; // navigated away mid-save: that page state is gone
		if (res.ok) {
			baseVersion = res.version;
			lastSavedBy = res.updatedBy;
			baseContent = JSON.parse(snapshot);
			lastSavedSnapshot = snapshot;
			saveState = snap() === snapshot ? 'saved' : 'saving';
		} else if (res.conflict) {
			showConflict(res.current);
		} else {
			saveState = 'error';
			saveError = res.message;
		}
	}

	function showConflict(current: SavedValuationRecord | null) {
		saveState = 'idle';
		conflict = {
			current,
			changes: current && baseContent ? diffValuations(baseContent, current) : [],
			by: current?.updatedBy ?? 'A teammate',
			at: current?.lastUpdated ?? null
		};
	}

	function reloadTheirs() {
		if (!conflict) return;
		const theirs = conflict.current;
		conflict = null;
		if (theirs) adopt(theirs);
		else inWatchlist = false; // they removed it from the watchlist
	}

	function keepMine() {
		if (!conflict) return;
		const theirs = conflict.current;
		conflict = null;
		if (theirs) {
			baseVersion = theirs.version ?? 1;
			inWatchlist = true; // the autosave effect now sends my version on top of theirs
		} else {
			void addToWatchlist();
		}
	}

	async function addToWatchlist() {
		const symbol = company.symbol;
		saveState = 'saving';
		const res = await saveSavedValuation(symbol, {
			name: company.name,
			lastUpdated: Date.now(),
			...content(),
			baseVersion: 0
		});
		if (company.symbol !== symbol) return;
		if (res.ok) {
			inWatchlist = true;
			savedName = company.name;
			markSaved(res.version, res.updatedBy);
		} else if (res.conflict) {
			// A teammate added it first: compare against what they saved.
			inWatchlist = true;
			savedName = res.current?.name ?? company.name;
			baseContent = content();
			showConflict(res.current);
		} else {
			saveState = 'error';
			saveError = res.message;
		}
	}

	// After a version is restored from the history: load it as the new saved state.
	async function reloadSaved() {
		const symbol = company.symbol;
		const record = await getSavedValuation(symbol);
		if (company.symbol !== symbol || !record) return;
		conflict = null;
		inWatchlist = true;
		adopt(record);
	}

	// The team's named lists ("Q4 ideas", "Defence"...), for the Lists menu in the header.
	let namedLists = $state<NamedWatchlist[]>([]);
	async function loadLists() {
		const res = await fetch('/api/valuation/watchlists');
		if (res.ok) namedLists = (await res.json()) as NamedWatchlist[];
	}
	$effect(() => {
		void loadLists();
	});
	async function setListMembership(listId: number, member: boolean): Promise<string | null> {
		try {
			const res = await fetch(`/api/valuation/watchlists/${listId}/members`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ symbol: company.symbol, member })
			});
			await loadLists();
			if (res.ok) return null;
			return (
				((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? 'Failed.'
			);
		} catch {
			return 'Network error - nothing changed.';
		}
	}

	let teamStatus = $state<StatusInfo | null>(null);
	let teamCoverage = $state<CoverageInfo | null>(null);

	// Autosave: debounced so typing fires one save ~500ms after the pause. snap() deep-reads every
	// field synchronously so Svelte keeps tracking nested edits; nothing is sent unless the
	// content really differs from what was last loaded or saved.
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if (hydratedFor !== company.symbol || !inWatchlist || conflict) return;
		const symbol = company.symbol;
		if (snap() === lastSavedSnapshot) return;
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => persist(symbol), 500);
	});

	// --- Templates ----------------------------------------------------------------------------
	// A valuation not yet on the watchlist starts from the sector's or the person's default
	// template (see the load function). Applying a template replaces every method and scenario,
	// so the previous assumptions are kept for one Undo.
	let startedFrom = $state<{ name: string; reason: string } | null>(null);
	let applied = $state<{ name: string; previous: ReturnType<typeof content> } | null>(null);

	const companyBaskets = $derived(
		[...new Map(data.sectors.map((p) => [p.basketKey, p.basketLabel])).entries()].map(
			([key, label]) => ({ key, label })
		)
	);

	function applyTemplate(t: ValuationTemplate) {
		applied = { name: t.name, previous: content() };
		// The menu's list is reactive state; snapshot it so edits never write back into it.
		assumptions = $state.snapshot(t.assumptions);
		activeMethod = t.activeMethod;
		startedFrom = null;
	}

	function undoTemplate() {
		if (!applied) return;
		assumptions = applied.previous.assumptions;
		activeMethod = applied.previous.activeMethod ?? 'pe';
		applied = null;
	}

	function resetActive() {
		assumptions[activeMethod][activeScenario] = freshScenario(activeMethod, activeScenario);
	}

	const projected = $derived(
		project(activeMethod, baseSales, baseBVPS, shares, assumptions[activeMethod][activeScenario])
	);

	const cmp = $derived(company.cmp ?? 0);

	let priceRefreshing = $state(false);
	let priceRefreshError = $state<string | null>(null);

	async function refreshPrice() {
		priceRefreshing = true;
		priceRefreshError = null;
		try {
			const res = await fetch(`/api/valuation/company/${company.symbol}/refresh-price`, { method: 'POST' });
			const body = await res.json().catch(() => null);
			if (!res.ok) {
				throw new Error(body?.message ?? `Request failed (${res.status})`);
			}
			company = {
				...company,
				cmp: body.cmp,
				marketCap: body.marketCap,
				cmpFetchedAt: body.cmpFetchedAt
			};
		} catch (e) {
			priceRefreshError = e instanceof Error ? e.message : 'Failed to refresh price';
		} finally {
			priceRefreshing = false;
		}
	}

	// Stage analysis and order book both hit Angel One live (not the 24h Screener cache), so
	// they're loaded on demand rather than blocking the initial page render — same pattern as
	// refreshPrice above.
	let strengthView = $state(emptyStrengthView());
	let stageResult = $state<StageAnalysisResult | null>(null);
	let stageLoading = $state(false);
	let stageError = $state<string | null>(null);

	async function loadStageAnalysis() {
		stageLoading = true;
		stageError = null;
		try {
			const res = await fetch(`/api/valuation/company/${company.symbol}/stage-analysis`);
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.message ?? `Request failed (${res.status})`);
			stageResult = body;
		} catch (e) {
			stageError = e instanceof Error ? e.message : 'Failed to load stage analysis';
		} finally {
			stageLoading = false;
		}
	}

	let depthResult = $state<MarketDepth | null>(null);
	let depthLoading = $state(false);
	let depthError = $state<string | null>(null);

	async function loadDepth() {
		depthLoading = true;
		depthError = null;
		try {
			const res = await fetch(`/api/valuation/company/${company.symbol}/depth`);
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.message ?? `Request failed (${res.status})`);
			depthResult = body;
		} catch (e) {
			depthError = e instanceof Error ? e.message : 'Failed to load order book';
		} finally {
			depthLoading = false;
		}
	}

	function clock(ts: number | null | undefined): string {
		if (!ts) return '';
		return new Date(ts).toLocaleString('en-IN', {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatRefreshedAt(ts: number | null | undefined): string {
		if (!ts) return 'not fetched live yet';
		const diffMin = Math.round((Date.now() - ts) / 60_000);
		if (diffMin < 1) return 'just now';
		if (diffMin < 60) return `${diffMin}m ago`;
		return `${Math.round(diffMin / 60)}h ago`;
	}

	function fmt1(n: number) {
		return n.toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
	}
	function fmt2(n: number) {
		return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}
	function pct1(n: number | null) {
		return n == null ? '—' : `${fmt1(n)}%`;
	}

	function historyGrowthPct(i: number): number | null {
		if (i === 0) return null;
		const prev = historyYears[i - 1]?.sales;
		const cur = historyYears[i]?.sales;
		if (prev == null || cur == null || prev === 0) return null;
		return (cur / prev - 1) * 100;
	}
	function historyExpensePct(i: number): number | null {
		const y = historyYears[i];
		if (y?.sales == null || y.expenses == null || y.sales === 0) return null;
		return (y.expenses / y.sales) * 100;
	}
	function historyOpmPct(i: number): number | null {
		const y = historyYears[i];
		if (y?.sales == null || y.operatingProfit == null || y.sales === 0) return null;
		return (y.operatingProfit / y.sales) * 100;
	}
	function historyTaxPct(i: number): number | null {
		const y = historyYears[i];
		if (y?.pbt == null || y.tax == null || y.pbt === 0) return null;
		return (y.tax / y.pbt) * 100;
	}

	const yearLabels = ['FY+1E', 'FY+2E', 'FY+3E'];
</script>

<svelte:head>
	<title>{company.name} · ThesisTrack</title>
</svelte:head>

<svelte:window onbeforeprint={onBeforePrint} onafterprint={onAfterPrint} />

<div class="band">
	<div class="band-inner">
		<a class="back-link" href={resolve('/valuation')}>&larr; Watchlist</a>
		<button class="print-btn" onclick={handlePrint}>🖨 Print / PDF</button>
		<button
			class="print-btn print-btn-gap"
			data-testid="export-excel"
			disabled={exporting}
			onclick={exportExcel}>{exporting ? 'Exporting…' : 'Excel'}</button
		>
		{#if exportError}<p class="export-error" role="alert">{exportError}</p>{/if}
		<h1>
			{company.name}
			<span class="quality-badge quality-{quality.rating.toLowerCase()}">{quality.rating}</span>
		</h1>
		<div class="sub">
			{company.symbol} · Bear / base / bull valuation ·
			{company.basis === 'consolidated'
				? 'Consolidated'
				: company.basis === 'standalone'
					? 'Standalone'
					: 'Standalone (only basis available)'}
			{#if company.industry}
				· {company.industry}
			{/if}
		</div>
		<div class="co-links" data-testid="company-links">
			{#if data.thesisId}
				<a href={resolve('/company/[id]', { id: data.thesisId })}>Investment thesis &rarr;</a>
			{/if}
			<a href={resolve(`/valuation/compare?symbols=${company.symbol}`)}>Compare with peers &rarr;</a>
			{#each data.sectors as path (path.majorKey + path.basketKey)}
				<a
					href={resolve('/valuation/sector-rotation/[key]/[subKey]', {
						key: path.majorKey,
						subKey: path.basketKey
					})}>{path.majorLabel} &rsaquo; {path.basketLabel} &rarr;</a
				>
			{/each}
		</div>
		<div class="wl-strip" data-testid="watchlist-strip">
			{#if hydratedFor !== company.symbol}
				<span class="wl-strip-note">Checking the watchlist…</span>
			{:else if inWatchlist}
				<span class="wl-strip-badge" data-testid="watchlist-status">On the watchlist</span>
				<ListMenu
					symbol={company.symbol}
					name={company.name}
					lists={namedLists}
					onChange={setListMembership}
				/>
				<span class="wl-strip-note" data-testid="save-status" role="status">
					{#if saveState === 'saving'}Saving…
					{:else if saveState === 'error'}
						Not saved: {saveError}
						<button class="wl-strip-btn" type="button" onclick={() => persist(company.symbol)}
							>Retry</button
						>
					{:else if conflict}Waiting for you to resolve the change below
					{:else if lastSavedBy}Saved · last saved by {lastSavedBy}
					{:else}Saved{/if}
				</span>
			{:else}
				<button
					class="wl-strip-btn wl-strip-add"
					type="button"
					data-testid="add-to-watchlist"
					disabled={saveState === 'saving'}
					onclick={addToWatchlist}>＋ Add to watchlist</button
				>
				<span class="wl-strip-note" data-testid="save-status" role="status">
					{#if saveState === 'error'}Not added: {saveError}
					{:else}Not on the watchlist yet. Edits are not saved until you add it.{/if}
				</span>
			{/if}
			{#if teamStatus}
				<span class="status-chip status-{teamStatus.status}" data-testid="header-status"
					>{REVIEW_STATUS_LABELS[teamStatus.status]}{statusIsStale(teamStatus, baseVersion)
						? ' (changed since)'
						: ''}</span
				>
			{/if}
			<span class="wl-strip-note" data-testid="header-coverage"
				>{teamCoverage ? `Covered by ${teamCoverage.username}` : 'Not covered'}</span
			>
			<a class="wl-strip-link" href="#team">Thesis, notes &amp; history &darr;</a>
		</div>
	</div>
</div>

<div class="wrap">
	{#if conflict}
		<div class="conflict-banner" role="alert" data-testid="conflict-banner">
			{#if conflict.current}
				<strong>{conflict.by}</strong> changed this valuation{conflict.at
					? ` at ${clock(conflict.at)}`
					: ''} while you were editing. Reload to see their version before you carry on - your edits have
				not been saved.
				{#if conflict.changes.length}
					<ul class="conflict-changes" data-testid="conflict-changes">
						{#each conflict.changes.slice(0, 8) as line (line)}
							<li>{line}</li>
						{/each}
						{#if conflict.changes.length > 8}
							<li>…and {conflict.changes.length - 8} more</li>
						{/if}
					</ul>
				{/if}
			{:else}
				<strong>{conflict.by}</strong> removed this company from the watchlist while you were editing.
			{/if}
			<div class="conflict-actions">
				<button
					class="wl-strip-btn"
					type="button"
					data-testid="conflict-reload"
					onclick={reloadTheirs}>{conflict.current ? 'Reload their version' : 'Dismiss'}</button
				>
				<button class="wl-strip-btn" type="button" data-testid="conflict-keep" onclick={keepMine}
					>{conflict.current ? 'Keep my edits (overwrite)' : 'Add it back with my edits'}</button
				>
			</div>
		</div>
	{/if}
	<div class="cmp-strip">
		<div class="item">
			<div class="l">CMP</div>
			<div class="v">
				₹{company.cmp ?? '—'}
				<button
					class="refresh-btn"
					onclick={refreshPrice}
					disabled={priceRefreshing}
					title="Fetch live price from Angel One"
				>
					{priceRefreshing ? '⟳ Refreshing…' : '⟳ Refresh'}
				</button>
			</div>
			<div class="refreshed-at">{formatRefreshedAt(company.cmpFetchedAt)}</div>
		</div>
		<div class="item">
			<div class="l">Market Cap</div>
			<div class="v">₹{company.marketCap ?? '—'}cr</div>
		</div>
		<div class="item">
			<div class="l">Book Value/Share</div>
			<div class="v">₹{company.bookValuePerShare ?? '—'}</div>
		</div>
		<div class="item">
			<div class="l">Shares Outstanding (cr)</div>
			<div class="v">
				<input
					class="editable"
					style="width:96px"
					type="number"
					step="0.01"
					aria-label="Shares outstanding (crore)"
					bind:value={shares}
				/>
			</div>
		</div>
		<div class="item">
			<div class="l">Stock P/E</div>
			<div class="v">{company.stockPE ?? '—'}</div>
		</div>
		<div class="item">
			<div class="l">ROE</div>
			<div class="v">{company.roe != null ? `${company.roe}%` : '—'}</div>
		</div>
		<div class="item">
			<div class="l">ROCE</div>
			<div class="v">{company.roce != null ? `${company.roce}%` : '—'}</div>
		</div>
		<div class="item">
			<div class="l">Dividend Yield</div>
			<div class="v">{company.dividendYield != null ? `${company.dividendYield}%` : '—'}</div>
		</div>
	</div>

	{#if priceRefreshError}
		<div class="price-error">{priceRefreshError}</div>
	{/if}

	<div class="depth-panel">
		<div class="depth-head">
			<span class="exhibit-cap" style="margin:0">Order Book (Live, Angel One)</span>
			<button class="diagnosis-apply" onclick={loadDepth} disabled={depthLoading}>
				{depthLoading ? 'Loading…' : depthResult ? 'Refresh' : 'Load order book'}
			</button>
		</div>
		{#if depthError}
			<div class="price-error">{depthError}</div>
		{/if}
		{#if depthResult}
			{@const totalQuan = depthResult.totBuyQuan + depthResult.totSellQuan}
			{@const buyPressurePct = totalQuan > 0 ? (depthResult.totBuyQuan / totalQuan) * 100 : 50}
			<div class="depth-pressure">
				<span class="signal-good">Buy {depthResult.totBuyQuan.toLocaleString('en-IN')}</span>
				<div class="depth-pressure-bar">
					<div class="depth-pressure-fill" style="width:{buyPressurePct.toFixed(1)}%"></div>
				</div>
				<span class="signal-bad">Sell {depthResult.totSellQuan.toLocaleString('en-IN')}</span>
			</div>
			<div class="depth-grid">
				<div>
					<div class="quality-title">Bid (Buy)</div>
					<table class="depth-table">
						<thead>
							<tr>
								<th class="left">Price</th>
								<th>Qty</th>
								<th>Orders</th>
							</tr>
						</thead>
						<tbody>
							{#each depthResult.depth.buy as level, i (i)}
								<tr>
									<td class="left signal-good">{level.price > 0 ? `₹${level.price}` : '—'}</td>
									<td>{level.quantity || '—'}</td>
									<td>{level.orders || '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<div>
					<div class="quality-title">Ask (Sell)</div>
					<table class="depth-table">
						<thead>
							<tr>
								<th class="left">Price</th>
								<th>Qty</th>
								<th>Orders</th>
							</tr>
						</thead>
						<tbody>
							{#each depthResult.depth.sell as level, i (i)}
								<tr>
									<td class="left signal-bad">{level.price > 0 ? `₹${level.price}` : '—'}</td>
									<td>{level.quantity || '—'}</td>
									<td>{level.orders || '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
			<div class="depth-note">
				Live NSE market depth via Angel One — populated only during trading hours (9:15am–3:30pm
				IST, Mon–Fri).
			</div>
		{/if}
	</div>

	{#if company.pros.length > 0 || company.cons.length > 0 || extraQualityFlags.length > 0 || company.shareholding || company.balanceSheet}
		<div class="quality-panel">
			{#if company.pros.length > 0 || company.cons.length > 0 || extraQualityFlags.length > 0}
				<div class="quality-col">
					{#if company.pros.length > 0}
						<div class="quality-block pros">
							<div class="quality-title">Pros</div>
							<ul>
								{#each company.pros as p (p)}
									<li>{p}</li>
								{/each}
							</ul>
						</div>
					{/if}
					{#if company.cons.length > 0}
						<div class="quality-block cons">
							<div class="quality-title">Cons</div>
							<ul>
								{#each company.cons as c (c)}
									<li>{c}</li>
								{/each}
							</ul>
						</div>
					{/if}
					{#if extraQualityFlags.length > 0}
						<div class="quality-block">
							<div class="quality-title">Other Signals</div>
							<ul>
								{#each extraQualityFlags as f (f.text)}
									<li class="signal-{f.tone}">{f.text}</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			{/if}
			{#if company.shareholding || company.balanceSheet}
				<div class="quality-col">
					{#if company.shareholding}
						<div class="quality-block">
							<div class="quality-title">Shareholding · {company.shareholding.label}</div>
							<div class="shareholding-bars">
								<div class="sh-row">
									<span class="sh-l">Promoters</span><span class="sh-v"
										>{company.shareholding.promoters != null
											? `${company.shareholding.promoters}%`
											: '—'}</span
									>
								</div>
								<div class="sh-row">
									<span class="sh-l">FIIs</span><span class="sh-v"
										>{company.shareholding.fiis != null
											? `${company.shareholding.fiis}%`
											: '—'}</span
									>
								</div>
								<div class="sh-row">
									<span class="sh-l">DIIs</span><span class="sh-v"
										>{company.shareholding.diis != null
											? `${company.shareholding.diis}%`
											: '—'}</span
									>
								</div>
								<div class="sh-row">
									<span class="sh-l">Public</span><span class="sh-v"
										>{company.shareholding.public != null
											? `${company.shareholding.public}%`
											: '—'}</span
									>
								</div>
							</div>
						</div>
					{/if}
					{#if company.balanceSheet}
						<div class="quality-block">
							<div class="quality-title">Balance Sheet · {company.balanceSheet.label}</div>
							<div class="shareholding-bars">
								<div class="sh-row">
									<span class="sh-l">Reserves</span><span class="sh-v"
										>₹{company.balanceSheet.reserves ?? '—'}cr</span
									>
								</div>
								<div class="sh-row">
									<span class="sh-l">Borrowings</span><span class="sh-v"
										>₹{company.balanceSheet.borrowings ?? '—'}cr</span
									>
								</div>
								<div class="sh-row">
									<span class="sh-l">Total Assets</span><span class="sh-v"
										>₹{company.balanceSheet.totalAssets ?? '—'}cr</span
									>
								</div>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<div class="sv-company">
		<StrengthPanel
			level="company"
			parentKey={company.symbol}
			kind="company"
			title="Track strength & volume"
			scopeLabel={`${company.symbol}`}
			canSave={data.user?.role !== 'read_only'}
			bind:view={strengthView}
		/>
		{#if strengthView.active}
			<StrengthWhy evaluation={strengthView.byKey[company.symbol.toUpperCase()]} all />
		{/if}
	</div>

	<div class="stage-panel">
		<div class="depth-head">
			<span class="exhibit-cap" style="margin:0">Stage Analysis (Live, Angel One)</span>
			<button class="diagnosis-apply" onclick={loadStageAnalysis} disabled={stageLoading}>
				{stageLoading ? 'Loading…' : stageResult ? 'Refresh' : 'Load stage analysis'}
			</button>
		</div>
		{#if stageError}
			<div class="price-error">{stageError}</div>
		{/if}
		{#if stageResult}
			<div
				class="stage-verdict signal-{stageResult.stage === 'Stage 2 (Uptrend)'
					? 'good'
					: stageResult.stage === 'Insufficient Data'
						? 'warn'
						: 'bad'}"
			>
				<strong>{stageResult.stage}</strong> — {stageResult.score}/{stageResult.totalCriteria} criteria
				met
			</div>
			<div class="stage-breakout signal-{stageResult.breakoutSignal ? 'good' : 'warn'}">
				{stageResult.breakoutDetail}
			</div>
			<ul class="integrity-list">
				{#each stageResult.criteria as c (c.label)}
					<li class="signal-{c.pass ? 'good' : 'bad'}">
						<span class="integrity-label">{c.pass ? '✓' : '✕'} {c.label}</span>
						<span class="integrity-detail">{c.detail}</span>
					</li>
				{/each}
			</ul>
			<div class="depth-note">
				52-week range ₹{stageResult.week52Low.toFixed(1)}–₹{stageResult.week52High.toFixed(1)} · {stageResult.dataPoints}
				trading days of history used. A rule-based reading of Weinstein Stage Analysis / the Minervini
				Trend Template — not a guarantee.
			</div>
		{/if}
	</div>

	{#if integrityChecks.length > 0}
		<div class="integrity-panel">
			<button class="integrity-toggle" onclick={() => (showIntegrity = !showIntegrity)}>
				<span
					class="signal-{integrityStatus === 'ok'
						? 'good'
						: integrityStatus === 'warn'
							? 'warn'
							: 'bad'}"
					>{integrityStatus === 'ok'
						? '✓ Data tie-out checks passed'
						: integrityStatus === 'warn'
							? '⚠ Data tie-out has minor mismatches'
							: '✕ Data tie-out found a mismatch'}</span
				>
				<span class="integrity-count">({integrityChecks.length} checks)</span>
				<span class="integrity-caret">{showIntegrity ? '▲' : '▼'}</span>
			</button>
			{#if showIntegrity}
				<ul class="integrity-list">
					{#each integrityChecks as c (c.label)}
						<li class="signal-{c.status === 'ok' ? 'good' : c.status === 'warn' ? 'warn' : 'bad'}">
							<span class="integrity-label">{c.label}</span>
							<span class="integrity-detail">{c.detail}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}

	{#if company.quarters.length > 0}
		<div class="exhibit-cap" style="margin-top:0">Recent Quarters</div>
		<!-- Scrollable regions must be keyboard-focusable (WCAG 2.1.1). -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="table-scroll" tabindex="0" role="region" aria-label="Recent quarters">
			<table class="quarters-table" data-testid="quarters-table">
				<thead>
					<tr>
						<th class="left">₹ Crores</th>
						{#each company.quarters as q (q.label)}
							<th>{q.label}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					<tr>
						<td class="left">Sales</td>
						{#each company.quarters as q (q.label)}<td>{q.sales != null ? fmt1(q.sales) : '—'}</td
							>{/each}
					</tr>
					<tr class="rowname-sub">
						<td class="left">OPM %</td>
						{#each company.quarters as q (q.label)}<td>{pct1(q.opmPct)}</td>{/each}
					</tr>
					<tr>
						<td class="left">Net Profit</td>
						{#each company.quarters as q (q.label)}<td
								>{q.netProfit != null ? fmt1(q.netProfit) : '—'}</td
							>{/each}
					</tr>
					<tr>
						<td class="left">EPS (₹)</td>
						{#each company.quarters as q (q.label)}<td>{q.eps != null ? fmt2(q.eps) : '—'}</td
							>{/each}
					</tr>
				</tbody>
			</table>
		</div>
	{/if}

	<div class="diagnosis-banner" class:low-confidence={diagnosis.lowConfidence}>
		<div class="diagnosis-head">
			<span class="diagnosis-label">Recommended method: {diagnosis.label}</span>
			{#if activeMethod !== diagnosis.method}
				<button class="diagnosis-apply" onclick={() => (activeMethod = diagnosis.method)}>
					Switch to {diagnosis.label}
				</button>
			{/if}
		</div>
		<ul>
			{#each diagnosis.reasons as r (r)}
				<li>{r}</li>
			{/each}
		</ul>
	</div>

	{#if diagnosis.method === 'pe' && peg.label}
		<div
			class="peg-strip signal-{peg.label === 'Attractive'
				? 'good'
				: peg.label === 'Expensive'
					? 'bad'
					: 'warn'}"
		>
			<strong>PEG {peg.label}</strong> — {peg.detail}
		</div>
	{/if}

	<div class="method-tabs">
		{#each METHODS as m (m)}
			<button class:active={activeMethod === m} onclick={() => (activeMethod = m)}>
				{METHOD_LABELS[m]}
			</button>
		{/each}
	</div>

	<div class="toggle-row">
		<div class="segmented">
			{#each SCENARIOS as s (s)}
				<button class:active={activeScenario === s} onclick={() => (activeScenario = s)}>
					{s[0].toUpperCase() + s.slice(1)}
				</button>
			{/each}
		</div>
		<button class="reset-btn" onclick={resetActive}>Reset active scenario to defaults</button>
		{#if data.user}
			<TemplateMenu
				baskets={companyBaskets}
				me={data.user}
				current={() => ({ assumptions: $state.snapshot(assumptions), activeMethod })}
				onApply={applyTemplate}
			/>
		{/if}
	</div>
	{#if applied}
		<p class="tpl-note" role="status" data-testid="template-applied">
			Applied the template “{applied.name}” to every method and scenario.
			<button class="link-btn" type="button" onclick={undoTemplate}>Undo</button>
		</p>
	{:else if startedFrom}
		<p class="tpl-note" data-testid="template-started">
			These assumptions start from the template “{startedFrom.name}” ({startedFrom.reason}). Nothing
			is saved until you add the company to the watchlist.
		</p>
	{/if}

	<!-- Scrollable regions must be keyboard-focusable (WCAG 2.1.1). -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div class="table-scroll" tabindex="0" role="region" aria-label="Projected valuation table">
		<table data-testid="valuation-table">
			<thead>
				<tr>
					<th>₹ Crores</th>
					{#each historyYears as y (y.label)}
						<th>{y.label}</th>
					{/each}
					{#each yearLabels as yl (yl)}
						<th>{yl}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				<tr>
					<td>Sales</td>
					{#each historyYears as y (y.label)}<td class="locked"
							>{y.sales != null ? fmt1(y.sales) : '—'}</td
						>{/each}
					{#each projected as p, i (i)}<td class="locked">{fmt1(p.sales)}</td>{/each}
				</tr>
				<tr class="rowname-sub">
					<td>Sales Growth %</td>
					{#each historyYears as y, i (y.label)}<td class="locked">{pct1(historyGrowthPct(i))}</td
						>{/each}
					{#each assumptions[activeMethod][activeScenario].years as ya, i (i)}
						<td
							><input
								class="editable"
								type="number"
								step="0.1"
								aria-label="Sales growth % {yearLabels[i]}"
								bind:value={ya.revenueGrowthPct}
							/></td
						>
					{/each}
				</tr>

				<tr>
					<td>Expenses</td>
					{#each historyYears as y (y.label)}<td class="locked"
							>{y.expenses != null ? fmt1(y.expenses) : '—'}</td
						>{/each}
					{#each projected as p, i (i)}<td class="locked">{fmt1(p.expenses)}</td>{/each}
				</tr>
				<tr class="rowname-sub">
					<td>Expenses (% of Sales)</td>
					{#each historyYears as y, i (y.label)}<td class="locked">{pct1(historyExpensePct(i))}</td
						>{/each}
					{#each assumptions[activeMethod][activeScenario].years as ya, i (i)}
						<td
							><input
								class="editable"
								type="number"
								step="0.1"
								aria-label="Expenses % of sales {yearLabels[i]}"
								bind:value={ya.expensePct}
							/></td
						>
					{/each}
				</tr>

				<tr class="subtotal">
					<td>Operating Profit (EBITDA)</td>
					{#each historyYears as y (y.label)}<td class="locked"
							>{y.operatingProfit != null ? fmt1(y.operatingProfit) : '—'}</td
						>{/each}
					{#each projected as p, i (i)}<td class="locked">{fmt1(p.ebitda)}</td>{/each}
				</tr>
				<tr class="rowname-sub">
					<td>OPM %</td>
					{#each historyYears as y, i (y.label)}<td class="locked">{pct1(historyOpmPct(i))}</td
						>{/each}
					{#each projected as p, i (i)}<td class="locked"
							>{pct1(p.sales !== 0 ? (p.ebitda / p.sales) * 100 : null)}</td
						>{/each}
				</tr>

				<tr>
					<td>Other Income</td>
					{#each historyYears as y (y.label)}<td class="locked"
							>{y.otherIncome != null ? fmt1(y.otherIncome) : '—'}</td
						>{/each}
					{#each assumptions[activeMethod][activeScenario].years as ya, i (i)}
						<td
							><input
								class="editable"
								type="number"
								step="0.1"
								aria-label="Other income {yearLabels[i]}"
								bind:value={ya.otherIncome}
							/></td
						>
					{/each}
				</tr>

				<tr>
					<td>Interest</td>
					{#each historyYears as y (y.label)}<td class="locked"
							>{y.interest != null ? fmt1(y.interest) : '—'}</td
						>{/each}
					{#each assumptions[activeMethod][activeScenario].years as ya, i (i)}
						<td
							><input
								class="editable"
								type="number"
								step="0.1"
								aria-label="Interest {yearLabels[i]}"
								bind:value={ya.interest}
							/></td
						>
					{/each}
				</tr>

				<tr>
					<td>Depreciation</td>
					{#each historyYears as y (y.label)}<td class="locked"
							>{y.depreciation != null ? fmt1(y.depreciation) : '—'}</td
						>{/each}
					{#each assumptions[activeMethod][activeScenario].years as ya, i (i)}
						<td
							><input
								class="editable"
								type="number"
								step="0.1"
								aria-label="Depreciation {yearLabels[i]}"
								bind:value={ya.depreciation}
							/></td
						>
					{/each}
				</tr>

				<tr class="subtotal">
					<td>Profit Before Tax</td>
					{#each historyYears as y (y.label)}<td class="locked"
							>{y.pbt != null ? fmt1(y.pbt) : '—'}</td
						>{/each}
					{#each projected as p, i (i)}<td class="locked">{fmt1(p.pbt)}</td>{/each}
				</tr>
				<tr class="rowname-sub">
					<td>Tax %</td>
					{#each historyYears as y, i (y.label)}<td class="locked">{pct1(historyTaxPct(i))}</td
						>{/each}
					{#each assumptions[activeMethod][activeScenario].years as ya, i (i)}
						<td
							><input
								class="editable"
								type="number"
								step="0.1"
								aria-label="Tax % {yearLabels[i]}"
								bind:value={ya.taxPct}
							/></td
						>
					{/each}
				</tr>

				<tr class="subtotal">
					<td>Net Profit</td>
					{#each historyYears as y (y.label)}<td class="locked"
							>{y.netProfit != null ? fmt1(y.netProfit) : '—'}</td
						>{/each}
					{#each projected as p, i (i)}<td class="locked">{fmt1(p.netProfit)}</td>{/each}
				</tr>

				<tr>
					<td>EPS (₹)</td>
					{#each historyYears as y (y.label)}<td class="locked"
							>{y.eps != null ? fmt2(y.eps) : '—'}</td
						>{/each}
					{#each projected as p, i (i)}<td class="locked">{fmt2(p.eps)}</td>{/each}
				</tr>

				<tr>
					<td>Book Value/Share (₹)</td>
					{#each historyYears as y, i (y.label)}
						<td class="locked"
							>{i === historyYears.length - 1 && company.bookValuePerShare != null
								? fmt2(company.bookValuePerShare)
								: '—'}</td
						>
					{/each}
					{#each projected as p, i (i)}<td class="locked">{fmt2(p.bookValuePerShare)}</td>{/each}
				</tr>

				<tr class="rowname-sub">
					<td>Dividend Payout %</td>
					{#each historyYears as y (y.label)}<td class="locked">—</td>{/each}
					{#each assumptions[activeMethod][activeScenario].years as ya, i (i)}
						<td
							><input
								class="editable"
								type="number"
								step="0.1"
								aria-label="Dividend payout % {yearLabels[i]}"
								bind:value={ya.dividendPayoutPct}
							/></td
						>
					{/each}
				</tr>

				{#if activeMethod === 'ev_ebitda'}
					<tr class="rowname-sub">
						<td>Net Debt (₹cr)</td>
						{#each historyYears as y (y.label)}<td class="locked">—</td>{/each}
						{#each assumptions[activeMethod][activeScenario].years as ya, i (i)}
							<td
								><input
									class="editable"
									type="number"
									step="0.1"
									aria-label="Net debt {yearLabels[i]}"
									bind:value={ya.netDebt}
								/></td
							>
						{/each}
					</tr>
				{/if}

				<tr>
					<td>{METHOD_MULTIPLE_LABEL[activeMethod]}</td>
					{#each historyYears as y (y.label)}<td class="locked">—</td>{/each}
					{#each assumptions[activeMethod][activeScenario].years as ya, i (i)}
						<td
							><input
								class="editable"
								type="number"
								step="0.1"
								aria-label="{METHOD_MULTIPLE_LABEL[activeMethod]} {yearLabels[i]}"
								bind:value={ya.targetMultiple}
							/></td
						>
					{/each}
				</tr>

				<tr class="subtotal">
					<td>Implied Stock Price (₹)</td>
					{#each historyYears as y (y.label)}<td class="locked">—</td>{/each}
					{#each projected as p, i (i)}<td class="locked">{fmt1(p.impliedPrice)}</td>{/each}
				</tr>
			</tbody>
		</table>
	</div>

	<div class="assump-note">
		Historical columns (locked) are scraped from Screener.in on a {company.basis === 'consolidated'
			? 'consolidated'
			: 'standalone'} basis. Future years are editable (blue cells) and recalculate live. Method-specific
		terminal multiple determines the implied price for each valuation approach; switch tabs to compare
		all four side by side (assumptions are kept independently per method and per scenario).
	</div>

	<div class="cagr-cards">
		{#each projected as p, i (i)}
			{@const c = cagr(p.impliedPrice, cmp, i + 1)}
			<div class="cagr-card">
				<div class="l">{yearLabels[i]} · {i + 1}yr CAGR</div>
				<div class="price">₹{fmt1(p.impliedPrice)}</div>
				<div class="cagr {c >= 0 ? 'pos' : 'neg'}">{c >= 0 ? '+' : ''}{c.toFixed(1)}% CAGR</div>
			</div>
		{/each}
	</div>

	{#if data.user}
		<CompanyTeam
			symbol={company.symbol}
			me={data.user}
			{inWatchlist}
			currentVersion={baseVersion}
			getCurrent={content}
			onRestored={reloadSaved}
			bind:status={teamStatus}
			bind:coverage={teamCoverage}
		/>
	{/if}
</div>
