<script lang="ts">
	// New-company/initial-thesis form, amend-thesis form, and JSON-paste import,
	// all in one route. Ports frontend/components/ingest.js's Form/JSON tabs and
	// its create/amend mode switch into Svelte 5.
	//
	// Modes (via query params):
	//   (default)                       - create a brand-new company + thesis
	//   ?companyId=X                    - create a new scenario on an EXISTING
	//                                      company ("Start Your Own Thesis"):
	//                                      Basics prefilled/locked from that company
	//   ?mode=amend&companyId=X         - amend the caller's own thesis on X:
	//                                      Basics hidden, Change Note required,
	//                                      all pillar fields prefilled
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { api, ApiError } from '$lib/api';

	const OPERATING_MODELS = ['factory', 'subscription', 'money_lending', 'retail_stores', 'services'];
	const STATUSES = ['on_track', 'watch_closely', 'broken'];
	const OPERATORS = ['<', '<=', '>', '>=', '==', '!='];
	const BELIEVE_KINDS = ['Premise', 'Inference', 'Conclusion'];

	type Industry = { name: string; niches: { name: string }[] };
	type MetricDef = { metric_key: string; label: string; unit: string };

	let mode = $derived(page.url.searchParams.get('mode') === 'amend' ? 'amend' : 'create');
	let prefillCompanyId = $derived(page.url.searchParams.get('companyId') ?? '');
	let isExistingCompany = $derived(mode === 'amend' || !!prefillCompanyId);

	let taxonomy = $state<Industry[]>([]);
	let metrics = $state<MetricDef[]>([]);
	let loadError = $state('');
	let submitting = $state(false);
	let submitError = $state('');
	let fieldErrors = $state<string[]>([]);
	let prefilling = $state(false);

	let activeTab = $state<'form' | 'json'>('form');
	let jsonText = $state('');
	let jsonValidateMsg = $state('');
	let jsonValidateOk = $state(false);

	// Basics
	let companyId = $state('');
	let name = $state('');
	let broadIndustry = $state('');
	let specificNiche = $state('');
	let operatingModel = $state('factory');
	let currency = $state('INR');
	let status = $state('on_track');
	let lastReviewed = $state(new Date().toISOString().slice(0, 10));

	// Amend-only
	let changeNote = $state('');

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

	// Pillar notes (Additional Notes, keyed by ThesisData field name)
	let pillarNotes = $state<Record<string, string[]>>({});

	function notesFor(fieldKey: string): string[] {
		return pillarNotes[fieldKey] ?? [];
	}
	function addNote(fieldKey: string) {
		pillarNotes = { ...pillarNotes, [fieldKey]: [...notesFor(fieldKey), ''] };
	}
	function removeNote(fieldKey: string, i: number) {
		pillarNotes = { ...pillarNotes, [fieldKey]: notesFor(fieldKey).filter((_, idx) => idx !== i) };
	}

	let niches = $derived(taxonomy.find((i) => i.name === broadIndustry)?.niches ?? []);

	$effect(() => {
		if (!isExistingCompany && niches.length && !niches.some((n) => n.name === specificNiche)) {
			specificNiche = niches[0].name;
		}
	});

	function splitBelieveEntry(entry: string): { kind: string; text: string } {
		const match = /^\s*(Premise|Inference|Conclusion)\s*:\s*(.*)$/is.exec(entry || '');
		if (match) return { kind: match[1][0].toUpperCase() + match[1].slice(1).toLowerCase(), text: match[2] };
		return { kind: 'Premise', text: entry || '' };
	}

	type ThesisDataShape = {
		the_business?: { what_it_does?: string; revenue_split?: { segment: string; share_pct: number }[] };
		the_growth_engine?: string[];
		the_big_change?: { summary?: string; expected_completion?: string };
		proof_points?: { hard_evidence?: string[]; model_specific_metrics?: Record<string, number> };
		what_can_kill_it?: {
			label: string;
			metric_key?: string | null;
			operator?: string | null;
			threshold?: number | null;
			action: string;
			severity: string;
			grace_periods: number;
			manual_check?: boolean;
		}[];
		why_we_believe_it?: string[];
		health_check?: { latest_quarter_review?: string };
		references?: { title: string; url: string }[];
		pillar_notes?: Record<string, string[]>;
	};

	function applyThesisData(t: ThesisDataShape) {
		whatItDoes = t.the_business?.what_it_does ?? '';
		revenueSplit = (t.the_business?.revenue_split ?? []).map((r) => ({ segment: r.segment, sharePct: String(r.share_pct) }));
		if (!revenueSplit.length) revenueSplit = [{ segment: '', sharePct: '' }];
		growthEngine = t.the_growth_engine?.length ? [...t.the_growth_engine] : [''];
		bigChangeSummary = t.the_big_change?.summary ?? '';
		expectedCompletion = t.the_big_change?.expected_completion ?? '';
		hardEvidence = t.proof_points?.hard_evidence?.length ? [...t.proof_points.hard_evidence] : [''];
		metricValues = Object.fromEntries(
			Object.entries(t.proof_points?.model_specific_metrics ?? {}).map(([k, v]) => [k, String(v)])
		);
		killTriggers = t.what_can_kill_it?.length
			? t.what_can_kill_it.map((k) => ({
					label: k.label,
					metricKey: k.metric_key ?? '',
					operator: k.operator ?? '<',
					threshold: k.threshold != null ? String(k.threshold) : '',
					action: k.action,
					severity: k.severity,
					gracePeriods: String(k.grace_periods ?? 1),
					manualCheck: !!k.manual_check
				}))
			: [{ label: '', metricKey: '', operator: '<', threshold: '', action: '', severity: 'kill', gracePeriods: '1', manualCheck: false }];
		believeRows = t.why_we_believe_it?.length
			? t.why_we_believe_it.map(splitBelieveEntry)
			: [
					{ kind: 'Premise', text: '' },
					{ kind: 'Premise', text: '' },
					{ kind: 'Conclusion', text: '' }
				];
		latestQuarterReview = t.health_check?.latest_quarter_review ?? '';
		references = t.references?.length ? [...t.references] : [];
		pillarNotes = { ...(t.pillar_notes ?? {}) };
	}

	onMount(async () => {
		try {
			const tax = (await api.getTaxonomy()) as Industry[];
			taxonomy = tax;
			if (tax.length && !isExistingCompany) broadIndustry = tax[0].name;
		} catch (e) {
			loadError = String(e);
		}

		if (isExistingCompany && prefillCompanyId) {
			prefilling = true;
			try {
				const detail = (await api.getCompany(prefillCompanyId)) as {
					company_id: string;
					name: string;
					broad_industry: string;
					specific_niche: string;
					operating_model: string;
					currency: string;
					status: string | null;
					last_reviewed: string | null;
					current_thesis?: ThesisDataShape;
					has_own_scenario: boolean;
				};
				companyId = detail.company_id;
				name = detail.name;
				broadIndustry = detail.broad_industry;
				specificNiche = detail.specific_niche;
				operatingModel = detail.operating_model;
				currency = detail.currency;
				if (detail.status) status = detail.status;
				if (detail.last_reviewed) lastReviewed = detail.last_reviewed;
				if (mode === 'amend' && detail.has_own_scenario && detail.current_thesis) {
					applyThesisData(detail.current_thesis);
				}
			} catch (e) {
				loadError = `Could not load existing company: ${String(e)}`;
			} finally {
				prefilling = false;
			}
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

	function buildThesisData() {
		return {
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
			pillar_notes: Object.fromEntries(
				Object.entries(pillarNotes)
					.map(([k, v]) => [k, v.map((n) => n.trim()).filter(Boolean)])
					.filter(([, v]) => (v as string[]).length)
			)
		};
	}

	function buildCreatePayload() {
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
			thesis_data: buildThesisData()
		};
	}

	function extractErrors(e: unknown): { fieldErrors: string[]; submitError: string } {
		if (e instanceof ApiError) {
			const msg = typeof e.body === 'string' ? e.body : ((e.body as { message?: string })?.message ?? e.message);
			const errs = String(msg).split('\n').filter(Boolean);
			return { fieldErrors: errs, submitError: errs.length ? '' : String(msg) };
		}
		return { fieldErrors: [], submitError: String(e) };
	}

	async function submit() {
		submitError = '';
		fieldErrors = [];
		submitting = true;
		try {
			if (mode === 'amend') {
				if (!changeNote.trim()) {
					fieldErrors = ['Change Note is required when amending a thesis.'];
					submitting = false;
					return;
				}
				await api.amendThesis(prefillCompanyId, { thesis_data: buildThesisData(), change_note: changeNote.trim() });
				await goto(`/company/${encodeURIComponent(prefillCompanyId)}`);
			} else {
				const payload = buildCreatePayload();
				const created = (await api.createCompany(payload)) as { company_id: string };
				await goto(`/company/${encodeURIComponent(created.company_id)}`);
			}
		} catch (e) {
			const { fieldErrors: fe, submitError: se } = extractErrors(e);
			fieldErrors = fe;
			submitError = se;
		} finally {
			submitting = false;
		}
	}

	// ---- JSON tab ----
	const CONVERSION_PROMPT = `Convert the investment thesis notes I paste after this prompt into a single JSON object with EXACTLY this shape (no extra keys, no markdown fencing):

{
  "company_id": "TICKER_OR_SLUG",
  "name": "Company Name",
  "classification": { "broad_industry": "...", "specific_niche": "...", "operating_model": "factory|subscription|money_lending|retail_stores|services", "currency": "INR" },
  "status": "on_track|watch_closely|broken",
  "last_reviewed": "YYYY-MM-DD",
  "thesis_data": {
    "the_business": { "what_it_does": "...", "revenue_split": [{ "segment": "...", "share_pct": 0 }] },
    "the_growth_engine": ["..."],
    "the_big_change": { "summary": "...", "expected_completion": "..." },
    "proof_points": { "hard_evidence": ["..."], "model_specific_metrics": {} },
    "what_can_kill_it": [{ "label": "...", "metric_key": null, "operator": null, "threshold": null, "action": "...", "severity": "kill", "grace_periods": 1, "manual_check": true }],
    "why_we_believe_it": ["Premise: ...", "Premise: ...", "Conclusion: ..."],
    "health_check": { "latest_quarter_review": "...", "historical_checks": [] },
    "references": [{ "title": "...", "url": "https://..." }],
    "pillar_notes": {}
  }
}

Rules: revenue_split share_pct must sum to ~100. what_can_kill_it needs at least one entry with severity="kill". why_we_believe_it needs at least 3 entries, at least one starting with "Premise:", and exactly one starting with "Conclusion:". Ask me clarifying questions if anything is ambiguous, then output ONLY the JSON.

My notes:
`;

	function applyParsedPayload(parsed: {
		company_id?: string;
		name?: string;
		classification?: { broad_industry?: string; specific_niche?: string; operating_model?: string; currency?: string };
		status?: string;
		last_reviewed?: string;
		thesis_data?: ThesisDataShape;
	}) {
		if (parsed.company_id) companyId = parsed.company_id;
		if (parsed.name) name = parsed.name;
		if (parsed.classification?.broad_industry) broadIndustry = parsed.classification.broad_industry;
		if (parsed.classification?.specific_niche) specificNiche = parsed.classification.specific_niche;
		if (parsed.classification?.operating_model) operatingModel = parsed.classification.operating_model;
		if (parsed.classification?.currency) currency = parsed.classification.currency;
		if (parsed.status) status = parsed.status;
		if (parsed.last_reviewed) lastReviewed = parsed.last_reviewed;
		if (parsed.thesis_data) applyThesisData(parsed.thesis_data);
	}

	function validateJson() {
		jsonValidateMsg = '';
		jsonValidateOk = false;
		let parsed: unknown;
		try {
			parsed = JSON.parse(jsonText);
		} catch (e) {
			jsonValidateMsg = `Not valid JSON: ${String(e)}`;
			return;
		}
		if (mode === 'amend') {
			const obj = parsed as { thesis_data?: unknown };
			if (!obj.thesis_data || typeof obj.thesis_data !== 'object') {
				jsonValidateMsg = 'Expected an object with a "thesis_data" key (or paste the thesis_data object directly).';
				// tolerate pasting a bare thesis_data object for amend
				applyParsedPayload({ thesis_data: parsed as ThesisDataShape });
				jsonValidateOk = true;
				jsonValidateMsg = 'Structure loaded into the form (as thesis_data) - review each section, then Save Amendment.';
				return;
			}
			applyParsedPayload(obj as { thesis_data: ThesisDataShape });
		} else {
			applyParsedPayload(
				parsed as {
					company_id?: string;
					name?: string;
					classification?: { broad_industry?: string; specific_niche?: string; operating_model?: string; currency?: string };
					status?: string;
					last_reviewed?: string;
					thesis_data?: ThesisDataShape;
				}
			);
		}
		jsonValidateOk = true;
		jsonValidateMsg = 'Structure loaded into the Form tab - review each section, then submit.';
		activeTab = 'form';
	}

	async function copyConversionPrompt() {
		try {
			await navigator.clipboard.writeText(CONVERSION_PROMPT);
		} catch {
			/* clipboard permission denied - textarea is still selectable/copyable manually */
		}
	}
</script>

<a href={isExistingCompany && prefillCompanyId ? `/company/${encodeURIComponent(prefillCompanyId)}` : '/'} class="text-sm text-muted-fg hover:text-fg"
	>&larr; Back</a
>

<div class="mt-3 max-w-2xl">
	<div class="flex items-center justify-between gap-3 flex-wrap">
		<div>
			<h1 class="text-xl font-semibold">{mode === 'amend' ? `Amend Thesis - ${name || prefillCompanyId}` : isExistingCompany ? `Start Your Own Thesis - ${name || prefillCompanyId}` : 'New Company / Thesis'}</h1>
			<p class="text-sm text-muted-fg mt-0.5">
				{mode === 'amend'
					? 'Basics are immutable after creation - amend the 7 pillars and explain why.'
					: 'Fill in the 7 pillars to create a company and its initial thesis.'}
			</p>
		</div>
		<div class="flex border border-border rounded-md overflow-hidden shrink-0">
			<button
				type="button"
				onclick={() => (activeTab = 'form')}
				class="px-3 py-1.5 text-xs font-medium {activeTab === 'form' ? 'bg-surface-3' : 'text-muted-fg'}">Form</button
			>
			<button
				type="button"
				onclick={() => (activeTab = 'json')}
				class="px-3 py-1.5 text-xs font-medium {activeTab === 'json' ? 'bg-surface-3' : 'text-muted-fg'}">JSON</button
			>
		</div>
	</div>

	{#if loadError}
		<div class="mt-3 rounded-md bg-danger/10 border border-danger/30 p-3 text-sm text-danger">{loadError}</div>
	{/if}
	{#if prefilling}
		<div class="mt-3 text-sm text-muted-fg">Loading existing thesis...</div>
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

	{#if activeTab === 'json'}
		<div class="mt-4">
			<details class="rounded-md border border-border mb-3">
				<summary class="cursor-pointer px-3 py-2 text-sm font-medium">Converting an existing write-up? Copy a prompt for that</summary>
				<div class="px-3 pb-3">
					<p class="text-xs text-muted-fg mb-2">
						Copy this prompt into ChatGPT/Claude/etc. alongside your existing thesis notes. It has our exact schema baked
						in, so the LLM can ask you clarifying questions and hand back JSON in the right shape - paste that JSON below
						and validate/load it into the form as usual.
					</p>
					<textarea readonly rows="6" class="w-full rounded-md border border-border px-2 py-1.5 text-xs font-mono bg-surface-2"
						>{CONVERSION_PROMPT}</textarea
					>
					<button type="button" onclick={copyConversionPrompt} class="text-xs text-ok mt-2">Copy prompt</button>
				</div>
			</details>
			<textarea
				bind:value={jsonText}
				rows="24"
				spellcheck="false"
				class="w-full rounded-md border border-border px-2 py-1.5 text-xs font-mono"
				placeholder={mode === 'amend' ? 'Paste a thesis_data payload here' : 'Paste a full thesis payload here'}
			></textarea>
			{#if jsonValidateMsg}
				<div class="mt-2 text-xs {jsonValidateOk ? 'text-good' : 'text-danger'}">{jsonValidateMsg}</div>
			{/if}
			<button type="button" onclick={validateJson} class="text-xs text-ok mt-2">Validate structure</button>
		</div>
	{:else}
		{#if mode === 'amend'}
			<section class="mt-5">
				<label class="block text-sm"
					>Change Note <span class="text-muted-fg">(required - why is the thesis being amended?)</span>
					<textarea bind:value={changeNote} rows="2" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"
					></textarea>
				</label>
			</section>
		{/if}

		{#if mode !== 'amend'}
			<!-- Basics -->
			<section class="mt-5">
				<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Basics</h2>
				<div class="grid grid-cols-2 gap-3 mt-2">
					<label class="text-sm"
						>Company ID
						<input
							bind:value={companyId}
							readonly={isExistingCompany}
							placeholder="TICKER_OR_SLUG"
							class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm {isExistingCompany ? 'bg-surface-2 text-muted-fg' : ''}"
						/>
					</label>
					<label class="text-sm"
						>Name
						<input bind:value={name} readonly={isExistingCompany} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm {isExistingCompany ? 'bg-surface-2 text-muted-fg' : ''}" />
					</label>
					<label class="text-sm"
						>Broad Industry
						<select bind:value={broadIndustry} disabled={isExistingCompany} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
							{#each taxonomy as i (i.name)}
								<option value={i.name}>{i.name}</option>
							{/each}
						</select>
					</label>
					<label class="text-sm"
						>Specific Niche
						<select bind:value={specificNiche} disabled={isExistingCompany} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
							{#each niches as n (n.name)}
								<option value={n.name}>{n.name}</option>
							{/each}
						</select>
					</label>
					<label class="text-sm"
						>Operating Model
						<select bind:value={operatingModel} disabled={isExistingCompany} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
							{#each OPERATING_MODELS as m (m)}
								<option value={m}>{m}</option>
							{/each}
						</select>
					</label>
					<label class="text-sm"
						>Currency
						<input bind:value={currency} readonly={isExistingCompany} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm {isExistingCompany ? 'bg-surface-2 text-muted-fg' : ''}" />
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
				{#if isExistingCompany}
					<p class="text-xs text-muted-fg mt-2">This company already exists - identity/classification are locked. You're starting a new thesis (scenario) of your own on it.</p>
				{/if}
			</section>
		{/if}

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
			<div class="mt-4 pt-3 border-t border-border">
				<div class="text-sm font-medium">Additional Notes <span class="text-muted-fg font-normal">- free-text extras that don't fit the fields above</span></div>
				<div class="space-y-1 mt-1">
					{#each notesFor('the_business') as _n, i (i)}
						<div class="flex gap-2 items-center">
							<input bind:value={pillarNotes['the_business'][i]} class="flex-1 rounded-md border border-border px-2 py-1 text-sm" />
							<button type="button" onclick={() => removeNote('the_business', i)} class="text-muted-fg hover:text-danger">&times;</button>
						</div>
					{/each}
				</div>
				<button type="button" onclick={() => addNote('the_business')} class="text-xs text-ok mt-1">+ Add note</button>
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
			<div class="mt-4 pt-3 border-t border-border">
				<div class="text-sm font-medium">Additional Notes</div>
				<div class="space-y-1 mt-1">
					{#each notesFor('the_growth_engine') as _n, i (i)}
						<div class="flex gap-2 items-center">
							<input bind:value={pillarNotes['the_growth_engine'][i]} class="flex-1 rounded-md border border-border px-2 py-1 text-sm" />
							<button type="button" onclick={() => removeNote('the_growth_engine', i)} class="text-muted-fg hover:text-danger">&times;</button>
						</div>
					{/each}
				</div>
				<button type="button" onclick={() => addNote('the_growth_engine')} class="text-xs text-ok mt-1">+ Add note</button>
			</div>
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
			<div class="mt-4 pt-3 border-t border-border">
				<div class="text-sm font-medium">Additional Notes</div>
				<div class="space-y-1 mt-1">
					{#each notesFor('the_big_change') as _n, i (i)}
						<div class="flex gap-2 items-center">
							<input bind:value={pillarNotes['the_big_change'][i]} class="flex-1 rounded-md border border-border px-2 py-1 text-sm" />
							<button type="button" onclick={() => removeNote('the_big_change', i)} class="text-muted-fg hover:text-danger">&times;</button>
						</div>
					{/each}
				</div>
				<button type="button" onclick={() => addNote('the_big_change')} class="text-xs text-ok mt-1">+ Add note</button>
			</div>
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
			<div class="mt-4 pt-3 border-t border-border">
				<div class="text-sm font-medium">Additional Notes</div>
				<div class="space-y-1 mt-1">
					{#each notesFor('proof_points') as _n, i (i)}
						<div class="flex gap-2 items-center">
							<input bind:value={pillarNotes['proof_points'][i]} class="flex-1 rounded-md border border-border px-2 py-1 text-sm" />
							<button type="button" onclick={() => removeNote('proof_points', i)} class="text-muted-fg hover:text-danger">&times;</button>
						</div>
					{/each}
				</div>
				<button type="button" onclick={() => addNote('proof_points')} class="text-xs text-ok mt-1">+ Add note</button>
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
			<div class="mt-4 pt-3 border-t border-border">
				<div class="text-sm font-medium">Additional Notes</div>
				<div class="space-y-1 mt-1">
					{#each notesFor('what_can_kill_it') as _n, i (i)}
						<div class="flex gap-2 items-center">
							<input bind:value={pillarNotes['what_can_kill_it'][i]} class="flex-1 rounded-md border border-border px-2 py-1 text-sm" />
							<button type="button" onclick={() => removeNote('what_can_kill_it', i)} class="text-muted-fg hover:text-danger">&times;</button>
						</div>
					{/each}
				</div>
				<button type="button" onclick={() => addNote('what_can_kill_it')} class="text-xs text-ok mt-1">+ Add note</button>
			</div>
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
			<div class="mt-4 pt-3 border-t border-border">
				<div class="text-sm font-medium">Additional Notes</div>
				<div class="space-y-1 mt-1">
					{#each notesFor('why_we_believe_it') as _n, i (i)}
						<div class="flex gap-2 items-center">
							<input bind:value={pillarNotes['why_we_believe_it'][i]} class="flex-1 rounded-md border border-border px-2 py-1 text-sm" />
							<button type="button" onclick={() => removeNote('why_we_believe_it', i)} class="text-muted-fg hover:text-danger">&times;</button>
						</div>
					{/each}
				</div>
				<button type="button" onclick={() => addNote('why_we_believe_it')} class="text-xs text-ok mt-1">+ Add note</button>
			</div>
		</section>

		<!-- Health Check -->
		<section class="mt-5">
			<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">7. Health Check</h2>
			<label class="block text-sm mt-2"
				>Latest Quarter Review
				<textarea bind:value={latestQuarterReview} rows="4" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"></textarea>
			</label>
			<div class="mt-4 pt-3 border-t border-border">
				<div class="text-sm font-medium">Additional Notes</div>
				<div class="space-y-1 mt-1">
					{#each notesFor('health_check') as _n, i (i)}
						<div class="flex gap-2 items-center">
							<input bind:value={pillarNotes['health_check'][i]} class="flex-1 rounded-md border border-border px-2 py-1 text-sm" />
							<button type="button" onclick={() => removeNote('health_check', i)} class="text-muted-fg hover:text-danger">&times;</button>
						</div>
					{/each}
				</div>
				<button type="button" onclick={() => addNote('health_check')} class="text-xs text-ok mt-1">+ Add note</button>
			</div>
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
			<div class="mt-4 pt-3 border-t border-border">
				<div class="text-sm font-medium">Additional Notes</div>
				<div class="space-y-1 mt-1">
					{#each notesFor('references') as _n, i (i)}
						<div class="flex gap-2 items-center">
							<input bind:value={pillarNotes['references'][i]} class="flex-1 rounded-md border border-border px-2 py-1 text-sm" />
							<button type="button" onclick={() => removeNote('references', i)} class="text-muted-fg hover:text-danger">&times;</button>
						</div>
					{/each}
				</div>
				<button type="button" onclick={() => addNote('references')} class="text-xs text-ok mt-1">+ Add note</button>
			</div>
		</section>
	{/if}

	<div class="flex justify-end gap-2 mb-10">
		<a
			href={isExistingCompany && prefillCompanyId ? `/company/${encodeURIComponent(prefillCompanyId)}` : '/'}
			class="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-surface-3">Cancel</a
		>
		<button
			type="button"
			disabled={submitting}
			onclick={submit}
			class="text-sm px-3 py-1.5 rounded-md bg-accent text-accent-ink hover:brightness-90 disabled:opacity-50"
		>
			{submitting ? 'Saving...' : mode === 'amend' ? 'Save Amendment' : isExistingCompany ? 'Start Thesis' : 'Create Company'}
		</button>
	</div>
</div>
