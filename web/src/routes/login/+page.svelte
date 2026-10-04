<script lang="ts">
	import '$lib/styles/dashboard.css';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Sign in · Valuation Dashboard</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Valuation Dashboard</h1>
		<div class="sub">Sign in to continue</div>
	</div>
</div>

<div class="wrap">
	<form class="auth-card" method="POST" aria-labelledby="signin-title">
		<h2 id="signin-title" class="auth-title">Sign in</h2>

		{#if form?.error}
			<p class="sm-msg sm-msg-error" role="alert" data-testid="login-error">{form.error}</p>
		{/if}

		<label class="auth-label" for="username">Username</label>
		<input
			class="sm-input auth-input"
			id="username"
			name="username"
			autocomplete="username"
			autocapitalize="none"
			spellcheck="false"
			value={form?.username ?? ''}
			required
		/>

		<label class="auth-label" for="password">Password</label>
		<input
			class="sm-input auth-input"
			id="password"
			name="password"
			type="password"
			autocomplete="current-password"
			required
		/>

		<input type="hidden" name="next" value={data.next} />
		<button class="sm-btn sm-btn-primary auth-submit" type="submit">Sign in</button>
	</form>
</div>
