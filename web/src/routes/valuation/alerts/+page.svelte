<script lang="ts">
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import {
		ALERT_TYPES,
		ALERT_TYPE_LABELS,
		ALERTS_CHANGED_EVENT,
		type AlertRecord,
		type AlertType
	} from '$lib/valuation/alerts';
	import { sectorApi } from '$lib/valuation/sectorClient';
	import { describeStrengthConfig } from '$lib/valuation/strength';
	import ViewResetButton from '$lib/valuation/components/ViewResetButton.svelte';
	import { trackView, type ViewTracker } from '$lib/viewMemory.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The type filter and "Unread only" are remembered for this person (lib/viewMemory.ts).
	const memory: ViewTracker<'alerts'> = trackView({
		view: 'alerts',
		userId: () => data.user?.id,
		read: () => ({ type: typeFilter, unread: unreadOnly }),
		apply: (s) => {
			typeFilter = s.type;
			unreadOnly = s.unread;
		}
	});
	let typeFilter = $state<AlertType | 'all'>(memory.initial.type);
	let unreadOnly = $state(memory.initial.unread);

	const visible = $derived(
		data.alerts.filter(
			(a) => (typeFilter === 'all' || a.type === typeFilter) && (!unreadOnly || !a.read)
		)
	);
	const countFor = (t: AlertType | 'all') =>
		data.alerts.filter((a) => t === 'all' || a.type === t).length;

	let status = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
	let busy = $state<string | null>(null);

	function announce(unread: number) {
		window.dispatchEvent(new CustomEvent(ALERTS_CHANGED_EVENT, { detail: { unread } }));
	}

	async function setRead(ids: number[] | 'all', read: boolean) {
		busy = 'read';
		const res = await sectorApi<{ unread: number }>(
			'POST',
			'/api/valuation/alerts/read',
			ids === 'all' ? { all: true, read } : { ids, read }
		);
		busy = null;
		if (!res.ok) {
			status = { kind: 'error', text: res.message };
			return;
		}
		announce(res.data.unread);
		await invalidateAll();
	}

	async function runCheck(scope: 'price' | 'structural') {
		busy = scope;
		status = null;
		const res = await sectorApi<{
			summaries: {
				scope: string;
				checked: number;
				alerts: number;
				errors: number;
				skipped?: string;
			}[];
		}>('POST', '/api/valuation/alerts/check', { scope });
		busy = null;
		if (!res.ok) {
			status = { kind: 'error', text: res.message };
			return;
		}
		const parts = res.data.summaries.map((s) =>
			s.skipped
				? `${s.scope}: skipped (${s.skipped})`
				: `${s.scope}: ${s.checked} checked, ${s.alerts} new alert${s.alerts === 1 ? '' : 's'}${s.errors ? `, ${s.errors} error${s.errors === 1 ? '' : 's'}` : ''}`
		);
		status = { kind: 'ok', text: parts.join(' · ') };
		await invalidateAll();
		const count = await fetch('/api/valuation/alerts/unread-count')
			.then((r) => r.json())
			.catch(() => null);
		if (count) announce(count.unread);
	}

	// ---- Strength & Volume rules ----
	let rulesOpen = $state(false);
	const LEVEL_WORDS = {
		sectors: 'Every sector',
		subsectors: 'Subsectors',
		companies: 'Companies',
		company: 'Company'
	} as const;
	const ruleKind = (level: string) => (level === 'sectors' || level === 'subsectors' ? 'group' : 'company');

	async function toggleRule(id: number, enabled: boolean) {
		busy = 'rule';
		const res = await sectorApi('PATCH', `/api/valuation/strength/rules/${id}`, { enabled });
		busy = null;
		if (!res.ok) status = { kind: 'error', text: res.message };
		else await invalidateAll();
	}

	async function removeRule(id: number, name: string) {
		if (!confirm(`Delete the alert rule "${name}"? Its past alerts stay in the feed.`)) return;
		busy = 'rule';
		const res = await sectorApi('DELETE', `/api/valuation/strength/rules/${id}`);
		busy = null;
		if (!res.ok) status = { kind: 'error', text: res.message };
		else await invalidateAll();
	}

	// ---- settings ----
	let settingsOpen = $state(false);

	async function putSettings(patch: {
		enabled?: Record<string, boolean>;
		mute?: string[];
		unmute?: string[];
		thresholds?: { weeklyPct: number; monthlyPct: number };
	}): Promise<boolean> {
		busy = 'settings';
		const res = await sectorApi('PUT', '/api/valuation/alerts/settings', patch);
		busy = null;
		if (!res.ok) {
			status = { kind: 'error', text: res.message };
			return false;
		}
		await invalidateAll();
		return true;
	}

	// Weekly / monthly relative-strength thresholds (admin-editable, read-only for members).
	// The input shows the admin's in-progress edit, otherwise whatever is currently saved.
	let weeklyEdit = $state<number | null>(null);
	let monthlyEdit = $state<number | null>(null);
	const weeklyDraft = $derived(weeklyEdit ?? data.settings.thresholds.weeklyPct);
	const monthlyDraft = $derived(monthlyEdit ?? data.settings.thresholds.monthlyPct);

	async function saveThresholds() {
		const weekly = Number(weeklyDraft);
		const monthly = Number(monthlyDraft);
		const ok = await putSettings({ thresholds: { weeklyPct: weekly, monthlyPct: monthly } });
		if (ok) {
			// Saved values now come back through `data`; drop the in-progress edit.
			weeklyEdit = monthlyEdit = null;
			status = {
				kind: 'ok',
				text: `Thresholds saved: weekly ±${weekly}%, monthly ±${monthly}%. They apply from the next sector check.`
			};
		}
	}

	function toggleType(t: AlertType) {
		return putSettings({ enabled: { [t]: !data.settings.enabled[t] } });
	}

	function mute(a: AlertRecord) {
		return putSettings({ mute: [a.subjectKey] }).then((ok) => {
			if (ok) {
				status = {
					kind: 'ok',
					text: `Muted ${a.subjectLabel}. Its alerts are hidden for you; unmute it under Alert settings.`
				};
			}
		});
	}

	function unmute(key: string) {
		return putSettings({ unmute: [key] });
	}

	let testing = $state(false);
	async function sendTest() {
		testing = true;
		const res = await sectorApi('POST', '/api/valuation/alerts/settings/test-email');
		testing = false;
		status = res.ok
			? { kind: 'ok', text: 'Test email sent.' }
			: { kind: 'error', text: res.message };
	}

	function when(ts: number) {
		return new Date(ts).toLocaleString('en-IN', {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function relative(ts: number) {
		const mins = Math.round((Date.now() - ts) / 60_000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.round(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		return `${Math.round(hrs / 24)}d ago`;
	}

	// Typed routes via resolve(), derived from the alert's subject (a basket alert also needs its
	// parent sector, which is carried in the stored path).
	type AlertRoute =
		| { kind: 'symbol'; symbol: string }
		| { kind: 'sector'; key: string }
		| { kind: 'basket'; key: string; subKey: string };

	function routeFor(a: AlertRecord): AlertRoute | null {
		const kind = a.subjectKey.split(':')[0];
		const key = a.subjectKey.slice(a.subjectKey.indexOf(':') + 1);
		if (kind === 'symbol') return { kind, symbol: key };
		if (kind === 'sector') return { kind, key };
		const m = a.href?.match(/^\/sector-rotation\/([^/]+)\/([^/]+)$/);
		return kind === 'basket' && m ? { kind, key: m[1], subKey: m[2] } : null;
	}

	const mutedLabel = (key: string) => key.replace(/^(symbol|sector|basket):/, '');
</script>

<svelte:head>
	<title>Alerts · ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Alerts</h1>
		<div class="sub">
			Price reaching fair value ({data.analysis?.valuation.fairValuePct ?? 80}% of the Base-case
			FY+2E target), sectors flipping to Rotating In/Out, stocks entering Near Stage 2 Breakout, and anything entering a Strength &amp; Volume rule you saved.
			Alerts are raised for the whole team; what you have read, which types you see and what you
			mute are yours alone.
		</div>
	</div>
</div>

<div class="wrap">
	<div class="al-toolbar">
		<div class="al-filters" role="group" aria-label="Filter alerts by type">
			<button
				class="al-chip"
				class:al-chip-on={typeFilter === 'all'}
				type="button"
				aria-pressed={typeFilter === 'all'}
				onclick={() => (typeFilter = 'all')}>All <span>{countFor('all')}</span></button
			>
			{#each ALERT_TYPES as t (t)}
				<button
					class="al-chip"
					class:al-chip-on={typeFilter === t}
					type="button"
					aria-pressed={typeFilter === t}
					onclick={() => (typeFilter = t)}>{ALERT_TYPE_LABELS[t]} <span>{countFor(t)}</span></button
				>
			{/each}
		</div>
		<label class="sm-check al-unread-toggle">
			<input type="checkbox" bind:checked={unreadOnly} />
			<span>Unread only</span>
		</label>
		<button
			class="sm-btn"
			type="button"
			disabled={busy === 'read' || data.unread === 0}
			onclick={() => setRead('all', true)}>Mark all read</button
		>
		<ViewResetButton onReset={() => memory.reset()} />
	</div>

	<div class="al-checks">
		<button
			class="sm-btn sm-btn-primary"
			type="button"
			disabled={busy !== null}
			onclick={() => runCheck('price')}
		>
			{busy === 'price' ? 'Checking prices…' : 'Check prices now'}
		</button>
		<button
			class="sm-btn"
			type="button"
			disabled={busy !== null}
			onclick={() => runCheck('structural')}
		>
			{busy === 'structural' ? 'Checking sectors & breakouts…' : 'Check sectors & breakouts now'}
		</button>
		<span class="sm-hint al-checks-hint"
			>Checks also run automatically: prices every 10 minutes in market hours, sectors and breakouts
			after each data refresh.</span
		>
	</div>

	{#if status}
		<p class="sm-msg sm-msg-{status.kind}" role="status">{status.text}</p>
	{/if}

	{#if visible.length === 0}
		<p class="sm-empty" data-testid="alerts-empty">
			{data.alerts.length === 0
				? 'No alerts yet. They appear here when a price reaches fair value, a sector flips, or a stock enters Near Breakout.'
				: 'No alerts match this filter.'}
		</p>
	{:else}
		<ul class="al-list" data-testid="alert-list">
			{#each visible as a (a.id)}
				{@const route = routeFor(a)}
				<li class="al-item" class:al-unread={!a.read} data-alert-id={a.id} data-type={a.type}>
					<span class="al-dot" aria-hidden="true"></span>
					<div class="al-main">
						<div class="al-meta">
							<span class="al-type al-type-{a.type}">{ALERT_TYPE_LABELS[a.type]}</span>
							{#if route?.kind === 'symbol'}
								<a class="al-subject" href={resolve('/valuation/company/[symbol]', { symbol: route.symbol })}
									>{a.subjectLabel}</a
								>
							{:else if route?.kind === 'sector'}
								<a class="al-subject" href={resolve('/valuation/sector-rotation/[key]', { key: route.key })}
									>{a.subjectLabel}</a
								>
							{:else if route?.kind === 'basket'}
								<a
									class="al-subject"
									href={resolve('/valuation/sector-rotation/[key]/[subKey]', {
										key: route.key,
										subKey: route.subKey
									})}>{a.subjectLabel}</a
								>
							{:else}
								<span class="al-subject">{a.subjectLabel}</span>
							{/if}
							<span class="al-time" title={when(a.createdAt)}>{relative(a.createdAt)}</span>
						</div>
						<p class="al-msg">{a.message}</p>
					</div>
					<div class="al-actions">
						<button
							class="sm-btn"
							type="button"
							disabled={busy === 'read'}
							onclick={() => setRead([a.id], !a.read)}
						>
							{a.read ? 'Mark unread' : 'Mark read'}
						</button>
						<button
							class="sm-btn sm-btn-quiet-danger"
							type="button"
							disabled={busy === 'settings' || data.settings.muted.includes(a.subjectKey)}
							onclick={() => mute(a)}
							title="Hide alerts for {a.subjectLabel} from you"
						>
							{data.settings.muted.includes(a.subjectKey) ? 'Muted' : 'Mute'}
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="integrity-panel al-settings">
		<button class="integrity-toggle" type="button" onclick={() => (rulesOpen = !rulesOpen)}>
			<span>Strength &amp; Volume rules ({data.rules.length})</span>
			<span class="integrity-caret">{rulesOpen ? '▲' : '▼'}</span>
		</button>
		{#if rulesOpen}
			<div class="import-body">
				{#if data.rules.length === 0}
					<p class="sm-hint">
						No rules yet. Open the Strength &amp; Volume panel on a sector, subsector or company
						view, switch on a signal and choose "Create alert from this filter".
					</p>
				{:else}
					<ul class="sv-rule-list">
						{#each data.rules as r (r.id)}
							<li class="sv-rule" class:sv-rule-off={!r.enabled}>
								<div class="sv-rule-main">
									<strong>{r.name}</strong>
									<span class="sm-hint"
										>{LEVEL_WORDS[r.level]}{r.parentKey ? ` · ${r.parentKey}` : ''} · {describeStrengthConfig(
											r.config,
											ruleKind(r.level)
										).join(', ')} · {r.repeat.mode === 'once'
											? 'first time only'
											: `re-alerts after ${r.repeat.cooldownSessions} sessions`}{r.createdBy
											? ` · by ${r.createdBy}`
											: ''}</span
									>
								</div>
								<button
									type="button"
									class="sm-btn"
									disabled={busy === 'rule'}
									onclick={() => toggleRule(r.id, !r.enabled)}>{r.enabled ? 'Pause' : 'Resume'}</button
								>
								<button
									type="button"
									class="sm-btn"
									disabled={busy === 'rule'}
									onclick={() => removeRule(r.id, r.name)}>Delete</button
								>
							</li>
						{/each}
					</ul>
				{/if}
				<p class="sm-hint">
					Rules use end-of-day data and are checked after each weekday's close, once the sector data
					refreshes. Everyone on the team receives the alerts. "Check sectors &amp; breakouts now" runs them
					immediately.
				</p>
			</div>
		{/if}
	</div>

	<div class="integrity-panel al-settings">
		<button class="integrity-toggle" type="button" onclick={() => (settingsOpen = !settingsOpen)}>
			<span>Alert settings</span>
			<span class="integrity-caret">{settingsOpen ? '▲' : '▼'}</span>
		</button>
		{#if settingsOpen}
			<div class="import-body">
				<h3 class="sm-new-title" style="margin-top:12px">Alert types (just for you)</h3>
				{#each ALERT_TYPES as t (t)}
					<label class="sm-check al-setting-row">
						<input
							type="checkbox"
							checked={data.settings.enabled[t]}
							disabled={busy === 'settings'}
							onchange={() => toggleType(t)}
						/>
						<span>{ALERT_TYPE_LABELS[t]}</span>
					</label>
				{/each}

				<h3 class="sm-new-title" style="margin-top:16px">Sector rotation thresholds</h3>
				<p class="sm-hint">
					Besides flips into Rotating In/Out, a sector or basket alerts when its relative strength
					vs Nifty crosses these levels, up or down - over the last week (5 trading days) and the
					last month (21 trading days).
				</p>
				{#if data.user?.role === 'admin'}
					<form
						class="sm-inline-form al-thresholds"
						onsubmit={(e) => {
							e.preventDefault();
							saveThresholds();
						}}
					>
						<label class="sm-check">
							<span>Weekly ±</span>
							<input
								class="sm-input al-threshold-input"
								type="number"
								min="0.5"
								max="50"
								step="0.5"
								aria-label="Weekly threshold in percentage points"
								value={weeklyDraft}
								oninput={(e) => (weeklyEdit = e.currentTarget.valueAsNumber)}
							/>
							<span>%</span>
						</label>
						<label class="sm-check">
							<span>Monthly ±</span>
							<input
								class="sm-input al-threshold-input"
								type="number"
								min="0.5"
								max="50"
								step="0.5"
								aria-label="Monthly threshold in percentage points"
								value={monthlyDraft}
								oninput={(e) => (monthlyEdit = e.currentTarget.valueAsNumber)}
							/>
							<span>%</span>
						</label>
						<button class="sm-btn sm-btn-primary" type="submit" disabled={busy === 'settings'}
							>Save thresholds</button
						>
					</form>
				{:else}
					<p class="sm-hint" data-testid="thresholds-readonly">
						Weekly ±{data.settings.thresholds.weeklyPct}%, monthly ±{data.settings.thresholds
							.monthlyPct}% (set by the admin).
					</p>
				{/if}

				<h3 class="sm-new-title" style="margin-top:16px">Muted</h3>
				{#if data.settings.muted.length === 0}
					<p class="sm-hint">Nothing muted. Use "Mute" on an alert to silence a stock or sector.</p>
				{:else}
					<ul class="sm-chips">
						{#each data.settings.muted as key (key)}
							<li class="sm-chip">
								<span class="sm-chip-name">{mutedLabel(key)}</span>
								<span class="sm-chip-ticker">{key.split(':')[0]}</span>
								<button
									class="sm-chip-x"
									type="button"
									aria-label="Unmute {mutedLabel(key)}"
									title="Unmute"
									onclick={() => unmute(key)}>×</button
								>
							</li>
						{/each}
					</ul>
				{/if}

				<h3 class="sm-new-title" style="margin-top:16px">Email (optional)</h3>
				{#if data.email.configured}
					<p class="sm-hint" data-testid="email-status">
						Sending each new alert to {data.email.recipients.join(', ')}.
					</p>
					<button class="sm-btn" type="button" disabled={testing} onclick={sendTest}>
						{testing ? 'Sending…' : 'Send test email'}
					</button>
				{:else}
					<p class="sm-hint" data-testid="email-status">
						Email is not configured, so alerts show here only. To turn it on, set
						<code>SMTP_HOST</code>, <code>SMTP_FROM</code> and <code>ALERT_EMAIL_TO</code> (plus
						<code>SMTP_USER</code>/<code>SMTP_PASS</code> if your server needs a login) in
						<code>.env</code> and restart the app.
					</p>
				{/if}
			</div>
		{/if}
	</div>
</div>
