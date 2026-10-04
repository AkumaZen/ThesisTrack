<script lang="ts">
	import { goto } from '$app/navigation';
	import { MIN_PASSWORD_LENGTH } from '$lib/auth';
	import AuthFrame from '$lib/components/shell/AuthFrame.svelte';
	import PageHeader from '$lib/components/shell/PageHeader.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let busy = $state(false);
	let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

	const forced = $derived(data.user?.mustChangePassword ?? false);
	const mismatch = $derived(confirmPassword !== '' && newPassword !== confirmPassword);
	const tooShort = $derived(newPassword !== '' && newPassword.length < MIN_PASSWORD_LENGTH);

	async function submit() {
		message = null;
		if (newPassword !== confirmPassword) {
			message = { kind: 'error', text: 'The new passwords do not match.' };
			return;
		}
		busy = true;
		try {
			const res = await fetch('/api/account/password', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ currentPassword, newPassword })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				message = { kind: 'error', text: body.message ?? 'Could not change the password.' };
				return;
			}
		} catch {
			message = { kind: 'error', text: 'Could not reach the server. Try again.' };
			return;
		} finally {
			busy = false;
		}
		currentPassword = newPassword = confirmPassword = '';
		message = { kind: 'ok', text: 'Password changed. Other devices were signed out.' };
		// Leave the forced-change screen once the temporary password has been replaced.
		if (forced) await goto('/', { invalidateAll: true });
	}
</script>

<svelte:head>
	<title>Change password · ThesisTrack</title>
</svelte:head>

{#snippet passwordForm()}
	<form
		class="pw-form"
		onsubmit={(e) => {
			e.preventDefault();
			submit();
		}}
	>
		{#if forced}
			<p class="notice notice-warn" data-testid="must-change">
				Your password is temporary. Choose your own to continue.
			</p>
		{/if}
		{#if message}
			<p class="notice notice-{message.kind}" role={message.kind === 'error' ? 'alert' : 'status'}>
				{message.text}
			</p>
		{/if}

		<div class="field">
			<label class="field-label" for="current">Current password</label>
			<input
				class="input"
				id="current"
				type="password"
				autocomplete="current-password"
				bind:value={currentPassword}
				required
			/>
		</div>
		<div class="field">
			<label class="field-label" for="new">New password</label>
			<input
				class="input"
				id="new"
				type="password"
				autocomplete="new-password"
				minlength={MIN_PASSWORD_LENGTH}
				bind:value={newPassword}
				aria-invalid={tooShort}
				aria-describedby="new-hint"
				required
			/>
			<span class="field-hint" class:field-error={tooShort} id="new-hint"
				>At least {MIN_PASSWORD_LENGTH} characters.</span
			>
		</div>
		<div class="field">
			<label class="field-label" for="confirm">Confirm new password</label>
			<input
				class="input"
				id="confirm"
				type="password"
				autocomplete="new-password"
				bind:value={confirmPassword}
				aria-invalid={mismatch}
				required
			/>
			{#if mismatch}<span class="field-error">Passwords don't match yet.</span>{/if}
		</div>

		<div class="pw-actions">
			<button
				class="btn btn-primary"
				class:btn-block={forced}
				type="submit"
				disabled={busy || !currentPassword || !newPassword || mismatch || tooShort}
			>
				{busy ? 'Saving…' : 'Change password'}
			</button>
		</div>
	</form>
	{#if forced}
		<form method="POST" action="/logout" class="signout">
			<button type="submit" class="btn btn-ghost btn-sm">Sign out instead</button>
		</form>
	{/if}
{/snippet}

{#if forced}
	<AuthFrame title="Choose a password" subtitle="Signed in as {data.user?.email}">
		{@render passwordForm()}
	</AuthFrame>
{:else}
	<PageHeader title="Change password" subtitle="Signed in as {data.user?.email}" />
	<div class="pw-card card">
		{@render passwordForm()}
	</div>
{/if}

<style>
	.pw-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.pw-card {
		max-width: 480px;
		padding: var(--space-4);
	}
	.pw-actions {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}
	.signout {
		display: flex;
		justify-content: center;
		margin-top: var(--space-3);
	}
</style>
