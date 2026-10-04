<script lang="ts">
	import { timeAgo } from '$lib/valuation/activity';
	import {
		REVIEW_STATUSES,
		REVIEW_STATUS_LABELS,
		noteProblem,
		statusIsStale,
		type CompanyNote,
		type CompanyTeamData,
		type CoverageInfo,
		type NoteKind,
		type ReviewStatus,
		type StatusInfo
	} from '$lib/valuation/team';
	import {
		restoreValuation,
		type ValuationContent,
		type ValuationVersionInfo
	} from '$lib/valuation/savedValuations';
	import { diffValuations } from '$lib/valuation/valuationDiff';

	interface Props {
		symbol: string;
		me: { id: number; username: string; role: string };
		inWatchlist: boolean;
		/** The valuation version currently loaded on the page (0 when not saved). */
		currentVersion: number;
		/** The content currently on screen, for "compare with current". */
		getCurrent: () => Pick<
			ValuationContent,
			'assumptions' | 'shares' | 'activeMethod' | 'activeScenario'
		>;
		/** Called after a version was restored, so the page reloads the valuation. */
		onRestored: () => Promise<void>;
		/** Kept in sync for the page header. */
		status?: StatusInfo | null;
		coverage?: CoverageInfo | null;
	}

	let {
		symbol,
		me,
		inWatchlist,
		currentVersion,
		getCurrent,
		onRestored,
		status = $bindable(null),
		coverage = $bindable(null)
	}: Props = $props();

	let tab = $state<'notes' | 'discussion' | 'history'>('notes');
	let team = $state<CompanyTeamData | null>(null);
	let loadError = $state<string | null>(null);

	const theses = $derived(team?.notes.filter((n) => n.kind === 'thesis') ?? []);
	const notes = $derived(team?.notes.filter((n) => n.kind === 'note') ?? []);
	const comments = $derived(team?.notes.filter((n) => n.kind === 'comment') ?? []);

	async function loadTeam(forSymbol: string) {
		loadError = null;
		try {
			const res = await fetch(`/api/valuation/company/${forSymbol}/team`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as CompanyTeamData;
			if (forSymbol !== symbol) return;
			team = data;
			status = data.status;
			coverage = data.coverage;
		} catch (e) {
			if (forSymbol === symbol) loadError = `Could not load team notes (${(e as Error).message}).`;
		}
	}

	// Reload whenever the page moves to another company (the component instance is reused).
	$effect(() => {
		const s = symbol;
		team = null;
		history = null;
		status = null;
		coverage = null;
		resetForms();
		void loadTeam(s);
	});

	function fullDate(at: number) {
		return new Date(at).toLocaleString('en-IN', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	async function send(method: string, url: string, body?: unknown): Promise<string | null> {
		try {
			const res = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body)
			});
			if (res.ok) return null;
			const data = (await res.json().catch(() => null)) as { message?: string } | null;
			return data?.message ?? `Failed (HTTP ${res.status}).`;
		} catch {
			return 'Network error - nothing was saved.';
		}
	}

	// --- Writing: thesis, notes, comments -------------------------------------------------------
	let drafts = $state<Record<NoteKind, string>>({ thesis: '', note: '', comment: '' });
	let editingThesis = $state(false);
	let busy = $state(false);
	let formError = $state<Record<string, string | null>>({});
	let editingId = $state<number | null>(null);
	let editText = $state('');
	let confirmDeleteId = $state<number | null>(null);

	function resetForms() {
		drafts = { thesis: '', note: '', comment: '' };
		editingThesis = false;
		formError = {};
		editingId = null;
		confirmDeleteId = null;
		statusDraft = null;
		statusComment = '';
	}

	async function addNote(kind: NoteKind) {
		const problem = noteProblem(drafts[kind]);
		if (problem) {
			formError[kind] = problem;
			return;
		}
		busy = true;
		const err = await send('POST', `/api/valuation/company/${symbol}/notes`, { kind, body: drafts[kind] });
		busy = false;
		formError[kind] = err;
		if (err) return;
		drafts[kind] = '';
		if (kind === 'thesis') editingThesis = false;
		await loadTeam(symbol);
	}

	function startThesisEdit() {
		drafts.thesis = theses[0]?.body ?? '';
		editingThesis = true;
	}

	async function saveEdit(note: CompanyNote) {
		const problem = noteProblem(editText);
		if (problem) {
			formError[`edit-${note.id}`] = problem;
			return;
		}
		busy = true;
		const err = await send('PATCH', `/api/valuation/notes/${note.id}`, { body: editText });
		busy = false;
		formError[`edit-${note.id}`] = err;
		if (err) return;
		editingId = null;
		await loadTeam(symbol);
	}

	async function remove(note: CompanyNote) {
		busy = true;
		const err = await send('DELETE', `/api/valuation/notes/${note.id}`);
		busy = false;
		confirmDeleteId = null;
		formError[`edit-${note.id}`] = err;
		if (!err) await loadTeam(symbol);
	}

	const canEdit = (n: CompanyNote) => n.author === me.username && n.kind !== 'thesis';
	const canDelete = (n: CompanyNote) => n.author === me.username || me.role === 'admin';

	// --- Review status ---------------------------------------------------------------------------
	let statusDraft = $state<ReviewStatus | null>(null);
	let statusComment = $state('');

	async function applyStatus() {
		if (!statusDraft) return;
		busy = true;
		const err = await send('PUT', `/api/valuation/company/${symbol}/status`, {
			status: statusDraft,
			atVersion: inWatchlist ? currentVersion : null,
			comment: statusComment
		});
		busy = false;
		formError.status = err;
		if (err) return;
		statusDraft = null;
		statusComment = '';
		await loadTeam(symbol);
	}

	// --- Coverage ---------------------------------------------------------------------------------
	async function assign(userId: number | null) {
		busy = true;
		const err = await send('PUT', `/api/valuation/company/${symbol}/coverage`, { userId });
		busy = false;
		formError.coverage = err;
		if (!err) await loadTeam(symbol);
	}

	// --- History ----------------------------------------------------------------------------------
	let history = $state<ValuationVersionInfo[] | null>(null);
	let historyError = $state<string | null>(null);
	let compare = $state<{ id: number; lines: string[] } | null>(null);
	let confirmRestoreId = $state<number | null>(null);
	let restoreMessage = $state<string | null>(null);

	async function loadHistory(forSymbol: string) {
		historyError = null;
		try {
			const res = await fetch(`/api/valuation/valuations/${forSymbol}/history`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as ValuationVersionInfo[];
			if (forSymbol === symbol) history = data;
		} catch (e) {
			if (forSymbol === symbol)
				historyError = `Could not load the history (${(e as Error).message}).`;
		}
	}

	// The history tab follows saves: each new version (including autosaves) refreshes it.
	$effect(() => {
		if (tab !== 'history') return;
		void currentVersion;
		void loadHistory(symbol);
	});

	async function showCompare(entry: ValuationVersionInfo) {
		if (compare?.id === entry.id) {
			compare = null;
			return;
		}
		const res = await fetch(`/api/valuation/valuations/${symbol}/history/${entry.id}`);
		if (!res.ok) {
			historyError = 'Could not load that version.';
			return;
		}
		const old = (await res.json()) as ValuationContent;
		compare = { id: entry.id, lines: diffValuations(getCurrent(), old) };
	}

	async function restore(entry: ValuationVersionInfo) {
		busy = true;
		const res = await restoreValuation(symbol, entry.id, inWatchlist ? currentVersion : 0);
		busy = false;
		confirmRestoreId = null;
		if (res.ok) {
			restoreMessage = `Version ${entry.version} is now the current valuation (saved as version ${res.version}).`;
			compare = null;
			await onRestored();
			await loadHistory(symbol);
		} else if (res.conflict) {
			restoreMessage =
				'Someone saved this valuation after you opened it. Reload the page to see their version before restoring.';
		} else {
			restoreMessage = `Not restored: ${res.message}`;
		}
	}

	const ACTION_LABEL = { save: 'Saved', delete: 'Removed from the watchlist', restore: 'Restored' };
</script>

<section class="team-panel" id="team" aria-labelledby="team-title" data-testid="team-panel">
	<div class="team-head">
		<h2 id="team-title">Team</h2>
		<div class="team-coverage" data-testid="coverage">
			{#if coverage}
				Covered by <strong>{coverage.username}</strong>
				{#if coverage.userId === me.id}
					<button class="link-btn" type="button" disabled={busy} onclick={() => assign(null)}
						>Stop covering</button
					>
				{/if}
			{:else}
				<span class="muted">No one covers this company yet.</span>
				<button
					class="link-btn"
					type="button"
					disabled={busy}
					data-testid="cover-me"
					onclick={() => assign(me.id)}>I'll cover it</button
				>
			{/if}
			{#if me.role === 'admin' && team}
				<label class="team-assign">
					<span class="sr-only">Assign coverage</span>
					<select
						aria-label="Assign coverage"
						value={coverage?.userId ?? ''}
						disabled={busy}
						onchange={(e) => {
							const v = (e.currentTarget as HTMLSelectElement).value;
							void assign(v === '' ? null : Number(v));
						}}
					>
						<option value="">Unassigned</option>
						{#each team.members as m (m.id)}
							<option value={m.id}>{m.username}</option>
						{/each}
					</select>
				</label>
			{/if}
			{#if formError.coverage}<span class="team-error" role="alert">{formError.coverage}</span>{/if}
		</div>
	</div>

	<div class="method-tabs team-tabs" role="tablist" aria-label="Team sections">
		<button
			role="tab"
			type="button"
			class:active={tab === 'notes'}
			aria-selected={tab === 'notes'}
			onclick={() => (tab = 'notes')}>Thesis &amp; notes ({notes.length})</button
		>
		<button
			role="tab"
			type="button"
			class:active={tab === 'discussion'}
			aria-selected={tab === 'discussion'}
			data-testid="tab-discussion"
			onclick={() => (tab = 'discussion')}>Discussion &amp; review ({comments.length})</button
		>
		<button
			role="tab"
			type="button"
			class:active={tab === 'history'}
			aria-selected={tab === 'history'}
			data-testid="tab-history"
			onclick={() => (tab = 'history')}>History</button
		>
	</div>

	{#if loadError}
		<p class="team-error" role="alert">
			{loadError}
			<button class="link-btn" type="button" onclick={() => loadTeam(symbol)}>Try again</button>
		</p>
	{:else if !team}
		<p class="muted">Loading…</p>
	{:else if tab === 'notes'}
		<div class="team-block" data-testid="thesis">
			<h3>Investment thesis</h3>
			{#if editingThesis}
				<label class="sr-only" for="thesis-input">Investment thesis</label>
				<textarea
					id="thesis-input"
					rows="6"
					bind:value={drafts.thesis}
					placeholder="Why we own (or would own) this: the drivers, what has to go right, what would make us wrong."
				></textarea>
				{#if formError.thesis}<p class="team-error" role="alert">{formError.thesis}</p>{/if}
				<div class="team-actions">
					<button
						class="wl-strip-btn btn-primary"
						type="button"
						disabled={busy}
						onclick={() => addNote('thesis')}>Save thesis</button
					>
					<button class="wl-strip-btn" type="button" onclick={() => (editingThesis = false)}
						>Cancel</button
					>
				</div>
				<p class="hint">Saving keeps the earlier thesis in its history below.</p>
			{:else if theses[0]}
				<div class="thesis-body">{theses[0].body}</div>
				<div class="note-meta">
					{theses[0].author} ·
					<span title={fullDate(theses[0].createdAt)}>{timeAgo(theses[0].createdAt)}</span>
				</div>
				<button class="wl-strip-btn" type="button" onclick={startThesisEdit}>Update thesis</button>
				{#if theses.length > 1}
					<details class="thesis-history">
						<summary>Earlier versions ({theses.length - 1})</summary>
						{#each theses.slice(1) as t (t.id)}
							<div class="note">
								<div class="thesis-body">{t.body}</div>
								<div class="note-meta">{t.author} · {fullDate(t.createdAt)}</div>
							</div>
						{/each}
					</details>
				{/if}
			{:else}
				<p class="muted">No thesis written yet.</p>
				<button
					class="wl-strip-btn"
					type="button"
					data-testid="write-thesis"
					onclick={startThesisEdit}>Write the thesis</button
				>
			{/if}
		</div>

		<div class="team-block">
			<h3>Research notes</h3>
			{@render composer(
				'note',
				'Add a note: a call, a channel check, a number to watch…',
				'Add note'
			)}
			{@render noteList(notes, 'No notes yet.')}
		</div>
	{:else if tab === 'discussion'}
		<div class="team-block" data-testid="review">
			<h3>Review status</h3>
			{#if status}
				<p>
					<span class="status-chip status-{status.status}" data-testid="status-chip"
						>{REVIEW_STATUS_LABELS[status.status]}</span
					>
					set by {status.setBy} ·
					<span title={fullDate(status.setAt)}>{timeAgo(status.setAt)}</span>
					{#if status.atVersion !== null}(on version {status.atVersion}){/if}
				</p>
				{#if statusIsStale(status, currentVersion)}
					<p class="team-warn" data-testid="status-stale">
						The valuation has changed since it was approved (now version {currentVersion}).
						Re-review it before relying on the approval.
					</p>
				{/if}
			{:else}
				<p class="muted">No status yet.</p>
			{/if}
			<div class="status-form">
				<label>
					<span>Change to</span>
					<select
						bind:value={statusDraft}
						aria-label="New review status"
						data-testid="status-select"
					>
						<option value={null}>Choose…</option>
						{#each REVIEW_STATUSES as s (s)}
							<option value={s}>{REVIEW_STATUS_LABELS[s]}</option>
						{/each}
					</select>
				</label>
				{#if statusDraft}
					<input
						type="text"
						bind:value={statusComment}
						placeholder="Why? (optional, added to the discussion)"
						aria-label="Reason for the status change"
					/>
					<button
						class="wl-strip-btn btn-primary"
						type="button"
						disabled={busy}
						data-testid="status-apply"
						onclick={applyStatus}>Set status</button
					>
				{/if}
			</div>
			{#if formError.status}<p class="team-error" role="alert">{formError.status}</p>{/if}
		</div>
		<div class="team-block">
			<h3>Discussion</h3>
			{@render composer('comment', 'Ask a question or leave review feedback…', 'Comment')}
			{@render noteList(comments, 'No comments yet.')}
		</div>
	{:else}
		<div class="team-block" data-testid="history">
			{#if restoreMessage}<p class="team-info" role="status">{restoreMessage}</p>{/if}
			{#if historyError}<p class="team-error" role="alert">{historyError}</p>{/if}
			{#if history === null}
				<p class="muted">Loading…</p>
			{:else if history.length === 0}
				<p class="muted">
					No saved versions yet. Add the company to the watchlist and every change is kept here.
				</p>
			{:else}
				<p class="hint">
					Each row is one save (an editing session by one person counts as one). Restoring makes an
					old version current again as a new version; nothing is ever overwritten.
				</p>
				<ol class="history-list">
					{#each history as entry, i (entry.id)}
						<li class="history-item" data-testid="history-item">
							<div class="history-line">
								<strong>v{entry.version}</strong>
								{ACTION_LABEL[entry.action]} by {entry.savedBy}
								<span class="muted" title={fullDate(entry.savedAt)}>· {timeAgo(entry.savedAt)}</span
								>
								{#if i === 0 && entry.action !== 'delete' && inWatchlist}
									<span class="current-tag">current</span>
								{/if}
							</div>
							{#if entry.changes.length}
								<ul class="history-changes">
									{#each entry.changes.slice(0, 4) as line (line)}<li>{line}</li>{/each}
									{#if entry.changes.length > 4}<li class="muted">
											…and {entry.changes.length - 4} more
										</li>{/if}
								</ul>
							{/if}
							{#if !(i === 0 && inWatchlist) && entry.action !== 'delete'}
								<div class="team-actions">
									<button class="link-btn" type="button" onclick={() => showCompare(entry)}
										>{compare?.id === entry.id ? 'Hide comparison' : 'Compare with current'}</button
									>
									{#if confirmRestoreId === entry.id}
										<span>Make v{entry.version} the current valuation?</span>
										<button
											class="wl-strip-btn btn-primary"
											type="button"
											disabled={busy}
											data-testid="restore-confirm"
											onclick={() => restore(entry)}>Restore</button
										>
										<button
											class="wl-strip-btn"
											type="button"
											onclick={() => (confirmRestoreId = null)}>Cancel</button
										>
									{:else}
										<button
											class="link-btn"
											type="button"
											data-testid="restore"
											onclick={() => (confirmRestoreId = entry.id)}>Restore this version</button
										>
									{/if}
								</div>
								{#if compare?.id === entry.id}
									<div class="compare-box" data-testid="compare-box">
										{#if compare.lines.length}
											<div class="muted">Going back to v{entry.version} would change:</div>
											<ul class="history-changes">
												{#each compare.lines as line (line)}<li>{line}</li>{/each}
											</ul>
										{:else}
											<div class="muted">Identical to what is on screen now.</div>
										{/if}
									</div>
								{/if}
							{/if}
						</li>
					{/each}
				</ol>
			{/if}
		</div>
	{/if}
</section>

{#snippet composer(kind: NoteKind, placeholder: string, label: string)}
	<div class="composer">
		<label class="sr-only" for="compose-{kind}">{label}</label>
		<textarea id="compose-{kind}" rows="2" bind:value={drafts[kind]} {placeholder}></textarea>
		<button
			class="wl-strip-btn btn-primary"
			type="button"
			disabled={busy || !drafts[kind].trim()}
			data-testid="add-{kind}"
			onclick={() => addNote(kind)}>{label}</button
		>
	</div>
	{#if formError[kind]}<p class="team-error" role="alert">{formError[kind]}</p>{/if}
{/snippet}

{#snippet noteList(list: CompanyNote[], empty: string)}
	{#if list.length === 0}
		<p class="muted">{empty}</p>
	{:else}
		<ul class="note-list">
			{#each list as n (n.id)}
				<li class="note" data-testid="note">
					{#if editingId === n.id}
						<textarea rows="3" bind:value={editText} aria-label="Edit note"></textarea>
						<div class="team-actions">
							<button
								class="wl-strip-btn btn-primary"
								type="button"
								disabled={busy}
								onclick={() => saveEdit(n)}>Save</button
							>
							<button class="wl-strip-btn" type="button" onclick={() => (editingId = null)}
								>Cancel</button
							>
						</div>
					{:else}
						<div class="note-body">{n.body}</div>
					{/if}
					<div class="note-meta">
						{n.author} · <span title={fullDate(n.createdAt)}>{timeAgo(n.createdAt)}</span>
						{#if n.editedAt}<span title={fullDate(n.editedAt)}> · edited</span>{/if}
						{#if canEdit(n) && editingId !== n.id}
							<button
								class="link-btn"
								type="button"
								onclick={() => {
									editingId = n.id;
									editText = n.body;
								}}>Edit</button
							>
						{/if}
						{#if canDelete(n)}
							{#if confirmDeleteId === n.id}
								<span>Delete this?</span>
								<button
									class="link-btn danger"
									type="button"
									disabled={busy}
									onclick={() => remove(n)}>Yes, delete</button
								>
								<button class="link-btn" type="button" onclick={() => (confirmDeleteId = null)}
									>No</button
								>
							{:else}
								<button class="link-btn" type="button" onclick={() => (confirmDeleteId = n.id)}
									>Delete</button
								>
							{/if}
						{/if}
					</div>
					{#if formError[`edit-${n.id}`]}
						<p class="team-error" role="alert">{formError[`edit-${n.id}`]}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}
