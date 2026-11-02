// Opt-in release validation runs inside Vercel, where production credentials stay protected.
// It uses the built application's normal authenticated API handlers and stores real summaries.
const company = process.env.DOCUMENT_HISTORY_VALIDATE_COMPANY;
if (process.env.VERCEL_ENV === 'production' && company) {
  if (company !== 'BALUFORGE') throw new Error('Only the explicitly requested BALUFORGE validation is permitted.');
  const { Server } = await import('../.svelte-kit/output/server/index.js');
  const { manifest } = await import('../.svelte-kit/output/server/manifest.js');
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.API_KEY) headers['x-api-key'] = process.env.API_KEY;
  else if (process.env.JWT_SECRET) {
    const { SignJWT } = await import('jose');
    headers.Authorization = `Bearer ${await new SignJWT({ role: 'read_write' }).setProtectedHeader({ alg: 'HS256' }).setSubject('release-document-validation').setExpirationTime('30m').sign(new TextEncoder().encode(process.env.JWT_SECRET))}`;
  } else throw new Error('Production API credentials are unavailable for document validation.');
  const server = new Server(manifest);
  await server.init({ env: { ...process.env, DISABLE_BACKGROUND_JOBS: 'true' } });
  const url = `https://thesis-track-sigma.vercel.app/api/companies/${company}/documents`;
  let result;
  let previousProgress;
  let action = 'start';
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > 25 * 60_000) throw new Error('Document validation exceeded 25 minutes; its persisted queue can be resumed.');
    const response = await server.respond(new Request(url, { method: 'POST', headers, body: JSON.stringify({ action }) }), { getClientAddress: () => '127.0.0.1' });
    if (response.status === 423) { await new Promise((done) => setTimeout(done, 2000)); continue; }
    result = await response.json();
    if (!response.ok) throw new Error(`BALUFORGE validation HTTP ${response.status}: ${result.detail ?? result.message ?? 'request failed'}`);
    console.log('[BALUFORGE document validation]', JSON.stringify(result.progress));
    const newFailures = (result.progress?.failed ?? 0) - (previousProgress?.failed ?? 0);
    const newProcessed = (result.progress?.processed ?? 0) - (previousProgress?.processed ?? 0);
    if (newFailures >= 3 && newFailures === newProcessed && result.documents.filter((d) => d.reviewError).every((d) => /OpenAI.*HTTP (400|401|403|404)/.test(d.reviewError))) throw new Error('BALUFORGE validation stopped after repeated provider rejection; inspect the AI request before spending on more documents.');
    previousProgress = result.progress;
    if (result.progress?.state !== 'reviewing') break;
    action = 'continue';
  }
  if (result.progress?.state !== 'complete') throw new Error('BALUFORGE history review did not complete.');
  const important = result.documents.filter((d) => d.analysis?.important);
  const dates = important.map((d) => d.announcedAt).sort();
  console.log('[BALUFORGE document validation complete]', JSON.stringify({ ...result.progress, important: important.length, pending: result.documents.filter((d) => !d.analysis).length, oldestImportant: dates[0], newestImportant: dates.at(-1), failures: result.documents.filter((d) => d.reviewError).map((d) => ({ date: d.announcedAt, subject: d.subject, reason: d.reviewError })) }));
}
