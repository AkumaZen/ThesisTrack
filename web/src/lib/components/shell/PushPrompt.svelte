<script lang="ts">
	import { onMount } from 'svelte';
	import { enablePush, pushConfig, pushSupported, syncSubscription } from '$lib/push';

	let { userId }: { userId: number } = $props();

	const dismissKey = $derived(`tt_push_prompt_dismissed_${userId}`);
	let show = $state(false);
	let busy = $state(false);
	let message = $state('');

	onMount(async () => {
		if (!pushSupported()) return;
		if (Notification.permission === 'granted') {
			void syncSubscription();
			return;
		}
		if (Notification.permission !== 'default' || localStorage.getItem(dismissKey)) return;
		show = (await pushConfig()).configured;
	});

	async function allow() {
		busy = true;
		const result = await enablePush();
		busy = false;
		if (result.ok) show = false;
		else message = result.message;
	}

	function dismiss() {
		localStorage.setItem(dismissKey, '1');
		show = false;
	}
</script>

{#if show}
	<div class="push-prompt" role="region" aria-label="Notifications" data-testid="push-prompt">
		<p>
			<strong>Get alerts on this device for companies you track.</strong>
			{#if message}<span class="msg">{message}</span>{/if}
		</p>
		<div class="actions">
			<button type="button" class="allow" onclick={allow} disabled={busy}>
				{busy ? 'Asking...' : 'Allow notifications'}
			</button>
			<button type="button" class="later" onclick={dismiss}>Not now</button>
		</div>
	</div>
{/if}

<style>
	.push-prompt {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		padding: 0.6rem 1rem;
		background: var(--accent-soft);
		border-bottom: var(--border-w) solid var(--ink);
		font-size: 0.875rem;
	}
	p {
		margin: 0;
		min-width: 0;
	}
	.msg {
		display: block;
		color: var(--danger);
	}
	.actions {
		display: flex;
		gap: 0.5rem;
	}
	button {
		font: inherit;
		font-weight: 600;
		padding: 0.4rem 0.8rem;
		border: var(--border-w) solid var(--ink);
		cursor: pointer;
		min-height: 2.5rem;
	}
	.allow {
		background: var(--accent);
		color: var(--accent-ink);
		box-shadow: var(--shadow-sm);
	}
	.later {
		background: var(--bg);
		color: var(--ink);
	}
	button:disabled {
		opacity: 0.6;
		cursor: wait;
	}
</style>
