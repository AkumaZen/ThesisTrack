<script lang="ts">
	import { api, ApiError } from '$lib/api';
	export type Proposal = {
		id: number; company_id: string; period: string | null; proposed_status: string;
		source: string; rationale: string; evidence: { reasoning_chain?: string[] } | null;
	};
	let { proposals, readOnly, onResolved }: { proposals: Proposal[]; readOnly: boolean; onResolved: () => Promise<void> } = $props();
	let notes = $state<Record<number, string>>({});
	let busy = $state<number | null>(null);
	let error = $state('');
	async function resolve(proposal: Proposal, action: 'accept' | 'reject') {
		busy = proposal.id;
		error = '';
		try {
			await api.resolveProposal(proposal.id, { action, verdict: action === 'accept' ? proposal.proposed_status : null, note: notes[proposal.id] || null });
			await onResolved();
		} catch (e) {
			error = e instanceof ApiError ? String((e.body as { detail?: string })?.detail ?? e.message) : String(e);
		} finally { busy = null; }
	}
</script>

{#if proposals.length}
	<div class="mt-5 border-t border-border pt-4">
		<h4 class="text-sm font-semibold">Status recommendations</h4>
		<p class="text-xs text-muted-fg mt-1">Review rule and AI proposals here. Accepting records a quarterly review; rejecting dismisses the proposal.</p>
		{#if error}<p role="alert" class="text-sm mt-2">{error}</p>{/if}
		{#each proposals as proposal (proposal.id)}
			<div class="mt-3 border border-border rounded-lg p-3">
				<p class="text-sm font-medium">{proposal.period ?? 'No period'} · {proposal.proposed_status.replaceAll('_', ' ')} · {proposal.source.replaceAll('_', ' ')}</p>
				<p class="mt-1 text-sm whitespace-pre-wrap">{proposal.rationale}</p>
				{#if proposal.evidence?.reasoning_chain?.length}
					<ol class="mt-2 list-decimal pl-5 text-sm">{#each proposal.evidence.reasoning_chain as step, i (i)}<li>{step}</li>{/each}</ol>
				{/if}
				{#if !readOnly}
					<label class="block text-xs mt-3" for={`resolution-${proposal.id}`}>Resolution note (required to override a fired kill trigger)</label>
					<input id={`resolution-${proposal.id}`} bind:value={notes[proposal.id]} class="mt-1 w-full rounded-md border border-border p-2 text-sm" />
					<div class="flex gap-2 mt-2">
						<button type="button" disabled={busy !== null} onclick={() => resolve(proposal, 'accept')} class="rounded-md bg-fg text-bg px-3 py-2 text-sm disabled:opacity-50">Accept</button>
						<button type="button" disabled={busy !== null} onclick={() => resolve(proposal, 'reject')} class="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50">Reject</button>
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}
