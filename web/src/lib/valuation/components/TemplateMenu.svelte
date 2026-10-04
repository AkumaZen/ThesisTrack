<script lang="ts">
	import { templateNameProblem, type ValuationTemplate } from '$lib/valuation/templates';
	import type { MethodId, ScenarioAssumptions, ScenarioId } from '$lib/valuation/valuationEngine';

	type Content = {
		assumptions: Record<MethodId, Record<ScenarioId, ScenarioAssumptions>>;
		activeMethod: MethodId;
	};

	// Named valuation templates: apply one to this company, save the current assumptions as a new
	// one, and choose which template new valuations start from (personally, or for this
	// company's sector baskets). Templates are loaded when the menu is first opened.
	let {
		baskets,
		me,
		current,
		onApply
	}: {
		baskets: { key: string; label: string }[];
		me: { username: string; role: string };
		current: () => Content;
		onApply: (t: ValuationTemplate) => void;
	} = $props();

	let templates = $state<ValuationTemplate[] | null>(null);
	let myDefaultId = $state<number | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);
	let newName = $state('');
	let confirmDelete = $state<number | null>(null);
	let menu = $state<HTMLDetailsElement>();

	async function load() {
		try {
			const res = await fetch('/api/valuation/templates');
			if (!res.ok) throw new Error();
			const body = (await res.json()) as {
				templates: ValuationTemplate[];
				myDefaultId: number | null;
			};
			templates = body.templates;
			myDefaultId = body.myDefaultId;
		} catch {
			error = 'Could not load the templates.';
		}
	}

	async function call(url: string, method: string, body?: unknown): Promise<boolean> {
		busy = true;
		error = null;
		try {
			const res = await fetch(url, {
				method,
				headers: body ? { 'Content-Type': 'application/json' } : undefined,
				body: body ? JSON.stringify(body) : undefined
			});
			if (!res.ok) {
				const err = (await res.json().catch(() => null)) as { message?: string } | null;
				error = err?.message ?? `Something went wrong (HTTP ${res.status}).`;
				return false;
			}
			await load();
			return true;
		} catch {
			error = 'Could not reach the server.';
			return false;
		} finally {
			busy = false;
		}
	}

	async function saveNew(e: SubmitEvent) {
		e.preventDefault();
		const problem = templateNameProblem(newName);
		if (problem) {
			error = problem;
			return;
		}
		if (await call('/api/valuation/templates', 'POST', { name: newName, ...current() })) newName = '';
	}

	function apply(t: ValuationTemplate) {
		onApply(t);
		if (menu) menu.open = false;
	}

	const setDefault = (scope: string, templateId: number | null) =>
		call('/api/valuation/templates/defaults', 'PUT', { scope, templateId });
	const canDelete = (t: ValuationTemplate) => t.createdBy === me.username || me.role === 'admin';
	const basketLabel = (key: string) => baskets.find((b) => b.key === key)?.label;
</script>

<details
	class="tpl-menu"
	data-testid="template-menu"
	bind:this={menu}
	ontoggle={(e) => {
		if ((e.currentTarget as HTMLDetailsElement).open && templates === null) void load();
	}}
>
	<summary class="reset-btn">Templates ▾</summary>
	<div class="tpl-panel">
		{#if templates === null && !error}
			<p class="hint">Loading…</p>
		{:else if templates}
			{#if templates.length === 0}
				<p class="hint">
					No templates yet. Save this company's assumptions as the first one below.
				</p>
			{:else}
				<ul class="tpl-list">
					{#each templates as t (t.id)}
						<li data-testid="template-item">
							<div class="tpl-row">
								<span class="tpl-name">{t.name}</span>
								<button
									class="wl-strip-btn btn-primary"
									type="button"
									disabled={busy}
									onclick={() => apply(t)}>Apply</button
								>
							</div>
							<div class="tpl-meta">
								By {t.createdBy}{t.updatedBy !== t.createdBy ? `, updated by ${t.updatedBy}` : ''}.
								{#if myDefaultId === t.id}<strong>Your default.</strong>{/if}
								{#each t.basketDefaults.filter((k) => basketLabel(k)) as k (k)}
									<strong>Default for {basketLabel(k)}.</strong>
								{/each}
							</div>
							<div class="tpl-actions">
								{#if myDefaultId === t.id}
									<button
										class="link-btn"
										type="button"
										disabled={busy}
										onclick={() => setDefault('me', null)}>Stop using as my default</button
									>
								{:else}
									<button
										class="link-btn"
										type="button"
										disabled={busy}
										onclick={() => setDefault('me', t.id)}>Make my default</button
									>
								{/if}
								{#each baskets as b (b.key)}
									{#if t.basketDefaults.includes(b.key)}
										<button
											class="link-btn"
											type="button"
											disabled={busy}
											onclick={() => setDefault(`basket:${b.key}`, null)}
											>Clear default for {b.label}</button
										>
									{:else}
										<button
											class="link-btn"
											type="button"
											disabled={busy}
											onclick={() => setDefault(`basket:${b.key}`, t.id)}
											>Default for {b.label}</button
										>
									{/if}
								{/each}
								{#if canDelete(t)}
									{#if confirmDelete === t.id}
										<span class="tpl-confirm"
											>Delete for everyone?
											<button
												class="link-btn danger"
												type="button"
												disabled={busy}
												onclick={async () => {
													await call(`/api/valuation/templates/${t.id}`, 'DELETE');
													confirmDelete = null;
												}}>Yes, delete</button
											>
											<button class="link-btn" type="button" onclick={() => (confirmDelete = null)}
												>Cancel</button
											></span
										>
									{:else}
										<button
											class="link-btn danger"
											type="button"
											onclick={() => (confirmDelete = t.id)}>Delete</button
										>
									{/if}
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
			<form class="tpl-new" onsubmit={saveNew}>
				<label for="tpl-new-name">Save these assumptions as a template</label>
				<div class="tpl-row">
					<input
						id="tpl-new-name"
						class="sm-input"
						type="text"
						maxlength="60"
						placeholder="e.g. Bank P/B model"
						bind:value={newName}
					/>
					<button class="wl-strip-btn" type="submit" disabled={busy}>Save</button>
				</div>
				<p class="hint">
					Saves every method and scenario as they are now. Templates are shared with the team.
				</p>
			</form>
		{/if}
		{#if error}<p class="team-error" role="alert">{error}</p>{/if}
	</div>
</details>
