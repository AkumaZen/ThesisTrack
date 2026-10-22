<script lang="ts">

	import { invalidateAll } from '$app/navigation';
	import { describeScanConfig, scanOpenHref, scanShareHref } from '$lib/valuation/savedScans';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const canWrite = $derived(Boolean(data.user?.role && data.user.role !== 'read_only'));
	let message = $state<string | null>(null);
	let busyId = $state<string | null>(null);

	async function call(id: string, init: RequestInit, url = `/api/valuation/scans/${id}`) {
		busyId = id;
		message = null;
		try {
			const res = await fetch(url, init);
			if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `HTTP ${res.status}`);
			await invalidateAll();
		} catch (e) {
			message = e instanceof Error ? e.message : 'That did not work.';
		} finally {
			busyId = null;
		}
	}
	const toggleNotify = (id: string, notify: boolean) =>
		call(id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notify }) });
	const remove = (id: string, name: string) => {
		if (confirm(`Delete the scan "${name}" and its history?`)) call(id, { method: 'DELETE' });
	};
	const snapshot = (id: string) => call(id, { method: 'POST' }, `/api/valuation/scans/${id}/snapshot`);

	async function copyLink(id: string) {
		try {
			await navigator.clipboard.writeText(new URL(scanShareHref(id), location.origin).href);
			message = 'Link copied. Anyone signed in to ThesisTrack can open it.';
		} catch {
			message = `Copy this address: ${new URL(scanShareHref(id), location.origin).href}`;
		}
	}
</script>

<svelte:head>
	<title>Saved scans · ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Saved scans</h1>
		<div class="sub">Your breakout scanner filters, kept under a name.</div>
		<details class="calm-disclosure no-print">
			<summary>How this works</summary>
			<p>
				Each day the stored scan results are matched again and the symbols that newly match are listed;
				switch alerts on to get a push or Telegram message when a scan gains a match. Save a scan from
				the <a href="/valuation/stage-scanner">breakout scanner</a>.
			</p>
		</details>
	</div>
</div>

<div class="wrap wrap-wide an-page">
	{#if message}<p class="hint" role="status" data-testid="scans-message">{message}</p>{/if}

	{#if data.scans.length === 0}
		<p class="scan-note" data-testid="scans-empty">
			You have no saved scans yet.{canWrite ? ' Set filters in the breakout scanner and press "Save this scan".' : ' Read-only accounts cannot save scans.'}
		</p>
	{:else}
		<ul class="scan-list" data-testid="scans-list">
			{#each data.scans as s (s.id)}
				<li class="scan-item">
					<div class="scan-item-main">
						<a class="scan-item-name" href={scanShareHref(s.id)}>{s.name}</a>
						<span class="scan-sub">{describeScanConfig(s.config).join(' · ')}</span>
						{#if s.latestDate}
							<span class="scan-item-stats" data-testid="scan-stats">
								{s.matches} matches as of {s.latestDate}
								{#if s.compared}
									· <strong class="res-up">{s.added} new</strong>, {s.removed} dropped since {s.compared}
								{:else}
									· first snapshot, nothing to compare yet
								{/if}
							</span>
						{:else}
							<span class="scan-item-stats">No snapshot yet.</span>
						{/if}
					</div>
					<div class="scan-item-actions no-print">
						<a class="calm-btn" href={scanOpenHref(s.id)}>Open in scanner</a>
						<button type="button" class="calm-btn" onclick={() => copyLink(s.id)}>Copy link</button>
						{#if canWrite}
							<label class="pc-toggle">
								<input
									type="checkbox"
									checked={s.notify}
									disabled={busyId === s.id}
									onchange={(e) => toggleNotify(s.id, e.currentTarget.checked)}
									data-testid="scan-notify"
								/> Alert on new matches
							</label>
							<button type="button" class="calm-btn" disabled={busyId === s.id} onclick={() => snapshot(s.id)}>Snapshot now</button>
							<button type="button" class="calm-btn scan-danger" disabled={busyId === s.id} onclick={() => remove(s.id, s.name)}>Delete</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>
