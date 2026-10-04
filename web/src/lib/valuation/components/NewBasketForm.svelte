<script lang="ts">
	import { sectorApi, type VerifyResponse } from '$lib/valuation/sectorClient';
	import type { SymbolSuggestion } from '$lib/valuation/sectorEdit';

	let {
		majorKey,
		majorLabel,
		onchanged,
		oncreated
	}: {
		majorKey: string;
		majorLabel: string;
		onchanged: () => Promise<void> | void;
		oncreated: (text: string) => void;
	} = $props();

	let label = $state('');
	let symbol = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let suggestions = $state<SymbolSuggestion[]>([]);

	async function create(symbolOverride?: string) {
		const typed = (symbolOverride ?? symbol).trim();
		busy = true;
		error = null;
		suggestions = [];
		try {
			const verify = await sectorApi<VerifyResponse>('POST', '/api/valuation/sectors/verify', {
				symbol: typed
			});
			if (!verify.ok) {
				error = verify.message;
				return;
			}
			if (!verify.data.ok) {
				error = verify.data.reason;
				suggestions = verify.data.suggestions;
				return;
			}
			const verified = verify.data;
			const res = await sectorApi('POST', '/api/valuation/sectors/baskets', {
				label,
				majorKey,
				symbol: verified.symbol
			});
			if (!res.ok) {
				error = res.message;
				return;
			}
			oncreated(`Created basket "${label.trim()}" with ${verified.name}.`);
			label = '';
			symbol = '';
			await onchanged();
		} finally {
			busy = false;
		}
	}
</script>

<form
	class="sm-new-basket"
	onsubmit={(e) => {
		e.preventDefault();
		create();
	}}
>
	<h4 class="sm-new-title">Add a basket to {majorLabel}</h4>
	<div class="sm-inline-form">
		<input
			class="sm-input"
			aria-label="New basket name in {majorLabel}"
			placeholder="Basket name"
			maxlength="80"
			bind:value={label}
			disabled={busy}
		/>
		<input
			class="sm-input sm-input-symbol"
			aria-label="First NSE symbol for the new basket in {majorLabel}"
			placeholder="First NSE symbol"
			autocapitalize="characters"
			spellcheck="false"
			bind:value={symbol}
			disabled={busy}
		/>
		<button
			class="sm-btn sm-btn-primary"
			type="submit"
			disabled={busy || !label.trim() || !symbol.trim()}
		>
			{busy ? 'Working…' : 'Verify & create basket'}
		</button>
	</div>
	{#if error}
		<p class="sm-msg sm-msg-error" role="status">{error}</p>
	{/if}
	{#if suggestions.length > 0}
		<div class="sm-suggest">
			<span class="sm-hint">Did you mean:</span>
			{#each suggestions as s (s.symbol)}
				<button class="sm-suggest-btn" type="button" onclick={() => create(s.symbol)}>
					{s.name} <span class="sm-chip-ticker">{s.symbol}</span>
				</button>
			{/each}
		</div>
	{/if}
</form>
