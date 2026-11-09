<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { IMAGE_CATEGORIES, type ThesisImage } from '$lib/thesisImages';
	let { companyId, owner, canWrite }: { companyId: string; owner: string; canWrite: boolean } = $props();
	type Draft = { key: number; id?: number; imageData: string; title: string; category: typeof IMAGE_CATEGORIES[number]; caption: string; sourceUrl: string };
	let images = $state<ThesisImage[]>([]);
	let drafts = $state<Draft[]>([]);
	let loading = $state(true), processing = $state(false), saving = $state(false), dragging = $state(false);
	let error = $state(''), notice = $state('');
	let picker = $state<HTMLInputElement>();
	let viewer: HTMLDialogElement;
	let draftForm = $state<HTMLFormElement>();
	let selected = $state<ThesisImage | null>(null);
	let nextKey = 0;
	const endpoint = $derived(`/api/companies/${encodeURIComponent(companyId)}/images`);
	const query = $derived(`owner=${encodeURIComponent(owner)}`);
	function imageUrl(id: number) { return `${endpoint}?${query}&image=${id}`; }
	async function request(method = 'GET', body?: unknown): Promise<ThesisImage[]> {
		const response = await fetch(`${endpoint}?${query}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
		const data = await response.json();
		if (!response.ok) throw new Error(data.detail || 'Could not save images. Please try again.');
		return data;
	}
	async function load() {
		loading = true; error = '';
		try { images = await request(); } catch (err) { error = String((err as Error).message); }
		finally { loading = false; }
	}
	onMount(() => { void load(); });
	beforeNavigate((navigation) => {
		if (drafts.length && !navigation.willUnload && !confirm('You have unsaved images. Leave without saving?')) navigation.cancel();
	});
	async function prepare(file: File): Promise<string> {
		if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(`${file.name}: choose a PNG, JPEG or WebP image.`);
		if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: choose an image under 20 MB.`);
		const bitmap = await createImageBitmap(file);
		try {
			if (bitmap.width * bitmap.height > 50_000_000) throw new Error(`${file.name}: image dimensions are too large.`);
			const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
			const canvas = document.createElement('canvas');
			canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
			const context = canvas.getContext('2d'); if (!context) throw new Error('Your browser could not prepare this image.');
			context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
			for (const quality of [0.94, 0.85, 0.7, 0.5]) {
				const data = canvas.toDataURL('image/webp', quality);
				if (data.length <= 1_400_000) return data;
			}
			throw new Error(`${file.name}: image is still too large after resizing. Try a smaller screenshot.`);
		} finally { bitmap.close(); }
	}
	async function addFiles(files: File[]) {
		if (!canWrite || !files.length) return;
		if (processing || saving) { error = 'Wait for the current images to finish, then add more.'; return; }
		processing = true; error = ''; notice = '';
		const problems: string[] = [];
		for (const file of files) {
			if (images.length + drafts.filter((draft) => !draft.id).length >= 100) { problems.push('This thesis can hold 100 images. Remove one before adding more.'); break; }
			try {
				const imageData = await prepare(file);
				drafts = [...drafts, { key: nextKey++, imageData, title: file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Screenshot', category: 'PPT snapshot', caption: '', sourceUrl: '' }];
			} catch (err) { problems.push((err as Error).message); }
		}
		processing = false; error = problems.join(' ');
		if (drafts.length) { await tick(); draftForm?.scrollIntoView({ block: 'nearest' }); }
	}
	function paste(event: ClipboardEvent) {
		if (!canWrite || document.querySelector('dialog[open]')) return;
		const files = Array.from(event.clipboardData?.items ?? []).filter((item) => item.kind === 'file' && item.type.startsWith('image/')).map((item) => item.getAsFile()).filter((file): file is File => !!file);
		if (files.length) { event.preventDefault(); void addFiles(files); }
	}
	function drop(event: DragEvent) {
		dragging = false;
		if (!canWrite || !event.dataTransfer?.types.includes('Files')) return;
		event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files));
	}
	async function save(event: SubmitEvent) {
		event.preventDefault(); saving = true; error = ''; notice = '';
		try {
			for (const draft of [...drafts]) {
				const { key, ...body } = draft;
				await request(draft.id ? 'PATCH' : 'POST', body);
				drafts = drafts.filter((item) => item.key !== key);
			}
			notice = 'Images saved to this thesis.';
		} catch (err) { error = (err as Error).message; }
		finally {
			try { images = await request(); } catch (err) { error ||= (err as Error).message; }
			saving = false;
		}
	}
	function edit(image: ThesisImage) {
		if (drafts.some((draft) => draft.id === image.id)) return;
		drafts = [...drafts, { ...image, key: nextKey++, imageData: imageUrl(image.id), category: image.category }];
	}
	async function remove(image: ThesisImage) {
		if (!confirm(`Remove "${image.title}" from this thesis?`)) return;
		saving = true; error = '';
		try { await request('DELETE', { id: image.id }); images = images.filter((item) => item.id !== image.id); drafts = drafts.filter((draft) => draft.id !== image.id); notice = 'Image removed.'; }
		catch (err) { error = (err as Error).message; }
		finally { saving = false; }
	}
</script>

<svelte:window onpaste={paste} onbeforeunload={(event) => { if (drafts.length) { event.preventDefault(); event.returnValue = ''; } }} />
<section class="thesis-images" aria-label="Images & key updates">
	<div class="heading">
		<div><h4>Images & key updates</h4><p>PPT snapshots, products and the updates behind your thesis.</p></div>
		{#if canWrite}<button type="button" onclick={() => picker?.click()} disabled={processing || saving}>Add images</button><input class="file-input" bind:this={picker} type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="Choose thesis images" onchange={(event) => { void addFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ''; }} />{/if}
	</div>
	{#if canWrite}
		<!-- The file input/button provides a keyboard equivalent for the drop target. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class:dragging class="dropzone" ondragover={(event) => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragging = true; } }} ondragleave={() => dragging = false} ondrop={drop}>
			<strong>{processing ? 'Preparing images…' : 'Drop images here or paste with Ctrl + V'}</strong>
			<span>On Mac, use Command + V. You can also use Add images. PNG, JPEG or WebP, up to 20 MB each.</span>
		</div>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if notice}<p class="notice" role="status">{notice}</p>{/if}
	{#if drafts.length}
		<form bind:this={draftForm} onsubmit={save} class="drafts">
			<h5>{drafts.length} image{drafts.length === 1 ? '' : 's'} to save</h5>
			{#each drafts as draft (draft.key)}
				<div class="draft">
					<img src={draft.imageData} alt={draft.title || 'Image preview'} />
					<fieldset disabled={saving}>
						<label>Title<input required maxlength="120" bind:value={draft.title} /></label>
						<label>Image type<select bind:value={draft.category}>{#each IMAGE_CATEGORIES as category}<option>{category}</option>{/each}</select></label>
						<label>Caption or key update<textarea rows="3" maxlength="2000" bind:value={draft.caption} placeholder="What does this show, and why does it matter?"></textarea></label>
						<label>Source link (optional)<input type="url" pattern="https://.*" maxlength="2000" bind:value={draft.sourceUrl} placeholder="https://…" /></label>
						<button type="button" class="quiet" onclick={() => { drafts = drafts.filter((item) => item.key !== draft.key); }}>Discard {draft.id ? 'changes' : 'image'}</button>
					</fieldset>
				</div>
			{/each}
			<div class="save-row"><button type="submit" disabled={saving || processing}>{saving ? 'Saving…' : 'Save images'}</button><span>Images are resized for quick viewing. Changes are saved when you click Save images.</span></div>
		</form>
	{/if}
	{#if loading}<p role="status">Loading images…</p>
	{:else if images.length}
		<div class="gallery">
			{#each images as image (image.id)}
				<figure>
					<button class="image-button" type="button" aria-label={`Expand ${image.title}`} onclick={() => { selected = image; viewer.showModal(); }}><img src={imageUrl(image.id)} alt={image.title} loading="lazy" /></button>
					<figcaption><span class="category">{image.category} · Added {new Date(image.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span><h5>{image.title}</h5>{#if image.caption}<p class="caption">{image.caption}</p>{/if}
						<div class="actions">{#if image.sourceUrl}<a href={image.sourceUrl} target="_blank" rel="noopener noreferrer">View source<span class="sr-only"> (opens in a new tab)</span></a>{/if}
						{#if canWrite}<button type="button" class="quiet" disabled={saving} onclick={() => edit(image)}>Edit</button><button type="button" class="quiet" disabled={saving} onclick={() => remove(image)}>Remove</button>{/if}</div>
					</figcaption>
				</figure>
			{/each}
		</div>
	{:else if !error && !drafts.length}<p class="empty">{canWrite ? 'Add a slide, product photo or screenshot to bring this thesis into focus.' : 'No images have been added to this thesis yet.'}</p>
	{/if}
	{#if !loading && error}<button type="button" class="quiet" onclick={load}>Reload saved images</button>{/if}
</section>
<dialog bind:this={viewer} aria-label={selected?.title || 'Expanded thesis image'}>
	{#if selected}<div class="viewer-heading"><h4>{selected.title}</h4><button type="button" onclick={() => viewer.close()}>Close</button></div><img class="expanded" src={imageUrl(selected.id)} alt={selected.title} />{#if selected.caption}<p class="caption">{selected.caption}</p>{/if}{/if}
</dialog>

<style>
	.thesis-images { margin-top: 1.5rem; border-top: 1px solid var(--rule); padding-top: 1.5rem; container-type: inline-size; }
	.heading,.save-row,.viewer-heading { display:flex; align-items:center; justify-content:space-between; gap:1rem; }
	h4 { font-family:var(--font-display); font-size:1.1rem; font-weight:700; margin:0; }
	h5 { font-weight:700; margin:0.35rem 0; overflow-wrap:anywhere; }
	p { font-size:0.875rem; line-height:1.65; }
	.heading p,.save-row span,.dropzone span { color:var(--muted); font-size:0.8rem; }
	button { min-height:44px; padding:0.5rem 0.9rem; border:2px solid var(--ink); background:var(--ink); color:var(--bg); font-weight:600; font-size:0.8rem; cursor:pointer; }
	button:hover { background:var(--accent); border-color:var(--accent); color:white; }
	button:disabled { opacity:0.55; cursor:wait; }
	button.quiet { color:var(--ink); background:transparent; border:1px solid var(--rule); }
	button.quiet:hover { color:var(--accent); border-color:var(--accent); }
	:where(button,input,textarea,select,a):focus-visible { outline:3px solid var(--accent); outline-offset:3px; }
	.file-input { display:none; }
	.dropzone { display:grid; gap:0.4rem; padding:1.25rem; margin-top:1rem; border:2px dashed var(--rule); background:var(--surface); font-size:0.875rem; }
	.dropzone.dragging { border-color:var(--accent); background:var(--bg); }
	.error { color:var(--danger); overflow-wrap:anywhere; }
	.notice { color:var(--good); }
	.drafts { padding:1rem 0; }
	.draft { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,2fr); gap:1.25rem; padding:1rem 0; border-bottom:1px solid var(--rule); }
	.draft>img { width:100%; max-height:240px; object-fit:contain; background:var(--surface); }
	fieldset { min-width:0; border:0; padding:0; display:grid; gap:0.75rem; }
	label { display:grid; gap:0.35rem; font-size:0.8rem; font-weight:600; }
	input,select,textarea { min-width:0; width:100%; min-height:44px; padding:0.6rem; border:1px solid var(--rule); background-color:var(--bg); color:var(--ink); font:inherit; }
	select { appearance:auto; }
	textarea { resize:vertical; }
	.save-row { margin-top:1rem; justify-content:flex-start; }
	.save-row span { max-width:45ch; }
	.gallery { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr)); gap:1.5rem; margin-top:1.25rem; }
	figure { margin:0; min-width:0; border-bottom:1px solid var(--rule); }
	.image-button { display:block; width:100%; padding:0; background:var(--surface); border:1px solid var(--rule); }
	.image-button img { width:100%; height:200px; object-fit:contain; }
	figcaption { padding:0.85rem 0; }
	.category { color:var(--muted); font-size:0.75rem; }
	.caption { white-space:pre-wrap; overflow-wrap:anywhere; max-width:70ch; }
	.actions { display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap; margin-top:0.75rem; }
	a { color:var(--accent); text-decoration:underline; text-underline-offset:3px; font-size:0.8rem; padding:0.6rem 0; }
	.empty { padding:1rem 0; color:var(--muted); }
	dialog { width:min(1100px,95vw); max-height:92dvh; margin:auto; padding:1.25rem; border:2px solid var(--ink); background:var(--bg); color:var(--ink); overflow:auto; }
	dialog::backdrop { background:rgb(0 0 0 / 65%); }
	.expanded { display:block; max-width:100%; max-height:70dvh; object-fit:contain; margin:1rem auto; }
	.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
	@container (max-width:540px) { .heading { align-items:flex-start; flex-direction:column; gap:0.75rem; } .draft { grid-template-columns:1fr; } .draft>img { max-height:180px; } .save-row { flex-direction:column; align-items:flex-start; } .dropzone { padding:1rem; } }
</style>
