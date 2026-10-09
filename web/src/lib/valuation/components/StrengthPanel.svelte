<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		DEFAULT_STRENGTH_CONFIG,
		PERIOD_PRESETS,
		describeStrengthConfig,
		emptyStrengthView,
		isStrengthActive,
		parseStrengthConfig,
		type StrengthConfig,
		type StrengthLevel,
		type StrengthResult,
		type StrengthView
	} from '$lib/valuation/strength';
	import type { PanelState } from '$lib/viewMemory';

	// The Strength & Volume filter, the same panel on every level of the sector -> subsector ->
	// company journey. It sends its settings to /api/valuation/strength (the one calculation the
	// alert checks also use) and hands the result to the page through `view`; the page decides
	// what to hide. "Create alert" saves exactly the settings being shown.
	let {
		level,
		parentKey = null,
		kind,
		scopeLabel,
		canSave = true,
		view = $bindable(emptyStrengthView()),
		openState = $bindable<PanelState>('auto'),
		settled = $bindable(false),
		title = 'Strength & Volume'
	}: {
		level: StrengthLevel;
		parentKey?: string | null;
		/** company: no spreading controls (a single stock has no constituents). */
		kind: 'group' | 'company';
		/** What an alert saved from here would watch, in words ("every sector"). */
		scopeLabel: string;
		canSave?: boolean;
		view?: StrengthView;
		/** Remembered by the page: 'auto' follows the default until the person opens or closes it. */
		openState?: PanelState;
		/** True once this place's saved filter has loaded and, when it is on, been evaluated, so a
		 *  page can wait for it before showing cards the filter might still hide. */
		settled?: boolean;
		title?: string;
	} = $props();

	let config = $state<StrengthConfig>(structuredClone(DEFAULT_STRENGTH_CONFIG));
	let loadedPrefs = $state(false);
	// The place whose saved filter is on screen ("level|scope"); changes are saved only for it.
	let loadedFor = $state('');
	// Open by default for a single company with filters on; otherwise closed until opened.
	let openByDefault = $state(false);
	const open = $derived(openState === 'auto' ? openByDefault : openState === 'open');
	let customPeriod = $state(false);
	let loading = $state(false);
	let total = $state(0);
	let matches = $state(0);
	let unavailableCount = $state(0);

	const active = $derived(isStrengthActive(config, kind));
	$effect(() => {
		settled = loadedPrefs && loadedFor === `${level}|${scope}` && (!active || view.ready || view.error != null);
	});
	const chips = $derived(describeStrengthConfig(config, kind));
	const periodSelect = $derived(
		customPeriod || !PERIOD_PRESETS.some((p) => p.days === config.periodDays)
			? 'custom'
			: String(config.periodDays)
	);
	const priceSignalCount = $derived(
		Number(config.sudden.enabled) +
			Number(config.gradual.enabled) +
			Number(kind === 'group' && config.spreading.enabled)
	);

	// The filter is remembered per person for each place it is used: every sector, each sector's
	// subsectors, each subsector's companies and each company keep their own settings.
	const scope = $derived(parentKey ?? '');
	const prefsUrl = '/api/valuation/strength/prefs';

	// What the server holds for the place shown, so only a real change is sent; and a change not
	// yet sent, so leaving the page straight after a change still keeps it.
	let savedSnapshot = '';
	let unsaved: { level: StrengthLevel; scope: string; snapshot: string } | null = null;
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let saveError = $state(false);

	async function sendPref(pending: NonNullable<typeof unsaved>, leaving = false) {
		try {
			const res = await fetch(prefsUrl, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ level: pending.level, scope: pending.scope, config: JSON.parse(pending.snapshot) }),
				// Still delivered when the page is being left.
				keepalive: leaving
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			if (leaving) return;
			if (pending.level === level && pending.scope === scope) savedSnapshot = pending.snapshot;
			saveError = false;
		} catch {
			// Kept as unsaved (unless a newer change replaced it): leaving the page tries again.
			unsaved ??= pending;
			if (!leaving) saveError = true;
		}
	}
	/** Sends a change not yet sent, at once (and once only). */
	function flushPref(leaving: boolean) {
		clearTimeout(saveTimer);
		saveTimer = undefined;
		const pending = unsaved;
		unsaved = null;
		if (pending) void sendPref(pending, leaving);
	}

	// Remember each change shortly after it is made (including "no filter").
	$effect(() => {
		if (loadedFor !== `${level}|${scope}`) return;
		const snapshot = JSON.stringify(config);
		if (snapshot === savedSnapshot) {
			// Back to what is saved: nothing is left to send.
			unsaved = null;
			saveError = false;
			clearTimeout(saveTimer);
			return;
		}
		unsaved = { level, scope, snapshot };
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => flushPref(false), 500);
	});

	beforeNavigate(() => flushPref(true));
	onMount(() => {
		const onHide = () => flushPref(true);
		const onVisibility = () => document.visibilityState === 'hidden' && onHide();
		window.addEventListener('pagehide', onHide);
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			window.removeEventListener('pagehide', onHide);
			document.removeEventListener('visibilitychange', onVisibility);
			flushPref(true);
		};
	});

	/** Back to the default filter (everything off). Used by the page's "Reset this view". */
	export function reset() {
		config = structuredClone(DEFAULT_STRENGTH_CONFIG);
		customPeriod = false;
	}

	// Load the saved filter for this place (again when the same page moves to another sector).
	$effect(() => {
		const lvl = level;
		const sc = scope;
		let cancelled = false;
		const shownBefore = untrack(() => JSON.stringify(config));
		(async () => {
			let saved: StrengthConfig | null = null;
			try {
				const res = await fetch(`${prefsUrl}?${new URLSearchParams({ level: lvl, scope: sc })}`);
				if (res.ok) {
					const body = (await res.json()) as { config: unknown };
					if (body.config) saved = parseStrengthConfig(body.config);
				}
			} catch {
				// no saved settings: start from the defaults
			}
			if (cancelled) return;
			untrack(() => {
				// A change made while this was loading is the person's latest choice: it stays (and is
				// then saved for this place). Otherwise the saved filter, or the defaults, are shown.
				if (JSON.stringify(config) === shownBefore)
					config = saved ?? structuredClone(DEFAULT_STRENGTH_CONFIG);
				savedSnapshot = JSON.stringify(saved ?? DEFAULT_STRENGTH_CONFIG);
				customPeriod = !PERIOD_PRESETS.some((p) => p.days === config.periodDays);
				openByDefault = isStrengthActive(config, kind) && kind === 'company';
				loadedPrefs = true;
				loadedFor = `${lvl}|${sc}`;
			});
		})();
		return () => {
			cancelled = true;
			// Moving to another place: what was changed here is still saved for here.
			untrack(() => flushPref(false));
		};
	});

	// Re-evaluate shortly after the last change; an older in-flight request is dropped.
	$effect(() => {
		if (!loadedPrefs) return;
		const snapshot = JSON.stringify(config);
		const isActive = active;
		const lvl = level;
		const parent = parentKey;
		if (!isActive) {
			view = emptyStrengthView();
			total = matches = unavailableCount = 0;
			loading = false;
			return;
		}
		const controller = new AbortController();
		loading = true;
		const timer = setTimeout(async () => {
			try {
				const qs = new URLSearchParams({ level: lvl, config: snapshot });
				if (parent) qs.set('parent', parent);
				const res = await fetch(`/api/valuation/strength?${qs}`, { signal: controller.signal });
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const result = (await res.json()) as StrengthResult;
				const byKey = Object.fromEntries(result.rows.map((r) => [r.key, r.evaluation]));
				total = result.rows.length;
				matches = result.rows.filter((r) => r.evaluation.matched).length;
				unavailableCount = result.rows.filter((r) => r.evaluation.unavailable.length > 0).length;
				view = { active: true, ready: true, error: null, asOf: result.asOf, byKey };
			} catch (e) {
				if ((e as Error).name === 'AbortError') return;
				view = { ...emptyStrengthView(), active: true, error: 'Could not calculate this filter.' };
			}
			loading = false;
		}, 350);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});

	function clear() {
		config = {
			...structuredClone(DEFAULT_STRENGTH_CONFIG),
			periodDays: config.periodDays,
			baselineDays: config.baselineDays
		};
	}

	function setPeriod(value: string) {
		if (value === 'custom') {
			customPeriod = true;
			return;
		}
		customPeriod = false;
		config.periodDays = Number(value);
	}

	// ---- alert from this filter ----
	let alertOpen = $state(false);
	let alertName = $state('');
	let repeatMode = $state<'once' | 'rearm'>('rearm');
	let cooldown = $state(5);
	let saving = $state(false);
	let saveMessage = $state<{ ok: boolean; text: string } | null>(null);

	function openAlert() {
		alertName = `${scopeLabel}: ${chips.join(', ')}`.slice(0, 120);
		saveMessage = null;
		alertOpen = true;
	}

	async function saveAlert() {
		saving = true;
		saveMessage = null;
		try {
			const res = await fetch('/api/valuation/strength/rules', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: alertName,
					level,
					parentKey,
					config,
					repeat: { mode: repeatMode, cooldownSessions: cooldown }
				})
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				throw new Error(body?.message ?? `Could not save (${res.status}).`);
			}
			saveMessage = { ok: true, text: 'Alert saved. The whole team will be notified on entry.' };
			alertOpen = false;
		} catch (e) {
			saveMessage = { ok: false, text: e instanceof Error ? e.message : 'Could not save the alert.' };
		}
		saving = false;
	}

	const fieldId = (n: string) => `sv-${level}-${n}`;
</script>

<section class="sv-panel" aria-label="{title} filters" data-testid="strength-panel">
	<div class="sv-head">
		<button
			type="button"
			class="sv-toggle"
			aria-expanded={open}
			aria-controls={fieldId('body')}
			onclick={() => (openState = open ? 'closed' : 'open')}
		>
			<span class="sv-title">{title}</span>
			<span class="sv-caret" aria-hidden="true">{open ? '▲' : '▼'}</span>
		</button>

		{#if active}
			<ul class="sv-chips" aria-label="Active filters">
				{#each chips as c (c)}<li class="sv-chip">{c}</li>{/each}
			</ul>
			<span class="sv-count" role="status">
				{#if view.error}
					{view.error}
				{:else if loading && !view.ready}
					Calculating…
				{:else}
					{matches} of {total} match{unavailableCount ? ` · ${unavailableCount} unavailable` : ''}
				{/if}
			</span>
			<button type="button" class="sector-sort-dir" onclick={clear}>Clear filters</button>
		{:else}
			<span class="sv-hint"
				>{kind === 'company'
					? 'Switch on a signal to track this stock against Nifty 50.'
					: 'Find sudden or gradual strength, spreading participation and volume.'}</span
			>
		{/if}
	</div>
	{#if saveError}
		<p class="sv-save-error" role="status">
			This filter could not be saved for next time. It is tried again with your next change.
		</p>
	{/if}

	{#if open}
		<div class="sv-body" id={fieldId('body')}>
			<div class="sv-row">
				<label class="sv-field">
					<span>Measurement period</span>
					<select value={periodSelect} onchange={(e) => setPeriod(e.currentTarget.value)}>
						{#each PERIOD_PRESETS as p (p.days)}
							<option value={String(p.days)}>{p.label} ({p.days} {p.days === 1 ? 'session' : 'sessions'})</option>
						{/each}
						<option value="custom">Custom</option>
					</select>
				</label>
				{#if periodSelect === 'custom'}
					<label class="sv-field">
						<span>Trading days</span>
						<input type="number" min="1" max="63" bind:value={config.periodDays} />
					</label>
				{/if}
				<label class="sv-field">
					<span>Normal behaviour baseline (sessions)</span>
					<input type="number" min="30" max="252" bind:value={config.baselineDays} />
				</label>
				{#if priceSignalCount > 1}
					<label class="sv-field">
						<span>Price signals</span>
						<select bind:value={config.match}>
							<option value="any">Match any</option>
							<option value="all">Match all</option>
						</select>
					</label>
				{/if}
			</div>

			<div class="sv-signals">
				<fieldset class="sv-signal" class:sv-on={config.sudden.enabled}>
					<legend>
						<label class="sv-check"
							><input type="checkbox" bind:checked={config.sudden.enabled} /> Suddenly strengthening</label
						>
					</legend>
					<p class="sv-help">
						Relative performance vs Nifty over the measurement period jumps far above this
						{kind === 'company' ? 'stock' : 'group'}'s own usual range.
					</p>
					<div class="sv-row">
						<label class="sv-field" title="Adaptive compares with this subject's own history; Fixed uses a set number of points.">
							<span>Sensitivity</span>
							<select bind:value={config.sudden.mode}>
								<option value="adaptive">Adaptive</option>
								<option value="explicit">Fixed</option>
							</select>
						</label>
						{#if config.sudden.mode === 'adaptive'}
							<label class="sv-field" title="How many standard deviations above its usual relative strength">
								<span>Z-score at least</span>
								<input type="number" min="0.5" max="6" step="0.5" bind:value={config.sudden.z} />
							</label>
							<label class="sv-field">
								<span>Min RS (pts)</span>
								<input type="number" min="0" max="50" step="0.5" bind:value={config.sudden.minRsPct} />
							</label>
						{:else}
							<label class="sv-field">
								<span>RS at least (pts)</span>
								<input
									type="number"
									min="0.1"
									max="100"
									step="0.5"
									bind:value={config.sudden.explicitRsPct}
								/>
							</label>
						{/if}
					</div>
				</fieldset>

				<fieldset class="sv-signal" class:sv-on={config.gradual.enabled}>
					<legend>
						<label class="sv-check"
							><input type="checkbox" bind:checked={config.gradual.enabled} /> Gradually strengthening</label
						>
					</legend>
					<p class="sv-help">
						Beats Nifty on enough sessions in the window, with a real gain that is not one
						isolated jump.
					</p>
					<div class="sv-row">
						<label class="sv-field">
							<span>Window (sessions)</span>
							<input type="number" min="3" max="60" bind:value={config.gradual.days} />
						</label>
						<label class="sv-field" title="Sessions in the window where it beat Nifty">
							<span>Improving days</span>
							<input
								type="number"
								min="1"
								max={config.gradual.days}
								bind:value={config.gradual.minImprovingSessions}
							/>
						</label>
						<label class="sv-field">
							<span>Min gain (%)</span>
							<input type="number" min="0" max="50" step="0.5" bind:value={config.gradual.minGainPct} />
						</label>
					</div>
				</fieldset>

				{#if kind === 'group'}
					<fieldset class="sv-signal" class:sv-on={config.spreading.enabled}>
						<legend>
							<label class="sv-check"
								><input type="checkbox" bind:checked={config.spreading.enabled} /> Strength spreading</label
							>
						</legend>
						<p class="sv-help">
							A growing share of constituent stocks outperform Nifty over the window.
						</p>
						<div class="sv-row">
							<label class="sv-field">
								<span>Window (sessions)</span>
								<input type="number" min="3" max="63" bind:value={config.spreading.days} />
							</label>
							<label class="sv-field">
								<span>Participating (%)</span>
								<input
									type="number"
									min="10"
									max="100"
									step="5"
									bind:value={config.spreading.minBreadthPct}
								/>
							</label>
							<label class="sv-field">
								<span>Up by (pts)</span>
								<input type="number" min="0" max="100" step="5" bind:value={config.spreading.minChangePts} />
							</label>
						</div>
					</fieldset>
				{/if}

				<fieldset class="sv-signal" class:sv-on={config.volume.enabled}>
					<legend>
						<label class="sv-check"
							><input type="checkbox" bind:checked={config.volume.enabled} /> Volume confirmation (optional)</label
						>
					</legend>
					<p class="sv-help">
						Trading activity is well above its previous average while price outperforms. With a
						price signal on, volume must also hold; on its own it is a signal.
					</p>
					<div class="sv-row">
						<label class="sv-field">
							<span>Recent (sessions)</span>
							<input type="number" min="1" max="63" bind:value={config.volume.days} />
						</label>
						<label class="sv-field" title="Average volume of the sessions before the recent period">
							<span>Vs previous (sess.)</span>
							<input type="number" min="5" max="126" bind:value={config.volume.baselineDays} />
						</label>
						<label class="sv-field">
							<span>Min (x average)</span>
							<input type="number" min="1" max="20" step="0.1" bind:value={config.volume.minRatio} />
						</label>
					</div>
				</fieldset>
			</div>

			<p class="sv-foot">
				Based on daily closes and volume vs Nifty 50, completed sessions only
				{view.asOf ? `(latest: ${view.asOf})` : ''}. These are price and trading-activity readings, not
				business growth or a forecast. Data refreshes after each weekday's close.
			</p>

			<div class="sv-alert">
				{#if !alertOpen}
					<button
						type="button"
						class="diagnosis-apply"
						onclick={openAlert}
						disabled={!active || !canSave}
						title={!canSave
							? 'Read-only accounts cannot create alerts'
							: !active
								? 'Switch on a signal first'
								: 'Alert the team when something enters this filter'}
					>
						{kind === 'company' ? 'Track strength & volume' : 'Create alert from this filter'}
					</button>
				{:else}
					<div class="sv-alert-form">
						<label class="sv-field sv-grow">
							<span>Alert name</span>
							<input type="text" maxlength="120" bind:value={alertName} />
						</label>
						<label class="sv-field">
							<span>Repeat</span>
							<select bind:value={repeatMode}>
								<option value="rearm">Alert on every new entry</option>
								<option value="once">Only the first time</option>
							</select>
						</label>
						{#if repeatMode === 'rearm'}
							<label class="sv-field">
								<span>Cooldown (sessions)</span>
								<input type="number" min="0" max="60" bind:value={cooldown} />
							</label>
						{/if}
						<div class="sv-alert-actions">
							<button type="button" class="diagnosis-apply" onclick={saveAlert} disabled={saving || !alertName.trim()}>
								{saving ? 'Saving…' : 'Save alert'}
							</button>
							<button type="button" class="sector-sort-dir" onclick={() => (alertOpen = false)}>Cancel</button>
						</div>
						<p class="sv-foot sv-grow">
							Watches {scopeLabel}. Fires when something enters this condition, using end-of-day
							data checked after each weekday's close. Goes to the whole team.
						</p>
					</div>
				{/if}
				{#if saveMessage}
					<p class="sv-msg {saveMessage.ok ? 'sv-msg-ok' : 'sv-msg-bad'}" role="status">
						{saveMessage.text}
						{#if saveMessage.ok}<a href={resolve('/valuation/alerts')}>Manage alerts &rarr;</a>{/if}
					</p>
				{/if}
			</div>
		</div>
	{/if}
</section>
