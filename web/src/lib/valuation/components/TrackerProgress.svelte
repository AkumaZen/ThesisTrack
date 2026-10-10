<script lang="ts">
	import { trackerSteps, type TrackerStep } from '../trackerProgress';
	let { step, status }: { step: TrackerStep; status: 'running' | 'ready' | 'error' } = $props();
	const current = $derived(trackerSteps.findIndex((s) => s.id === step));
</script>
<section class="progress" aria-label="Analysis progress" aria-busy={status==='running'}>
	<p role="status">{status==='ready' ? 'Draft ready for review' : status==='error' ? 'Analysis stopped — see the error above' : `Currently: ${trackerSteps[current].label}`}</p>
	<ol>{#each trackerSteps as item,i}<li class:complete={i<current||status==='ready'} class:active={i===current&&status==='running'} aria-current={i===current&&status==='running' ? 'step' : undefined}>
		<span class="marker" aria-hidden="true">{i<current||status==='ready' ? '✓' : i+1}</span><div><strong>{item.label}</strong><small>{i<current||status==='ready' ? 'Complete' : i===current&&status==='error' ? 'Stopped' : i===current ? item.detail : 'Waiting'}</small></div>
	</li>{/each}</ol>
	{#if status==='running'}<p class="hint">You can leave this running while we work. Downloading documents and analysing scenarios can take time; steps update when the server actually reaches them.</p>{/if}
</section>
<style>
	.progress{border:1px solid var(--rule);padding:14px;margin-top:14px;background:var(--surface)}p{font-size:13px;margin:0 0 12px}ol{display:flex;flex-wrap:wrap;gap:14px;list-style:none;padding:0;margin:0}li{display:flex;gap:8px;flex:1;min-width:150px;color:var(--muted);font-size:12px}.marker{display:grid;place-items:center;flex-shrink:0;width:24px;height:24px;border:1px solid var(--rule);border-radius:50%}.active{color:var(--accent)}.active .marker{border-color:var(--accent);animation:pulse 1.5s ease-in-out infinite}.complete{color:var(--good)}small{display:block;line-height:1.5;margin-top:5px}.hint{color:var(--muted);font-size:12px;margin:14px 0 0}@keyframes pulse{50%{box-shadow:0 0 0 4px var(--rule)}}@media(prefers-reduced-motion:reduce){.active .marker{animation:none}}
</style>
