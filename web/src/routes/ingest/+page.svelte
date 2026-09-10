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
	import { operatingModelLabel } from '$lib/format';
	import TableBuilderModal, { type BuiltTable } from '$lib/components/TableBuilderModal.svelte';

	const STATUSES = ['on_track', 'watch_closely', 'broken'];
	const OPERATORS = ['<', '<=', '>', '>=', '==', '!='];
	const BELIEVE_KINDS = ['Premise', 'Inference', 'Conclusion'];

	type Industry = { name: string; niches: { name: string }[] };
	type OperatingModel = { name: string };
	type MetricDef = { metric_key: string; label: string; unit: string };
	type SelectedMetric = MetricDef & { value: string };

	let mode = $derived(page.url.searchParams.get('mode') === 'amend' ? 'amend' : 'create');
	let prefillCompanyId = $derived(page.url.searchParams.get('companyId') ?? '');
	let isExistingCompany = $derived(mode === 'amend' || !!prefillCompanyId);

	let taxonomy = $state<Industry[]>([]);
	let operatingModels = $state<OperatingModel[]>([]);
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
	let nseTicker = $state('');
	let bseTicker = $state('');
	let name = $state('');
	let broadIndustry = $state('');
	let specificNiche = $state('');
	let operatingModel = $state('factory');
	let currency = $state('INR');
	let status = $state('on_track');
	let lastReviewed = $state(new Date().toISOString().slice(0, 10));

	// Inline "add new" taxonomy affordances
	let addingIndustry = $state(false);
	let newIndustryName = $state('');
	let addingNiche = $state(false);
	let newNicheName = $state('');
	let addingOperatingModel = $state(false);
	let newOperatingModelName = $state('');
	let taxonomyBusy = $state(false);
	let taxonomyError = $state('');

	async function submitNewIndustry() {
		const nm = newIndustryName.trim();
		if (!nm) return;
		taxonomyBusy = true;
		taxonomyError = '';
		try {
			const created = (await api.proposeIndustry(nm)) as { name: string };
			taxonomy = [...taxonomy, { name: created.name, niches: [] }];
			broadIndustry = created.name;
			newIndustryName = '';
			addingIndustry = false;
		} catch (e) {
			taxonomyError = e instanceof ApiError ? String((e.body as { detail?: string })?.detail ?? e.message) : String(e);
		} finally {
			taxonomyBusy = false;
		}
	}

	async function submitNewNiche() {
		const nm = newNicheName.trim();
		if (!nm || !broadIndustry) return;
		taxonomyBusy = true;
		taxonomyError = '';
		try {
			const created = (await api.proposeNiche(broadIndustry, nm)) as { name: string };
			taxonomy = taxonomy.map((i) =>
				i.name === broadIndustry ? { ...i, niches: [...i.niches, { name: created.name }] } : i
			);
			specificNiche = created.name;
			newNicheName = '';
			addingNiche = false;
		} catch (e) {
			taxonomyError = e instanceof ApiError ? String((e.body as { detail?: string })?.detail ?? e.message) : String(e);
		} finally {
			taxonomyBusy = false;
		}
	}

	async function submitNewOperatingModel() {
		const nm = newOperatingModelName.trim();
		if (!nm) return;
		taxonomyBusy = true;
		taxonomyError = '';
		try {
			const created = (await api.proposeOperatingModel(nm)) as { name: string };
			operatingModels = [...operatingModels, { name: created.name }];
			operatingModel = created.name;
			newOperatingModelName = '';
			addingOperatingModel = false;
		} catch (e) {
			taxonomyError = e instanceof ApiError ? String((e.body as { detail?: string })?.detail ?? e.message) : String(e);
		} finally {
			taxonomyBusy = false;
		}
	}

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
	let selectedMetrics = $state<SelectedMetric[]>([]);
	let metricSearch = $state('');
	let creatingMetric = $state(false);
	let newMetricLabel = $state('');
	let newMetricUnit = $state('');
	let metricBusy = $state(false);
	let metricError = $state('');
	let availableMetrics = $derived(
		metrics.filter((metric) => {
			if (selectedMetrics.some((selected) => selected.metric_key === metric.metric_key)) return false;
			const query = metricSearch.trim().toLowerCase();
			return !query || metric.label.toLowerCase().includes(query) || metric.metric_key.includes(query) || metric.unit.toLowerCase().includes(query);
		})
	);

	function addMetric(metric: MetricDef) {
		if (!selectedMetrics.some((selected) => selected.metric_key === metric.metric_key)) {
			selectedMetrics = [...selectedMetrics, { ...metric, value: '' }];
		}
		metricSearch = '';
	}

	function removeMetric(metricKey: string) {
		selectedMetrics = selectedMetrics.filter((metric) => metric.metric_key !== metricKey);
	}

	async function createCustomMetric() {
		if (!newMetricLabel.trim() || !newMetricUnit.trim()) return;
		metricBusy = true;
		metricError = '';
		try {
			const created = (await api.createMetric({ label: newMetricLabel, unit: newMetricUnit })) as MetricDef;
			metrics = [...metrics, created].sort((a, b) => a.label.localeCompare(b.label));
			addMetric(created);
			newMetricLabel = '';
			newMetricUnit = '';
			creatingMetric = false;
		} catch (error) {
			metricError = error instanceof ApiError ? String((error.body as { message?: string })?.message ?? error.message) : String(error);
		} finally {
			metricBusy = false;
		}
	}

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
	let trackables = $state<string[]>([]);
	let buySellDecision = $state('');

	// References
	let references = $state<{ title: string; url: string }[]>([]);

	// Custom/pillar tables - each becomes its own custom data table on the
	// company, same shape as the "+ Add Table" builder on the company page -
	// literally the same TableBuilderModal component, so any change to that
	// builder (columns editor, CSV/paste import, etc.) shows up in both places
	// for free. The company doesn't exist yet while filling this form out, so
	// each built table is just queued here (tagged with the pillar section it
	// was added from, or null for the untagged "Custom Sections" block - same
	// tagging the company page's per-pillar "+ Add Table" uses) and actually
	// created via the API after the company itself is created
	// (createCustomSections).
	type QueuedTable = { id: number; section: string | null; built: BuiltTable };
	let queuedTables = $state<QueuedTable[]>([]);
	let nextQueuedTableId = 0;
	let sectionBuilderOpen = $state(false);
	let builderSection = $state<string | null>(null);

	// Back-compat alias for the untagged "Custom Sections" block below.
	let customSections = $derived(queuedTables.filter((t) => t.section === null));

	function tablesForSection(section: string) {
		return queuedTables.filter((t) => t.section === section);
	}
	function openTableBuilder(section: string | null) {
		builderSection = section;
		sectionBuilderOpen = true;
	}
	function removeQueuedTable(id: number) {
		queuedTables = queuedTables.filter((t) => t.id !== id);
	}
	function handleNewCustomSection(built: BuiltTable) {
		if (built.name.trim() && built.columns.length) {
			queuedTables = [...queuedTables, { id: nextQueuedTableId++, section: builderSection, built }];
		}
	}
	async function createCustomSections(companyId: string) {
		for (const { section, built } of queuedTables) {
			const table = (await api.createTable(companyId, { name: built.name.trim(), columns: built.columns, section })) as {
				id: number;
			};
			if (built.rows.length) await api.createRowsBulk(table.id, built.rows);
		}
	}

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
		trackables?: string[];
		buy_sell_decision?: string;
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
		selectedMetrics = Object.entries(t.proof_points?.model_specific_metrics ?? {}).map(([key, value]) => {
			const definition = metrics.find((metric) => metric.metric_key === key);
			return { metric_key: key, label: definition?.label ?? key, unit: definition?.unit ?? 'value', value: String(value) };
		});
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
		trackables = [...(t.trackables ?? [])];
		buySellDecision = t.buy_sell_decision ?? '';
		references = t.references?.length ? [...t.references] : [];
		pillarNotes = { ...(t.pillar_notes ?? {}) };
	}

	onMount(async () => {
		try {
			const [tax, allMetrics] = await Promise.all([
				api.getTaxonomy() as Promise<{ industries: Industry[]; operating_models: OperatingModel[] }>,
				api.getMetrics() as Promise<MetricDef[]>
			]);
			taxonomy = tax.industries;
			operatingModels = tax.operating_models;
			metrics = allMetrics;
			if (tax.industries.length && !isExistingCompany) broadIndustry = tax.industries[0].name;
			if (tax.operating_models.length && !isExistingCompany) operatingModel = tax.operating_models[0].name;
		} catch (e) {
			loadError = String(e);
		}

		if (isExistingCompany && prefillCompanyId) {
			prefilling = true;
			try {
				const detail = (await api.getCompany(prefillCompanyId)) as {
					company_id: string;
					name: string;
					nse_ticker?: string | null;
					bse_ticker?: string | null;
					broad_industry: string;
					specific_niche: string;
					operating_model: string;
					currency: string;
					status: string | null;
					last_reviewed: string | null;
					current_thesis?: ThesisDataShape;
					has_own_scenario: boolean;
				};
				nseTicker = detail.nse_ticker ?? '';
				bseTicker = detail.bse_ticker ?? '';
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
					selectedMetrics.filter((metric) => metric.value !== '').map((metric) => [metric.metric_key, Number(metric.value)])
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
			trackables: trackables.filter((item) => item.trim()),
			buy_sell_decision: buySellDecision,
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
			nse_ticker: nseTicker.trim().toUpperCase(),
			bse_ticker: bseTicker.trim().toUpperCase(),
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
				await createCustomSections(prefillCompanyId);
				await goto(`/company/${encodeURIComponent(prefillCompanyId)}`);
			} else {
				if (!isExistingCompany && !nseTicker.trim() && !bseTicker.trim()) {
					fieldErrors = ['At least one of NSE Ticker or BSE Ticker is required.'];
					submitting = false;
					return;
				}
				const payload = buildCreatePayload();
				const created = (await api.createCompany(payload)) as { company_id: string };
				await createCustomSections(created.company_id);
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
  "nse_ticker": "NSE_TICKER (at least one of nse_ticker/bse_ticker required)",
  "bse_ticker": "BSE_TICKER_OR_SCRIP_CODE",
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
    "trackables": ["What to monitor, in your own words"],
    "buy_sell_decision": "Your buy/sell reasoning and conditions. Actual transactions are logged separately after saving.",
    "references": [{ "title": "...", "url": "https://..." }],
    "pillar_notes": {}
  },
  "custom_sections": [
    {
      "name": "Any Section Name (e.g. Shareholding Pattern, Peer Valuation, Management Bios)",
      "columns": [{ "key": "column_key", "label": "Column Label", "type": "text|number|date|enum", "options": ["only for type=enum"] }],
      "rows": [{ "column_key": "value for row 1" }, { "column_key": "value for row 2" }]
    }
  ]
}

Rules: revenue_split share_pct must sum to ~100. what_can_kill_it needs at least one entry with severity="kill". why_we_believe_it needs at least 3 entries, at least one starting with "Premise:", and exactly one starting with "Conclusion:". "custom_sections" is optional and unbounded - use it for ANY data that doesn't fit the 7 fixed pillars above (shareholding, peer comps, management, subsidiaries, capex schedule, anything else my notes contain): add as many sections as needed, each with as many columns and rows as needed. Column "key" must be a short lowercase identifier (spaces/case get normalized automatically, but keep it clean); "type" defaults to "text" if omitted. Ask me clarifying questions if anything is ambiguous, then output ONLY the JSON.

My notes:
`;

	type ParsedCustomSection = {
		name?: string;
		columns?: { key?: string; label?: string; type?: string; options?: string[] }[];
		rows?: Record<string, string>[];
	};

	function applyParsedCustomSections(sections: ParsedCustomSection[]) {
		const mapped: BuiltTable[] = sections
			.filter((s) => s.name?.trim() && s.columns?.length)
			.map((s) => ({
				name: s.name!.trim(),
				columns: (s.columns ?? []).map((c) => ({
					key: c.key ?? '',
					label: c.label ?? c.key ?? '',
					type: (c.type ?? 'text') as BuiltTable['columns'][number]['type'],
					options: c.options
				})),
				rows: s.rows ?? []
			}));
		if (mapped.length) {
			queuedTables = [...queuedTables, ...mapped.map((built) => ({ id: nextQueuedTableId++, section: null, built }))];
		}
	}

	function applyParsedPayload(parsed: {
		company_id?: string;
		nse_ticker?: string;
		bse_ticker?: string;
		name?: string;
		classification?: { broad_industry?: string; specific_niche?: string; operating_model?: string; currency?: string };
		status?: string;
		last_reviewed?: string;
		thesis_data?: ThesisDataShape;
		custom_sections?: ParsedCustomSection[];
	}) {
		// company_id-only JSON payloads (older exports) map onto nse_ticker so
		// they still derive a working company_id on submit.
		if (parsed.nse_ticker) nseTicker = parsed.nse_ticker;
		else if (parsed.company_id) nseTicker = parsed.company_id;
		if (parsed.bse_ticker) bseTicker = parsed.bse_ticker;
		if (parsed.name) name = parsed.name;
		if (parsed.classification?.broad_industry) broadIndustry = parsed.classification.broad_industry;
		if (parsed.classification?.specific_niche) specificNiche = parsed.classification.specific_niche;
		if (parsed.classification?.operating_model) operatingModel = parsed.classification.operating_model;
		if (parsed.classification?.currency) currency = parsed.classification.currency;
		if (parsed.status) status = parsed.status;
		if (parsed.last_reviewed) lastReviewed = parsed.last_reviewed;
		if (parsed.thesis_data) applyThesisData(parsed.thesis_data);
		if (parsed.custom_sections?.length) applyParsedCustomSections(parsed.custom_sections);
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

<div class="mt-3 max-w-5xl mx-auto">
	<div class="flex items-center justify-between gap-3 flex-wrap">
		<div>
			<h1 class="text-xl font-semibold">{mode === 'amend' ? `Amend Thesis - ${name || prefillCompanyId}` : isExistingCompany ? `Start Your Own Thesis - ${name || prefillCompanyId}` : 'New Company / Thesis'}</h1>
			<p class="text-sm text-muted-fg mt-0.5">
				{mode === 'amend'
					? 'Amend the 9 default sections and explain why. References remain separate.'
					: 'Complete the 9 default sections for your company thesis. References remain separate.'}
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
			<section class="mt-5 rounded-xl border border-border bg-surface p-5">
				<label class="block text-sm"
					>Change Note <span class="text-muted-fg">(required - why is the thesis being amended?)</span>
					<textarea bind:value={changeNote} rows="2" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"
					></textarea>
				</label>
			</section>
		{/if}

		{#if mode !== 'amend'}
			<!-- Basics -->
			<section class="mt-5 rounded-xl border border-border bg-surface p-5">
				<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Basics</h2>
				<div class="grid grid-cols-2 gap-3 mt-2">
					<label class="text-sm"
						>NSE Ticker <span class="text-muted-fg font-normal">(at least one of NSE/BSE required)</span>
						<input
							bind:value={nseTicker}
							readonly={isExistingCompany}
							placeholder="e.g. RELIANCE"
							class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm uppercase {isExistingCompany ? 'bg-surface-2 text-muted-fg' : ''}"
						/>
					</label>
					<label class="text-sm"
						>BSE Ticker <span class="text-muted-fg font-normal">(at least one of NSE/BSE required)</span>
						<input
							bind:value={bseTicker}
							readonly={isExistingCompany}
							placeholder="e.g. 500325"
							class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm uppercase {isExistingCompany ? 'bg-surface-2 text-muted-fg' : ''}"
						/>
					</label>
					<label class="text-sm"
						>Name
						<input bind:value={name} readonly={isExistingCompany} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm {isExistingCompany ? 'bg-surface-2 text-muted-fg' : ''}" />
					</label>
					<label class="text-sm"
						>Broad Industry
						{#if !isExistingCompany && !addingIndustry}
							<button type="button" onclick={() => (addingIndustry = true)} class="float-right text-xs text-ok normal-case font-normal"
								>+ New Industry</button
							>
						{/if}
						{#if addingIndustry}
							<div class="mt-1 flex gap-1">
								<input
									bind:value={newIndustryName}
									placeholder="New industry name"
									class="flex-1 rounded-md border border-border px-2 py-1.5 text-sm"
								/>
								<button type="button" disabled={taxonomyBusy} onclick={submitNewIndustry} class="text-xs px-2 rounded-md border border-border hover:bg-surface-3"
									>Add</button
								>
								<button type="button" onclick={() => (addingIndustry = false)} class="text-xs px-2 text-muted-fg hover:text-danger"
									>Cancel</button
								>
							</div>
						{:else}
							<select bind:value={broadIndustry} disabled={isExistingCompany} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
								{#each taxonomy as i (i.name)}
									<option value={i.name}>{i.name}</option>
								{/each}
							</select>
						{/if}
					</label>
					<label class="text-sm"
						>Specific Niche
						{#if !isExistingCompany && !addingNiche && broadIndustry}
							<button type="button" onclick={() => (addingNiche = true)} class="float-right text-xs text-ok normal-case font-normal"
								>+ New Niche</button
							>
						{/if}
						{#if addingNiche}
							<div class="mt-1 flex gap-1">
								<input
									bind:value={newNicheName}
									placeholder="New niche name under {broadIndustry}"
									class="flex-1 rounded-md border border-border px-2 py-1.5 text-sm"
								/>
								<button type="button" disabled={taxonomyBusy} onclick={submitNewNiche} class="text-xs px-2 rounded-md border border-border hover:bg-surface-3"
									>Add</button
								>
								<button type="button" onclick={() => (addingNiche = false)} class="text-xs px-2 text-muted-fg hover:text-danger"
									>Cancel</button
								>
							</div>
						{:else}
							<select bind:value={specificNiche} disabled={isExistingCompany} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
								{#each niches as n (n.name)}
									<option value={n.name}>{n.name}</option>
								{/each}
							</select>
						{/if}
					</label>
					<label class="text-sm"
						>Operating Model
						{#if !isExistingCompany && !addingOperatingModel}
							<button type="button" onclick={() => (addingOperatingModel = true)} class="float-right text-xs text-ok normal-case font-normal"
								>+ New Operating Model</button
							>
						{/if}
						{#if addingOperatingModel}
							<div class="mt-1 flex gap-1">
								<input
									bind:value={newOperatingModelName}
									placeholder="New operating model name"
									class="flex-1 rounded-md border border-border px-2 py-1.5 text-sm"
								/>
								<button type="button" disabled={taxonomyBusy} onclick={submitNewOperatingModel} class="text-xs px-2 rounded-md border border-border hover:bg-surface-3"
									>Add</button
								>
								<button type="button" onclick={() => (addingOperatingModel = false)} class="text-xs px-2 text-muted-fg hover:text-danger"
									>Cancel</button
								>
							</div>
						{:else}
							<select bind:value={operatingModel} disabled={isExistingCompany} class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm">
								{#each operatingModels as m (m.name)}
									<option value={m.name}>{operatingModelLabel(m.name)}</option>
								{/each}
							</select>
						{/if}
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
				{#if taxonomyError}
					<p class="text-xs text-danger mt-2">{taxonomyError}</p>
				{/if}
			</section>
		{/if}

		<!-- Staged data tables for a pillar section - name + row/column count,
		     with a remove (x) button - reused across every pillar below and the
		     untagged "Custom Sections" block. -->
		{#snippet queuedTableList(items: QueuedTable[])}
			{#if items.length}
				<div class="space-y-2 mt-3">
					{#each items as t (t.id)}
						<div class="rounded-lg border border-border p-3 flex items-center justify-between">
							<div>
								<div class="text-sm font-medium">{t.built.name}</div>
								<div class="text-xs text-muted-fg">
									{t.built.columns.length} column{t.built.columns.length === 1 ? '' : 's'} &middot; {t.built.rows.length} row{t.built
										.rows.length === 1
										? ''
										: 's'} staged
								</div>
							</div>
							<button type="button" onclick={() => removeQueuedTable(t.id)} class="text-muted-fg hover:text-danger">&times;</button>
						</div>
					{/each}
				</div>
			{/if}
		{/snippet}

		<!-- Per-pillar table button + list - same builder/tagging as the "+ Add
		     Table" button inside each pillar's CustomTables on the company page,
		     just deferred (queued) until the company itself is created. -->
		{#snippet pillarTables(section: string)}
			<div class="mt-4 pt-3 border-t border-border">
				<div class="flex items-center justify-between">
					<div class="text-sm font-medium">Tables <span class="text-muted-fg font-normal">- optional data tables for this section</span></div>
					<button
						type="button"
						onclick={() => openTableBuilder(section)}
						class="text-xs text-ok px-2 py-1 rounded-md cursor-pointer hover:bg-ok/10 transition-colors">+ Add Table</button
					>
				</div>
				{@render queuedTableList(tablesForSection(section))}
			</div>
		{/snippet}

		<!-- The Business -->
		<section class="mt-5 rounded-xl border border-border bg-surface p-5">
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
			{@render pillarTables('the_business')}
		</section>

		<!-- The Growth Engine -->
		<section class="mt-5 rounded-xl border border-border bg-surface p-5">
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
			{@render pillarTables('the_growth_engine')}
		</section>

		<!-- The Big Change -->
		<section class="mt-5 rounded-xl border border-border bg-surface p-5">
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
			{@render pillarTables('the_big_change')}
		</section>

		<!-- Proof Points -->
		<section class="mt-5 rounded-xl border border-border bg-surface p-5">
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
				<div class="text-sm font-medium">Proof-point metrics</div>
				<p class="text-xs text-muted-fg mt-0.5">Add only the measurements that matter for this company. Nothing is required or preselected.</p>
				<div class="space-y-2 mt-2">
					{#each selectedMetrics as metric (metric.metric_key)}
						<div class="grid grid-cols-[minmax(0,1fr)_minmax(9rem,0.45fr)_auto] gap-2 items-end">
						<label class="text-xs">
							<span>{metric.label}</span> <span class="text-muted-fg">({metric.unit})</span>
							<input type="number" step="any" bind:value={metric.value} placeholder="Value" class="mt-0.5 w-full rounded-md border border-border px-2 py-1 text-sm" />
						</label>
						<div class="pb-1 text-xs text-muted-fg truncate" title={metric.metric_key}>{metric.metric_key}</div>
						<button type="button" aria-label="Remove {metric.label}" onclick={() => removeMetric(metric.metric_key)} class="mb-1 px-2 py-1 text-muted-fg hover:text-danger">&times;</button>
						</div>
					{/each}
					{#if !selectedMetrics.length}
						<div class="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-fg">No metrics selected. Add any metric that makes this thesis measurable.</div>
					{/if}
			</div>

				<div class="mt-3 relative">
					<label class="text-xs font-medium" for="metric-search">Add a metric</label>
					<input id="metric-search" bind:value={metricSearch} placeholder="Search all metrics by name, key, or unit" autocomplete="off" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" />
					{#if metricSearch.trim()}
						<div class="mt-1 max-h-44 overflow-y-auto rounded-md border border-border bg-bg-ink shadow-lg">
							{#each availableMetrics as metric (metric.metric_key)}
								<button type="button" onclick={() => addMetric(metric)} class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-3">
									<span>{metric.label}</span><span class="text-xs text-muted-fg">{metric.unit}</span>
								</button>
							{/each}
							{#if !availableMetrics.length}
								<div class="px-3 py-2 text-xs text-muted-fg">No matching metric. Create it below.</div>
							{/if}
						</div>
					{/if}
				</div>

				{#if creatingMetric}
					<div class="mt-3 rounded-md border border-border bg-surface-2 p-3">
						<div class="grid grid-cols-2 gap-2">
							<label class="text-xs">Metric name<input bind:value={newMetricLabel} placeholder="e.g. Beds occupied" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" /></label>
							<label class="text-xs">Unit<input bind:value={newMetricUnit} placeholder="e.g. beds, tonnes/day, INR/room" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm" /></label>
						</div>
						{#if metricError}<div class="mt-2 text-xs text-danger">{metricError}</div>{/if}
						<div class="mt-2 flex gap-2">
							<button type="button" disabled={metricBusy || !newMetricLabel.trim() || !newMetricUnit.trim()} onclick={createCustomMetric} class="rounded-md bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-50">{metricBusy ? 'Creating…' : 'Create and add'}</button>
							<button type="button" onclick={() => (creatingMetric = false)} class="rounded-md border border-border px-3 py-1.5 text-xs">Cancel</button>
						</div>
					</div>
				{:else}
					<button type="button" onclick={() => (creatingMetric = true)} class="mt-2 text-xs text-ok">+ Create a custom metric</button>
				{/if}
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
			{@render pillarTables('proof_points')}
		</section>

		<!-- What Can Kill It -->
		<section class="mt-5 rounded-xl border border-border bg-surface p-5">
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
			{@render pillarTables('what_can_kill_it')}
		</section>

		<!-- Why We Believe It -->
		<section class="mt-5 rounded-xl border border-border bg-surface p-5">
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
			{@render pillarTables('why_we_believe_it')}
		</section>

		<!-- Health Check (pillar 7 / Quarterly Review) -->
		<section class="mt-5 rounded-xl border border-border bg-surface p-5">
			<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">7. Quarterly Review</h2>
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
			{@render pillarTables('health_check')}
		</section>

		<section class="rounded-xl border border-border bg-surface p-5">
			<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">8. Trackables</h2>
			<p class="mt-2 text-sm text-muted-fg">Write exactly what you want to monitor. These entries appear unchanged in the Review Queue, grouped by company.</p>
			<div class="mt-3 space-y-3">
				{#each trackables as item, i (i)}
					<div class="flex items-start gap-2">
						<textarea aria-label={`Trackable ${i + 1}`} bind:value={trackables[i]} rows="3" class="flex-1 min-w-0 rounded-md border border-border p-2 text-sm"></textarea>
						<button type="button" aria-label={`Remove trackable ${i + 1}`} onclick={() => trackables = removeRow(trackables, i)} class="px-2 py-1 text-muted-fg hover:text-fg">&times;</button>
					</div>
				{/each}
			</div>
			<button type="button" onclick={() => trackables = [...trackables, '']} class="mt-3 text-sm underline">+ Add trackable</button>
		</section>

		<section class="rounded-xl border border-border bg-surface p-5">
			<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">9. Buy / Sell Decision</h2>
			<label class="block mt-3 text-sm" for="buy-sell-decision">Decision reasoning and conditions</label>
			<textarea id="buy-sell-decision" bind:value={buySellDecision} rows="5" placeholder="Explain your buy/sell decision, the conditions behind it, and what would change your mind." class="mt-2 w-full rounded-md border border-border p-2 text-sm"></textarea>
			<p class="mt-2 text-xs text-muted-fg">After saving, log actual buys and sells in this section on the company page, with price, optional quantity, date, and rationale. Logged decisions remain in the permanent history.</p>
			{@render pillarTables('buy_sell_decision')}
		</section>

		<!-- References -->
		<section class="mt-5 mb-5 rounded-xl border border-border bg-surface p-5">
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
			{@render pillarTables('references')}
		</section>

		<!-- Custom Sections - uses the exact same builder (TableBuilderModal) as
		     the company page's "+ Add Table", so it's available up front too,
		     not just after the company card exists. -->
		<section class="mt-5 mb-5 rounded-xl border border-border bg-surface p-5">
			<div class="flex items-center justify-between">
				<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">Custom Sections</h2>
				<button
					type="button"
					onclick={() => openTableBuilder(null)}
					class="text-xs text-ok px-2 py-1 rounded-md cursor-pointer hover:bg-ok/10 transition-colors">+ Add Custom Section</button
				>
			</div>
			<p class="text-xs text-muted-fg mt-1">
				Optional - define your own data tables (name + columns), same builder as "+ Add Table" on the company page. Each one
				shows up there as its own named card and nav entry once the company is created.
			</p>
			{@render queuedTableList(customSections)}
		</section>

		<TableBuilderModal
			bind:open={sectionBuilderOpen}
			title={builderSection ? 'New Data Table' : 'New Custom Section'}
			submitLabel={builderSection ? 'Create Table' : 'Add Section'}
			onSubmit={handleNewCustomSection}
		/>
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
			class="text-sm px-3 py-1.5 rounded-md bg-fg text-bg hover:brightness-90 disabled:opacity-50"
		>
			{submitting ? 'Saving...' : mode === 'amend' ? 'Save Amendment' : isExistingCompany ? 'Start Thesis' : 'Create Company'}
		</button>
	</div>
</div>
