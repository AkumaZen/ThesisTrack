// Generic: sync a company's authored proof_points.model_specific_metrics snapshot
// into real observations for every quantifiable (non-manual_check) kill trigger
// whose metric_key is present in that snapshot. This is what actually wires the
// rule engine (trigger_evaluations -> status_proposals -> Review Queue) to real
// data - the static snapshot alone never reaches it. Works for any company_id.
const [, , BASE, TOKEN, COMPANY_ID, PERIOD, PERIOD_END] = process.argv;

if (!BASE || !TOKEN || !COMPANY_ID || !PERIOD || !PERIOD_END) {
	console.error('usage: node sync-observations.mjs <base_url> <token> <company_id> <period> <period_end>');
	process.exit(1);
}

async function req(method, path, body) {
	const r = await fetch(`${BASE}/api${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
		body: body !== undefined ? JSON.stringify(body) : undefined
	});
	const data = await r.json();
	if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(data)}`);
	return data;
}

const company = await req('GET', `/companies/${COMPANY_ID}`);
const snapshot = company.current_thesis?.proof_points?.model_specific_metrics ?? {};
const quantifiableTriggers = (company.kill_triggers ?? []).filter((t) => !t.manual_check && t.metric_key);

const toSync = quantifiableTriggers
	.filter((t) => Object.prototype.hasOwnProperty.call(snapshot, t.metric_key))
	.map((t) => ({ metric_key: t.metric_key, numeric_value: snapshot[t.metric_key], source_type: 'thesis_snapshot' }));

const skipped = quantifiableTriggers.filter((t) => !Object.prototype.hasOwnProperty.call(snapshot, t.metric_key));

console.log(`${COMPANY_ID}: ${quantifiableTriggers.length} quantifiable trigger(s), ${toSync.length} matched in the authored snapshot.`);
if (skipped.length) {
	console.log(
		`  skipped (no value in thesis snapshot, would need a real source): ${skipped.map((t) => t.metric_key).join(', ')}`
	);
}
if (!toSync.length) {
	console.log('  nothing to post.');
	process.exit(0);
}

const result = await req('POST', `/companies/${COMPANY_ID}/observations`, {
	period: PERIOD,
	period_end: PERIOD_END,
	observations: toSync
});
console.log('  posted:', JSON.stringify(toSync));
console.log('  result:', JSON.stringify(result));
