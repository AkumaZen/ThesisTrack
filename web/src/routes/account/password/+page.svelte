<script lang="ts">
	import '$lib/styles/dashboard.css';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { sectorApi } from '$lib/sectorClient';
	import { MIN_PASSWORD_LENGTH } from '$lib/auth';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let busy = $state(false);
	let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

	const mismatch = $derived(confirmPassword !== '' && newPassword !== confirmPassword);

	async function submit() {
		message = null;
		if (newPassword !== confirmPassword) {
			message = { kind: 'error', text: 'The new passwords do not match.' };
			return;
		}
		busy = true;
		const res = await sectorApi('POST', '/api/account/password', { currentPassword, newPassword });
		busy = false;
		if (!res.ok) {
			message = { kind: 'error', text: res.message };
			return;
		}
		currentPassword = newPassword = confirmPassword = '';
		message = { kind: 'ok', text: 'Password changed. Other devices were signed out.' };
		// Leave the forced-change screen once the temporary password has been replaced.
		if (data.user?.mustChangePassword) await goto(resolve('/'), { invalidateAll: true });
	}
</script>

<svelte:head>
	<title>Change password · Valuation Dashboard</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		{#if !data.user?.mustChangePassword}
			<a class="back-link" href={resolve('/')}>&larr; Back to search</a>
		{/if}
		<h1>Change password</h1>
		<div class="sub">Signed in as {data.user?.username}</div>
	</div>
</div>

<div class="wrap">
	<form
		class="auth-card"
		aria-labelledby="pw-title"
		onsubmit={(e) => {
			e.preventDefault();
			submit();
		}}
	>
		<h2 id="pw-title" class="auth-title">Choose a new password</h2>
		{#if data.user?.mustChangePassword}
			<p class="sm-msg sm-msg-warn" data-testid="must-change">
				Your password is temporary. Choose your own to continue.
			</p>
		{/if}
		{#if message}
			<p class="sm-msg sm-msg-{message.kind}" role="status">{message.text}</p>
		{/if}

		<label class="auth-label" for="current">Current password</label>
		<input
			class="sm-input auth-input"
			id="current"
			type="password"
			autocomplete="current-password"
			bind:value={currentPassword}
			required
		/>

		<label class="auth-label" for="new">New password</label>
		<input
			class="sm-input auth-input"
			id="new"
			type="password"
			autocomplete="new-password"
			minlength={MIN_PASSWORD_LENGTH}
			bind:value={newPassword}
			required
		/>
		<p class="sm-hint">At least {MIN_PASSWORD_LENGTH} characters.</p>

		<label class="auth-label" for="confirm">Confirm new password</label>
		<input
			class="sm-input auth-input"
			id="confirm"
			type="password"
			autocomplete="new-password"
			bind:value={confirmPassword}
			aria-invalid={mismatch}
			required
		/>
		{#if mismatch}<p class="sm-hint signal-bad">Passwords don't match yet.</p>{/if}

		<button
			class="sm-btn sm-btn-primary auth-submit"
			type="submit"
			disabled={busy || !currentPassword || !newPassword || mismatch}
		>
			{busy ? 'Saving…' : 'Change password'}
		</button>
	</form>
</div>
