<script lang="ts">
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { untrack } from 'svelte';
	import {
		DEFAULT_ANALYSIS_SETTINGS,
		ROTATION_FIELDS,
		SCAN_FIELDS,
		VALUATION_FIELDS,
		type AnalysisSettings
	} from '$lib/valuation/analysisSettings';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const isAdmin = $derived(data.user?.role === 'admin');
	// A working copy the form edits; replaced by what the server stored after each save.
	// Seeded once; the page's own saves keep it in step with the server afterwards.
	const initial = untrack(() => structuredClone(data.settings));
	let draft = $state<AnalysisSettings>(initial);
	let busy = $state(false);
	let message = $state<{ ok: boolean; text: string } | null>(null);

	const groups = [
		{
			id: 'valuation' as const,
			title: 'Valuation',
			intro: 'How fair value is derived from each company’s Base-case FY+2E target.',
			fields: VALUATION_FIELDS
		},
		{
			id: 'rotation' as const,
			title: 'Sector rotation',
			intro:
				'A sector is Rotating In when its relative strength vs Nifty is accelerating: the short window beats the medium window, which beats the long one (per trading day). Rotating Out is the mirror case. The 1W/1M/3M/6M columns on the cards are unaffected.',
			fields: ROTATION_FIELDS
		},
		{
			id: 'scan' as const,
			title: 'Stage 2 breakout scanner',
			intro:
				'How the scanner recognises a base, a near breakout and a confirmed breakout. Changing these recomputes every stock on its next scan.',
			fields: SCAN_FIELDS
		}
	];

	type GroupId = 'valuation' | 'rotation' | 'scan';
	const defaultOf = (group: GroupId, key: string) =>
		(DEFAULT_ANALYSIS_SETTINGS[group] as unknown as Record<string, number>)[key];
	const valueOf = (group: GroupId, key: string) =>
		(draft[group] as unknown as Record<string, number>)[key];
	function setValue(group: GroupId, key: string, v: number) {
		(draft[group] as unknown as Record<string, number>)[key] = v;
	}

	async function send(body: unknown, done: string) {
		busy = true;
		message = null;
		try {
			const res = await fetch('/api/valuation/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				const err = (await res.json().catch(() => null)) as { message?: string } | null;
				message = { ok: false, text: err?.message ?? `Could not save (HTTP ${res.status}).` };
				return;
			}
			draft = (await res.json()) as AnalysisSettings;
			message = { ok: true, text: done };
			// Every page reads the settings from the layout data; refresh it.
			await invalidateAll();
		} catch {
			message = { ok: false, text: 'Could not reach the server. Nothing was changed.' };
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Settings · ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Settings</h1>
		<div class="sub">
			Team-wide thresholds behind the rotation signals and the breakout scanner. Everyone sees the
			same signals, so only the admin can change them. Relative-strength alert levels are on the
			<a href={resolve('/valuation/alerts')}>Alerts</a> page.
		</div>
	</div>
</div>

<div class="wrap settings-page">
	{#if !isAdmin}
		<p class="hint" data-testid="settings-readonly">
			You can see the current values; ask the admin to change them.
		</p>
	{/if}
	<form
		onsubmit={(e) => {
			e.preventDefault();
			void send(draft, 'Saved. New values apply from the next refresh of each page.');
		}}
	>
		{#each groups as g (g.id)}
			<fieldset class="settings-group" data-testid="settings-{g.id}">
				<legend>{g.title}</legend>
				<p class="hint">{g.intro}</p>
				<div class="settings-grid">
					{#each Object.entries(g.fields) as [key, spec] (key)}
						<div class="settings-field">
							<label class="settings-label" for="set-{g.id}-{key}">{spec.label}</label>
							<span class="settings-input">
								<input
									id="set-{g.id}-{key}"
									aria-describedby="help-{g.id}-{key}"
									type="number"
									min={spec.min}
									max={spec.max}
									step={spec.step}
									required
									disabled={!isAdmin || busy}
									value={valueOf(g.id, key)}
									oninput={(e) => setValue(g.id, key, e.currentTarget.valueAsNumber)}
								/>
								<span class="muted">{spec.unit}</span>
							</span>
							<span class="hint" id="help-{g.id}-{key}"
								>{spec.help}
								{#if valueOf(g.id, key) !== defaultOf(g.id, key)}
									<em>Default {defaultOf(g.id, key)}.</em>
								{/if}</span
							>
						</div>
					{/each}
				</div>
			</fieldset>
		{/each}
		{#if isAdmin}
			<div class="settings-actions">
				<button class="wl-strip-btn btn-primary" type="submit" disabled={busy}>Save settings</button
				>
				<button
					class="link-btn"
					type="button"
					disabled={busy}
					onclick={() => send({ reset: true }, 'Back to the default values.')}
					>Reset to defaults</button
				>
			</div>
		{/if}
		{#if message}
			<p class={message.ok ? 'hint' : 'team-error'} role={message.ok ? 'status' : 'alert'}>
				{message.text}
			</p>
		{/if}
	</form>
</div>
