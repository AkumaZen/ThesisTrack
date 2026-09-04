<script lang="ts">
	// Ports the drawer.js/company-page rendering from the vanilla-JS
	// frontend into a real route - this is the concrete fix for the
	// reported "card click should show a separate page, superfast" issue.
	// Tables/decisions/performance panels (the old combined /panel endpoint)
	// land in Phase 2 once those backend services are ported.
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { STATUS_STYLES } from '$lib/format';

	type KillTrigger = {
		id: number;
		label: string;
		metric_key: string | null;
		operator: string | null;
		threshold: number | null;
		severity: string;
		action: string;
		grace_periods: number;
		manual_check: boolean;
		latest_observed_value: number | null;
		latest_breached: boolean | null;
		latest_fired: boolean | null;
	};
	type HealthCheck = { id: number; period: string; verdict: string; source: string; note: string; human_confirmed: boolean };
	type CompanyDetail = {
		company_id: string;
		name: string;
		broad_industry: string;
		specific_niche: string;
		operating_model: string;
		currency: string;
		status: string | null;
		has_active_override: boolean;
		current_thesis: {
			the_business?: { what_it_does: string; revenue_split: { segment: string; share_pct: number }[] };
			the_growth_engine?: string[];
			the_big_change?: { summary: string; expected_completion: string };
			proof_points?: { hard_evidence: string[] };
			why_we_believe_it?: string[];
			health_check?: { latest_quarter_review: string };
			references?: { title: string; url: string }[];
		};
		kill_triggers: KillTrigger[];
		health_checks: HealthCheck[];
		active_override: { to_status: string; rationale: string; actor: string } | null;
	};

	let companyId = $derived(page.params.id!);
	let detail = $state<CompanyDetail | null>(null);
	let error = $state('');
	let loading = $state(true);

	async function load() {
		loading = true;
		error = '';
		try {
			detail = (await api.getCompany(companyId)) as CompanyDetail;
		} catch (e) {
			error = String(e);
		} finally {
			loading = false;
		}
	}

	onMount(load);
	$effect(() => {
		companyId;
		load();
	});

	let style = $derived(STATUS_STYLES[detail?.status ?? ''] ?? STATUS_STYLES.on_track);
</script>

<a href="/" class="text-sm text-muted-fg hover:text-fg">&larr; Back</a>

{#if loading}
	<div class="text-center text-muted-fg py-16">Loading...</div>
{:else if error}
	<div class="text-center text-danger py-16">{error}</div>
{:else if detail}
	<div class="mt-3">
		<div class="flex items-center gap-2">
			<span class="inline-block h-2 w-2 rounded-full {style.dot}"></span>
			<span class="text-xs font-medium {style.pill} px-2 py-0.5 rounded-full ring-1">{style.label}</span>
			{#if detail.has_active_override}
				<span class="text-[10px] font-semibold uppercase text-danger bg-danger/10 px-2 py-0.5 rounded-full ring-1 ring-danger/20"
					>Active Override</span
				>
			{/if}
		</div>
		<h2 class="text-xl font-semibold mt-1">{detail.name}</h2>
		<div class="text-sm text-muted-fg">
			{detail.broad_industry} &gt; {detail.specific_niche} &middot; {detail.operating_model} &middot; {detail.currency}
		</div>

		{#if detail.active_override}
			<div class="mt-3 rounded-md bg-danger/10 border border-danger/30 p-3 text-sm text-danger">
				<strong>Override active:</strong> status held at {detail.active_override.to_status} by {detail.active_override.actor}.
				<div class="mt-1">{detail.active_override.rationale}</div>
			</div>
		{/if}

		{#if detail.current_thesis?.the_business}
			<section class="mt-5">
				<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">The Business</h3>
				<p class="text-sm mt-1">{detail.current_thesis.the_business.what_it_does}</p>
				<div class="mt-2 space-y-0.5">
					{#each detail.current_thesis.the_business.revenue_split as r (r.segment)}
						<div class="flex justify-between text-sm"><span>{r.segment}</span><span>{r.share_pct}%</span></div>
					{/each}
				</div>
			</section>
		{/if}

		{#if detail.current_thesis?.the_growth_engine?.length}
			<section class="mt-4">
				<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">The Growth Engine</h3>
				<ul class="list-disc list-inside text-sm mt-1 space-y-0.5">
					{#each detail.current_thesis.the_growth_engine as g, i (i)}
						<li>{g}</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if detail.current_thesis?.the_big_change}
			<section class="mt-4">
				<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">The Big Change</h3>
				<p class="text-sm mt-1">{detail.current_thesis.the_big_change.summary}</p>
				<div class="text-xs text-muted-fg mt-0.5">Expected completion: {detail.current_thesis.the_big_change.expected_completion}</div>
			</section>
		{/if}

		{#if detail.current_thesis?.proof_points?.hard_evidence?.length}
			<section class="mt-4">
				<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Proof Points</h3>
				<ul class="list-disc list-inside text-sm mt-1 space-y-0.5">
					{#each detail.current_thesis.proof_points.hard_evidence as e, i (i)}
						<li>{e}</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if detail.current_thesis?.why_we_believe_it?.length}
			<section class="mt-4">
				<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Why We Believe It</h3>
				<ol class="list-decimal list-inside text-sm mt-1 space-y-1">
					{#each detail.current_thesis.why_we_believe_it as w, i (i)}
						<li>{w}</li>
					{/each}
				</ol>
			</section>
		{/if}

		<section class="mt-4">
			<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Invalidation Redlines</h3>
			{#if detail.kill_triggers.length}
				<div class="mt-1">
					{#each detail.kill_triggers as t (t.id)}
						<div class="border-b border-border py-2 last:border-0">
							<div class="flex items-center justify-between">
								<span class="text-sm" class:text-danger={t.latest_fired} class:font-medium={t.latest_fired}>{t.label}</span>
								<span
									class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
									class:bg-danger={false}
									class:text-danger={t.severity === 'kill'}
									class:bg-warn={t.severity !== 'kill'}
								>
									{t.severity}
								</span>
							</div>
							<div class="text-xs text-muted-fg">{t.action} &middot; grace {t.grace_periods}</div>
							{#if t.manual_check}
								<div class="text-xs text-muted-fg italic">Manual check - not quantifiable.</div>
							{:else if t.latest_observed_value != null}
								<div class="text-xs text-muted-fg mt-0.5">observed {t.latest_observed_value} vs threshold {t.operator} {t.threshold}</div>
							{:else}
								<div class="text-xs text-muted-fg">No observation yet for {t.metric_key}.</div>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<div class="text-xs text-muted-fg mt-1">None defined.</div>
			{/if}
		</section>

		{#if detail.current_thesis?.health_check}
			<section class="mt-4">
				<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Health Check Timeline</h3>
				<p class="text-sm mt-1 text-muted-fg">{detail.current_thesis.health_check.latest_quarter_review}</p>
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
						<div class="text-xs text-muted-fg">No health checks recorded yet.</div>
					{/each}
				</div>
			</section>
		{/if}

		{#if detail.current_thesis?.references?.length}
			<section class="mt-4 mb-8">
				<h3 class="font-medium text-sm text-muted-fg uppercase tracking-wide">References</h3>
				<div class="mt-1 space-y-0.5">
					{#each detail.current_thesis.references as r (r.url)}
						<a href={r.url} target="_blank" rel="noopener" class="block text-sm text-ok hover:underline">{r.title}</a>
					{/each}
				</div>
			</section>
		{/if}
	</div>
{/if}
