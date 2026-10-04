<script lang="ts">
	import { resolve } from '$app/paths';
	import { sectorApi, type VerifyResponse } from '$lib/valuation/sectorClient';
	import type { SymbolSuggestion } from '$lib/valuation/sectorEdit';

	let {
		basket,
		names,
		majors,
		assignedMajorKeys,
		viewMajorKey,
		onchanged
	}: {
		basket: { key: string; label: string; symbols: string[] };
		names: Record<string, string>;
		majors: { key: string; label: string }[];
		assignedMajorKeys: string[];
		/** Major sector to link the "View rotation" shortcut through (none when unassigned). */
		viewMajorKey: string | null;
		onchanged: () => Promise<void> | void;
	} = $props();

	type Message = { kind: 'ok' | 'error' | 'warn'; text: string };

	let renaming = $state(false);
	let labelDraft = $state('');
	let symbolDraft = $state('');
	let busy = $state(false);
	let message = $state<Message | null>(null);
	let suggestions = $state<SymbolSuggestion[]>([]);
	let moveOpen = $state(false);
	let moveSelection = $state<string[]>([]);
	let confirmingDelete = $state(false);

	function nameOf(symbol: string) {
		return names[symbol] ?? symbol;
	}

	async function run(fn: () => Promise<Message | null>) {
		busy = true;
		message = null;
		try {
			message = await fn();
		} finally {
			busy = false;
		}
	}

	function startRename() {
		labelDraft = basket.label;
		renaming = true;
	}

	function saveRename() {
		return run(async () => {
			const res = await sectorApi('PATCH', `/api/valuation/sectors/baskets/${basket.key}`, {
				label: labelDraft
			});
			if (!res.ok) return { kind: 'error', text: res.message };
			renaming = false;
			await onchanged();
			return null;
		});
	}

	// Verify-then-add: the server re-verifies on add (it never trusts this client), but verifying
	// first lets the UI show structured "did you mean" suggestions and the Angel One warning.
	function addSymbol(raw: string = symbolDraft) {
		const typed = raw.trim();
		if (!typed) return Promise.resolve();
		return run(async () => {
			suggestions = [];
			const verify = await sectorApi<VerifyResponse>('POST', '/api/valuation/sectors/verify', {
				symbol: typed
			});
			if (!verify.ok) return { kind: 'error', text: verify.message };
			if (!verify.data.ok) {
				suggestions = verify.data.suggestions;
				return { kind: 'error', text: verify.data.reason };
			}
			const { symbol, name, listedOnAngelOne } = verify.data;
			const added = await sectorApi('POST', `/api/valuation/sectors/baskets/${basket.key}/symbols`, {
				symbol
			});
			if (!added.ok) return { kind: 'error', text: added.message };
			symbolDraft = '';
			await onchanged();
			return listedOnAngelOne
				? { kind: 'ok', text: `Added ${name} (${symbol}).` }
				: {
						kind: 'warn',
						text: `Added ${name} (${symbol}), but Angel One doesn't list it - no live chart for this one.`
					};
		});
	}

	function removeSymbol(symbol: string) {
		return run(async () => {
			const res = await sectorApi(
				'DELETE',
				`/api/valuation/sectors/baskets/${basket.key}/symbols/${encodeURIComponent(symbol)}`
			);
			if (!res.ok) return { kind: 'error', text: res.message };
			await onchanged();
			return { kind: 'ok', text: `Removed ${nameOf(symbol)}.` };
		});
	}

	function openMove() {
		moveSelection = [...assignedMajorKeys];
		moveOpen = true;
	}

	function toggleMajor(key: string) {
		moveSelection = moveSelection.includes(key)
			? moveSelection.filter((k) => k !== key)
			: [...moveSelection, key];
	}

	function saveMove() {
		return run(async () => {
			const res = await sectorApi('PUT', `/api/valuation/sectors/baskets/${basket.key}/majors`, {
				majorKeys: moveSelection
			});
			if (!res.ok) return { kind: 'error', text: res.message };
			moveOpen = false;
			await onchanged();
			return { kind: 'ok', text: 'Sector assignment saved.' };
		});
	}

	function deleteBasket() {
		return run(async () => {
			const res = await sectorApi('DELETE', `/api/valuation/sectors/baskets/${basket.key}`);
			if (!res.ok) return { kind: 'error', text: res.message };
			await onchanged();
			return null;
		});
	}
</script>

<div class="sm-basket" data-basket={basket.key}>
	<div class="sm-basket-head">
		{#if renaming}
			<form
				class="sm-inline-form"
				onsubmit={(e) => {
					e.preventDefault();
					saveRename();
				}}
			>
				<input
					class="sm-input"
					aria-label="Basket name"
					bind:value={labelDraft}
					maxlength="80"
					disabled={busy}
				/>
				<button class="sm-btn sm-btn-primary" type="submit" disabled={busy || !labelDraft.trim()}>
					Save
				</button>
				<button class="sm-btn" type="button" onclick={() => (renaming = false)}>Cancel</button>
			</form>
		{:else}
			<h3 class="sm-basket-title">{basket.label}</h3>
			<span class="sm-count">{basket.symbols.length}</span>
			<div class="sm-actions">
				{#if viewMajorKey}
					<a
						class="sm-btn sm-btn-link"
						href={resolve('/valuation/sector-rotation/[key]/[subKey]', {
							key: viewMajorKey,
							subKey: basket.key
						})}>View rotation</a
					>
				{/if}
				<button class="sm-btn" type="button" onclick={startRename}>Rename</button>
				<button class="sm-btn" type="button" onclick={openMove} aria-expanded={moveOpen}>
					Move / assign
				</button>
				{#if confirmingDelete}
					<span class="sm-confirm">
						Delete this basket?
						<button
							class="sm-btn sm-btn-danger"
							type="button"
							onclick={deleteBasket}
							disabled={busy}
						>
							Yes, delete
						</button>
						<button class="sm-btn" type="button" onclick={() => (confirmingDelete = false)}>
							Cancel
						</button>
					</span>
				{:else}
					<button
						class="sm-btn sm-btn-quiet-danger"
						type="button"
						onclick={() => (confirmingDelete = true)}
					>
						Delete
					</button>
				{/if}
			</div>
		{/if}
	</div>

	{#if moveOpen}
		<div class="sm-move" role="group" aria-label="Sectors for {basket.label}">
			<p class="sm-hint">
				A basket can sit in more than one sector. Tick every sector it should appear under;
				unticking all leaves it unassigned.
			</p>
			<div class="sm-move-grid">
				{#each majors as m (m.key)}
					<label class="sm-check">
						<input
							type="checkbox"
							checked={moveSelection.includes(m.key)}
							onchange={() => toggleMajor(m.key)}
						/>
						<span>{m.label}</span>
					</label>
				{/each}
			</div>
			<div class="sm-inline-form">
				<button class="sm-btn sm-btn-primary" type="button" onclick={saveMove} disabled={busy}>
					Save assignment
				</button>
				<button class="sm-btn" type="button" onclick={() => (moveOpen = false)}>Cancel</button>
			</div>
		</div>
	{/if}

	<ul class="sm-chips">
		{#each basket.symbols as symbol (symbol)}
			<li class="sm-chip">
				<span class="sm-chip-name">{nameOf(symbol)}</span>
				<span class="sm-chip-ticker">{symbol}</span>
				<button
					class="sm-chip-x"
					type="button"
					aria-label="Remove {nameOf(symbol)} from {basket.label}"
					title="Remove"
					disabled={busy}
					onclick={() => removeSymbol(symbol)}>×</button
				>
			</li>
		{/each}
	</ul>

	<form
		class="sm-inline-form sm-add"
		onsubmit={(e) => {
			e.preventDefault();
			addSymbol();
		}}
	>
		<input
			class="sm-input sm-input-symbol"
			aria-label="Add NSE symbol to {basket.label}"
			placeholder="Add NSE symbol, e.g. TCS"
			bind:value={symbolDraft}
			autocapitalize="characters"
			spellcheck="false"
			disabled={busy}
		/>
		<button class="sm-btn sm-btn-primary" type="submit" disabled={busy || !symbolDraft.trim()}>
			{busy ? 'Working…' : 'Verify & add'}
		</button>
	</form>

	{#if message}
		<p class="sm-msg sm-msg-{message.kind}" role="status">{message.text}</p>
	{/if}
	{#if suggestions.length > 0}
		<div class="sm-suggest">
			<span class="sm-hint">Did you mean:</span>
			{#each suggestions as s (s.symbol)}
				<button class="sm-suggest-btn" type="button" onclick={() => addSymbol(s.symbol)}>
					{s.name} <span class="sm-chip-ticker">{s.symbol}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
