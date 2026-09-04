<script lang="ts">
	// Ports the remaining drawer.js action panels (observation entry, decision
	// logging, price entry + performance, health-check/outcome submission) into
	// Svelte 5. position_decisions is append-only via a DB trigger, so the
	// decision panel is insert-only - no edit/delete UI, matching the backend.
	import { api, ApiError } from '$lib/api';
	import { session } from '$lib/session.svelte';
	import { STATUS_STYLES } from '$lib/format';

	let { companyId }: { companyId: string } = $props();

	function apiErrorMessage(e: unknown): string {
		if (e instanceof ApiError) {
			const body = e.body as { message?: string } | string;
			return typeof body === 'string' ? body : (body?.message ?? e.message);
		}
		return String(e);
	}

	const today = () => new Date().toISOString().slice(0, 10);

	// ---- Observations ----
	let obsPeriod = $state('');
	let obsPeriodEnd = $state(today());
	let obsMetricKey = $state('');
	let obsNumericValue = $state('');
	let obsTextValue = $state('');
	let obsNote = $state('');
	let obsSubmitting = $state(false);
	let obsError = $state('');
	let obsSuccess = $state('');

	async function submitObservation() {
		obsError = '';
		obsSuccess = '';
		if (!obsPeriod.trim() || !obsMetricKey.trim()) {
			obsError = 'Period and metric key are required.';
			return;
		}
		obsSubmitting = true;
		try {
			await api.postObservations(companyId, {
				period: obsPeriod.trim(),
				period_end: obsPeriodEnd,
				observations: [
					{
						metric_key: obsMetricKey.trim(),
						numeric_value: obsNumericValue !== '' ? Number(obsNumericValue) : null,
						text_value: obsTextValue.trim() || null,
						note: obsNote.trim() || null
					}
				]
			});
			obsSuccess = 'Observation recorded.';
			obsMetricKey = '';
			obsNumericValue = '';
			obsTextValue = '';
			obsNote = '';
		} catch (e) {
			obsError = apiErrorMessage(e);
		} finally {
			obsSubmitting = false;
		}
	}

	// ---- Decisions ----
	type Decision = {
		id: number;
		action: string;
		price: number;
		quantity: number | null;
		decided_on: string;
		rationale: string;
		actor: string;
		created_at: string;
	};
	let decisions = $state<Decision[]>([]);
	let decisionsLoading = $state(true);
	let decisionsError = $state('');
	let decAction = $state<'buy' | 'sell'>('buy');
	let decPrice = $state('');
	let decQuantity = $state('');
	let decDecidedOn = $state(today());
	let decRationale = $state('');
	let decSubmitting = $state(false);

	async function loadDecisions() {
		decisionsLoading = true;
		decisionsError = '';
		try {
			decisions = (await api.listDecisions(companyId)) as Decision[];
		} catch (e) {
			decisionsError = apiErrorMessage(e);
		} finally {
			decisionsLoading = false;
		}
	}

	async function submitDecision() {
		decisionsError = '';
		if (!decPrice || !decDecidedOn || !decRationale.trim()) {
			decisionsError = 'Price, date, and rationale are required.';
			return;
		}
		decSubmitting = true;
		try {
			await api.logDecision(companyId, {
				action: decAction,
				price: Number(decPrice),
				quantity: decQuantity !== '' ? Number(decQuantity) : null,
				decided_on: decDecidedOn,
				rationale: decRationale.trim()
			});
			decPrice = '';
			decQuantity = '';
			decRationale = '';
			await loadDecisions();
		} catch (e) {
			decisionsError = apiErrorMessage(e);
		} finally {
			decSubmitting = false;
		}
	}

	// ---- Prices + performance ----
	type Performance = {
		baseline_mode: string;
		baseline_date: string | null;
		baseline_price: number | null;
		current_date: string | null;
		current_price: number | null;
		pct_change: number | null;
		currency: string;
		note: string | null;
	};
	let performance = $state<Performance | null>(null);
	let performanceLoading = $state(true);
	let performanceError = $state('');
	let baselineMode = $state<'thesis' | 'decision'>('thesis');
	let priceObservedOn = $state(today());
	let priceValue = $state('');
	let priceSubmitting = $state(false);
	let priceError = $state('');

	async function loadPerformance() {
		performanceLoading = true;
		performanceError = '';
		try {
			performance = (await api.getPerformance(companyId, baselineMode)) as Performance;
		} catch (e) {
			performanceError = apiErrorMessage(e);
		} finally {
			performanceLoading = false;
		}
	}

	async function submitPrice() {
		priceError = '';
		if (!priceValue || !priceObservedOn) {
			priceError = 'Date and price are required.';
			return;
		}
		priceSubmitting = true;
		try {
			await api.logPrice(companyId, { observed_on: priceObservedOn, price: Number(priceValue) });
			priceValue = '';
			await loadPerformance();
		} catch (e) {
			priceError = apiErrorMessage(e);
		} finally {
			priceSubmitting = false;
		}
	}

	$effect(() => {
		baselineMode;
		loadPerformance();
	});

	// ---- Health check ----
	let hcPeriod = $state('');
	let hcVerdict = $state<'on_track' | 'watch_closely' | 'broken'>('on_track');
	let hcNote = $state('');
	let hcSubmitting = $state(false);
	let hcError = $state('');
	let hcSuccess = $state('');

	async function submitHealthCheck() {
		hcError = '';
		hcSuccess = '';
		if (!hcPeriod.trim() || !hcNote.trim()) {
			hcError = 'Period and note are required.';
			return;
		}
		hcSubmitting = true;
		try {
			await api.submitHealthCheck(companyId, { period: hcPeriod.trim(), verdict: hcVerdict, note: hcNote.trim() });
			hcSuccess = 'Quarterly review recorded.';
			hcNote = '';
		} catch (e) {
			hcError = apiErrorMessage(e);
		} finally {
			hcSubmitting = false;
		}
	}

	// ---- Outcome ----
	let outcomeValue = $state<'played_out' | 'invalidated' | 'exited_early'>('played_out');
	let outcomeNote = $state('');
	let outcomeSubmitting = $state(false);
	let outcomeError = $state('');
	let outcomeSuccess = $state('');

	async function submitOutcome() {
		outcomeError = '';
		outcomeSuccess = '';
		if (!outcomeNote.trim()) {
			outcomeError = 'Note is required.';
			return;
		}
		outcomeSubmitting = true;
		try {
			await api.submitOutcome(companyId, { outcome: outcomeValue, note: outcomeNote.trim() });
			outcomeSuccess = 'Outcome recorded - scenario closed.';
			outcomeNote = '';
		} catch (e) {
			outcomeError = apiErrorMessage(e);
		} finally {
			outcomeSubmitting = false;
		}
	}

	$effect(() => {
		companyId;
		loadDecisions();
	});
</script>

{#if !session.isReadOnly}
	<section class="mt-6 border-t border-border pt-5">
		<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Log Observation</h3>
		{#if obsError}
			<div class="mt-2 rounded-md bg-danger/10 border border-danger/30 p-2 text-xs text-danger">{obsError}</div>
		{/if}
		{#if obsSuccess}
			<div class="mt-2 rounded-md bg-good/10 border border-good/30 p-2 text-xs text-good">{obsSuccess}</div>
		{/if}
		<div class="grid grid-cols-2 gap-2 mt-2">
			<input placeholder="Period (e.g. FY25Q2)" bind:value={obsPeriod} class="rounded-md border border-border px-2 py-1.5 text-sm" />
			<input type="date" bind:value={obsPeriodEnd} class="rounded-md border border-border px-2 py-1.5 text-sm" />
			<input placeholder="Metric key" bind:value={obsMetricKey} class="rounded-md border border-border px-2 py-1.5 text-sm" />
			<input placeholder="Numeric value" type="number" step="any" bind:value={obsNumericValue} class="rounded-md border border-border px-2 py-1.5 text-sm" />
			<input placeholder="Text value (optional)" bind:value={obsTextValue} class="rounded-md border border-border px-2 py-1.5 text-sm col-span-2" />
			<input placeholder="Note (optional)" bind:value={obsNote} class="rounded-md border border-border px-2 py-1.5 text-sm col-span-2" />
		</div>
		<button
			disabled={obsSubmitting}
			onclick={submitObservation}
			class="mt-2 text-xs px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90 disabled:opacity-50"
			>{obsSubmitting ? 'Saving...' : 'Record Observation'}</button
		>
	</section>
{/if}

<section class="mt-6 border-t border-border pt-5">
	<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Position Decisions</h3>
	{#if decisionsError}
		<div class="mt-2 rounded-md bg-danger/10 border border-danger/30 p-2 text-xs text-danger">{decisionsError}</div>
	{/if}
	{#if decisionsLoading}
		<div class="text-xs text-muted-fg mt-2">Loading...</div>
	{:else if !decisions.length}
		<div class="text-xs text-muted-fg mt-2">No decisions logged yet.</div>
	{:else}
		<div class="mt-2 space-y-1.5">
			{#each decisions as d (d.id)}
				<div class="flex items-start justify-between gap-3 text-xs border-b border-border pb-1.5 last:border-0">
					<div>
						<span class="font-medium uppercase" class:text-good={d.action === 'buy'} class:text-danger={d.action === 'sell'}
							>{d.action}</span
						>
						@ {d.price}{d.quantity != null ? ` x ${d.quantity}` : ''} on {d.decided_on}
						<div class="text-muted-fg">{d.rationale}</div>
					</div>
					<span class="text-muted-fg shrink-0">{d.actor}</span>
				</div>
			{/each}
		</div>
	{/if}
	{#if !session.isReadOnly}
		<div class="grid grid-cols-4 gap-2 mt-3">
			<select bind:value={decAction} class="rounded-md border border-border px-2 py-1.5 text-sm">
				<option value="buy">Buy</option>
				<option value="sell">Sell</option>
			</select>
			<input placeholder="Price" type="number" step="any" bind:value={decPrice} class="rounded-md border border-border px-2 py-1.5 text-sm" />
			<input placeholder="Quantity (optional)" type="number" step="any" bind:value={decQuantity} class="rounded-md border border-border px-2 py-1.5 text-sm" />
			<input type="date" bind:value={decDecidedOn} class="rounded-md border border-border px-2 py-1.5 text-sm" />
		</div>
		<input placeholder="Rationale" bind:value={decRationale} class="mt-2 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
		<button
			disabled={decSubmitting}
			onclick={submitDecision}
			class="mt-2 text-xs px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90 disabled:opacity-50"
			>{decSubmitting ? 'Saving...' : 'Log Decision'}</button
		>
		<p class="text-[11px] text-muted-fg mt-1">Decisions are append-only - there is no edit or delete once logged.</p>
	{/if}
</section>

<section class="mt-6 border-t border-border pt-5">
	<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Price &amp; Performance</h3>
	<div class="flex items-center gap-2 mt-2">
		<label class="text-xs text-muted-fg"
			>Baseline
			<select bind:value={baselineMode} class="ml-1 rounded-md border border-border px-2 py-1 text-xs">
				<option value="thesis">Thesis</option>
				<option value="decision">Decision</option>
			</select>
		</label>
	</div>
	{#if performanceError}
		<div class="mt-2 rounded-md bg-danger/10 border border-danger/30 p-2 text-xs text-danger">{performanceError}</div>
	{:else if performanceLoading}
		<div class="text-xs text-muted-fg mt-2">Loading...</div>
	{:else if performance}
		<div class="mt-2 text-sm">
			{#if performance.pct_change != null}
				<span class:text-good={performance.pct_change >= 0} class:text-danger={performance.pct_change < 0} class="font-medium">
					{performance.pct_change >= 0 ? '+' : ''}{performance.pct_change.toFixed(2)}%
				</span>
				<span class="text-muted-fg text-xs">
					({performance.baseline_price} on {performance.baseline_date} &rarr; {performance.current_price} on {performance.current_date}, {performance.currency})
				</span>
			{:else}
				<span class="text-xs text-muted-fg">{performance.note ?? 'Not enough data yet.'}</span>
			{/if}
		</div>
	{/if}
	{#if !session.isReadOnly}
		{#if priceError}
			<div class="mt-2 rounded-md bg-danger/10 border border-danger/30 p-2 text-xs text-danger">{priceError}</div>
		{/if}
		<div class="flex gap-2 mt-2">
			<input type="date" bind:value={priceObservedOn} class="rounded-md border border-border px-2 py-1.5 text-sm" />
			<input placeholder="Price" type="number" step="any" bind:value={priceValue} class="flex-1 rounded-md border border-border px-2 py-1.5 text-sm" />
			<button
				disabled={priceSubmitting}
				onclick={submitPrice}
				class="text-xs px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90 disabled:opacity-50"
				>{priceSubmitting ? 'Saving...' : 'Log Price'}</button
			>
		</div>
	{/if}
</section>

{#if !session.isReadOnly}
	<section class="mt-6 border-t border-border pt-5">
		<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Quarterly Review</h3>
		{#if hcError}
			<div class="mt-2 rounded-md bg-danger/10 border border-danger/30 p-2 text-xs text-danger">{hcError}</div>
		{/if}
		{#if hcSuccess}
			<div class="mt-2 rounded-md bg-good/10 border border-good/30 p-2 text-xs text-good">{hcSuccess}</div>
		{/if}
		<div class="grid grid-cols-2 gap-2 mt-2">
			<input placeholder="Period (e.g. FY25Q2)" bind:value={hcPeriod} class="rounded-md border border-border px-2 py-1.5 text-sm" />
			<select bind:value={hcVerdict} class="rounded-md border border-border px-2 py-1.5 text-sm">
				{#each Object.entries(STATUS_STYLES) as [key, s] (key)}
					<option value={key}>{s.label}</option>
				{/each}
			</select>
		</div>
		<textarea bind:value={hcNote} rows="2" placeholder="Note" class="mt-2 w-full rounded-md border border-border px-2 py-1.5 text-sm"
		></textarea>
		<button
			disabled={hcSubmitting}
			onclick={submitHealthCheck}
			class="mt-2 text-xs px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90 disabled:opacity-50"
			>{hcSubmitting ? 'Saving...' : 'Submit Quarterly Review'}</button
		>
	</section>

	<section class="mt-6 border-t border-border pt-5 mb-8">
		<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Close Out Thesis</h3>
		<p class="text-xs text-muted-fg mt-1">
			Records a terminal outcome and closes the active scenario. This cannot be undone from here.
		</p>
		{#if outcomeError}
			<div class="mt-2 rounded-md bg-danger/10 border border-danger/30 p-2 text-xs text-danger">{outcomeError}</div>
		{/if}
		{#if outcomeSuccess}
			<div class="mt-2 rounded-md bg-good/10 border border-good/30 p-2 text-xs text-good">{outcomeSuccess}</div>
		{/if}
		<div class="flex gap-2 mt-2">
			<select bind:value={outcomeValue} class="rounded-md border border-border px-2 py-1.5 text-sm">
				<option value="played_out">Played Out</option>
				<option value="invalidated">Invalidated</option>
				<option value="exited_early">Exited Early</option>
			</select>
			<input placeholder="Note" bind:value={outcomeNote} class="flex-1 rounded-md border border-border px-2 py-1.5 text-sm" />
		</div>
		<button
			disabled={outcomeSubmitting}
			onclick={submitOutcome}
			class="mt-2 text-xs px-3 py-1.5 rounded-md bg-danger text-white hover:brightness-90 disabled:opacity-50"
			>{outcomeSubmitting ? 'Saving...' : 'Close Out'}</button
		>
	</section>
{/if}
