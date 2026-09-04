<script lang="ts">
	// Ports frontend/components/reviewQueue.js (renderReviewQueue) + the
	// review-queue wiring in frontend/app.js into a real route.
	import { onMount } from 'svelte';
	import { api, ApiError } from '$lib/api';
	import { session } from '$lib/session.svelte';

	type Proposal = {
		id: number;
		company_id: string;
		period: string | null;
		proposed_status: string;
		source: string;
		rationale: string;
		evidence: { reasoning_chain?: string[] } | null;
		state: string;
		model_name: string | null;
		created_at: string;
	};

	let proposals = $state<Proposal[]>([]);
	let loading = $state(true);
	let error = $state('');
	let notes = $state<Record<number, string>>({});
	let resolving = $state<Record<number, boolean>>({});

	async function refresh() {
		loading = true;
		error = '';
		try {
			proposals = (await api.listProposals('pending')) as Proposal[];
		} catch (e) {
			error = String(e);
		} finally {
			loading = false;
		}
	}

	onMount(refresh);

	const SOURCE_STYLES: Record<string, string> = {
		rule_engine: 'bg-surface-3 text-fg',
		ai_proposed: 'bg-accent/10 text-accent',
		manual: 'bg-ok/10 text-ok'
	};

	const STATUS_PILL: Record<string, string> = {
		broken: 'bg-danger/10 text-danger',
		watch_closely: 'bg-warn/10 text-warn',
		on_track: 'bg-good/10 text-good'
	};

	async function resolve(p: Proposal, action: 'accept' | 'reject') {
		resolving = { ...resolving, [p.id]: true };
		try {
			await api.resolveProposal(p.id, {
				action,
				verdict: action === 'accept' ? p.proposed_status : null,
				note: notes[p.id] || null
			});
			proposals = proposals.filter((x) => x.id !== p.id);
		} catch (e) {
			error = e instanceof ApiError ? String((e.body as { detail?: string })?.detail ?? e.message) : String(e);
		} finally {
			const { [p.id]: _drop, ...rest } = resolving;
			resolving = rest;
		}
	}
</script>

<h2 class="text-xl font-semibold mb-1">Review Queue</h2>
<p class="text-sm text-muted-fg mb-4">
	"To Review" items are status changes flagged by the rule engine, AI review, or a manual entry - accept to file it as
	this quarter's Quarterly Review, or reject to dismiss it.
</p>

{#if error}
	<div class="mb-3 rounded-md bg-danger/10 border border-danger/30 p-2 text-sm text-danger">{error}</div>
{/if}

{#if loading}
	<div class="text-center text-muted-fg py-16">Loading...</div>
{:else if !proposals.length}
	<div class="text-center text-muted-fg py-16">Nothing pending - review queue is empty.</div>
{:else}
	<div class="space-y-3">
		{#each proposals as p (p.id)}
			<div class="rounded-lg border border-border bg-surface p-4">
				<div class="flex items-center justify-between">
					<div class="font-medium">
						<a href="/company/{p.company_id}" class="hover:text-accent">{p.company_id}</a>
						<span class="text-muted-fg font-normal">&middot; {p.period || ''}</span>
					</div>
					<div class="flex items-center gap-2">
						<span class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded {SOURCE_STYLES[p.source] ?? 'bg-surface-3'}"
							>{p.source.replace('_', ' ')}</span
						>
						<span class="text-xs font-medium px-2 py-0.5 rounded-full {STATUS_PILL[p.proposed_status] ?? 'bg-surface-3'}"
							>&rarr; {p.proposed_status}</span
						>
					</div>
				</div>
				<p class="text-sm text-muted-fg mt-1">{p.rationale}</p>
				{#if p.evidence?.reasoning_chain?.length}
					<ol class="list-decimal list-inside text-xs text-muted-fg mt-1 space-y-0.5">
						{#each p.evidence.reasoning_chain as step, i (i)}
							<li>{step}</li>
						{/each}
					</ol>
				{/if}
				{#if !session.isReadOnly}
					<div class="mt-3 flex items-center gap-2">
						<input
							type="text"
							placeholder="Resolution note (required to override a fired kill trigger)"
							bind:value={notes[p.id]}
							class="flex-1 rounded-md border border-border px-2 py-1 text-xs"
						/>
						<button
							disabled={resolving[p.id]}
							onclick={() => resolve(p, 'accept')}
							class="text-xs px-3 py-1.5 rounded-md bg-good text-accent-ink hover:brightness-90 disabled:opacity-50">Accept</button
						>
						<button
							disabled={resolving[p.id]}
							onclick={() => resolve(p, 'reject')}
							class="text-xs px-3 py-1.5 rounded-md bg-danger text-white hover:brightness-90 disabled:opacity-50">Reject</button
						>
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}
