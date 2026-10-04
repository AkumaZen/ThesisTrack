<script lang="ts" module>
	import type { UserPrefs } from '$lib/valuation/prefs';
	// The watchlist layout last chosen in this tab (see savePrefs).
	let latestWatchlistPrefs: UserPrefs['watchlist'] | null = null;
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		listSavedValuations,
		removeSavedValuation,
		getSavedValuation,
		saveSavedValuation,
		restoreValuation,
		type SavedValuationMeta
	} from '$lib/valuation/savedValuations';
	import {
		project,
		cagr,
		METHOD_LABELS,
		type MethodId,
		type ScenarioAssumptions
	} from '$lib/valuation/valuationEngine';
	import { diagnoseValuationMethod } from '$lib/valuation/valuationDiagnosis';
	import {
		parseImportPayload,
		validateCandidate,
		buildImportedRecord,
		type ImportOutcome
	} from '$lib/valuation/importValuation';
	import { getCachedRow, setCachedRow, evictCachedRow } from '$lib/valuation/watchlistCache';
	import { DEFAULT_FAIR_VALUE_PCT, fairValueFromTarget, upsidePct } from '$lib/valuation/fairValue';
	import { downloadWorkbook, FORMATS, todayStamp } from '$lib/valuation/exportXlsx';
	import {
		DEFAULT_PREFS,
		WATCHLIST_COLUMNS,
		type ColumnId,
		type SortKey,
		type WatchlistView
	} from '$lib/valuation/prefs';
	import { REVIEW_STATUS_LABELS, type ReviewStatus } from '$lib/valuation/team';
	import type { NamedWatchlist } from '$lib/valuation/watchlists';
	import { timeAgo } from '$lib/valuation/activity';
	import ActivityFeed from '$lib/valuation/components/ActivityFeed.svelte';
	import RemovedValuations from '$lib/valuation/components/RemovedValuations.svelte';
	import ColumnChooser from '$lib/valuation/components/ColumnChooser.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let query = $state('');
	let results = $state<{ name: string; symbol: string }[]>([]);
	let loading = $state(false);
	let saved = $state<SavedValuationMeta[]>([]);
	// False until the first load answers, so the empty-state message never flashes before data.
	let savedLoaded = $state(false);
	// Bumped whenever the watchlist changed, so the "Recently removed" list reloads too.
	let savedVersion = $state(0);
	async function refreshSaved() {
		saved = await listSavedValuations();
		savedLoaded = true;
		savedVersion++;
	}

	const me = $derived(data.user?.username ?? '');
	$effect(() => {
		refreshSaved();
	});

	// One scenario's FY+2E read: the implied price 2 years out under this scenario, the CAGR
	// that implies from CMP over those 2 years, and how much of that move has already happened
	// (CMP as a % of the implied price — "80%" means the stock is already 80% of the way there).
	interface ScenarioRead {
		impliedPrice: number | null;
		cagrPct: number | null;
		pctAchieved: number | null;
	}

	const EMPTY_SCENARIO: ScenarioRead = { impliedPrice: null, cagrPct: null, pctAchieved: null };

	interface WatchRow {
		symbol: string;
		name: string;
		cmp: number | null;
		marketCap: number | null;
		method: MethodId | null;
		methodLabel: string | null;
		bear: ScenarioRead;
		base: ScenarioRead;
		bull: ScenarioRead;
		sparkline: number[] | null;
		lastUpdated: number;
		updatedBy: string | null;
		status: ReviewStatus | null;
		statusStale: boolean;
		coveredBy: string | null;
		loading: boolean;
		error: boolean;
	}

	/** The fields that come from the saved-valuation list (not from the live company data). */
	function metaOf(s: SavedValuationMeta) {
		return {
			name: s.name,
			lastUpdated: s.lastUpdated,
			updatedBy: s.updatedBy ?? null,
			status: s.status ?? null,
			statusStale: s.statusStale ?? false,
			coveredBy: s.coveredBy ?? null
		};
	}

	// $state.raw, not $state: every update here replaces the array (and any changed row) with a
	// new reference via map/filter/spread — nothing ever mutates a row's fields in place — so
	// there's no need to pay for Svelte's deep reactive proxy on every row object.
	let watchRows = $state.raw<WatchRow[]>([]);

	function readScenario(
		method: MethodId,
		baseSales: number,
		baseBVPS: number,
		shares: number,
		assumptions: ScenarioAssumptions,
		cmp: number | null
	): ScenarioRead {
		const years = project(method, baseSales, baseBVPS, shares, assumptions);
		const fy2 = years[1];
		if (!fy2) return EMPTY_SCENARIO;
		const impliedPrice = fy2.impliedPrice;
		const cagrPct = cmp ? cagr(impliedPrice, cmp, 2) : null;
		const pctAchieved = cmp && impliedPrice > 0 ? (cmp / impliedPrice) * 100 : null;
		return { impliedPrice, cagrPct, pctAchieved };
	}

	async function loadRow(symbol: string) {
		try {
			const res = await fetch(`/api/valuation/company/${symbol}`);
			if (!res.ok) throw new Error('failed to load');
			const data = await res.json();

			let method: MethodId | null = null;
			let methodLabel: string | null = null;
			let bear = EMPTY_SCENARIO;
			let base = EMPTY_SCENARIO;
			let bull = EMPTY_SCENARIO;

			const record = await getSavedValuation(symbol);
			if (record) {
				if (record.activeMethod) {
					method = record.activeMethod;
				} else {
					// Older saved records (and imports) predate the activeMethod field — fall
					// back to the diagnosed method rather than defaulting silently to PE.
					const diagnosis = diagnoseValuationMethod({
						history: data.history ?? [],
						balanceSheet: data.balanceSheet ?? null,
						cashConversionCycle: data.cashConversionCycle ?? null,
						industry: data.industry ?? null
					});
					method = diagnosis.method;
				}
				methodLabel = METHOD_LABELS[method];

				const historyYears: { sales: number | null }[] = data.years ?? [];
				const baseSales = historyYears[historyYears.length - 1]?.sales ?? 0;
				const baseBVPS = data.bookValuePerShare ?? 0;
				const methodAssumptions = record.assumptions[method];

				bear = readScenario(
					method,
					baseSales,
					baseBVPS,
					record.shares,
					methodAssumptions.bear,
					data.cmp
				);
				base = readScenario(
					method,
					baseSales,
					baseBVPS,
					record.shares,
					methodAssumptions.base,
					data.cmp
				);
				bull = readScenario(
					method,
					baseSales,
					baseBVPS,
					record.shares,
					methodAssumptions.bull,
					data.cmp
				);
			}

			const values = {
				cmp: data.cmp,
				marketCap: data.marketCap,
				method,
				methodLabel,
				bear,
				base,
				bull
			};
			// Show the valuation as soon as it is computed. The sparkline comes from the
			// rate-limited market-data feed and can take much longer; it fills in afterwards.
			watchRows = watchRows.map((r) =>
				r.symbol === symbol ? { ...r, ...values, loading: false } : r
			);
			setCachedRow(symbol, { ...values, sparkline: null, fetchedAt: Date.now(), error: false });

			// Best-effort: not every saved symbol is Angel One-listed, and a missing sparkline
			// shouldn't fail the whole row.
			try {
				const sparkRes = await fetch(`/api/valuation/company/${symbol}/sparkline`);
				const sparkline: number[] | null = sparkRes.ok
					? ((await sparkRes.json()).closes ?? null)
					: null;
				if (sparkline) {
					watchRows = watchRows.map((r) => (r.symbol === symbol ? { ...r, sparkline } : r));
					setCachedRow(symbol, { ...values, sparkline, fetchedAt: Date.now(), error: false });
				}
			} catch {
				/* sparkline is optional */
			}
		} catch {
			watchRows = watchRows.map((r) =>
				r.symbol === symbol ? { ...r, loading: false, error: true } : r
			);
		}
	}

	// Only adds/removes rows for symbols that actually changed in `saved` — removing one
	// watchlist row (or importing one new symbol) used to reset every row back to `loading`
	// and re-fetch CMP + sparkline for all of them, turning a single-row UI action into a
	// full-table refetch paced through Angel One's rate limiter (seconds of visible reload
	// for a large watchlist). Rows that are still saved keep their already-fetched data.
	$effect(() => {
		const list = saved;

		// `watchRows` must be read and written without either becoming a dependency of this
		// effect — reading it here would make the effect depend on its own writes, which
		// re-triggers itself continuously (the same self-referential-effect trap fixed earlier
		// for the company page's shares default). `saved` is the only thing this effect should
		// react to.
		untrack(() => {
			const nextBySymbol = new Map(list.map((s) => [s.symbol, s]));
			const currentSymbols = new Set(watchRows.map((r) => r.symbol));

			// Rows still saved keep their live data; their saved-list fields (name, who updated it,
			// review status, analyst) are refreshed since a teammate may have changed them.
			watchRows = watchRows
				.filter((r) => nextBySymbol.has(r.symbol))
				.map((r) => ({ ...r, ...metaOf(nextBySymbol.get(r.symbol)!) }));

			for (const s of list) {
				if (currentSymbols.has(s.symbol)) continue;

				// A fresh-enough module-level cache entry survives navigating away and back to
				// this page (see watchlistCache.ts) — reuse it instead of re-fetching and
				// re-flashing every row's price/CAGR/sparkline on every single visit.
				const cached = getCachedRow(s.symbol);
				watchRows = [
					...watchRows,
					{
						symbol: s.symbol,
						...metaOf(s),
						cmp: cached?.cmp ?? null,
						marketCap: cached?.marketCap ?? null,
						method: cached?.method ?? null,
						methodLabel: cached?.methodLabel ?? null,
						bear: cached?.bear ?? EMPTY_SCENARIO,
						base: cached?.base ?? EMPTY_SCENARIO,
						bull: cached?.bull ?? EMPTY_SCENARIO,
						sparkline: cached?.sparkline ?? null,
						loading: cached == null,
						error: cached?.error ?? false
					}
				];
				if (!cached) loadRow(s.symbol);
			}
		});
	});

	// The person's own layout, saved on the server (see lib/prefs.ts): which columns, in what
	// order, the sort, and which view. Initial values come from the page load.
	// svelte-ignore state_referenced_locally
	const initialPrefs = latestWatchlistPrefs ?? (data.prefs ?? DEFAULT_PREFS).watchlist;
	let columns = $state<ColumnId[]>(initialPrefs.columns);
	let sortKey = $state<SortKey>(initialPrefs.sort.key);
	let sortDir = $state<'asc' | 'desc'>(initialPrefs.sort.dir);
	let view = $state<WatchlistView>(initialPrefs.view);
	// svelte-ignore state_referenced_locally
	let lists = $state<NamedWatchlist[]>(data.watchlists);

	let prefsTimer: ReturnType<typeof setTimeout> | undefined;
	function sendPrefs() {
		prefsTimer = undefined;
		void fetch('/api/valuation/me/prefs', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				watchlist: { columns, sort: { key: sortKey, dir: sortDir }, view }
			}),
			// Still delivered if the page is being left.
			keepalive: true
		}).catch(() => {});
	}
	function savePrefs() {
		// Remembered for this browser tab too: the layout's copy of the preferences is not
		// reloaded on client-side navigation, so coming back must not start from that stale copy.
		latestWatchlistPrefs = { columns, sort: { key: sortKey, dir: sortDir }, view };
		clearTimeout(prefsTimer);
		prefsTimer = setTimeout(sendPrefs, 300);
	}
	// Leaving before the debounce fires (e.g. sort, then open a company) must not lose the change.
	beforeNavigate(() => {
		if (prefsTimer !== undefined) {
			clearTimeout(prefsTimer);
			sendPrefs();
		}
	});

	function sortBy(key: SortKey) {
		if (sortKey === key) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortKey = key;
			sortDir = 'desc';
		}
		savePrefs();
	}

	function setColumns(next: ColumnId[]) {
		columns = next;
		savePrefs();
	}

	function setView(next: WatchlistView) {
		view = next;
		renaming = false;
		confirmDeleteList = false;
		listError = null;
		savePrefs();
	}

	const activeList = $derived(
		view.startsWith('list:') ? lists.find((l) => `list:${l.id}` === view) : undefined
	);
	// A list that was deleted (by anyone) falls back to the whole watchlist.
	const effectiveView = $derived<WatchlistView>(
		view.startsWith('list:') && !activeList ? 'all' : view
	);

	function inView(r: WatchRow, v: WatchlistView): boolean {
		if (v === 'all') return true;
		if (v === 'mine') return r.coveredBy === me;
		return lists.find((l) => `list:${l.id}` === v)?.symbols.includes(r.symbol) ?? false;
	}

	// "Changed since you last looked": rows a teammate saved after this person's previous visit.
	let previousVisit = $state<number | null>(null);
	$effect(() => {
		void fetch('/api/valuation/me/visit', { method: 'POST' })
			.then((r) => (r.ok ? r.json() : null))
			.then((d: { previous: number | null } | null) => (previousVisit = d?.previous ?? null))
			.catch(() => {});
	});
	function changedSinceVisit(r: WatchRow): boolean {
		return (
			previousVisit !== null &&
			r.lastUpdated > previousVisit &&
			r.updatedBy !== null &&
			r.updatedBy !== me
		);
	}

	// Target = the Base-case FY+2E implied price (the same figure the Base CAGR is read from);
	// fair value is the team's set % of it (Settings) - see lib/fairValue.ts.
	const fairValuePct = $derived(data.analysis?.valuation.fairValuePct ?? DEFAULT_FAIR_VALUE_PCT);

	let exporting = $state(false);
	let exportError = $state<string | null>(null);
	/** Every data column (whatever columns are shown) for the rows in the current view and sort. */
	async function exportWatchlist() {
		exporting = true;
		exportError = null;
		const viewName =
			effectiveView === 'all'
				? 'All'
				: effectiveView === 'mine'
					? 'My coverage'
					: (activeList?.name ?? 'List');
		try {
			await downloadWorkbook(`watchlist-${todayStamp()}`, [
				{
					name: 'Watchlist',
					notes: [
						`Watchlist (${viewName}) exported ${new Date().toLocaleString('en-IN')} by ${me}.`,
						`Target = Base-case FY+2E implied price; fair value = ${fairValuePct}% of the target; CAGRs are 2-year annualised returns to each scenario price.`
					],
					columns: [
						{ header: 'Company', width: 34 },
						{ header: 'Ticker', width: 14 },
						{ header: 'CMP', format: FORMATS.price },
						{ header: 'Target', format: FORMATS.price },
						{ header: 'Fair value', format: FORMATS.price },
						{ header: 'Upside to target', format: FORMATS.pct, width: 16 },
						{ header: 'Method', width: 16 },
						{ header: 'Bear price', format: FORMATS.price },
						{ header: 'Base price', format: FORMATS.price },
						{ header: 'Bull price', format: FORMATS.price },
						{ header: 'Bear CAGR', format: FORMATS.pct },
						{ header: 'Base CAGR', format: FORMATS.pct },
						{ header: 'Bull CAGR', format: FORMATS.pct },
						{ header: 'Market cap (Rs cr)', format: FORMATS.int, width: 18 },
						{ header: 'Review', width: 16 },
						{ header: 'Analyst', width: 16 },
						{ header: 'Last saved', width: 18 },
						{ header: 'Saved by', width: 16 }
					],
					rows: sortedRows.map((r) => {
						const target = targetOf(r);
						return [
							r.name,
							r.symbol,
							r.cmp,
							target,
							fairValueFromTarget(target, fairValuePct),
							upsidePct(target, r.cmp),
							r.methodLabel,
							r.bear.impliedPrice,
							r.base.impliedPrice,
							r.bull.impliedPrice,
							r.bear.cagrPct,
							r.base.cagrPct,
							r.bull.cagrPct,
							r.marketCap,
							r.status
								? REVIEW_STATUS_LABELS[r.status] + (r.statusStale ? ' (changed since)' : '')
								: null,
							r.coveredBy,
							new Date(r.lastUpdated).toLocaleString('en-IN'),
							r.updatedBy
						];
					})
				}
			]);
		} catch {
			exportError = 'Could not build the Excel file. Please try again.';
		} finally {
			exporting = false;
		}
	}

	function targetOf(r: WatchRow): number | null {
		return r.base.impliedPrice;
	}

	function reachedFairValue(r: WatchRow): boolean {
		const fv = fairValueFromTarget(targetOf(r), fairValuePct);
		return fv != null && r.cmp != null && r.cmp >= fv;
	}

	function fmtPrice(n: number | null): string {
		return n == null ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
	}

	function sortValue(r: WatchRow, key: SortKey): string | number | null {
		switch (key) {
			case 'target':
				return targetOf(r);
			case 'fairValue':
				return fairValueFromTarget(targetOf(r), fairValuePct);
			case 'upside':
				return upsidePct(targetOf(r), r.cmp);
			case 'bearCagr':
				return r.bear.cagrPct;
			case 'baseCagr':
				return r.base.cagrPct;
			case 'bullCagr':
				return r.bull.cagrPct;
			case 'symbol':
				return r.name;
			case 'status':
				return r.status ? ['draft', 'review_needed', 'approved'].indexOf(r.status) : null;
			case 'coverage':
				return r.coveredBy;
			default:
				return r[key];
		}
	}

	const sortedRows = $derived(
		watchRows
			.filter((r) => inView(r, effectiveView))
			.sort((a, b) => {
				const av = sortValue(a, sortKey);
				const bv = sortValue(b, sortKey);
				if (av == null && bv == null) return 0;
				if (av == null) return 1;
				if (bv == null) return -1;
				if (typeof av === 'string' && typeof bv === 'string') {
					return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
				}
				if (typeof av === 'number' && typeof bv === 'number') {
					return sortDir === 'asc' ? av - bv : bv - av;
				}
				return 0;
			})
	);

	function sortIndicator(key: SortKey) {
		if (sortKey !== key) return '';
		return sortDir === 'asc' ? ' ▲' : ' ▼';
	}

	function fmtPct(n: number | null) {
		return n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
	}

	function trendClass(n: number | null): string {
		if (n == null) return '';
		return n >= 0 ? 'wl-pos' : 'wl-neg';
	}

	function trendArrow(n: number | null): string {
		if (n == null) return '';
		return n >= 0 ? '▲' : '▼';
	}

	function fmtAchieved(n: number | null): string {
		return n == null ? '' : `${Math.round(n)}%`;
	}

	// A 60x20 SVG polyline of the last ~90 daily closes, normalized to the row's own min/max —
	// each sparkline is scaled to its own range, so it shows shape (the trend), not magnitude.
	function sparklinePoints(closes: number[] | null): string | null {
		if (!closes || closes.length < 2) return null;
		const min = Math.min(...closes);
		const max = Math.max(...closes);
		const range = max - min || 1;
		const w = 60;
		const h = 20;
		return closes
			.map((c, i) => {
				const x = (i / (closes.length - 1)) * w;
				const y = h - ((c - min) / range) * h;
				return `${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.join(' ');
	}

	function sparklineTone(closes: number[] | null): string {
		if (!closes || closes.length < 2) return '';
		return closes[closes.length - 1] >= closes[0] ? 'spark-pos' : 'spark-neg';
	}

	// Removing is recoverable (the valuation is kept in its history), so there is no "are you
	// sure?" - instead an Undo appears for a few seconds, and "Recently removed" keeps it longer.
	let undo = $state<{ symbol: string; name: string; versionId: number } | null>(null);
	let undoMessage = $state<string | null>(null);
	let undoTimer: ReturnType<typeof setTimeout> | undefined;

	async function remove(symbol: string, e: Event) {
		e.stopPropagation();
		const name = saved.find((s) => s.symbol === symbol)?.name ?? symbol;
		const versionId = await removeSavedValuation(symbol);
		evictCachedRow(symbol);
		await refreshSaved();
		clearTimeout(undoTimer);
		if (versionId === null) {
			undo = null;
			undoMessage = `Could not remove ${name} - try again.`;
		} else {
			undo = { symbol, name, versionId };
			undoMessage = null;
		}
		undoTimer = setTimeout(() => {
			undo = null;
			undoMessage = null;
		}, 10_000);
	}

	async function undoRemove() {
		if (!undo) return;
		const { symbol, name, versionId } = undo;
		undo = null;
		const res = await restoreValuation(symbol, versionId, 0);
		undoMessage = res.ok
			? `${name} is back on the watchlist.`
			: res.conflict
				? `${name} was already added back by someone else.`
				: `Could not undo: ${res.message}`;
		await refreshSaved();
	}

	// --- Named lists ------------------------------------------------------------------------------
	let newListName = $state('');
	let creatingList = $state(false);
	let renaming = $state(false);
	let renameText = $state('');
	let confirmDeleteList = $state(false);
	let listError = $state<string | null>(null);

	async function refreshLists() {
		const res = await fetch('/api/valuation/watchlists');
		if (res.ok) lists = (await res.json()) as NamedWatchlist[];
	}

	async function send(method: string, url: string, body?: unknown): Promise<string | null> {
		try {
			const res = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body)
			});
			if (res.ok) return null;
			const d = (await res.json().catch(() => null)) as { message?: string } | null;
			return d?.message ?? `Failed (HTTP ${res.status}).`;
		} catch {
			return 'Network error - nothing changed.';
		}
	}

	async function createList() {
		let res: Response;
		try {
			res = await fetch('/api/valuation/watchlists', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newListName })
			});
		} catch {
			listError = 'Network error - the list was not created.';
			return;
		}
		if (!res.ok) {
			listError =
				((await res.json().catch(() => null)) as { message?: string } | null)?.message ??
				'Could not create the list.';
			return;
		}
		const created = (await res.json()) as NamedWatchlist;
		newListName = '';
		creatingList = false;
		await refreshLists();
		setView(`list:${created.id}`);
	}

	async function renameList() {
		if (!activeList) return;
		listError = await send('PATCH', `/api/valuation/watchlists/${activeList.id}`, { name: renameText });
		if (!listError) renaming = false;
		await refreshLists();
	}

	async function deleteList() {
		if (!activeList) return;
		const err = await send('DELETE', `/api/valuation/watchlists/${activeList.id}`);
		confirmDeleteList = false;
		if (!err) setView('all');
		listError = err;
		await refreshLists();
	}

	async function setMembership(symbol: string, listId: number, member: boolean) {
		const err = await send('PUT', `/api/valuation/watchlists/${listId}/members`, { symbol, member });
		await refreshLists();
		return err;
	}

	const viewCount = (v: WatchlistView) => watchRows.filter((r) => inView(r, v)).length;
	const columnLabel = (id: ColumnId) => WATCHLIST_COLUMNS.find((c) => c.id === id)!.label;
	const columnHelp = (id: ColumnId) =>
		id === 'fairValue'
			? `${fairValuePct}% of the target (a team setting on the Settings page)`
			: WATCHLIST_COLUMNS.find((c) => c.id === id)!.help;
	const SORT_FOR: Partial<Record<ColumnId, SortKey>> = {
		cmp: 'cmp',
		target: 'target',
		fairValue: 'fairValue',
		upside: 'upside',
		baseCagr: 'baseCagr',
		bullCagr: 'bullCagr',
		bearCagr: 'bearCagr',
		marketCap: 'marketCap',
		status: 'status',
		coverage: 'coverage',
		updated: 'lastUpdated'
	};

	const IMPORT_EXAMPLE = `{
  "symbol": "TCS",
  "name": "Tata Consultancy Services",
  "methods": {
    "pe": {
      "base": { "revenueGrowthPct": 12, "expensePct": 78, "targetMultiple": 24 },
      "bull": { "revenueGrowthPct": 16, "expensePct": 75, "targetMultiple": 28 }
    }
  }
}`;

	let importOpen = $state(false);
	let importText = $state('');
	let importing = $state(false);
	let importResults = $state<ImportOutcome[] | null>(null);

	function onImportFileSelected(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			importText = String(reader.result ?? '');
		};
		reader.readAsText(file);
	}

	async function runImport() {
		importing = true;
		const parsed = parseImportPayload(importText);
		if ('error' in parsed) {
			importResults = [{ symbol: '(payload)', ok: false, message: parsed.error }];
			importing = false;
			return;
		}

		const outcomes: ImportOutcome[] = [];
		for (const candidate of parsed.candidates) {
			const validated = validateCandidate(candidate);
			if ('error' in validated) {
				outcomes.push({ symbol: '(entry)', ok: false, message: validated.error });
				continue;
			}
			const { symbol } = validated.input;

			// The JSON can be perfectly well-formed for a symbol that doesn't actually exist on
			// Screener (typo, wrong exchange, delisted) — confirm it resolves before saving,
			// rather than silently adding a watchlist row that can never load any data.
			try {
				const res = await fetch(`/api/valuation/company/${symbol}`);
				if (!res.ok) {
					const body = await res.json().catch(() => null);
					outcomes.push({
						symbol,
						ok: false,
						message:
							res.status === 404
								? `Not found on Screener — check the symbol is correct.`
								: (body?.message ?? `Could not verify this symbol (${res.status}).`)
					});
					continue;
				}
			} catch {
				outcomes.push({
					symbol,
					ok: false,
					message: 'Could not reach the server to verify this symbol — try again.'
				});
				continue;
			}

			const existing = await getSavedValuation(symbol);
			const record = buildImportedRecord(existing, validated.input);
			const saved = await saveSavedValuation(symbol, {
				...record,
				baseVersion: existing?.version ?? 0
			});
			outcomes.push(
				saved.ok
					? { symbol, ok: true, message: 'Imported' }
					: {
							symbol,
							ok: false,
							message: saved.conflict
								? `Someone else changed ${symbol} while you were importing - nothing was overwritten. Import it again.`
								: saved.message
						}
			);
		}

		importResults = outcomes;
		await refreshSaved();
		importing = false;
	}

	function formatDate(ts: number) {
		return new Date(ts).toLocaleDateString('en-IN', {
			day: '2-digit',
			month: 'short',
			year: 'numeric'
		});
	}

	let timer: ReturnType<typeof setTimeout>;
	function onInput() {
		clearTimeout(timer);
		timer = setTimeout(async () => {
			if (query.trim().length < 2) {
				results = [];
				return;
			}
			loading = true;
			try {
				const res = await fetch(`/api/valuation/search?q=${encodeURIComponent(query)}`);
				results = await res.json();
			} finally {
				loading = false;
			}
		}, 300);
	}

	function select(symbol: string) {
		goto(resolve('/valuation/company/[symbol]', { symbol }));
	}

	function goDirect() {
		if (query.trim()) goto(resolve('/valuation/company/[symbol]', { symbol: query.trim().toUpperCase() }));
	}
</script>

<svelte:head>
	<title>Watchlist · ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Watchlist</h1>
		<div class="sub">Bear, base and bull valuations for the companies you follow.</div>
	</div>
</div>

<div class="company-search">
	<label
		for="companySearch"
		class="field-label" style="display:block;margin-bottom:6px"
	>
		Search company
	</label>
	<input
		id="companySearch"
		placeholder="e.g. Reliance, AHCL, TCS..."
		bind:value={query}
		oninput={onInput}
		onkeydown={(e) => e.key === 'Enter' && goDirect()}
	/>
	{#if results.length > 0}
		<div class="search-results">
			{#each results as r (r.symbol)}
				<button onclick={() => select(r.symbol)}
					>{r.name} <span style="color:var(--muted)">({r.symbol})</span></button
				>
			{/each}
		</div>
	{:else if loading}
		<div style="margin-top:8px;color:var(--muted);font-size:13px">Searching…</div>
	{/if}
</div>

<div class="wrap wrap-wide">
	<div class="integrity-panel no-print">
		<button class="integrity-toggle" onclick={() => (importOpen = !importOpen)}>
			<svg
				class="import-icon"
				width="15"
				height="15"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				stroke-width="1.4"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="M8 2v7M5.2 6.2 8 9l2.8-2.8" />
				<path d="M2.5 10.5V13a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2.5" />
			</svg>
			<span>Import valuations (JSON)</span>
			<span class="integrity-caret">{importOpen ? '▲' : '▼'}</span>
		</button>
		{#if importOpen}
			<div class="import-body">
				<p class="import-hint">
					Paste JSON generated by Claude or any other tool, or upload a <code>.json</code> file.
					Each entry needs a <code>symbol</code> and a <code>methods</code> object keyed by method (<code
						>pe</code
					>, <code>pb</code>, <code>ev_ebitda</code>,
					<code>mcap_sales</code>) then scenario (<code>bear</code>, <code>base</code>,
					<code>bull</code>) — any field left out falls back to this app's own defaults. Submit an
					array to import several companies at once.
				</p>
				<pre class="import-example">{IMPORT_EXAMPLE}</pre>
				<textarea
					class="import-textarea"
					rows="8"
					bind:value={importText}
					placeholder="Paste JSON here..."></textarea>
				<div class="import-actions">
					<input
						class="import-file"
						type="file"
						accept="application/json,.json"
						onchange={onImportFileSelected}
					/>
					<button
						class="diagnosis-apply"
						onclick={runImport}
						disabled={importing || !importText.trim()}
					>
						{importing ? 'Importing…' : 'Import'}
					</button>
				</div>
				{#if importResults}
					<ul class="integrity-list">
						{#each importResults as r, i (r.symbol + i)}
							<li class={r.ok ? 'signal-good' : 'signal-bad'}>
								<span class="integrity-label">{r.symbol}</span>
								<span class="integrity-detail">{r.message}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</div>

	{#if undo || undoMessage}
		<div class="undo-toast" role="status" data-testid="undo-toast">
			{#if undo}
				Removed {undo.name} from the watchlist.
				<button class="link-btn" type="button" data-testid="undo" onclick={undoRemove}>Undo</button>
			{:else}
				{undoMessage}
			{/if}
		</div>
	{/if}

	{#if saved.length > 0}
		<div class="watchlist-section">
			<div class="exhibit-cap">My Valuations</div>
			<div class="exhibit-title" style="font-size:16px;margin-bottom:10px">Watchlist</div>

			<div class="wl-toolbar no-print">
				<div class="wl-views" role="group" aria-label="Watchlist views">
					<button
						type="button"
						class="wl-view"
						class:active={effectiveView === 'all'}
						aria-pressed={effectiveView === 'all'}
						onclick={() => setView('all')}>All ({watchRows.length})</button
					>
					<button
						type="button"
						class="wl-view"
						class:active={effectiveView === 'mine'}
						aria-pressed={effectiveView === 'mine'}
						data-testid="view-mine"
						onclick={() => setView('mine')}>My coverage ({viewCount('mine')})</button
					>
					{#each lists as l (l.id)}
						<button
							type="button"
							class="wl-view"
							class:active={effectiveView === `list:${l.id}`}
							aria-pressed={effectiveView === `list:${l.id}`}
							onclick={() => setView(`list:${l.id}`)}>{l.name} ({viewCount(`list:${l.id}`)})</button
						>
					{/each}
					{#if creatingList}
						<form
							class="wl-newlist"
							onsubmit={(e) => {
								e.preventDefault();
								void createList();
							}}
						>
							<input
								aria-label="New list name"
								bind:value={newListName}
								maxlength="60"
								placeholder="e.g. Q4 ideas"
							/>
							<button class="wl-strip-btn btn-primary" type="submit" disabled={!newListName.trim()}
								>Create</button
							>
							<button
								class="link-btn"
								type="button"
								onclick={() => {
									creatingList = false;
									listError = null;
								}}>Cancel</button
							>
						</form>
					{:else}
						<button
							class="link-btn"
							type="button"
							data-testid="new-list"
							onclick={() => (creatingList = true)}>+ New list</button
						>
					{/if}
				</div>
				<div class="wl-tools">
					<ColumnChooser {columns} onChange={setColumns} />
					<button
						class="wl-strip-btn"
						type="button"
						data-testid="export-excel"
						disabled={exporting || sortedRows.length === 0}
						onclick={exportWatchlist}>{exporting ? 'Exporting…' : 'Excel'}</button
					>
					<button class="wl-strip-btn" type="button" onclick={() => window.print()}
						>Print / PDF</button
					>
				</div>
				{#if exportError}<p class="team-error" role="alert">{exportError}</p>{/if}
			</div>

			{#if activeList}
				<div class="wl-listbar no-print" data-testid="list-bar">
					{#if renaming}
						<form
							class="wl-newlist"
							onsubmit={(e) => {
								e.preventDefault();
								void renameList();
							}}
						>
							<input aria-label="List name" bind:value={renameText} maxlength="60" />
							<button class="wl-strip-btn btn-primary" type="submit" disabled={!renameText.trim()}
								>Save</button
							>
							<button class="link-btn" type="button" onclick={() => (renaming = false)}
								>Cancel</button
							>
						</form>
					{:else}
						<span
							><strong>{activeList.name}</strong> · made by {activeList.createdBy} · shared with the team.</span
						>
						<select
							class="wl-add-to-list"
							aria-label="Add a company to {activeList.name}"
							data-testid="add-to-list"
							onchange={(e) => {
								const el = e.currentTarget as HTMLSelectElement;
								if (el.value) void setMembership(el.value, activeList.id, true);
								el.value = '';
							}}
						>
							<option value="">+ Add a company…</option>
							{#each watchRows
								.filter((w) => !activeList.symbols.includes(w.symbol))
								.sort((x, y) => x.name.localeCompare(y.name)) as c (c.symbol)}
								<option value={c.symbol}>{c.name}</option>
							{/each}
						</select>
						<button
							class="link-btn"
							type="button"
							onclick={() => {
								renaming = true;
								renameText = activeList.name;
							}}>Rename</button
						>
						{#if activeList.createdBy === me || data.user?.role === 'admin'}
							{#if confirmDeleteList}
								<span>Delete this list? Its companies stay on the watchlist.</span>
								<button class="link-btn danger" type="button" onclick={deleteList}
									>Yes, delete</button
								>
								<button class="link-btn" type="button" onclick={() => (confirmDeleteList = false)}
									>No</button
								>
							{:else}
								<button class="link-btn" type="button" onclick={() => (confirmDeleteList = true)}
									>Delete list</button
								>
							{/if}
						{/if}
					{/if}
				</div>
			{/if}
			{#if listError}<p class="team-error" role="alert">{listError}</p>{/if}

			{#if sortedRows.length === 0}
				<p class="wl-empty" data-testid="view-empty">
					{#if effectiveView === 'mine'}
						You don't cover any companies yet. Open a company and click <strong
							>I'll cover it</strong
						>
						in its Team panel.
					{:else}
						No companies on this list yet. Use <strong>+ Add a company</strong> above, or the
						<strong>Lists</strong> button on a company's page.
					{/if}
				</p>
			{:else}
				<!-- Scrollable regions must be keyboard-focusable (WCAG 2.1.1). -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div class="table-scroll" tabindex="0" role="region" aria-label="Watchlist table">
					<table class="watchlist-table">
						<thead>
							<tr>
								<th
									class="sortable left"
									aria-sort={sortKey === 'symbol'
										? sortDir === 'asc'
											? 'ascending'
											: 'descending'
										: undefined}
								>
									<button type="button" class="th-sort" onclick={() => sortBy('symbol')}
										>Company{sortIndicator('symbol')}</button
									>
								</th>
								{#each columns as col (col)}
									{@const key = SORT_FOR[col]}
									{#if key}
										<th
											class="sortable"
											title={columnHelp(col)}
											aria-sort={sortKey === key
												? sortDir === 'asc'
													? 'ascending'
													: 'descending'
												: undefined}
										>
											<button type="button" class="th-sort" onclick={() => sortBy(key)}
												>{columnLabel(col)}{sortIndicator(key)}</button
											>
										</th>
									{:else}
										<th title={columnHelp(col)}>{columnLabel(col)}</th>
									{/if}
								{/each}
								<th><span class="sr-only">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							{#each sortedRows as r (r.symbol)}
								<tr
									class="watch-row"
									class:wl-changed={changedSinceVisit(r)}
									onclick={(e) => {
										// Controls inside the row (links, list menu, remove) do their own thing.
										const t = e.target as HTMLElement;
										if (t.closest('a, button, summary, details, input, label, [role="button"]'))
											return;
										select(r.symbol);
									}}
								>
									<td class="left">
										<a class="wl-name" href={resolve('/valuation/company/[symbol]', { symbol: r.symbol })}
											>{r.name}</a
										>
										{#if changedSinceVisit(r)}<span
												class="wl-new"
												data-testid="changed-since-visit"
												title="Saved by {r.updatedBy} since your last visit">updated</span
											>{/if}
										<span class="wl-meta">
											<span class="wl-symbol">{r.symbol}</span>
											{#if r.methodLabel}<span class="wl-method"
													>{r.methodLabel.split(' — ')[0]} · FY+2E</span
												>{/if}
										</span>
									</td>
									{#if r.error}
										<td colspan={columns.length} class="wl-error">
											⚠ Couldn't load this company — the symbol may be wrong, delisted, or not on
											Screener. <a href={resolve('/valuation/company/[symbol]', { symbol: r.symbol })}
												>Open it directly</a
											> to see the exact error.
										</td>
									{:else}
										{#each columns as col (col)}
											{@render cell(r, col)}
										{/each}
									{/if}
									<td class="wl-actions">
										{#if activeList}
											<button
												class="link-btn"
												type="button"
												aria-label="Take {r.name} off {activeList.name}"
												onclick={() => setMembership(r.symbol, activeList.id, false)}
												>Take off list</button
											>
										{:else}
											<span
												role="button"
												tabindex="0"
												class="wl-remove"
												aria-label="Remove {r.name} from the watchlist"
												title="Remove from the watchlist (you can undo)"
												onclick={(e) => remove(r.symbol, e)}
												onkeydown={(e) => e.key === 'Enter' && remove(r.symbol, e)}
											>
												✕
											</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{:else if savedLoaded}
		<p class="wl-empty" data-testid="watchlist-empty">
			Your watchlist is empty. Search for a company above, open it, and click
			<strong>Add to watchlist</strong> to start tracking its target, fair value and upside here - or
			import valuations from JSON.
		</p>
	{/if}

	<div class="no-print">
		<RemovedValuations refreshKey={savedVersion} onRestored={refreshSaved} />
		<ActivityFeed />
	</div>

	{#snippet scenario(sc: ScenarioRead, loading: boolean)}
		<td class="wl-scenario">
			{#if loading}
				…
			{:else if sc.cagrPct == null}
				—
			{:else}
				<span class="wl-scenario-stack">
					<span class={trendClass(sc.cagrPct)}>{trendArrow(sc.cagrPct)} {fmtPct(sc.cagrPct)}</span>
					{#if sc.pctAchieved != null}<span class="wl-badge wl-achieved"
							>{fmtAchieved(sc.pctAchieved)}</span
						>{/if}
				</span>
			{/if}
		</td>
	{/snippet}

	{#snippet cell(r: WatchRow, col: ColumnId)}
		{#if col === 'cmp'}
			<td data-col="cmp">{r.loading ? '…' : fmtPrice(r.cmp)}</td>
		{:else if col === 'target'}
			<td class="wl-target" data-col="target">{r.loading ? '…' : fmtPrice(targetOf(r))}</td>
		{:else if col === 'fairValue'}
			<td class="wl-target" data-col="fair-value">
				{#if r.loading}
					…
				{:else}
					{#if reachedFairValue(r)}<span
							class="wl-badge wl-fv-reached"
							title="CMP is at or above fair value">Reached</span
						>{/if}{fmtPrice(fairValueFromTarget(targetOf(r), fairValuePct))}
				{/if}
			</td>
		{:else if col === 'upside'}
			<td class="wl-upside" data-col="upside">
				{#if r.loading}
					…
				{:else}
					{@const up = upsidePct(targetOf(r), r.cmp)}
					{#if up == null}—{:else}<span class={trendClass(up)}>{trendArrow(up)} {fmtPct(up)}</span
						>{/if}
				{/if}
			</td>
		{:else if col === 'baseCagr'}
			{@render scenario(r.base, r.loading)}
		{:else if col === 'bullCagr'}
			{@render scenario(r.bull, r.loading)}
		{:else if col === 'bearCagr'}
			{@render scenario(r.bear, r.loading)}
		{:else if col === 'marketCap'}
			<td data-col="market-cap"
				>{r.loading
					? '…'
					: r.marketCap == null
						? '—'
						: `₹${r.marketCap.toLocaleString('en-IN')} cr`}</td
			>
		{:else if col === 'trend'}
			<td data-col="trend">
				{#if r.sparkline}
					<svg
						class="sparkline {sparklineTone(r.sparkline)}"
						viewBox="0 0 60 20"
						preserveAspectRatio="none"
						role="img"
						aria-label="Price trend"
					>
						<polyline points={sparklinePoints(r.sparkline)} />
					</svg>
				{:else if !r.loading}
					<span class="wl-symbol">—</span>
				{/if}
			</td>
		{:else if col === 'status'}
			<td data-col="status">
				{#if r.status}
					<span class="status-chip status-{r.status}">{REVIEW_STATUS_LABELS[r.status]}</span>
					{#if r.statusStale}<span class="wl-by" title="The valuation changed after it was approved"
							>changed since</span
						>{/if}
				{:else}
					<span class="muted">—</span>
				{/if}
			</td>
		{:else if col === 'coverage'}
			<td data-col="coverage">{r.coveredBy ?? '—'}</td>
		{:else if col === 'updated'}
			<td class="wl-updated" data-col="updated" title={timeAgo(r.lastUpdated)}>
				{formatDate(r.lastUpdated)}
				{#if r.updatedBy}<span class="wl-by wl-by-name" title="Saved by {r.updatedBy}"
						>{r.updatedBy}</span
					>{/if}
			</td>
		{/if}
	{/snippet}
</div>
