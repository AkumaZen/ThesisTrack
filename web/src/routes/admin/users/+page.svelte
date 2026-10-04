<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { ROLES, ROLE_LABELS, displayNameFromEmail, type Role, type UserRow } from '$lib/auth';
	import PageHeader from '$lib/components/shell/PageHeader.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let newEmail = $state('');
	let newName = $state('');
	let newRole = $state<Role>('read_write');
	let newPassword = $state('');
	let busy = $state<string | null>(null);
	let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
	// The temporary password is shown once, right after create/reset, and never retrievable again.
	let revealed = $state<{ who: string; password: string } | null>(null);
	let confirmRemove = $state<number | null>(null);
	let confirmReset = $state<number | null>(null);
	let copied = $state(false);

	const namePlaceholder = $derived(newEmail.includes('@') ? displayNameFromEmail(newEmail) : 'First.Last');

	const ROLE_HELP: Record<Role, string> = {
		admin: 'Everything, plus team, sector baskets and shared settings',
		read_write: 'Write theses and valuations',
		read_only: 'View everything, change nothing'
	};

	function when(ts: number | null) {
		if (!ts) return 'Never';
		return new Date(ts).toLocaleDateString('en-IN', {
			day: '2-digit',
			month: 'short',
			year: 'numeric'
		});
	}

	async function call<T>(method: string, url: string, body?: unknown): Promise<T | null> {
		try {
			const res = await fetch(url, {
				method,
				headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
				body: body !== undefined ? JSON.stringify(body) : undefined
			});
			const json = await res.json().catch(() => ({}));
			if (!res.ok) {
				message = { kind: 'error', text: json.message ?? `Request failed (${res.status}).` };
				return null;
			}
			return json as T;
		} catch {
			message = { kind: 'error', text: 'Could not reach the server. Try again.' };
			return null;
		}
	}

	async function addUser() {
		busy = 'add';
		message = null;
		revealed = null;
		const res = await call<{ user: UserRow; temporaryPassword: string }>('POST', '/api/admin/users', {
			email: newEmail,
			displayName: newName || undefined,
			role: newRole,
			password: newPassword || undefined
		});
		busy = null;
		if (!res) return;
		revealed = { who: res.user.email, password: res.temporaryPassword };
		message = { kind: 'ok', text: `Added ${res.user.username}.` };
		newEmail = newName = newPassword = '';
		newRole = 'read_write';
		await invalidateAll();
	}

	async function changeRole(u: UserRow, role: Role) {
		busy = `role-${u.id}`;
		message = null;
		const res = await call<UserRow>('PATCH', `/api/admin/users/${u.id}`, { role });
		busy = null;
		if (res) message = { kind: 'ok', text: `${u.username} is now ${ROLE_LABELS[role]}.` };
		await invalidateAll();
	}

	async function reset(u: UserRow) {
		busy = `reset-${u.id}`;
		message = null;
		revealed = null;
		const res = await call<{ temporaryPassword: string }>(
			'POST',
			`/api/admin/users/${u.id}/reset-password`,
			{}
		);
		busy = null;
		confirmReset = null;
		if (!res) return;
		revealed = { who: u.email, password: res.temporaryPassword };
		message = { kind: 'ok', text: `Reset ${u.username}'s password and signed them out.` };
		await invalidateAll();
	}

	async function remove(u: UserRow) {
		busy = `remove-${u.id}`;
		message = null;
		revealed = null;
		const res = await call('DELETE', `/api/admin/users/${u.id}`);
		busy = null;
		confirmRemove = null;
		if (!res) return;
		message = { kind: 'ok', text: `Removed ${u.username}. They were signed out immediately.` };
		await invalidateAll();
	}

	async function copy() {
		if (!revealed) return;
		try {
			await navigator.clipboard.writeText(revealed.password);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			/* clipboard blocked - the password is still on screen */
		}
	}
</script>

<svelte:head>
	<title>Team and access · ThesisTrack</title>
</svelte:head>

<PageHeader
	title="Team and access"
	subtitle="Who can sign in, and what they can change. One account covers theses and valuations."
/>

<section class="card add-card" aria-labelledby="add-title">
	<h2 id="add-title">Add a person</h2>
	<form
		class="add-grid"
		onsubmit={(e) => {
			e.preventDefault();
			addUser();
		}}
	>
		<div class="field">
			<label class="field-label" for="new-email">Email</label>
			<input
				id="new-email"
				class="input"
				type="email"
				autocapitalize="none"
				spellcheck="false"
				placeholder="first.last@rdc.in"
				bind:value={newEmail}
				disabled={busy === 'add'}
				required
			/>
		</div>
		<div class="field">
			<label class="field-label" for="new-name">Display name</label>
			<input
				id="new-name"
				class="input"
				placeholder={namePlaceholder}
				bind:value={newName}
				disabled={busy === 'add'}
			/>
		</div>
		<div class="field">
			<label class="field-label" for="new-role">Role</label>
			<select id="new-role" class="input" bind:value={newRole} disabled={busy === 'add'}>
				{#each ROLES as r (r)}<option value={r}>{ROLE_LABELS[r]}</option>{/each}
			</select>
		</div>
		<div class="field">
			<label class="field-label" for="new-password">Temporary password</label>
			<input
				id="new-password"
				class="input"
				placeholder="Blank = generate one"
				autocomplete="off"
				bind:value={newPassword}
				disabled={busy === 'add'}
			/>
		</div>
		<button class="btn btn-primary add-submit" type="submit" disabled={busy === 'add' || !newEmail.trim()}>
			{busy === 'add' ? 'Adding…' : 'Add person'}
		</button>
	</form>
	<p class="field-hint role-help">{ROLE_HELP[newRole]}.</p>
</section>

{#if message}
	<p class="notice notice-{message.kind} msg" role={message.kind === 'error' ? 'alert' : 'status'}>
		{message.text}
	</p>
{/if}

{#if revealed}
	<div class="reveal card card-raised" role="status" data-testid="temp-password">
		<div>
			<div class="eyebrow">Temporary password for {revealed.who}</div>
			<code class="reveal-value num" data-testid="temp-password-value">{revealed.password}</code>
			<p class="field-hint">Shown once. Share it now; they choose their own at first sign-in.</p>
		</div>
		<button class="btn btn-sm" type="button" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
	</div>
{/if}

<div class="table-wrap card">
	<table class="team">
		<thead>
			<tr>
				<th scope="col">Person</th>
				<th scope="col">Role</th>
				<th scope="col">Last sign-in</th>
				<th scope="col">Status</th>
				<th scope="col"><span class="sr-only">Actions</span></th>
			</tr>
		</thead>
		<tbody>
			{#each data.users as u (u.id)}
				{@const me = u.id === data.user?.id}
				<tr data-user={u.username}>
					<td>
						<div class="who">{u.username}{#if me}<span class="tag">You</span>{/if}</div>
						<div class="email num">{u.email}</div>
					</td>
					<td>
						<label class="sr-only" for="role-{u.id}">Role for {u.username}</label>
						<select
							id="role-{u.id}"
							class="input role-select"
							value={u.role}
							disabled={me || busy === `role-${u.id}`}
							onchange={(e) => changeRole(u, (e.currentTarget as HTMLSelectElement).value as Role)}
						>
							{#each ROLES as r (r)}<option value={r}>{ROLE_LABELS[r]}</option>{/each}
						</select>
					</td>
					<td class="num muted">{when(u.lastLoginAt)}</td>
					<td>
						{#if u.mustChangePassword}
							<span class="status status-warn">Temporary password</span>
						{:else}
							<span class="status">Active</span>
						{/if}
					</td>
					<td class="actions">
						{#if !me}
							{#if confirmReset === u.id}
								<span class="confirm">
									Reset and sign out?
									<button
										class="btn btn-sm btn-danger"
										type="button"
										disabled={busy === `reset-${u.id}`}
										onclick={() => reset(u)}>Reset</button
									>
									<button class="btn btn-sm btn-ghost" type="button" onclick={() => (confirmReset = null)}
										>Cancel</button
									>
								</span>
							{:else if confirmRemove === u.id}
								<span class="confirm">
									Remove {u.username}?
									<button
										class="btn btn-sm btn-danger"
										type="button"
										disabled={busy === `remove-${u.id}`}
										onclick={() => remove(u)}>Remove</button
									>
									<button class="btn btn-sm btn-ghost" type="button" onclick={() => (confirmRemove = null)}
										>Cancel</button
									>
								</span>
							{:else}
								<button
									class="btn btn-sm"
									type="button"
									onclick={() => ((confirmReset = u.id), (confirmRemove = null))}>Reset password</button
								>
								<button
									class="btn btn-sm btn-ghost btn-danger"
									type="button"
									onclick={() => ((confirmRemove = u.id), (confirmReset = null))}>Remove</button
								>
							{/if}
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.add-card {
		padding: var(--space-4);
		margin-bottom: var(--space-4);
	}
	h2 {
		font-size: 1.0625rem;
		font-weight: 700;
		margin-bottom: var(--space-3);
	}
	.add-grid {
		display: grid;
		grid-template-columns: 1.4fr 1fr 0.9fr 1fr auto;
		gap: var(--space-3);
		align-items: end;
	}
	.role-help {
		margin-top: var(--space-2);
	}
	.msg {
		margin-bottom: var(--space-3);
	}
	.reveal {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		margin-bottom: var(--space-4);
		background: var(--accent-soft);
	}
	.reveal-value {
		display: block;
		margin: var(--space-1) 0;
		font-size: 1.25rem;
		font-weight: 600;
	}
	.table-wrap {
		overflow-x: auto;
	}
	.team {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}
	.team th {
		text-align: left;
		padding: var(--space-2) var(--space-3);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
		background: var(--surface);
		border-bottom: var(--border-w) solid var(--ink);
		white-space: nowrap;
	}
	.team td {
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--rule);
		vertical-align: middle;
	}
	.team tbody tr:last-child td {
		border-bottom: 0;
	}
	.who {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-weight: 600;
	}
	.email {
		font-size: 0.75rem;
		color: var(--muted);
	}
	.muted {
		color: var(--muted);
		white-space: nowrap;
	}
	.role-select {
		min-height: 32px;
		width: auto;
		min-width: 130px;
		font-size: 0.8125rem;
	}
	.status {
		font-size: 0.8125rem;
		font-weight: 600;
		white-space: nowrap;
	}
	.status::before {
		content: '';
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-right: 6px;
		background: var(--good);
		vertical-align: 1px;
	}
	.status-warn::before {
		background: var(--warn);
	}
	.actions {
		text-align: right;
		white-space: nowrap;
	}
	.actions .btn + .btn {
		margin-left: var(--space-1);
	}
	.confirm {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: 0.8125rem;
		font-weight: 600;
	}
	@media (max-width: 1000px) {
		.add-grid {
			grid-template-columns: 1fr 1fr;
		}
		.add-submit {
			grid-column: 1 / -1;
			justify-self: start;
		}
	}
	@media (max-width: 560px) {
		.add-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
