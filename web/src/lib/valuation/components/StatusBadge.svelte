<script lang="ts">
	// A status word in a bordered tag. The word always says it; colour only reinforces.
	const TONE: Record<string, 'good' | 'bad' | 'warn' | 'plain'> = {
		beat: 'good', kept: 'good', pass: 'good', clean: 'good',
		miss: 'bad', missed: 'bad', fail: 'bad', high: 'bad',
		watch: 'warn'
	};
	const LABEL: Record<string, string> = {
		beat: 'Beat', 'in-line': 'In line', miss: 'Miss', 'n/a': 'n/a', kept: 'Kept', missed: 'Missed', pending: 'Pending',
		unverified: 'Not measurable', pass: 'Pass', fail: 'Fail', na: 'No data', clean: 'Clean', watch: 'Watch', high: 'High', insufficient: 'Not enough data'
	};
	let { status }: { status: string } = $props();
</script>

<span class="badge {TONE[status] ?? 'plain'}">{LABEL[status] ?? status}</span>

<style>
	.badge {
		display: inline-block;
		padding: 0.05rem 0.45rem;
		border: 2px solid var(--ink);
		background: var(--bg);
		color: var(--ink);
		font: 700 0.72rem/1.4 var(--font-display, inherit);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		white-space: nowrap;
	}
	.good {
		background: var(--good-soft);
		color: var(--good);
		border-color: var(--good);
	}
	.bad {
		background: var(--danger-soft);
		color: var(--danger);
		border-color: var(--danger);
	}
	.warn {
		background: var(--warn-soft);
		color: var(--warn);
		border-color: var(--warn);
	}
</style>
