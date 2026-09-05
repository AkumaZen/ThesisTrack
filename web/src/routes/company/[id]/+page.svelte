<script lang="ts">
	// Ports the drawer.js/company-page rendering from the vanilla-JS frontend
	// into a real route. Restructured per the drawer.js renderCompanyPage()
	// reference (~lines 164-309): persistent header action bar + left-side
	// jump nav, redline meters on kill triggers, per-pillar notes/tables,
	// multi-scenario ("Also tracked by" / "Start Your Own Thesis"), and a
	// wired-up "Run AI Review" action.
	import { goto } from '$app/navigation';
	import { api, ApiError } from '$lib/api';
	import { STATUS_STYLES, OPERATING_MODEL_LABELS } from '$lib/format';
	import { session } from '$lib/session.svelte';
	import CustomTables from './CustomTables.svelte';
	import ActionPanels from './ActionPanels.svelte';
	import type { PageData } from './$types';
	import type { CompanyDetail } from './+page';

	let { data }: { data: PageData } = $props();

	const OPERATING_MODELS = Object.keys(OPERATING_MODEL_LABELS);

	const BASE_SECTIONS = [
		{ id: 'business', label: '1. The Business' },
		{ id: 'growth', label: '2. The Growth Engine' },
		{ id: 'change', label: '3. The Big Change' },
		{ id: 'proof', label: '4. Proof Points' },
		{ id: 'kill', label: '5. What Can Kill It' },
		{ id: 'believe', label: '6. Why We Believe It' },
		{ id: 'health', label: '7. Quarterly Review' },
		{ id: 'decisions', label: 'Buy / Sell Decisions' },
		{ id: 'references', label: 'References' }
	];

	// The untagged custom tables a user has added (via "+ Add Table" here, or
	// the Custom Sections builder on the ingest/amend page) each get their own
	// named nav entry instead of one generic "Custom Sections" bucket - they
	// all live in the same cp-sec-custom card, so every entry scrolls there.
	let customTables = $state<{ id: number; name: string }[]>([]);
	let SECTIONS = $derived([
		...BASE_SECTIONS,
		...(customTables.length ? customTables.map((t) => ({ id: 'custom', label: t.name })) : [{ id: 'custom', label: 'Custom Sections' }])
	]);

	let companyId = $derived(data.detail.company_id);
	// Writable derived: tracks data.detail (re-derives when load() reruns,
	// e.g. navigating to a different company), but reload() below can also
	// assign it directly after a write, without waiting for a re-navigation.
	let detail = $derived(data.detail);

	async function reload() {
		detail = (await api.getCompany(companyId)) as CompanyDetail;
	}

	let style = $derived(STATUS_STYLES[detail?.status ?? ''] ?? STATUS_STYLES.on_track);

	// ---- Edit Details (Basics) ----
	type Industry = { name: string; niches: { name: string }[] };
	let editOpen = $state(false);
	let editTaxonomy = $state<Industry[]>([]);
	let editName = $state('');
	let editBroadIndustry = $state('');
	let editSpecificNiche = $state('');
	let editOperatingModel = $state('');
	let editCurrency = $state('');
	let editSubmitting = $state(false);
	let editError = $state('');
	let editNiches = $derived(editTaxonomy.find((i) => i.name === editBroadIndustry)?.niches ?? []);

	async function openEdit() {
		if (!detail) return;
		editError = '';
		editName = detail.name;
		editBroadIndustry = detail.broad_industry;
		editSpecificNiche = detail.specific_niche;
		editOperatingModel = detail.operating_model;
		editCurrency = detail.currency;
		editOpen = true;
		if (!editTaxonomy.length) {
			try {
				editTaxonomy = (await api.getTaxonomy()) as Industry[];
			} catch (e) {
				editError = String(e);
			}
		}
	}

	async function submitEdit() {
		if (!detail) return;
		editSubmitting = true;
		editError = '';
		try {
			await api.updateCompany(detail.company_id, {
				name: editName.trim(),
				broad_industry: editBroadIndustry,
				specific_niche: editSpecificNiche,
				operating_model: editOperatingModel,
				currency: editCurrency.trim().toUpperCase()
			});
			editOpen = false;
			await reload();
		} catch (e) {
			editError = e instanceof ApiError ? String((e.body as { detail?: string })?.detail ?? e.message) : String(e);
		} finally {
			editSubmitting = false;
		}
	}

	function scrollTo(id: string) {
		document.getElementById(`cp-sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function pillarNotesFor(key: string): string[] {
		return detail?.current_thesis?.pillar_notes?.[key] ?? [];
	}

	function redlinePct(observed: number, threshold: number): number {
		const span = Math.max(Math.abs(observed), Math.abs(threshold), 1) * 1.4;
		return Math.min(100, Math.max(0, (observed / span) * 100));
	}

	// ---- Run AI Review ----
	let aiReviewOpen = $state(false);
	let aiPeriod = $state('');
	let aiNarrative = $state('');
	let aiSubmitting = $state(false);
	let aiError = $state('');
	type AiReviewResult = { proposed_status: string; rationale: string; state: string; evidence: { reasoning_chain?: string[] } };
	let aiResult = $state<AiReviewResult | null>(null);

	function apiErrorMessage(e: unknown): string {
		if (e instanceof ApiError) {
			const body = e.body as { message?: string } | string;
			return typeof body === 'string' ? body : (body?.message ?? e.message);
		}
		return String(e);
	}

	async function runAiReview() {
		aiError = '';
		if (!aiPeriod.trim()) {
			aiError = 'Period is required (e.g. FY25Q2).';
			return;
		}
		aiSubmitting = true;
		aiResult = null;
		try {
			aiResult = (await api.runAiReview(companyId, { period: aiPeriod.trim(), narrative: aiNarrative.trim() || null })) as AiReviewResult;
		} catch (e) {
			aiError = apiErrorMessage(e);
		} finally {
			aiSubmitting = false;
		}
	}
</script>

<!-- Persistent action header -->
	<div class="flex items-center gap-3 flex-wrap -mx-4 sm:mx-0 px-4 sm:px-0 py-3 border-b border-border sticky top-0 z-10 bg-bg-ink">
		<a href="/" class="text-sm px-2 py-1.5 rounded-md hover:bg-surface-3 text-muted-fg hover:text-fg shrink-0">&larr; Back</a>
		{#if detail.has_own_scenario}
			<span class="inline-block h-2 w-2 rounded-full {style.dot} shrink-0"></span>
			<span class="text-xs font-medium {style.pill} px-2 py-0.5 rounded-full ring-1 shrink-0">{style.label}</span>
			{#if detail.has_active_override}
				<span
					class="text-[10px] font-semibold uppercase text-danger bg-danger/10 px-2 py-0.5 rounded-full ring-1 ring-danger/20 shrink-0"
					title="A sell/exit rule fired here, but you chose to keep holding anyway"
					>Warning Overridden</span
				>
			{/if}
		{/if}
		<h1 class="font-semibold text-base flex-1 min-w-0 truncate">{detail.name}</h1>
		{#if detail.has_own_scenario}
			<div class="flex flex-wrap gap-2 shrink-0">
				<a
					href={`/ingest?mode=amend&companyId=${encodeURIComponent(companyId)}`}
					class="text-sm px-3 py-1.5 rounded-md bg-fg text-bg hover:brightness-90">Amend Thesis</a
				>
				<button type="button" onclick={() => scrollTo('decisions')} class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3"
					>Post Observations</button
				>
				<button type="button" onclick={() => scrollTo('health')} class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3"
					>Log Quarterly Review</button
				>
				<button type="button" onclick={() => scrollTo('decisions')} class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3"
					>Log Buy/Sell</button
				>
				<button
					type="button"
					onclick={() => (aiReviewOpen = !aiReviewOpen)}
					class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Run AI Review</button
				>
				{#if !session.isReadOnly}
					<button type="button" onclick={openEdit} class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Edit Details</button>
				{/if}
			</div>
		{/if}
	</div>

	{#if editOpen}
		<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onclick={() => (editOpen = false)} role="presentation">
			<div class="bg-bg-ink rounded-xl border border-border w-full max-w-md p-5" onclick={(e) => e.stopPropagation()} role="presentation">
				<div class="flex items-center justify-between">
					<h2 class="font-semibold">Edit Details</h2>
					<button type="button" onclick={() => (editOpen = false)} class="text-muted-fg hover:text-fg text-lg leading-none">&times;</button>
				</div>
				<p class="text-xs text-muted-fg mt-1">Name and classification - shared across every analyst's thesis on this company.</p>
				{#if editError}
					<div class="mt-3 rounded-md bg-danger/10 border border-danger/30 p-2 text-sm text-danger">{editError}</div>
				{/if}
				<div class="mt-3 space-y-2">
					<label class="block text-sm"
						>Name
						<input bind:value={editName} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
					</label>
					<label class="block text-sm"
						>Broad Industry
						<select bind:value={editBroadIndustry} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
							{#each editTaxonomy as i (i.name)}
								<option value={i.name}>{i.name}</option>
							{/each}
						</select>
					</label>
					<label class="block text-sm"
						>Specific Niche
						<select bind:value={editSpecificNiche} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
							{#each editNiches as n (n.name)}
								<option value={n.name}>{n.name}</option>
							{/each}
						</select>
					</label>
					<label class="block text-sm"
						>Operating Model
						<select bind:value={editOperatingModel} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
							{#each OPERATING_MODELS as m (m)}
								<option value={m}>{OPERATING_MODEL_LABELS[m]}</option>
							{/each}
						</select>
					</label>
					<label class="block text-sm"
						>Currency
						<input bind:value={editCurrency} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
					</label>
				</div>
				<div class="flex justify-end gap-2 mt-4">
					<button type="button" onclick={() => (editOpen = false)} class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Cancel</button>
					<button
						type="button"
						disabled={editSubmitting}
						onclick={submitEdit}
						class="text-sm px-3 py-1.5 rounded-md bg-fg text-bg hover:brightness-90 disabled:opacity-50"
						>{editSubmitting ? 'Saving...' : 'Save Changes'}</button
					>
				</div>
			</div>
		</div>
	{/if}

	{#if aiReviewOpen}
		<div class="mt-3 rounded-md border border-border p-3">
			<div class="flex items-center justify-between">
				<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Run AI Review</h3>
				<button type="button" onclick={() => (aiReviewOpen = false)} class="text-muted-fg hover:text-fg text-lg leading-none">&times;</button>
			</div>
			<p class="text-xs text-muted-fg mt-1">
				Files an advisory proposal only - it never changes the thesis status directly. Review it from the Review Queue.
			</p>
			{#if aiError}
				<div class="mt-2 rounded-md bg-danger/10 border border-danger/30 p-2 text-xs text-danger">{aiError}</div>
			{/if}
			<div class="grid grid-cols-2 gap-2 mt-2">
				<input placeholder="Period (e.g. FY25Q2)" bind:value={aiPeriod} class="rounded-md border border-border px-2 py-1.5 text-sm" />
				<input placeholder="Narrative (optional)" bind:value={aiNarrative} class="rounded-md border border-border px-2 py-1.5 text-sm" />
			</div>
			<button
				disabled={aiSubmitting}
				onclick={runAiReview}
				class="mt-2 text-xs px-3 py-1.5 rounded-md bg-fg text-bg hover:brightness-90 disabled:opacity-50"
				>{aiSubmitting ? 'Running...' : 'Run Review'}</button
			>
			{#if aiResult}
				{@const rstyle = STATUS_STYLES[aiResult.proposed_status] ?? STATUS_STYLES.on_track}
				<div class="mt-3 rounded-md bg-surface-2 p-3">
					<div class="flex items-center gap-2">
						<span class="text-xs font-medium {rstyle.pill} px-2 py-0.5 rounded-full ring-1">Proposed: {rstyle.label}</span>
						<span class="text-xs text-muted-fg">filed as a "To Review" item - visible in the Review Queue</span>
					</div>
					{#if aiResult.evidence?.reasoning_chain?.length}
						<ol class="list-decimal list-inside text-sm mt-2 space-y-1">
							{#each aiResult.evidence.reasoning_chain as step, i (i)}
								<li>{step}</li>
							{/each}
						</ol>
					{:else}
						<p class="text-sm mt-2">{aiResult.rationale}</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	{#if !detail.has_own_scenario}
		<div class="mt-3 max-w-2xl">
			<div class="text-sm text-muted-fg">
				{detail.broad_industry} &gt; {detail.specific_niche} &middot; {detail.operating_model} &middot; {detail.currency}
			</div>
			{#if detail.other_scenarios?.length}
				<div class="mt-3 flex flex-wrap items-center gap-1.5">
					<span class="text-xs text-muted-fg">Also tracked by:</span>
					{#each detail.other_scenarios as s (s.id)}
						{@const sstyle = STATUS_STYLES[s.status] ?? STATUS_STYLES.on_track}
						<span class="text-xs px-2 py-0.5 rounded-full {sstyle.pill} ring-1">{s.owner} &middot; {sstyle.label}</span>
					{/each}
				</div>
			{/if}
			<div class="mt-6 rounded-md border border-dashed border-border p-5 text-center">
				<p class="text-sm text-muted-fg mb-3">You haven't started a thesis on this company yet.</p>
				<button
					type="button"
					onclick={() => goto(`/ingest?companyId=${encodeURIComponent(companyId)}`)}
					class="text-sm px-4 py-2 rounded-md bg-fg text-bg hover:brightness-90">+ Start Your Own Thesis</button
				>
			</div>
		</div>
	{:else}
		{@const t = detail.current_thesis ?? {}}
		<div class="mt-3 flex gap-6">
			<!-- Left section nav -->
			<nav class="hidden lg:flex flex-col gap-0.5 w-52 shrink-0 sticky top-16 self-start max-h-[calc(100vh-5rem)] overflow-y-auto">
				{#each SECTIONS as s, si (si)}
					<button
						type="button"
						onclick={() => scrollTo(s.id)}
						class="text-left px-2.5 py-1.5 rounded-md text-sm text-muted-fg hover:bg-surface-3 hover:text-fg">{s.label}</button
					>
				{/each}
			</nav>

			<div class="flex-1 min-w-0 max-w-3xl">
				<div class="text-sm text-muted-fg">
					{detail.broad_industry} &gt; {detail.specific_niche} &middot; {detail.operating_model} &middot; {detail.currency}
				</div>

				{#if detail.other_scenarios?.length}
					<div class="mt-3 flex flex-wrap items-center gap-1.5">
						<span class="text-xs text-muted-fg">Also tracked by:</span>
						{#each detail.other_scenarios as s (s.id)}
							{@const sstyle = STATUS_STYLES[s.status] ?? STATUS_STYLES.on_track}
							<span class="text-xs px-2 py-0.5 rounded-full {sstyle.pill} ring-1">{s.owner} &middot; {sstyle.label}</span>
						{/each}
					</div>
				{/if}

				{#if detail.active_override}
					<div class="mt-3 rounded-md bg-danger/10 border border-danger/30 p-3 text-sm text-danger">
						<strong>Warning overridden:</strong> a sell/exit rule fired, but the status is being held at "{detail.active_override.to_status}" by {detail.active_override.actor}.
						<div class="mt-1">{detail.active_override.rationale}</div>
					</div>
				{/if}

				<!-- 1. The Business -->
				<section id="cp-sec-business" class="mt-5 rounded-xl border border-border bg-surface p-5 scroll-mt-20">
					<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">1. The Business</h3>
					<p class="text-sm mt-1">{t.the_business?.what_it_does}</p>
					<div class="mt-2 space-y-0.5">
						{#each t.the_business?.revenue_split ?? [] as r (r.segment)}
							<div class="flex justify-between text-sm"><span>{r.segment}</span><span>{r.share_pct}%</span></div>
						{/each}
					</div>
					{#if pillarNotesFor('the_business').length}
						<div class="mt-2">
							<div class="text-xs font-medium text-muted-fg">Notes</div>
							<ul class="list-disc list-inside text-xs mt-0.5 space-y-0.5">
								{#each pillarNotesFor('the_business') as n (n)}
									<li>{n}</li>
								{/each}
							</ul>
						</div>
					{/if}
					<CustomTables {companyId} section="the_business" compact />
				</section>

				<!-- 2. The Growth Engine -->
				<section id="cp-sec-growth" class="mt-5 rounded-xl border border-border bg-surface p-5 scroll-mt-20">
					<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">2. The Growth Engine</h3>
					<ul class="list-disc list-inside text-sm mt-1 space-y-0.5">
						{#each t.the_growth_engine ?? [] as g, i (i)}
							<li>{g}</li>
						{/each}
					</ul>
					{#if pillarNotesFor('the_growth_engine').length}
						<div class="mt-2">
							<div class="text-xs font-medium text-muted-fg">Notes</div>
							<ul class="list-disc list-inside text-xs mt-0.5 space-y-0.5">
								{#each pillarNotesFor('the_growth_engine') as n (n)}
									<li>{n}</li>
								{/each}
							</ul>
						</div>
					{/if}
					<CustomTables {companyId} section="the_growth_engine" compact />
				</section>

				<!-- 3. The Big Change -->
				<section id="cp-sec-change" class="mt-5 rounded-xl border border-border bg-surface p-5 scroll-mt-20">
					<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">3. The Big Change</h3>
					<p class="text-sm mt-1">{t.the_big_change?.summary}</p>
					<div class="text-xs text-muted-fg mt-0.5">Expected completion: {t.the_big_change?.expected_completion}</div>
					{#if pillarNotesFor('the_big_change').length}
						<div class="mt-2">
							<div class="text-xs font-medium text-muted-fg">Notes</div>
							<ul class="list-disc list-inside text-xs mt-0.5 space-y-0.5">
								{#each pillarNotesFor('the_big_change') as n (n)}
									<li>{n}</li>
								{/each}
							</ul>
						</div>
					{/if}
					<CustomTables {companyId} section="the_big_change" compact />
				</section>

				<!-- 4. Proof Points -->
				<section id="cp-sec-proof" class="mt-5 rounded-xl border border-border bg-surface p-5 scroll-mt-20">
					<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">4. Proof Points</h3>
					<ul class="list-disc list-inside text-sm mt-1 space-y-0.5">
						{#each t.proof_points?.hard_evidence ?? [] as e, i (i)}
							<li>{e}</li>
						{/each}
					</ul>
					{#if pillarNotesFor('proof_points').length}
						<div class="mt-2">
							<div class="text-xs font-medium text-muted-fg">Notes</div>
							<ul class="list-disc list-inside text-xs mt-0.5 space-y-0.5">
								{#each pillarNotesFor('proof_points') as n (n)}
									<li>{n}</li>
								{/each}
							</ul>
						</div>
					{/if}
					<CustomTables {companyId} section="proof_points" compact />
				</section>

				<!-- 5. What Can Kill It -->
				<section id="cp-sec-kill" class="mt-5 rounded-xl border border-border bg-surface p-5 scroll-mt-20">
					<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">5. What Can Kill It</h3>
					{#if detail.kill_triggers.length}
						<div class="mt-1">
							{#each detail.kill_triggers as trig (trig.id)}
								<div class="border-b border-border py-2 last:border-0">
									<div class="flex items-center justify-between">
										<span class="text-sm" class:text-danger={trig.latest_fired} class:font-medium={trig.latest_fired}>{trig.label}</span>
										<span
											class="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full ring-1 {trig.severity ===
											'kill'
												? 'bg-danger/10 text-danger ring-danger/20'
												: 'bg-warn/10 text-warn ring-warn/20'}"
										>
											{trig.severity}
										</span>
									</div>
									<div class="text-xs text-muted-fg">{trig.action} &middot; grace {trig.grace_periods}</div>
									{#if trig.manual_check || trig.metric_key === null}
										<div class="text-xs text-muted-fg italic">Manual check - not quantifiable.</div>
									{:else if trig.latest_observed_value == null}
										<div class="text-xs text-muted-fg">No observation yet for {trig.metric_key}.</div>
									{:else}
										{@const obsPct = redlinePct(trig.latest_observed_value, trig.threshold ?? 0)}
										{@const thPct = redlinePct(trig.threshold ?? 0, trig.threshold ?? 0)}
										<div class="mt-1">
											<div class="relative h-2 rounded-full bg-surface-3">
												<div
													class="absolute inset-y-0 left-0 rounded-full {trig.latest_breached ? 'bg-danger' : 'bg-good'}"
													style="width:{obsPct}%"
												></div>
												<div class="absolute inset-y-0 w-0.5 bg-fg" style="left:{thPct}%"></div>
											</div>
											<div class="flex justify-between text-[11px] text-muted-fg mt-0.5">
												<span>observed {trig.latest_observed_value}</span>
												<span>threshold {trig.operator ?? ''} {trig.threshold}</span>
											</div>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{:else}
						<div class="text-xs text-muted-fg mt-1">None defined.</div>
					{/if}
					{#if pillarNotesFor('what_can_kill_it').length}
						<div class="mt-2">
							<div class="text-xs font-medium text-muted-fg">Notes</div>
							<ul class="list-disc list-inside text-xs mt-0.5 space-y-0.5">
								{#each pillarNotesFor('what_can_kill_it') as n (n)}
									<li>{n}</li>
								{/each}
							</ul>
						</div>
					{/if}
					<CustomTables {companyId} section="what_can_kill_it" compact />
				</section>

				<!-- 6. Why We Believe It -->
				<section id="cp-sec-believe" class="mt-5 rounded-xl border border-border bg-surface p-5 scroll-mt-20">
					<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">6. Why We Believe It</h3>
					<ol class="list-decimal list-inside text-sm mt-1 space-y-1">
						{#each t.why_we_believe_it ?? [] as w, i (i)}
							<li>{w}</li>
						{/each}
					</ol>
					{#if pillarNotesFor('why_we_believe_it').length}
						<div class="mt-2">
							<div class="text-xs font-medium text-muted-fg">Notes</div>
							<ul class="list-disc list-inside text-xs mt-0.5 space-y-0.5">
								{#each pillarNotesFor('why_we_believe_it') as n (n)}
									<li>{n}</li>
								{/each}
							</ul>
						</div>
					{/if}
					<CustomTables {companyId} section="why_we_believe_it" compact />
				</section>

				<!-- Thesis Performance / price + 7. Health Check -->
				<section id="cp-sec-health" class="mt-5 rounded-xl border border-border bg-surface p-5 scroll-mt-20">
					<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">7. Quarterly Review</h3>
					<p class="text-sm mt-1 text-muted-fg">{t.health_check?.latest_quarter_review}</p>
					<div class="mt-2">
						{#each detail.health_checks as h (h.id)}
							{@const hstyle = STATUS_STYLES[h.verdict] ?? STATUS_STYLES.on_track}
							<div class="flex gap-2 py-1.5 border-b border-border last:border-0">
								<span class="inline-block h-2 w-2 mt-1.5 rounded-full {hstyle.dot} shrink-0"></span>
								<div>
									<div class="text-xs font-medium">
										{h.period} - {hstyle.label}
										<span class="text-muted-fg font-normal">({h.source}{h.human_confirmed ? ', confirmed' : ''})</span>
									</div>
									<div class="text-xs text-muted-fg">{h.note}</div>
								</div>
							</div>
						{:else}
							<div class="text-xs text-muted-fg">No quarterly reviews recorded yet.</div>
						{/each}
					</div>
					{#if pillarNotesFor('health_check').length}
						<div class="mt-2">
							<div class="text-xs font-medium text-muted-fg">Notes</div>
							<ul class="list-disc list-inside text-xs mt-0.5 space-y-0.5">
								{#each pillarNotesFor('health_check') as n (n)}
									<li>{n}</li>
								{/each}
							</ul>
						</div>
					{/if}
					<CustomTables {companyId} section="health_check" compact />
				</section>

				<!-- Buy/Sell Decisions + Observations + Price/Performance + Outcome (ActionPanels) -->
				<section id="cp-sec-decisions" class="mt-5 rounded-xl border border-border bg-surface p-5 scroll-mt-20">
					<ActionPanels {companyId} />
					{#if detail.pending_proposals?.length}
						<div class="text-xs text-muted-fg mt-3">
							{detail.pending_proposals.length} item(s) "To Review" - resolve them from the Review Queue.
						</div>
					{/if}
				</section>

				<!-- References -->
				<section id="cp-sec-references" class="mt-5 rounded-xl border border-border bg-surface p-5 scroll-mt-20">
					<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">References</h3>
					<div class="mt-1 space-y-0.5">
						{#each t.references ?? [] as r (r.url)}
							<a href={r.url} target="_blank" rel="noopener" class="block text-sm text-ok hover:underline">{r.title}</a>
						{:else}
							<div class="text-xs text-muted-fg">None added.</div>
						{/each}
					</div>
					{#if pillarNotesFor('references').length}
						<div class="mt-2">
							<div class="text-xs font-medium text-muted-fg">Notes</div>
							<ul class="list-disc list-inside text-xs mt-0.5 space-y-0.5">
								{#each pillarNotesFor('references') as n (n)}
									<li>{n}</li>
								{/each}
							</ul>
						</div>
					{/if}
					<CustomTables {companyId} section="references" compact />
				</section>

				<!-- Custom Sections (untagged tables) - each one also gets its own
				     named entry in the left nav (see SECTIONS above) -->
				<section id="cp-sec-custom" class="mt-5 rounded-xl border border-border bg-surface p-5 mb-10 scroll-mt-20">
					<CustomTables {companyId} heading="Custom Sections" onTablesChange={(t) => (customTables = t)} />
				</section>
			</div>
		</div>
	{/if}
