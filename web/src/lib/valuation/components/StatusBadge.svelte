<script lang="ts">
	// A status word in a .tag. The word always says it; colour only reinforces.
	const TONE: Record<string, string> = {
		beat: 'tag-good', kept: 'tag-good', pass: 'tag-good', clean: 'tag-good',
		miss: 'tag-danger', missed: 'tag-danger', fail: 'tag-danger', high: 'tag-danger',
		watch: 'tag-warn'
	};
	const LABEL: Record<string, string> = {
		beat: 'Beat', 'in-line': 'In line', miss: 'Miss', 'n/a': 'n/a', kept: 'Kept', missed: 'Missed', pending: 'Pending',
		unverified: 'Not measurable', pass: 'Pass', fail: 'Fail', na: 'No data', clean: 'Clean', watch: 'Watch', high: 'High', insufficient: 'Not enough data'
	};
	let { status }: { status: string } = $props();
</script>

<span class="tag {TONE[status] ?? ''}">{LABEL[status] ?? status}</span>
