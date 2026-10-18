<script lang="ts">
	// Per-company panel: red-flag checks with their inputs, guidance credibility history, and the
	// analysed calls. Mount it anywhere with <ConcallPanel symbol="HFCL" {writable} />. It reads stored data
	// only; "Refresh" and "Analyse" are explicit buttons shown to people who can write.
	import StatusBadge from './StatusBadge.svelte';
	import { runBatches } from '../concallClient';
	import { describeTarget } from '../concall/guidance';
	import { quarterLabel } from '../concall/rows';
	import type { PanelData } from '../server/concallPanel';
	import { formatMeetingDay } from '../boardMeetings';

	let { symbol, writable = false, initial = null }: { symbol: string; writable?: boolean; initial?: PanelData | null } = $props();

	let data = $state<PanelData | null>(null);
	let loading = $state(true);
	let failure = $state('');
	let busy = $state(false);
	let status = $state<{ ok: boolean; text: string } | null>(null);
	let token = 0;

	async function load() {
		const mine = ++token;
		failure = '';
		try {
			const response = await fetch(`/api/valuation/concalls/company/${encodeURIComponent(symbol)}`);
			if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message ?? `HTTP ${response.status}`);
			const body = (await response.json()) as PanelData;
			if (mine === token) data = body;
		} catch (e) {
			if (mine === token) failure = e instanceof Error ? e.message : 'Could not load.';
		} finally {
			if (mine === token) loading = false;
		}
	}

	$effect(() => {
		void symbol;
		data = initial?.company.symbol === symbol ? initial : null;
		loading = !data;
		void load();
	});

	async function run(mode: 'refresh' | 'analyse') {
		busy = true;
		status = null;
		const result = await runBatches(mode, [symbol], (text) => (status = { ok: true, text }));
		status = { ok: result.ok, text: result.message };
		if (result.changed) await load();
		busy = false;
	}

	const scoreText = $derived(data?.flags?.score == null ? 'n/a' : `${data.flags.score} / 100`);
	const pct = (n: number | null) => (n == null ? 'n/a' : `${n.toFixed(0)}%`);
	const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
	const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
	const SOURCE: Record<string, string> = { screener: 'Screener, just now', stored: 'the last Screener snapshot (Screener did not respond)', research: 'the Master Tracker research (Screener did not respond)' };
</script>

<section class="cp" aria-labelledby="cp-h-{symbol}" data-testid="concall-panel">
	<header class="cp-head">
		<div>
			<h2 id="cp-h-{symbol}">Concalls and red flags</h2>
			{#if data?.scannedAt}
				<p class="cp-meta">Checked {dateText(data.scannedAt)} from {SOURCE[data.finSource ?? ''] ?? data.finSource}.</p>
			{/if}
		</div>
		{#if writable && data}
			<div class="cp-actions">
				<button type="button" class="sm-btn" disabled={busy} onclick={() => run('refresh')}>Refresh checks</button>
				<button type="button" class="sm-btn sm-btn-primary" disabled={busy || data.pending === 0} onclick={() => run('analyse')}>
					Analyse {data.pending} new {data.pending === 1 ? 'transcript' : 'transcripts'}
				</button>
			</div>
		{/if}
	</header>
	<p class="cp-status sm-msg" class:sm-msg-error={status && !status.ok} role="status" aria-live="polite">{status?.text ?? ''}</p>

	{#if loading}
		<p class="sm-hint">Loading...</p>
	{:else if failure}
		<p class="sm-msg sm-msg-error" role="alert">{failure}</p>
	{:else if data}
		{#if !data.scannedAt}
			<p class="sm-empty" data-testid="panel-unscanned">
				This company has not been scanned yet.{writable ? ' Press "Refresh checks" to read its financials and find its stored transcripts.' : ''}
			</p>
		{:else}
			<div class="cp-block" data-testid="redflags">
				<h3>Forensic red flags</h3>
				{#if data.flags}
					<p class="cp-score">
						<span class="cp-num">{scoreText}</span>
						<StatusBadge status={data.flags.level} />
						<span class="cp-meta">{data.flags.failed} of {data.flags.evaluated} checks failed. Higher is worse.</span>
					</p>
					<div class="cp-meter" role="img" aria-label="Red-flag score {scoreText}"><span style="width: {data.flags.score ?? 0}%"></span></div>
					<ul class="cp-checks">
						{#each data.flags.checks as c (c.id)}
							<li class="cp-check">
								<div class="cp-checkhead">
									<StatusBadge status={c.status} />
									<strong>{c.name}</strong>
								</div>
								<p class="cp-detail">{c.detail}</p>
								<details>
									<summary>Rule and inputs</summary>
									<p class="cp-rule">{c.rule}{c.weight ? ` Weight ${c.weight}.` : ''}</p>
									{#if c.inputs.length}
										<dl class="cp-inputs">
											{#each c.inputs as i (i.label)}
												<dt>{i.label}</dt>
												<dd>{i.value}</dd>
											{/each}
										</dl>
									{/if}
								</details>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="sm-hint">No red-flag report yet.</p>
				{/if}
			</div>

			<div class="cp-block" data-testid="guidance">
				<h3>Guidance credibility</h3>
				{#if data.guidance.length === 0}
					<p class="sm-hint">No guidance has been extracted yet. It appears after a transcript is analysed.</p>
				{:else}
					<p class="cp-score">
						<span class="cp-num">{data.credibility.resolved ? `${data.credibility.kept} of ${data.credibility.resolved}` : 'None resolved'}</span>
						<span class="cp-meta">
							{data.credibility.resolved ? `${pct(data.credibility.pct)} of resolved statements kept. ` : ''}Pending and not-measurable statements are not counted.
						</span>
					</p>
					<ul class="cp-guidance">
						{#each data.guidance as g (g.id)}
							<li class="cp-g">
								<div class="cp-checkhead">
									<StatusBadge status={g.status} />
									<strong>{g.label}</strong>
									<span class="cp-meta">said on the {quarterLabel(g.quarter)} call</span>
								</div>
								<p class="cp-detail">
									{g.target == null ? g.period : `Target: ${describeTarget(g)}`}.
									{g.statusReason}
								</p>
								<blockquote class="cp-quote">{g.quote}{g.page ? ` (page ${g.page})` : ''}</blockquote>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<div class="cp-block" data-testid="calls">
				<h3>Calls</h3>
				{#if data.calls.length === 0}
					<p class="sm-hint">No results or transcripts are stored for this company.</p>
				{/if}
				<ul class="cp-calls">
					{#each data.calls as r (r.key)}
						<li class="cp-call">
							<div class="cp-checkhead">
								<strong>{quarterLabel(r.quarter)}</strong>
								{#if r.quality}<StatusBadge status={r.quality.verdict} />{/if}
								{#if r.analysed && r.sentiment != null}
									<span class="cp-meta">Sentiment {signed(r.sentiment)}, {r.tone}</span>
								{:else if r.hasTranscript}
									<span class="cp-meta">Transcript not analysed</span>
								{:else}
									<span class="cp-meta">No transcript stored</span>
								{/if}
								{#if r.congratulations != null}<span class="cp-meta">{r.congratulations} congratulations</span>{/if}
							</div>
							{#if r.quality}
								<p class="cp-detail">
									{#each r.quality.metrics as m, i (m.name)}{i ? '; ' : ''}{m.name} {m.yoy == null ? 'n/a' : `${m.yoy.toFixed(0)}% YoY`}{m.trend == null ? '' : ` vs ${m.trend.toFixed(0)}% trend`}{/each}.
								</p>
							{/if}
							{#if r.analysed}
								<ul class="cp-points">
									{#each r.positives as p (p)}<li><span class="cp-up">Positive</span> {p}</li>{/each}
									{#each r.negatives as n (n)}<li><span class="cp-down">Negative</span> {n}</li>{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ul>
				{#if data.calls[0]?.next}
					<p class="cp-meta">Next: {data.calls[0].next.kind} on {formatMeetingDay(data.calls[0].next.date)}.</p>
				{/if}
				{#if data.tokens.input}
					<p class="cp-meta">Model use so far: {data.tokens.input.toLocaleString('en-IN')} input and {data.tokens.output.toLocaleString('en-IN')} output tokens.</p>
				{/if}
			</div>
		{/if}
	{/if}
</section>

<style>
	.cp {
		display: grid;
		gap: 0.8rem;
		border: var(--border-w) solid var(--ink);
		background: var(--bg);
		padding: 0.9rem 1rem;
		min-width: 0;
		box-shadow: var(--shadow-hard-sm);
	}
	.cp-head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: flex-start;
		justify-content: space-between;
	}
	.cp h2,
	.cp h3 {
		margin: 0;
	}
	.cp h2 {
		font-size: 1.1rem;
	}
	.cp h3 {
		font-size: 0.95rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		border-bottom: 2px solid var(--ink);
		padding-bottom: 0.25rem;
	}
	.cp-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.cp-actions :global(.sm-btn) {
		min-height: 2.75rem;
		white-space: normal;
	}
	.cp-status {
		margin: 0;
	}
	.cp-block {
		display: grid;
		gap: 0.6rem;
		min-width: 0;
	}
	.cp-meta {
		margin: 0;
		font-size: 0.78rem;
		color: var(--muted);
	}
	.cp-score {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.7rem;
		margin: 0;
	}
	.cp-num {
		font: 700 1.4rem/1.1 var(--font-mono, monospace);
	}
	.cp-meter {
		height: 0.7rem;
		border: 2px solid var(--ink);
		background: var(--bg);
	}
	.cp-meter span {
		display: block;
		height: 100%;
		background: var(--danger);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.cp-checks,
	.cp-guidance,
	.cp-calls {
		display: grid;
		gap: 0.6rem;
	}
	.cp-check,
	.cp-g,
	.cp-call {
		border: 2px solid var(--ink);
		padding: 0.6rem 0.75rem;
		display: grid;
		gap: 0.3rem;
		min-width: 0;
	}
	.cp-checkhead {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.6rem;
	}
	.cp-detail {
		margin: 0;
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}
	.cp-rule {
		margin: 0.3rem 0;
		font-size: 0.8rem;
		color: var(--muted);
	}
	summary {
		cursor: pointer;
		min-height: 2.75rem;
		display: flex;
		align-items: center;
		font-weight: 600;
		font-size: 0.85rem;
	}
	.cp-inputs {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 0.15rem 0.8rem;
		margin: 0;
		font-size: 0.82rem;
	}
	.cp-inputs dt {
		overflow-wrap: anywhere;
	}
	.cp-inputs dd {
		margin: 0;
		font-family: var(--font-mono, monospace);
		text-align: right;
	}
	.cp-quote {
		margin: 0;
		padding: 0.3rem 0.6rem;
		border-left: 4px solid var(--ink);
		font-size: 0.82rem;
		color: var(--muted);
		overflow-wrap: anywhere;
	}
	.cp-points {
		display: grid;
		gap: 0.2rem;
		font-size: 0.85rem;
	}
	.cp-up,
	.cp-down {
		font: 700 0.65rem/1 var(--font-display, inherit);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-right: 0.3rem;
	}
	.cp-up {
		color: var(--good);
	}
	.cp-down {
		color: var(--danger);
	}
</style>
