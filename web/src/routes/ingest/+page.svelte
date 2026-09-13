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
	//                                      Basics hidden, Change Note optional,
	//                                      all pillar fields prefilled
	//
	// Every pillar field below is optional - a thesis is built up over time,
	// not filled out all at once, so nothing here blocks a save.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';
	import { api, ApiError } from '$lib/api';
	import { operatingModelLabel } from '$lib/format';
	import TableBuilderModal, { type BuiltTable } from '$lib/components/TableBuilderModal.svelte';
	import TableCard, { type TableSummary } from '$lib/components/TableCard.svelte';

	const STATUSES = ['on_track', 'watch_closely', 'broken'];
	const OPERATORS = ['<', '<=', '>', '>=', '==', '!='];
	const SEVERITIES = ['warn', 'kill'];
	const BELIEVE_KINDS = ['Premise', 'Inference', 'Conclusion'];
	// Mirrors $lib/server/pillars.ts's PILLAR_KEYS - duplicated (not imported)
	// since that module is server-only and this is client code. Used to
	// validate a JSON-import custom_section's "pillar" tag.
	const PILLAR_KEYS = [
		'the_business',
		'the_growth_engine',
		'the_big_change',
		'proof_points',
		'what_can_kill_it',
		'why_we_believe_it',
		'health_check',
		'buy_sell_decision',
		'references'
	];

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
	// Fields a JSON import got wrong in a way the server would hard-reject
	// (wrong type, value outside an enum) get auto-corrected here instead -
	// dropped/defaulted with a note added here, so the import still loads
	// and the reviewer sees exactly what got cleaned up rather than hitting
	// a cryptic server validation error after Confirm.
	let importWarnings = $state<string[]>([]);
	// Snapshot of every field a JSON import can touch, taken right before
	// applying one - lets the reviewer see the import rendered in the real
	// Form tab (the actual look, not a mockup) and then either confirm it,
	// go back and edit the JSON, or discard it and start over. Non-null only
	// while an import is pending review; null once confirmed or discarded.
	let preImportSnapshot = $state<FormSnapshot | null>(null);

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
			metricError = error instanceof ApiError ? String((error.body as { detail?: string })?.detail ?? error.message) : String(error);
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
	// Real, already-created tables (amend mode only) - fetched so a note's
	// real "table" blocks can render the actual grid inline via TableCard,
	// not a name chip.
	let tablesById = $state<Record<number, TableSummary>>({});
	let nextQueuedTableId = 0;
	let sectionBuilderOpen = $state(false);
	let builderSection = $state<string | null>(null);
	// Set when "+ Add Table" was opened from inside a specific note (rather
	// than as this section's general table-add) - the created table gets
	// appended as a block on that note too, once real IDs are known.
	let builderNoteIndex = $state<number | null>(null);

	// Back-compat alias for the untagged "Custom Sections" block below.
	let customSections = $derived(queuedTables.filter((t) => t.section === null));

	function openTableBuilder(section: string | null, noteIndex: number | null = null) {
		builderSection = section;
		builderNoteIndex = noteIndex;
		sectionBuilderOpen = true;
	}
	function removeQueuedTable(id: number) {
		queuedTables = queuedTables.filter((t) => t.id !== id);
	}
	function handleNewCustomSection(built: BuiltTable) {
		if (built.name.trim() && built.columns.length) {
			const queuedId = nextQueuedTableId++;
			queuedTables = [...queuedTables, { id: queuedId, section: builderSection, built }];
			if (builderSection != null && builderNoteIndex != null) {
				const section = builderSection;
				const noteIndex = builderNoteIndex;
				pillarNotes = {
					...pillarNotes,
					[section]: notesFor(section).map((n, idx) =>
						idx === noteIndex ? { blocks: [...n.blocks, { type: 'table_pending' as const, queued_id: queuedId }] } : n
					)
				};
			}
		}
		builderNoteIndex = null;
	}
	// Returns queued-table-id -> real-table-id once every queued table has
	// actually been created (only possible after the company itself exists).
	async function createCustomSections(companyId: string): Promise<Map<number, number>> {
		const idMap = new Map<number, number>();
		for (const { id: queuedId, section, built } of queuedTables) {
			const table = (await api.createTable(companyId, { name: built.name.trim(), columns: built.columns, section })) as {
				id: number;
			};
			if (built.rows.length) await api.createRowsBulk(table.id, built.rows);
			idMap.set(queuedId, table.id);
		}
		return idMap;
	}

	// Pillar notes ("Additional Notes", keyed by ThesisData field name) - each
	// note is a small ordered sequence of blocks (free text or a table
	// reference), not a single string. A newly-added table block starts out
	// "table_pending" (pointing at a queued table with no real id yet, since
	// the company doesn't exist until this form is submitted); it's resolved
	// to a real "table" block after creation - see hasPendingTableBlocks()
	// and buildThesisData()'s idMap parameter.
	type IngestBlock =
		| { type: 'text'; text: string }
		| { type: 'table'; table_id: number }
		| { type: 'table_pending'; queued_id: number };
	type IngestNote = { blocks: IngestBlock[] };
	let pillarNotes = $state<Record<string, IngestNote[]>>({});

	function notesFor(fieldKey: string): IngestNote[] {
		return pillarNotes[fieldKey] ?? [];
	}
	function addNote(fieldKey: string) {
		pillarNotes = { ...pillarNotes, [fieldKey]: [...notesFor(fieldKey), { blocks: [{ type: 'text', text: '' }] }] };
	}
	function removeNote(fieldKey: string, i: number) {
		pillarNotes = { ...pillarNotes, [fieldKey]: notesFor(fieldKey).filter((_, idx) => idx !== i) };
	}
	function addTextBlock(fieldKey: string, noteIndex: number) {
		pillarNotes = {
			...pillarNotes,
			[fieldKey]: notesFor(fieldKey).map((n, idx) => (idx === noteIndex ? { blocks: [...n.blocks, { type: 'text', text: '' }] } : n))
		};
	}
	function removeBlock(fieldKey: string, noteIndex: number, blockIndex: number) {
		pillarNotes = {
			...pillarNotes,
			[fieldKey]: notesFor(fieldKey).map((n, idx) =>
				idx === noteIndex ? { blocks: n.blocks.filter((_, bi) => bi !== blockIndex) } : n
			)
		};
	}
	function hasPendingTableBlocks(): boolean {
		return Object.values(pillarNotes).some((notes) => notes.some((n) => n.blocks.some((b) => b.type === 'table_pending')));
	}

	// VSCode-style Tab: inserts a literal tab at the cursor instead of jumping
	// focus to the next field, with Shift+Tab removing one level of leading
	// indent from the current line. Only meaningful for text blocks.
	async function handleBlockKeydown(e: KeyboardEvent, fieldKey: string, noteIndex: number, blockIndex: number) {
		if (e.key !== 'Tab') return;
		const block = notesFor(fieldKey)[noteIndex]?.blocks[blockIndex];
		if (!block || block.type !== 'text') return;
		e.preventDefault();
		const el = e.currentTarget as HTMLTextAreaElement;
		const start = el.selectionStart ?? 0;
		const end = el.selectionEnd ?? 0;
		const value = block.text;

		let nextText: string | null = null;
		let cursor = start;
		if (e.shiftKey) {
			const lineStart = value.lastIndexOf('\n', start - 1) + 1;
			if (value[lineStart] === '\t') {
				nextText = value.slice(0, lineStart) + value.slice(lineStart + 1);
				cursor = Math.max(lineStart, start - 1);
			}
		} else {
			nextText = value.slice(0, start) + '\t' + value.slice(end);
			cursor = start + 1;
		}
		if (nextText == null) return;
		const resolvedText = nextText;
		pillarNotes = {
			...pillarNotes,
			[fieldKey]: notesFor(fieldKey).map((n, ni) =>
				ni === noteIndex ? { blocks: n.blocks.map((b, bi) => (bi === blockIndex ? { type: 'text', text: resolvedText } : b)) } : n
			)
		};
		await tick();
		el.selectionStart = el.selectionEnd = cursor;
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
		// Server-side data is already blocks-shaped (old plain-string notes get
		// normalized to a single text block on the way through the Zod schema),
		// but tolerate raw strings too in case this is hand-edited JSON.
		pillar_notes?: Record<string, (string | { blocks: ({ type: 'text'; text: string } | { type: 'table'; table_id: number })[] })[]>;
	};

	function applyThesisData(t: ThesisDataShape) {
		whatItDoes = t.the_business?.what_it_does ?? '';
		revenueSplit = (t.the_business?.revenue_split ?? []).map((r) => ({ segment: r.segment, sharePct: String(r.share_pct) }));
		if (!revenueSplit.length) revenueSplit = [{ segment: '', sharePct: '' }];
		growthEngine = t.the_growth_engine?.length ? [...t.the_growth_engine] : [''];
		bigChangeSummary = t.the_big_change?.summary ?? '';
		expectedCompletion = t.the_big_change?.expected_completion ?? '';
		hardEvidence = t.proof_points?.hard_evidence?.length ? [...t.proof_points.hard_evidence] : [''];
		// model_specific_metrics only accepts plain finite numbers - a bad
		// import (e.g. an LLM putting a date or null here) would otherwise
		// silently become NaN -> null on submit and get hard-rejected by the
		// server with a cryptic "expected number, received null". Drop it here
		// instead, with a note, so the rest of the import still goes through.
		selectedMetrics = Object.entries(t.proof_points?.model_specific_metrics ?? {}).flatMap(([key, value]) => {
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				importWarnings = [
					...importWarnings,
					`Dropped metric "${key}" - proof-point metrics must be a plain number, got ${JSON.stringify(value)}.`
				];
				return [];
			}
			const definition = metrics.find((metric) => metric.metric_key === key);
			return [{ metric_key: key, label: definition?.label ?? key, unit: definition?.unit ?? 'value', value: String(value) }];
		});
		killTriggers = t.what_can_kill_it?.length
			? t.what_can_kill_it.map((k, i) => {
					let severity = k.severity;
					if (!SEVERITIES.includes(severity)) {
						importWarnings = [
							...importWarnings,
							`Kill trigger #${i + 1} ("${k.label || 'untitled'}") had severity "${severity}" - only "warn" or "kill" are valid, defaulted to "kill".`
						];
						severity = 'kill';
					}
					let operator = k.operator ?? '<';
					if (operator && !OPERATORS.includes(operator)) {
						importWarnings = [
							...importWarnings,
							`Kill trigger #${i + 1} ("${k.label || 'untitled'}") had operator "${operator}" - not one of ${OPERATORS.join(' ')}, defaulted to "<".`
						];
						operator = '<';
					}
					return {
						label: k.label,
						metricKey: k.metric_key ?? '',
						operator,
						threshold: k.threshold != null ? String(k.threshold) : '',
						action: k.action,
						severity,
						gracePeriods: String(k.grace_periods ?? 1),
						manualCheck: !!k.manual_check
					};
				})
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
		pillarNotes = Object.fromEntries(
			Object.entries(t.pillar_notes ?? {}).map(([key, notes]) => [
				key,
				notes.map((n) => (typeof n === 'string' ? { blocks: [{ type: 'text' as const, text: n }] } : n))
			])
		);
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
				// So a section's already-real table blocks (saved on a previous
				// visit) render as the actual table grid here too, not a chip.
				api
					.listTables(prefillCompanyId)
					.then((rows) => {
						tablesById = Object.fromEntries((rows as TableSummary[]).map((t) => [t.id, t]));
					})
					.catch(() => {});
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

	// Serializes pillar_notes for submission. `idMap` resolves queued table ids
	// to real ones once the company/tables actually exist; a table_pending
	// block with no resolution yet (idMap omitted, or the id simply isn't in
	// it) is dropped rather than sent broken - the caller re-submits with a
	// resolved idMap right after createCustomSections runs (see submit()).
	function buildPillarNotesPayload(idMap?: Map<number, number>) {
		const out: Record<string, { blocks: ({ type: 'text'; text: string } | { type: 'table'; table_id: number })[] }[]> = {};
		for (const [key, notes] of Object.entries(pillarNotes)) {
			const serialized = notes
				.map((n) => {
					const blocks = n.blocks
						.map((b) => {
							if (b.type === 'text') {
								const text = b.text.trim();
								return text ? { type: 'text' as const, text } : null;
							}
							if (b.type === 'table') return { type: 'table' as const, table_id: b.table_id };
							const realId = idMap?.get(b.queued_id);
							return realId != null ? { type: 'table' as const, table_id: realId } : null;
						})
						.filter((b): b is { type: 'text'; text: string } | { type: 'table'; table_id: number } => b != null);
					return blocks.length ? { blocks } : null;
				})
				.filter((n): n is { blocks: ({ type: 'text'; text: string } | { type: 'table'; table_id: number })[] } => n != null);
			if (serialized.length) out[key] = serialized;
		}
		return out;
	}

	function buildThesisData(idMap?: Map<number, number>) {
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
			pillar_notes: buildPillarNotesPayload(idMap)
		};
	}

	function buildCreatePayload(idMap?: Map<number, number>) {
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
			thesis_data: buildThesisData(idMap)
		};
	}

	function extractErrors(e: unknown): { fieldErrors: string[]; submitError: string } {
		if (e instanceof ApiError) {
			// Server errors come back as FastAPI-shaped {"detail": "..."} (see
			// zodErrorMessage/errorResponse) - a validation failure's detail is
			// one "path: message" issue per "; "-separated segment. Reading
			// `.message` here (which doesn't exist on this body) used to fall
			// through to `e.message`, the raw JSON.stringify'd body - dumping
			// the whole {"detail":"..."} blob as a single unreadable bullet.
			const body = e.body as { detail?: string } | string;
			const msg = typeof body === 'string' ? body : (body?.detail ?? e.message);
			const errs = String(msg)
				.split(/;\s*|\n/)
				.map((s) => s.trim())
				.filter(Boolean);
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
				await api.amendThesis(prefillCompanyId, { thesis_data: buildThesisData(), change_note: changeNote.trim() || null });
				const idMap = await createCustomSections(prefillCompanyId);
				// Any note with a table added just now referenced a queued id that
				// didn't exist yet at the call above - now that the tables are
				// real, resubmit with those references resolved.
				if (hasPendingTableBlocks()) {
					await api.amendThesis(prefillCompanyId, { thesis_data: buildThesisData(idMap), change_note: null });
				}
				await goto(`/company/${encodeURIComponent(prefillCompanyId)}`);
			} else {
				if (!isExistingCompany && !nseTicker.trim() && !bseTicker.trim()) {
					fieldErrors = ['At least one of NSE Ticker or BSE Ticker is required.'];
					submitting = false;
					return;
				}
				const payload = buildCreatePayload();
				const created = (await api.createCompany(payload)) as { company_id: string };
				const idMap = await createCustomSections(created.company_id);
				if (hasPendingTableBlocks()) {
					await api.amendThesis(created.company_id, { thesis_data: buildThesisData(idMap), change_note: null });
				}
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
	const CONVERSION_PROMPT = `Convert the investment thesis material I paste after this prompt into a single JSON object with EXACTLY this shape (no extra top-level keys, no markdown fencing, output ONLY the JSON):

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
    "pillar_notes": {
      "the_business": [
        { "blocks": [{ "type": "text", "text": "A standalone text-only subsection - extra commentary/context for this pillar that doesn't fit the fixed fields above and has no table attached." }] }
      ]
    }
  },
  "custom_sections": [
    {
      "name": "Descriptive Section Name (e.g. Capacity Ramp, Peer Valuation Comps, Shareholding Pattern, Key Financials)",
      "pillar": "optional - one of: the_business, the_growth_engine, the_big_change, proof_points, what_can_kill_it, why_we_believe_it, health_check, buy_sell_decision, references",
      "text": "optional - the commentary/notes that go with this specific table, shown above it inside the same bordered Section (only used when pillar is set)",
      "columns": [{ "key": "column_key", "label": "Column Label", "type": "text|number|date|enum", "options": ["only for type=enum"] }],
      "rows": [{ "column_key": "value for row 1" }, { "column_key": "value for row 2" }]
    }
  ]
}

STRUCTURE RULES:
1. TABLES ARE MANDATORY, NOT OPTIONAL. Do not summarize tabular data as prose. If the source material has ANY numbers that vary across a dimension (years, quarters, segments, peers, capacity lines, shareholders, financials - anything with 2+ rows and 2+ columns worth of structure), it MUST become a "custom_sections" table with real columns and rows - never collapsed into a sentence.
2. EVERY PILLAR CAN HAVE MULTIPLE SUBSECTIONS - use both kinds liberally, as many as the material supports: (a) TEXT-ONLY - extra commentary with no table, goes directly in "pillar_notes" under that pillar's key, one { "blocks": [{ "type": "text", "text": "..." }] } entry per distinct point; (b) TEXT+TABLE - goes in "custom_sections" with "pillar" and "text" set. Don't leave pillar_notes empty just because custom_sections was used - uncaptured commentary belongs in pillar_notes, not dropped.
3. TABLES ARE DYNAMIC, NOT FIXED. Build as many "custom_sections" entries as the data supports, named descriptively (never "Table 1"). Always set "pillar" + a real "text" on each so it renders as one combined subsection under that pillar - omit "pillar" only for genuinely standalone data. Multiple custom_sections can share the same pillar.

DATA-TYPE RULES - every one of these has caused a rejected import before, follow them exactly:
- "model_specific_metrics" values must be a bare JSON number (e.g. 27.2), nothing else - no units, no strings, no null, no dates. If a data point isn't a clean number, do NOT put it here - put it in a custom_sections table or pillar_notes text instead. Never invent a key here for something you don't have a real numeric value for.
- "severity" (inside what_can_kill_it) must be exactly the string "warn" or "kill" - no other value, ever (not "medium", "monitor", "high", etc).
- "operator" (inside what_can_kill_it) must be exactly one of "<" "<=" ">" ">=" "==" "!=" , or null if manual_check is true.
- "share_pct" (inside revenue_split) and every custom_sections column of type "number" must be a bare JSON number, not a string with a % or unit attached.
- "grace_periods" must be a positive integer.
- Every enum field above (operating_model, status, column "type") must be exactly one of the listed options - do not invent new ones.

OTHER RULES: revenue_split share_pct must sum to ~100. what_can_kill_it needs at least one entry with severity="kill". why_we_believe_it needs at least 3 entries, at least one starting "Premise:", exactly one starting "Conclusion:". Column "key" must be a short lowercase identifier. "type" defaults to "text" if omitted.

If something is genuinely ambiguous (which pillar a subsection belongs to, an unclear number, a missing unit), ask me a clarifying question before finalizing - don't guess silently on anything that affects data accuracy. Do not skip, compress, or drop any data I give you - every table becomes a table, every distinct point of commentary becomes its own subsection.

My data:
`;

	type ParsedCustomSection = {
		name?: string;
		// Optional: one of the pillar keys (the_business, the_growth_engine,
		// the_big_change, proof_points, what_can_kill_it, why_we_believe_it,
		// health_check, buy_sell_decision, references). When present, this
		// table is embedded inline inside that pillar's Additional Sections -
		// alongside its own "text" - as one bordered Section, exactly like the
		// "+ Add Section" builder produces. Omitted (or an unrecognized key)
		// falls back to the old behaviour: an untagged table in the generic
		// "Custom Sections" block at the bottom.
		pillar?: string;
		// Optional free text paired with this table inside the same Section
		// (rendered above the table, same as a "+ Add Text" block).
		text?: string;
		columns?: { key?: string; label?: string; type?: string; options?: string[] }[];
		rows?: Record<string, string>[];
	};

	function applyParsedCustomSections(sections: ParsedCustomSection[]) {
		for (const s of sections) {
			if (!s.name?.trim() || !s.columns?.length) continue;
			const built: BuiltTable = {
				name: s.name.trim(),
				columns: (s.columns ?? []).map((c) => ({
					key: c.key ?? '',
					label: c.label ?? c.key ?? '',
					type: (c.type ?? 'text') as BuiltTable['columns'][number]['type'],
					options: c.options
				})),
				rows: s.rows ?? []
			};
			const pillar = s.pillar && PILLAR_KEYS.includes(s.pillar) ? s.pillar : null;
			const queuedId = nextQueuedTableId++;
			queuedTables = [...queuedTables, { id: queuedId, section: pillar, built }];
			if (pillar) {
				const blocks: IngestBlock[] = [];
				if (s.text?.trim()) blocks.push({ type: 'text', text: s.text.trim() });
				blocks.push({ type: 'table_pending', queued_id: queuedId });
				pillarNotes = { ...pillarNotes, [pillar]: [...notesFor(pillar), { blocks }] };
			}
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

	// Every field a JSON import can touch - captured right before applying one
	// so a pending import can be discarded and the form put back exactly how
	// it was. Deep-copied (not just spread) since several of these are
	// arrays/records of objects that later edits would otherwise mutate
	// in place.
	type FormSnapshot = {
		nseTicker: string;
		bseTicker: string;
		name: string;
		broadIndustry: string;
		specificNiche: string;
		operatingModel: string;
		currency: string;
		status: string;
		lastReviewed: string;
		whatItDoes: string;
		revenueSplit: { segment: string; sharePct: string }[];
		growthEngine: string[];
		bigChangeSummary: string;
		expectedCompletion: string;
		hardEvidence: string[];
		selectedMetrics: SelectedMetric[];
		killTriggers: KillTriggerForm[];
		believeRows: { kind: string; text: string }[];
		latestQuarterReview: string;
		trackables: string[];
		buySellDecision: string;
		references: { title: string; url: string }[];
		pillarNotes: Record<string, IngestNote[]>;
		queuedTables: QueuedTable[];
	};

	function captureFormSnapshot(): FormSnapshot {
		return {
			nseTicker,
			bseTicker,
			name,
			broadIndustry,
			specificNiche,
			operatingModel,
			currency,
			status,
			lastReviewed,
			whatItDoes,
			revenueSplit: revenueSplit.map((r) => ({ ...r })),
			growthEngine: [...growthEngine],
			bigChangeSummary,
			expectedCompletion,
			hardEvidence: [...hardEvidence],
			selectedMetrics: selectedMetrics.map((m) => ({ ...m })),
			killTriggers: killTriggers.map((k) => ({ ...k })),
			believeRows: believeRows.map((b) => ({ ...b })),
			latestQuarterReview,
			trackables: [...trackables],
			buySellDecision,
			references: references.map((r) => ({ ...r })),
			pillarNotes: Object.fromEntries(
				Object.entries(pillarNotes).map(([k, notes]) => [k, notes.map((n) => ({ blocks: n.blocks.map((b) => ({ ...b })) }))])
			),
			queuedTables: queuedTables.map((t) => ({
				...t,
				built: { ...t.built, columns: t.built.columns.map((c) => ({ ...c })), rows: t.built.rows.map((r) => ({ ...r })) }
			}))
		};
	}

	function restoreFormSnapshot(s: FormSnapshot) {
		nseTicker = s.nseTicker;
		bseTicker = s.bseTicker;
		name = s.name;
		broadIndustry = s.broadIndustry;
		specificNiche = s.specificNiche;
		operatingModel = s.operatingModel;
		currency = s.currency;
		status = s.status;
		lastReviewed = s.lastReviewed;
		whatItDoes = s.whatItDoes;
		revenueSplit = s.revenueSplit;
		growthEngine = s.growthEngine;
		bigChangeSummary = s.bigChangeSummary;
		expectedCompletion = s.expectedCompletion;
		hardEvidence = s.hardEvidence;
		selectedMetrics = s.selectedMetrics;
		killTriggers = s.killTriggers;
		believeRows = s.believeRows;
		latestQuarterReview = s.latestQuarterReview;
		trackables = s.trackables;
		buySellDecision = s.buySellDecision;
		references = s.references;
		pillarNotes = s.pillarNotes;
		queuedTables = s.queuedTables;
	}

	function validateJson() {
		jsonValidateMsg = '';
		jsonValidateOk = false;
		importWarnings = [];
		let parsed: unknown;
		try {
			parsed = JSON.parse(jsonText);
		} catch (e) {
			jsonValidateMsg = `Not valid JSON: ${String(e)}`;
			return;
		}
		// Only snapshot once per review cycle - re-validating after tweaking the
		// JSON (still under "Edit JSON") must not overwrite the ORIGINAL
		// pre-import state with an already-imported one, or "discard" would
		// restore the wrong thing.
		if (!preImportSnapshot) preImportSnapshot = captureFormSnapshot();
		if (mode === 'amend') {
			const obj = parsed as { thesis_data?: unknown };
			if (!obj.thesis_data || typeof obj.thesis_data !== 'object') {
				jsonValidateMsg = 'Expected an object with a "thesis_data" key (or paste the thesis_data object directly).';
				// tolerate pasting a bare thesis_data object for amend
				applyParsedPayload({ thesis_data: parsed as ThesisDataShape });
				jsonValidateOk = true;
				jsonValidateMsg = 'Loaded for preview below (as thesis_data) - review each section, then Confirm or Save Amendment.';
				activeTab = 'form';
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
		jsonValidateMsg = 'Loaded for preview below - review each section, then Confirm or submit.';
		activeTab = 'form';
	}

	// The reviewer is done looking at the imported data rendered in the Form
	// tab (the real look, not a mockup) and wants to keep it - just stops
	// treating it as "pending review" so the banner goes away.
	function confirmImport() {
		preImportSnapshot = null;
	}

	// Throws the import away entirely - puts every touched field back to
	// exactly how it was beforehand, and clears the pasted JSON too so the
	// analyst can start completely fresh rather than fight leftover text.
	function discardImport() {
		if (preImportSnapshot) restoreFormSnapshot(preImportSnapshot);
		preImportSnapshot = null;
		jsonText = '';
		jsonValidateOk = false;
		jsonValidateMsg = '';
		importWarnings = [];
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
			<button type="button" onclick={validateJson} class="text-xs text-ok mt-2">Preview in Form tab</button>
		</div>
	{:else}
		{#if preImportSnapshot}
			<div class="mt-4 rounded-md border border-ok/40 bg-ok/10 p-3 flex items-center justify-between gap-3 flex-wrap">
				<div class="text-sm">
					<span class="font-medium">Previewing a JSON import.</span>
					<span class="text-muted-fg">Everything below is exactly how it will look - review each section, then choose:</span>
				</div>
				<div class="flex items-center gap-2 shrink-0">
					<button type="button" onclick={confirmImport} class="text-xs px-2.5 py-1 rounded-md bg-ok text-white cursor-pointer">Confirm</button>
					<button type="button" onclick={() => (activeTab = 'json')} class="text-xs px-2.5 py-1 rounded-md border border-border hover:bg-surface-3 cursor-pointer"
						>Edit JSON</button
					>
					<button type="button" onclick={discardImport} class="text-xs px-2.5 py-1 rounded-md border border-border hover:text-danger cursor-pointer"
						>Discard &amp; remake</button
					>
				</div>
			</div>
			{#if importWarnings.length}
				<div class="mt-2 rounded-md border border-warn/40 bg-warn/10 p-3">
					<div class="text-sm font-medium">{importWarnings.length} value{importWarnings.length === 1 ? '' : 's'} auto-corrected on import</div>
					<ul class="list-disc list-inside text-xs mt-1 space-y-0.5 text-muted-fg">
						{#each importWarnings as w, i (i)}
							<li>{w}</li>
						{/each}
					</ul>
				</div>
			{/if}
		{/if}
		{#if mode === 'amend'}
			<section class="mt-5 rounded-xl border border-border bg-surface p-5">
				<label class="block text-sm"
					>Change Note <span class="text-muted-fg">(optional - why is the thesis being amended?)</span>
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

		<!-- Renders one staged (not-yet-created) table's columns + a preview of
		     its rows, inline, in place of a name chip - the real grid doesn't
		     exist until submit, but its actual content already does. -->
		{#snippet stagedTablePreview(qt: QueuedTable)}
			<div class="rounded-md border border-border">
				<div class="px-3 py-2 text-sm font-medium">
					{qt.built.name || '(untitled)'}
					<span class="text-xs text-muted-fg font-normal">{qt.built.columns.length} columns &middot; {qt.built.rows.length} rows staged</span>
				</div>
				{#if qt.built.columns.length}
					<div class="overflow-x-auto border-t border-border">
						<table class="w-full text-xs">
							<thead>
								<tr class="bg-surface-2">
									{#each qt.built.columns as c (c.key)}
										<th class="px-2 py-1.5 text-left font-medium whitespace-nowrap">{c.label}</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each qt.built.rows.slice(0, 5) as row, r (r)}
									<tr class="border-t border-border">
										{#each qt.built.columns as c (c.key)}
											<td class="px-2 py-1.5 whitespace-nowrap">{row[c.key] ?? '-'}</td>
										{/each}
									</tr>
								{:else}
									<tr><td colspan={qt.built.columns.length} class="px-2 py-3 text-center text-muted-fg">No rows staged yet.</td></tr>
								{/each}
							</tbody>
						</table>
					</div>
					{#if qt.built.rows.length > 5}
						<div class="px-3 py-1 text-xs text-muted-fg border-t border-border">+{qt.built.rows.length - 5} more row{qt.built.rows.length - 5 === 1 ? '' : 's'} staged</div>
					{/if}
				{/if}
			</div>
		{/snippet}

		<!-- Additional Sections, each a small ordered sequence of Text/Table
		     blocks the analyst builds up in whatever mix and order they want.
		     "+ Add Table" inside a section queues a table (created for real on
		     submit) AND appends a block referencing it, rendered right here as
		     the actual staged table content - not a separate list elsewhere. -->
		{#snippet pillarNotesAndTables(section: string, hint?: string)}
			<div class="mt-4 pt-3 border-t border-border">
				<div class="text-sm font-medium">Additional Sections {#if hint}<span class="text-muted-fg font-normal">- {hint}</span>{/if}</div>
				<div class="space-y-3 mt-2">
					{#each notesFor(section) as note, ni (ni)}
						<div class="rounded-md border border-border p-2.5">
							<div class="space-y-2">
								{#each note.blocks as block, bi (bi)}
									<div class="flex items-start gap-2">
										{#if block.type === 'text'}
											<textarea
												value={block.text}
												oninput={(e) => {
													const text = e.currentTarget.value;
													pillarNotes = {
														...pillarNotes,
														[section]: notesFor(section).map((n, idx) =>
															idx === ni ? { blocks: n.blocks.map((b, bidx) => (bidx === bi ? { type: 'text', text } : b)) } : n
														)
													};
												}}
												onkeydown={(e) => handleBlockKeydown(e, section, ni, bi)}
												rows="3"
												placeholder="Write text here... (Tab to indent)"
												class="flex-1 min-w-0 rounded-md border border-border px-2 py-1 text-sm font-mono"
											></textarea>
										{:else if block.type === 'table'}
											{@const t = tablesById[block.table_id]}
											{#if t}
												<div class="flex-1 min-w-0"><TableCard table={t} defaultExpanded={false} /></div>
											{:else}
												<div class="flex-1 min-w-0 text-xs text-danger">Table #{block.table_id} not found.</div>
											{/if}
										{:else}
											{@const qt = queuedTables.find((t) => t.id === block.queued_id)}
											<div class="flex-1 min-w-0">
												{#if qt}
													{@render stagedTablePreview(qt)}
												{:else}
													<div class="text-xs text-danger">Staged table not found.</div>
												{/if}
											</div>
										{/if}
										<button type="button" onclick={() => removeBlock(section, ni, bi)} class="text-muted-fg hover:text-danger mt-1.5"
											>&times;</button
										>
									</div>
								{/each}
							</div>
							<div class="flex items-center gap-3 mt-2">
								<button
									type="button"
									onclick={() => addTextBlock(section, ni)}
									class="text-xs text-ok cursor-pointer hover:bg-ok/10 rounded-md px-2 py-1 -ml-2">+ Add Text</button
								>
								<button
									type="button"
									onclick={() => openTableBuilder(section, ni)}
									class="text-xs text-ok cursor-pointer hover:bg-ok/10 rounded-md px-2 py-1">+ Add Table</button
								>
								<button
									type="button"
									onclick={() => removeNote(section, ni)}
									class="text-xs text-muted-fg hover:text-danger cursor-pointer rounded-md px-2 py-1 ml-auto">Remove section</button
								>
							</div>
						</div>
					{/each}
				</div>
				<button type="button" onclick={() => addNote(section)} class="text-xs text-ok cursor-pointer hover:bg-ok/10 rounded-md px-2 py-1 -ml-2 mt-1"
					>+ Add Section</button
				>
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
				<div class="text-sm font-medium">
					Revenue Split <span class="text-muted-fg font-normal">(optional - if used, should sum to 100%)</span>
				</div>
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
			{@render pillarNotesAndTables('the_business', "free-text extras that don't fit the fields above")}
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
			{@render pillarNotesAndTables('the_growth_engine')}
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
			{@render pillarNotesAndTables('the_big_change')}
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
			{@render pillarNotesAndTables('proof_points')}
		</section>

		<!-- What Can Kill It -->
		<section class="mt-5 rounded-xl border border-border bg-surface p-5">
			<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">5. What Can Kill It <span class="text-muted-fg font-normal normal-case">(optional)</span></h2>
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
			{@render pillarNotesAndTables('what_can_kill_it')}
		</section>

		<!-- Why We Believe It -->
		<section class="mt-5 rounded-xl border border-border bg-surface p-5">
			<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">
				6. Why We Believe It <span class="text-muted-fg font-normal normal-case"
					>(optional - typically a few Premise entries plus one Conclusion)</span
				>
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
			{@render pillarNotesAndTables('why_we_believe_it')}
		</section>

		<!-- Health Check (pillar 7 / Quarterly Review) -->
		<section class="mt-5 rounded-xl border border-border bg-surface p-5">
			<h2 class="font-medium text-sm text-muted-fg uppercase tracking-wide">7. Quarterly Review</h2>
			<label class="block text-sm mt-2"
				>Latest Quarter Review
				<textarea bind:value={latestQuarterReview} rows="4" class="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm"></textarea>
			</label>
			{@render pillarNotesAndTables('health_check')}
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
			{@render pillarNotesAndTables('buy_sell_decision')}
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
			{@render pillarNotesAndTables('references')}
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
