<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import AuthFrame from '$lib/components/shell/AuthFrame.svelte';
	import { onMount } from 'svelte';
	import { clearSessionState } from '$lib/viewMemory';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let showPassword = $state(false);
	let submitting = $state(false);

	// Reaching the sign-in page (signed out, or the session ran out) leaves no one's temporary
	// browsing state behind for the next person to sign in.
	onMount(() => clearSessionState());
</script>

<svelte:head>
	<title>Sign in · ThesisTrack</title>
</svelte:head>

<AuthFrame title="Sign in" subtitle="Theses, valuations and sector rotation in one place.">
	<form method="POST" class="auth-form" onsubmit={() => (submitting = true)} aria-labelledby="auth-title">
		{#if form?.error}
			<p class="notice notice-error" role="alert" data-testid="login-error">{form.error}</p>
		{/if}

		<div class="field">
			<label class="field-label" for="email">Email</label>
			<input
				class="input"
				id="email"
				name="email"
				type="email"
				autocomplete="username"
				autocapitalize="none"
				spellcheck="false"
				value={form?.email ?? ''}
				required
			/>
		</div>

		<div class="field">
			<label class="field-label" for="password">Password</label>
			<div class="pw">
				<input
					class="input"
					id="password"
					name="password"
					type={showPassword ? 'text' : 'password'}
					autocomplete="current-password"
					required
				/>
				<button
					type="button"
					class="pw-toggle"
					onclick={() => (showPassword = !showPassword)}
					aria-label={showPassword ? 'Hide password' : 'Show password'}
					aria-pressed={showPassword}
				>
					{showPassword ? 'Hide' : 'Show'}
				</button>
			</div>
		</div>

		<input type="hidden" name="next" value={data.next} />
		<button class="btn btn-primary btn-block" type="submit" disabled={submitting}>
			{submitting ? 'Signing in…' : 'Sign in'}
		</button>
	</form>
</AuthFrame>

<style>
	.auth-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.pw {
		position: relative;
	}
	.pw .input {
		padding-right: 64px;
	}
	.pw-toggle {
		position: absolute;
		right: 4px;
		top: 50%;
		transform: translateY(-50%);
		height: 32px;
		padding: 0 var(--space-2);
		font-family: var(--font-mono);
		font-size: 0.75rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink);
		background: transparent;
		border: 0;
	}
	.pw-toggle:hover {
		background: var(--surface);
	}
</style>
