<script lang="ts">
	import '$lib/styles/dashboard.css';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { sectorApi } from '$lib/sectorClient';
	import type { UserRow } from '$lib/auth';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let newUsername = $state('');
	let newRole = $state<'member' | 'admin'>('member');
	let newPassword = $state('');
	let busy = $state<string | null>(null);
	let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);
	// The temporary password is shown once, right after create/reset, and never retrievable again.
	let revealed = $state<{ username: string; password: string } | null>(null);
	let confirmRemove = $state<number | null>(null);
	let confirmReset = $state<number | null>(null);

	function when(ts: number) {
		return new Date(ts).toLocaleDateString('en-IN', {
			day: '2-digit',
			month: 'short',
			year: 'numeric'
		});
	}

	async function addUser() {
		busy = 'add';
		message = null;
		revealed = null;
		const res = await sectorApi<{ user: UserRow; temporaryPassword: string }>(
			'POST',
			'/api/admin/users',
			{ username: newUsername, role: newRole, password: newPassword || undefined }
		);
		busy = null;
		if (!res.ok) {
			message = { kind: 'error', text: res.message };
			return;
		}
		revealed = { username: res.data.user.username, password: res.data.temporaryPassword };
		message = { kind: 'ok', text: `Added ${res.data.user.username}.` };
		newUsername = newPassword = '';
		newRole = 'member';
		await invalidateAll();
	}

	async function reset(u: UserRow) {
		busy = `reset-${u.id}`;
		message = null;
		revealed = null;
		const res = await sectorApi<{ user: UserRow; temporaryPassword: string }>(
			'POST',
			`/api/admin/users/${u.id}/reset-password`,
			{}
		);
		busy = null;
		confirmReset = null;
		if (!res.ok) {
			message = { kind: 'error', text: res.message };
			return;
		}
		revealed = { username: u.username, password: res.data.temporaryPassword };
		message = { kind: 'ok', text: `Reset ${u.username}'s password and signed them out.` };
		await invalidateAll();
	}

	async function remove(u: UserRow) {
		busy = `remove-${u.id}`;
		message = null;
		revealed = null;
		const res = await sectorApi('DELETE', `/api/admin/users/${u.id}`);
		busy = null;
		confirmRemove = null;
		if (!res.ok) {
			message = { kind: 'error', text: res.message };
			return;
		}
		message = { kind: 'ok', text: `Removed ${u.username}. They were signed out immediately.` };
		await invalidateAll();
	}
</script>

<svelte:head>
	<title>Users · Valuation Dashboard</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<a class="back-link" href={resolve('/')}>&larr; Back to search</a>
		<h1>Users</h1>
		<div class="sub">
			Add or remove the people who can use this dashboard. Only admins see this page.
		</div>
	</div>
</div>

<div class="wrap">
	<form
		class="sm-toolbar admin-add"
		aria-label="Add a user"
		onsubmit={(e) => {
			e.preventDefault();
			addUser();
		}}
	>
		<input
			class="sm-input"
			aria-label="New username"
			placeholder="Username, e.g. First.Last"
			autocapitalize="none"
			spellcheck="false"
			maxlength="32"
			bind:value={newUsername}
			disabled={busy === 'add'}
		/>
		<select class="sm-input" aria-label="Role" bind:value={newRole} disabled={busy === 'add'}>
			<option value="member">Member</option>
			<option value="admin">Admin</option>
		</select>
		<input
			class="sm-input"
			aria-label="Temporary password (optional)"
			placeholder="Temporary password (blank = generate)"
			autocomplete="off"
			bind:value={newPassword}
			disabled={busy === 'add'}
		/>
		<button
			class="sm-btn sm-btn-primary"
			type="submit"
			disabled={busy === 'add' || !newUsername.trim()}
		>
			{busy === 'add' ? 'Adding…' : 'Add user'}
		</button>
	</form>

	{#if message}
		<p class="sm-msg sm-msg-{message.kind} sm-status" role="status">{message.text}</p>
	{/if}

	{#if revealed}
		<div class="admin-reveal" role="status" data-testid="temp-password">
			<strong>Temporary password for {revealed.username}:</strong>
			<code data-testid="temp-password-value">{revealed.password}</code>
			<span class="sm-hint">
				Shown once - share it with them now. They'll be asked to choose their own at first sign-in.
			</span>
		</div>
	{/if}

	<div class="table-scroll" style="margin-top:16px">
		<table class="admin-table">
			<thead>
				<tr>
					<th class="left">User</th>
					<th class="left">Role</th>
					<th class="left">Added</th>
					<th class="left">Status</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.users as u (u.id)}
					<tr data-user={u.username}>
						<td class="left"><strong>{u.username}</strong></td>
						<td class="left">
							<span class="al-type" class:al-type-sector_rotation={u.role === 'admin'}
								>{u.role}</span
							>
						</td>
						<td class="left">{when(u.createdAt)}</td>
						<td class="left">
							{#if u.mustChangePassword}
								<span class="signal-warn">Temporary password</span>
							{:else}
								Active
							{/if}
						</td>
						<td class="left">
							<div class="admin-actions">
								{#if u.id === data.user?.id}
									<span class="sm-hint">You</span>
								{:else}
									{#if confirmReset === u.id}
										<span class="sm-confirm">
											Reset and sign out?
											<button
												class="sm-btn sm-btn-danger"
												type="button"
												disabled={busy === `reset-${u.id}`}
												onclick={() => reset(u)}>Yes, reset</button
											>
											<button class="sm-btn" type="button" onclick={() => (confirmReset = null)}
												>Cancel</button
											>
										</span>
									{:else if confirmRemove === u.id}
										<span class="sm-confirm">
											Remove this user?
											<button
												class="sm-btn sm-btn-danger"
												type="button"
												disabled={busy === `remove-${u.id}`}
												onclick={() => remove(u)}>Yes, remove</button
											>
											<button class="sm-btn" type="button" onclick={() => (confirmRemove = null)}
												>Cancel</button
											>
										</span>
									{:else}
										<button
											class="sm-btn"
											type="button"
											onclick={() => ((confirmReset = u.id), (confirmRemove = null))}
											>Reset password</button
										>
										<button
											class="sm-btn sm-btn-quiet-danger"
											type="button"
											onclick={() => ((confirmRemove = u.id), (confirmReset = null))}>Remove</button
										>
									{/if}
								{/if}
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
