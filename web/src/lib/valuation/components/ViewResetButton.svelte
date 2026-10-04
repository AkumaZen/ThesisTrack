<script lang="ts">
	// "Reset this view": forgets the remembered sort, period, panels and scroll position of the
	// page it sits on and puts the defaults back.
	let { onReset, extraClass = '' }: { onReset: () => void; extraClass?: string } = $props();
</script>

<button type="button" class="vm-reset {extraClass}" data-testid="reset-view" onclick={onReset}
	>Reset this view</button
>
