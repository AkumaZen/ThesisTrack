<script lang="ts">
	import '$lib/valuation/styles/dashboard.css';

	let { children } = $props();
</script>

<!-- The valuation tools' stylesheet is scoped to .vd so it can never restyle thesis pages. -->
<div class="vd">
	{@render children()}
</div>
