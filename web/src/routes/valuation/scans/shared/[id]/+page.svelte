<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { describeScanConfig, scanOpenHref } from '$lib/valuation/savedScans';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const canWrite = $derived(Boolean(data.user?.role && data.user.role !== 'read_only'));
	const added = $derived(new Set(data.diff.added));
	const olderDates = $derived(data.date ? data.dates.filter((d) => d < data.date!) : []);
	const nameOf = (s: string) => (data.names[s] && data.names[s] !== s ? data.names[s] : '');

	function pick(next: { d?: string; c?: string }) {
		const u = new URL(page.url);
		if (next.d) {
			u.searchParams.set('d', next.d);
			u.searchParams.delete('c');
		}
		if (next.c !== undefined) next.c ? u.searchParams.set('c', next.c) : u.searchParams.delete('c');
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(u, { noScroll: true, keepFocus: true });
	}

	let message = $state<string | null>(null);
	let saving = $state(false);
	async function saveCopy() {
		saving = true;
		message = null;
		try {
			const res = await fetch('/api/valuation/scans', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: `${data.scan.name} (copy)`.slice(0, 60), config: data.scan.config, notify: false })
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.message ?? `HTTP ${res.status}`);
			message = 'Saved to your scans.';
		} catch (e) {
			message = e instanceof Error ? e.message : 'Could not save a copy.';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>{data.scan.name} · Saved scan · ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>{data.scan.name}</h1>
		<div class="sub">
			Saved by {data.scan.ownerName}. Filters: {describeScanConfig(data.scan.config).join(' · ')}.
		</div>
	</div>
</div>

<div class="wrap wrap-wide an-page">
	<div class="an-actions no-print">
		<a class="wl-strip-btn" href={scanOpenHref(data.scan.id)}>Open in scanner</a>
		{#if canWrite && !data.scan.mine}
			<button type="button" class="wl-strip-btn" onclick={saveCopy} disabled={saving}>Save a copy to my scans</button>
		{/if}
		{#if data.scan.mine}<a class="wl-strip-btn" href="/valuation/scans">My saved scans</a>{/if}
		{#if message}<span class="hint" role="status">{message}</span>{/if}
	</div>

	{#if !data.date}
		<p class="scan-note" data-testid="shared-empty">
			No snapshot has been stored for this scan yet. Snapshots are taken once a day after the price refresh.
		</p>
	{:else}
		<div class="scan-toolbar no-print">
			<label>
				<span class="sr-only">Snapshot date</span>
				<select class="sm-input" value={data.date} onchange={(e) => pick({ d: e.currentTarget.value })} data-testid="shared-date">
					{#each data.dates as d (d)}<option value={d}>Matches on {d}</option>{/each}
				</select>
			</label>
			<label>
				<span class="sr-only">Compare with</span>
				<select class="sm-input" value={data.compare ?? ''} onchange={(e) => pick({ c: e.currentTarget.value })} disabled={olderDates.length === 0} data-testid="shared-compare">
					<option value="">No comparison</option>
					{#each olderDates as d (d)}<option value={d}>Compare with {d}</option>{/each}
				</select>
			</label>
			<span class="hint" data-testid="shared-summary">
				{data.symbols.length} matches
				{#if data.compare}· <strong class="res-up">{data.diff.added.length} new</strong>, {data.diff.removed.length} dropped since {data.compare}{/if}
			</span>
		</div>

		{#if data.diff.removed.length}
			<p class="scan-note">Dropped: {data.diff.removed.join(', ')}</p>
		{/if}

		<div class="table-scroll">
			<table class="res-table" data-testid="shared-table">
				<thead>
					<tr><th class="text">Company</th><th class="text">Status</th></tr>
				</thead>
				<tbody>
					{#each data.symbols as s (s)}
						<tr>
							<td class="text res-name">
								<a href="/valuation/company/{encodeURIComponent(s)}">{nameOf(s) || s}</a>
								<span class="scan-sub">{s}</span>
							</td>
							<td class="text">{#if data.compare && added.has(s)}<strong class="res-up">New</strong>{:else}-{/if}</td>
						</tr>
					{:else}
						<tr><td colspan="2" class="muted scan-empty">Nothing matched on this date.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
