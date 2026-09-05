<script lang="ts">
	// Needed now that page data comes from load() functions (see +page.ts
	// files) - a failed load() throws here instead of being caught inline by
	// the old onMount try/catch, so this boundary is what a user actually
	// sees on a fetch failure during navigation.
	import { page } from '$app/state';
</script>

<div class="max-w-md mx-auto mt-16 rounded-xl border border-border bg-surface p-6 text-center">
	<div class="text-sm text-muted-fg">Error {page.status}</div>
	<h1 class="text-lg font-semibold mt-1">{page.error?.message ?? 'Something went wrong'}</h1>
	<a href="/" class="inline-block mt-4 text-sm px-3 py-1.5 rounded-md bg-fg text-bg hover:brightness-90">Back to Companies</a>
</div>
