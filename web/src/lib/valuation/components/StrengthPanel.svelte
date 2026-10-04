<script lang="ts">
	import { onMount } from 'svelte';
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
		title?: string;
	} = $props();

	let config = $state<StrengthConfig>(structuredClone(DEFAULT_STRENGTH_CONFIG));
	let loadedPrefs = $state(false);
	// Open by default for a single company with filters on; otherwise closed until opened.
	let openByDefault = $state(false);
	const open = $derived(openState === 'auto' ? openByDefault : openState === 'open');
	let customPeriod = $state(false);
	let loading = $state(false);
	let total = $state(0);
	let matches = $state(0);
	let unavailableCount = $state(0);

	const active = $derived(isStrengthActive(config, kind));
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

	// What the server last stored for this level, so only a real change is sent.
	let savedSnapshot = '';
	function savePref(snapshot: string, lvl: StrengthLevel) {
		if (snapshot === savedSnapshot) return;
		savedSnapshot = snapshot;
		// Remembered for next time (including "no filter"). Read-only people cannot write, so
		// failure is fine.
		void fetch('/api/valuation/strength/prefs', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ level: lvl, config: JSON.parse(snapshot) })
		}).catch(() => {});
	}

	/** Back to the default filter (everything off). Used by the page's "Reset this view". */
	export function reset() {
		config = structuredClone(DEFAULT_STRENGTH_CONFIG);
		customPeriod = false;
	}

	onMount(async () => {
		try {
			const res = await fetch(`/api/valuation/strength/prefs?level=${level}`);
			if (res.ok) {
				const body = (await res.json()) as { config: unknown };
				if (body.config) config = parseStrengthConfig(body.config);
			}
		} catch {
			// no saved settings: start from the defaults
		}
		savedSnapshot = JSON.stringify(config);
		customPeriod = !PERIOD_PRESETS.some((p) => p.days === config.periodDays);
		openByDefault = isStrengthActive(config, kind) && kind === 'company';
		loadedPrefs = true;
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
			const quiet = setTimeout(() => savePref(snapshot, lvl), 600);
			return () => clearTimeout(quiet);
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
				savePref(snapshot, lvl);
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
				business growth or a forecast. Data refreshes about every 2 hours.
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
							data checked about every 2 hours. Goes to the whole team.
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
