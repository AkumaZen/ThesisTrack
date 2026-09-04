<script lang="ts">
	// New-company + initial-thesis form. Ports the field set (not the pixel
	// layout) of frontend/components/ingest.js's "Form" tab into a Svelte 5
	// route, posting the same shape web/src/lib/server/schemas/thesis.ts
	// (thesisCreate) expects. The old drawer's JSON-paste tab, Data-Table
	// attachment, and pillar_notes editing are intentionally left for a
	// follow-up - this covers the required fields to create a company.
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { api, ApiError } from '$lib/api';

	const OPERATING_MODELS = ['factory', 'subscription', 'money_lending', 'retail_stores', 'services'];
	const STATUSES = ['on_track', 'watch_closely', 'broken'];
	const OPERATORS = ['<', '<=', '>', '>=', '==', '!='];
	const BELIEVE_KINDS = ['Premise', 'Inference', 'Conclusion'];

	type Industry = { name: string; niches: { name: string }[] };
	type MetricDef = { metric_key: string; label: string; unit: string };

	let taxonomy = $state<Industry[]>([]);
	let metrics = $state<MetricDef[]>([]);
	let loadError = $state('');
	let submitting = $state(false);
	let submitError = $state('');
	let fieldErrors = $state<string[]>([]);

	// Basics
	let companyId = $state('');
	let name = $state('');
	let broadIndustry = $state('');
	let specificNiche = $state('');
	let operatingModel = $state('factory');
	let currency = $state('INR');
	let status = $state('on_track');
	let lastReviewed = $state(new Date().toISOString().slice(0, 10));

	// The Business
	let whatItDoes = $state('');
	let revenueSplit = $state<{ segment: string; sharePct: string }[]>([{ segment: '', sharePct: '' }]);

	// The Growth Engine
	let growthEngine = $state<string[]>(['']);

	// The Big Change
	let bigChangeSummary = $state('');
	let expectedCompletion = $state('');

	// Proof Points
	let hardEvidence = $state<string[]>(['']);
	let metricValues = $state<Record<string, string>>({});

	// What Can Kill It
	type KillTriggerForm = {
		label: string;
		metricKey: string;
		operator: string;
		threshold: string;
		action: string;
		severity: string;
		gracePeriods: string;
		manualCheck: boolean;
	};
	let killTriggers = $state<KillTriggerForm[]>([
		{ label: '', metricKey: '', operator: '<', threshold: '', action: '', severity: 'kill', gracePeriods: '1', manualCheck: false }
	]);

	// Why We Believe It
	let believeRows = $state<{ kind: string; text: string }[]>([
		{ kind: 'Premise', text: '' },
		{ kind: 'Premise', text: '' },
		{ kind: 'Conclusion', text: '' }
	]);

	// Health Check
	let latestQuarterReview = $state('');

	// References
	let references = $state<{ title: string; url: string }[]>([]);

	let niches = $derived(taxonomy.find((i) => i.name === broadIndustry)?.niches ?? []);

	$effect(() => {
		if (niches.length && !niches.some((n) => n.name === specificNiche)) {
			specificNiche = niches[0].name;
		}
	});

	onMount(async () => {
		try {
			const [tax] = await Promise.all([api.getTaxonomy() as Promise<Industry[]>]);
			taxonomy = tax;
			if (tax.length) broadIndustry = tax[0].name;
		} catch (e) {
			loadError = String(e);
		}
	});

	$effect(() => {
		operatingModel;
		api
			.getMetrics(operatingModel)
			.then((m) => (metrics = m as MetricDef[]))
			.catch(() => (metrics = []));
	});

	function addRow<T>(list: T[], row: T): T[] {
		return [...list, row];
	}
	function removeRow<T>(list: T[], i: number): T[] {
		return list.filter((_, idx) => idx !== i);
	}

	function buildPayload() {
		return {
			company_id: companyId.trim().toUpperCase(),
			name: name.trim(),
			classification: {
				broad_industry: broadIndustry,
				specific_niche: specificNiche,
				operating_model: operatingModel,
				currency: currency.trim().toUpperCase() || 'INR'
			},
			status,
			last_reviewed: lastReviewed,
			thesis_data: {
				the_business: {
					what_it_does: whatItDoes,
					revenue_split: revenueSplit
						.filter((r) => r.segment.trim())
						.map((r) => ({ segment: r.segment.trim(), share_pct: Number(r.sharePct) || 0 }))
				},
				the_growth_engine: growthEngine.map((g) => g.trim()).filter(Boolean),
				the_big_change: { summary: bigChangeSummary, expected_completion: expectedCompletion },
				proof_points: {
					hard_evidence: hardEvidence.map((e) => e.trim()).filter(Boolean),
					model_specific_metrics: Object.fromEntries(
						Object.entries(metricValues).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => [k, Number(v)])
					)
				},
				what_can_kill_it: killTriggers
					.filter((t) => t.label.trim())
					.map((t) => ({
						label: t.label.trim(),
						metric_key: t.manualCheck ? null : t.metricKey || null,
						operator: t.manualCheck ? null : (t.operator as '<' | '<=' | '>' | '>=' | '==' | '!=') || null,
						threshold: t.manualCheck ? null : t.threshold !== '' ? Number(t.threshold) : null,
						action: t.action.trim(),
						severity: t.severity,
						grace_periods: Number(t.gracePeriods) || 1,
						manual_check: t.manualCheck
					})),
				why_we_believe_it: believeRows.filter((r) => r.text.trim()).map((r) => `${r.kind}: ${r.text.trim()}`),
				health_check: { latest_quarter_review: latestQuarterReview, historical_checks: [] },
				references: references.filter((r) => r.title.trim() && r.url.trim()),
				pillar_notes: {}
			}
		};
	}

	async function submit() {
		submitError = '';
		fieldErrors = [];
		submitting = true;
		try {
			const payload = buildPayload();
			const created = (await api.createCompany(payload)) as { company_id: string };
			await goto(`/company/${encodeURIComponent(created.company_id)}`);
		} catch (e) {
			if (e instanceof ApiError) {
				const msg = typeof e.body === 'string' ? e.body : ((e.body as { message?: string })?.message ?? e.message);
				fieldErrors = String(msg).split('\n').filter(Boolean);
				submitError = fieldErrors.length ? '' : String(msg);
			} else {
				submitError = String(e);
			}
		} finally {
			submitting = false;
		}
	}
</script>

<a href="/" class="text-sm text-muted-fg hover:text-fg">&larr; Back</a>

<div class="mt-3 max-w-2xl">
	<h1 class="text-xl font-semibold">New Company / Thesis</h1>
	<p class="text-sm text-muted-fg mt-0.5">Fill in the 7 pillars to create a company and its initial thesis.</p>

	{#if loadError}
		<div class="mt-3 rounded-md bg-danger/10 border border-danger/30 p-3 text-sm text-danger">{loadError}</div>
	{/if}
	{#if submitError}
		<div class="mt-3 rounded-md bg-danger/10 border border-danger/30 p-3 text-sm text-danger">{submitError}</div>
	{/if}
	{#if fieldErrors.length}
		<div class="mt-3 rounded-md bg-danger/10 border border-danger/30 p-3 text-sm text-danger">
			<ul class="list-disc list-inside">
				{#each fieldErrors as msg, i (i)}
					<li>{msg}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- Basics -->
	<section class="mt-5">
		<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Basics</h2>
		<div class="grid grid-cols-2 gap-3 mt-2">
			<label class="text-sm"
				>Company ID
				<input bind:value={companyId} placeholder="TICKER_OR_SLUG" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
			</label>
			<label class="text-sm"
				>Name
				<input bind:value={name} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
			</label>
			<label class="text-sm"
				>Broad Industry
				<select bind:value={broadIndustry} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
					{#each taxonomy as i (i.name)}
						<option value={i.name}>{i.name}</option>
					{/each}
				</select>
			</label>
			<label class="text-sm"
				>Specific Niche
				<select bind:value={specificNiche} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
					{#each niches as n (n.name)}
						<option value={n.name}>{n.name}</option>
					{/each}
				</select>
			</label>
			<label class="text-sm"
				>Operating Model
				<select bind:value={operatingModel} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
					{#each OPERATING_MODELS as m (m)}
						<option value={m}>{m}</option>
					{/each}
				</select>
			</label>
			<label class="text-sm"
				>Currency
				<input bind:value={currency} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
			</label>
			<label class="text-sm"
				>Status
				<select bind:value={status} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
					{#each STATUSES as s (s)}
						<option value={s}>{s}</option>
					{/each}
				</select>
			</label>
			<label class="text-sm"
				>Last Reviewed
				<input type="date" bind:value={lastReviewed} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
			</label>
		</div>
	</section>

	<!-- The Business -->
	<section class="mt-5">
		<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">1. The Business</h2>
		<label class="block text-sm mt-2"
			>What It Does
			<textarea bind:value={whatItDoes} rows="3" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"></textarea>
		</label>
		<div class="mt-3">
			<div class="text-sm font-medium">Revenue Split <span class="text-muted-fg font-normal">(must sum to 100%)</span></div>
			<div class="space-y-1 mt-1">
				{#each revenueSplit as row, i (i)}
					<div class="flex gap-2 items-center">
						<input placeholder="Segment" bind:value={row.segment} class="flex-1 rounded-md border border-border px-2 py-1 text-sm" />
						<input type="number" step="any" placeholder="%" bind:value={row.sharePct} class="w-20 rounded-md border border-border px-2 py-1 text-sm" />
						<button type="button" onclick={() => (revenueSplit = removeRow(revenueSplit, i))} class="text-muted-fg hover:text-danger">&times;</button>
					</div>
				{/each}
			</div>
			<button type="button" onclick={() => (revenueSplit = addRow(revenueSplit, { segment: '', sharePct: '' }))} class="text-xs text-ok mt-1"
				>+ Add segment</button
			>
		</div>
	</section>

	<!-- The Growth Engine -->
	<section class="mt-5">
		<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">2. The Growth Engine</h2>
		<div class="space-y-1 mt-2">
			{#each growthEngine as _row, i (i)}
				<div class="flex gap-2 items-center">
					<input placeholder="e.g. New capacity coming online in Q3" bind:value={growthEngine[i]} class="flex-1 rounded-md border border-border px-2 py-1 text-sm" />
					<button type="button" onclick={() => (growthEngine = removeRow(growthEngine, i))} class="text-muted-fg hover:text-danger">&times;</button>
				</div>
			{/each}
		</div>
		<button type="button" onclick={() => (growthEngine = addRow(growthEngine, ''))} class="text-xs text-ok mt-1">+ Add driver</button>
	</section>

	<!-- The Big Change -->
	<section class="mt-5">
		<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">3. The Big Change</h2>
		<label class="block text-sm mt-2"
			>Summary
			<textarea bind:value={bigChangeSummary} rows="3" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"></textarea>
		</label>
		<label class="block text-sm mt-3"
			>Expected Completion
			<input bind:value={expectedCompletion} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
		</label>
	</section>

	<!-- Proof Points -->
	<section class="mt-5">
		<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">4. Proof Points</h2>
		<div class="text-sm font-medium mt-2">Hard Evidence</div>
		<div class="space-y-1 mt-1">
			{#each hardEvidence as _row, i (i)}
				<div class="flex gap-2 items-center">
					<input placeholder="e.g. Order book up 22% YoY per Q2 filing" bind:value={hardEvidence[i]} class="flex-1 rounded-md border border-border px-2 py-1 text-sm" />
					<button type="button" onclick={() => (hardEvidence = removeRow(hardEvidence, i))} class="text-muted-fg hover:text-danger">&times;</button>
				</div>
			{/each}
		</div>
		<button type="button" onclick={() => (hardEvidence = addRow(hardEvidence, ''))} class="text-xs text-ok mt-1">+ Add evidence</button>

		<div class="mt-4">
			<div class="text-sm font-medium">Model-Specific Metrics</div>
			<div class="grid grid-cols-2 gap-3 mt-1">
				{#if !metrics.length}
					<div class="text-xs text-muted-fg col-span-2">No metrics registered for this operating model yet.</div>
				{/if}
				{#each metrics as m (m.metric_key)}
					<label class="text-xs"
						>{m.label} <span class="text-muted-fg">({m.unit})</span>
						<input
							type="number"
							step="any"
							bind:value={metricValues[m.metric_key]}
							class="mt-0.5 w-full rounded-md border border-border px-2 py-1 text-sm"
						/>
					</label>
				{/each}
			</div>
		</div>
	</section>

	<!-- What Can Kill It -->
	<section class="mt-5">
		<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">5. What Can Kill It <span class="text-muted-fg font-normal normal-case">(needs &ge; 1 severity=kill entry)</span></h2>
		<div class="space-y-2 mt-2">
			{#each killTriggers as t, i (i)}
				<div class="rounded-md border border-border p-2 space-y-1">
					<div class="flex gap-2">
						<input placeholder="Label / display sentence" bind:value={t.label} class="flex-1 rounded-md border border-border px-2 py-1 text-sm" />
						<button type="button" onclick={() => (killTriggers = removeRow(killTriggers, i))} class="text-muted-fg hover:text-danger">&times;</button>
					</div>
					<label class="flex items-center gap-1 text-xs text-muted-fg">
						<input type="checkbox" bind:checked={t.manualCheck} /> Manual check (not quantifiable)
					</label>
					{#if !t.manualCheck}
						<div class="grid grid-cols-6 gap-1">
							<select bind:value={t.metricKey} class="col-span-2 rounded-md border border-border px-1 py-1 text-xs">
								<option value="">(select metric)</option>
								{#each metrics as m (m.metric_key)}
									<option value={m.metric_key}>{m.label}</option>
								{/each}
							</select>
							<select bind:value={t.operator} class="rounded-md border border-border px-1 py-1 text-xs">
								{#each OPERATORS as op (op)}
									<option value={op}>{op}</option>
								{/each}
							</select>
							<input type="number" step="any" placeholder="threshold" bind:value={t.threshold} class="rounded-md border border-border px-1 py-1 text-xs" />
							<select bind:value={t.severity} class="rounded-md border border-border px-1 py-1 text-xs">
								<option value="kill">kill</option>
								<option value="warn">warn</option>
							</select>
							<input type="number" min="1" placeholder="grace" bind:value={t.gracePeriods} class="rounded-md border border-border px-1 py-1 text-xs" />
						</div>
					{:else}
						<select bind:value={t.severity} class="rounded-md border border-border px-1 py-1 text-xs">
							<option value="kill">kill</option>
							<option value="warn">warn</option>
						</select>
					{/if}
					<input placeholder="Action (e.g. Exit position)" bind:value={t.action} class="w-full rounded-md border border-border px-2 py-1 text-xs" />
				</div>
			{/each}
		</div>
		<button
			type="button"
			onclick={() =>
				(killTriggers = addRow(killTriggers, {
					label: '',
					metricKey: '',
					operator: '<',
					threshold: '',
					action: '',
					severity: 'kill',
					gracePeriods: '1',
					manualCheck: false
				}))}
			class="text-xs text-ok mt-1">+ Add redline</button
		>
	</section>

	<!-- Why We Believe It -->
	<section class="mt-5">
		<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">
			6. Why We Believe It <span class="text-muted-fg font-normal normal-case">(&ge;3 entries, &ge;1 Premise, exactly 1 Conclusion)</span>
		</h2>
		<div class="space-y-1 mt-2">
			{#each believeRows as row, i (i)}
				<div class="flex gap-2 items-center">
					<select bind:value={row.kind} class="w-28 shrink-0 rounded-md border border-border px-1 py-1 text-xs">
						{#each BELIEVE_KINDS as k (k)}
							<option value={k}>{k}</option>
						{/each}
					</select>
					<input placeholder="Reasoning text" bind:value={row.text} class="flex-1 rounded-md border border-border px-2 py-1 text-sm" />
					<button type="button" onclick={() => (believeRows = removeRow(believeRows, i))} class="text-muted-fg hover:text-danger">&times;</button>
				</div>
			{/each}
		</div>
		<button type="button" onclick={() => (believeRows = addRow(believeRows, { kind: 'Premise', text: '' }))} class="text-xs text-ok mt-1"
			>+ Add reasoning step</button
		>
	</section>

	<!-- Health Check -->
	<section class="mt-5">
		<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">7. Health Check</h2>
		<label class="block text-sm mt-2"
			>Latest Quarter Review
			<textarea bind:value={latestQuarterReview} rows="4" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"></textarea>
		</label>
	</section>

	<!-- References -->
	<section class="mt-5 mb-8">
		<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">References</h2>
		<div class="space-y-1 mt-2">
			{#each references as row, i (i)}
				<div class="flex gap-2 items-center">
					<input placeholder="Title" bind:value={row.title} class="flex-1 rounded-md border border-border px-2 py-1 text-sm" />
					<input placeholder="URL" bind:value={row.url} class="flex-[2] rounded-md border border-border px-2 py-1 text-sm" />
					<button type="button" onclick={() => (references = removeRow(references, i))} class="text-muted-fg hover:text-danger">&times;</button>
				</div>
			{/each}
		</div>
		<button type="button" onclick={() => (references = addRow(references, { title: '', url: '' }))} class="text-xs text-ok mt-1">+ Add reference</button>
	</section>

	<div class="flex justify-end gap-2 mb-10">
		<a href="/" class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Cancel</a>
		<button
			type="button"
			disabled={submitting}
			onclick={submit}
			class="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90 disabled:opacity-50"
		>
			{submitting ? 'Creating...' : 'Create Company'}
		</button>
	</div>
</div>
