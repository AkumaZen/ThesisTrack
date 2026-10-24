<script lang="ts">
	import GuestPromptCard from '$lib/components/shell/GuestPromptCard.svelte';

	let { data } = $props();

	// Back to wherever the guest came from; straight to the showcase when there is nowhere to go back.
	function back() {
		if (history.length > 1) history.back();
		else location.assign('/');
	}
</script>

<svelte:head><title>Members only · ThesisTrack</title></svelte:head>

<GuestPromptCard
	title="This page is for signed-in members."
	body="Thanks for exploring! Sign in to open it, or head back and keep looking around the guest preview."
	next={data.next}
>
	<button type="button" class="btn" onclick={back}>Back</button>
</GuestPromptCard>
