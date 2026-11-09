// Opt-in release check. Credentials remain inside Vercel; fixtures are removed in finally.
if (process.env.VERCEL_ENV === 'production' && process.env.THESIS_IMAGES_RELEASE_CHECK === 'true') {
  const { default: postgres } = await import('postgres');
  const { randomUUID } = await import('node:crypto');
  const { SignJWT } = await import('jose');
  const connection = process.env.DATABASE_URL;
  const host = new URL(connection).hostname.replace('-pooler.', '.');
  if (!host.startsWith('ep-damp-haze-azf572ro.') || !host.endsWith('.neon.tech')) throw new Error('Unexpected release check database.');
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required for the authenticated image release check.');
  const sql = postgres(connection, { max: 1, ssl: 'require', prepare: false, connect_timeout: 15 });
  const id = `IMAGE_RELEASE_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const owner = `image-release-${randomUUID()}`;
  const issue = role => new SignJWT({ role }).setProtectedHeader({ alg: 'HS256' }).setSubject(owner).setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const token = await issue('read_write');
  const readOnlyToken = await issue('read_only');
  const { Server } = await import('../.svelte-kit/output/server/index.js');
  const { manifest } = await import('../.svelte-kit/output/server/manifest.js');
  const server = new Server(manifest);
  await server.init({ env: { ...process.env, DISABLE_BACKGROUND_JOBS: 'true' } });
  const url = `https://thesis-track-sigma.vercel.app/api/companies/${id}/images`;
  const send = async (method, body, auth = token, suffix = '') => server.respond(new Request(url + suffix, {
    method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  }), { getClientAddress: () => '127.0.0.1' });
  const expectStatus = (response, status, action) => { if (response.status !== status) throw new Error(`Image release check ${action}: expected HTTP ${status}, received ${response.status}.`); };
  const checks = {};
  try {
    const created = await sql`insert into public.companies(company_id,name,broad_industry_id,specific_niche_id,operating_model)
      select ${id},'Temporary image release validation',broad_industry_id,specific_niche_id,operating_model from public.companies where company_id='BALUFORGE' returning company_id`;
    if (created.length !== 1) throw new Error('Release fixture could not be created.');
    await sql`insert into public.thesis_scenarios(company_id,owner,last_reviewed) values(${id},${owner},current_date)`;
    expectStatus(await send('GET', null, null), 401, 'signed-out access'); checks.signedOutBlocked = true;
    const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1EAAAAASUVORK5CYII=';
    const details = { title: 'Release validation image', category: 'PPT snapshot', caption: 'Temporary release fixture.', sourceUrl: 'https://example.com/release-check' };
    const upload = await send('POST', { ...details, imageData }); expectStatus(upload, 201, 'upload');
    const image = await upload.json(); checks.upload = Number.isSafeInteger(image.id);
    if (!checks.upload) throw new Error('Upload did not return an image ID.');
    const list = await send('GET'); expectStatus(list, 200, 'list');
    const rows = await list.json();
    checks.persistence = rows.length === 1 && rows[0].id === image.id && !('imageData' in rows[0]);
    if (!checks.persistence) throw new Error('Image metadata persistence check failed.');
    const original = await send('GET', null, token, `?image=${image.id}`); expectStatus(original, 200, 'image retrieval');
    checks.imageBytes = Buffer.from(await original.arrayBuffer()).equals(Buffer.from(imageData.split(',')[1], 'base64')) && original.headers.get('content-type') === 'image/png';
    if (!checks.imageBytes) throw new Error('Stored image content did not match.');
    expectStatus(await send('PATCH', { ...details, id: image.id, caption: 'Edited release fixture.' }), 200, 'edit'); checks.edit = true;
    expectStatus(await send('POST', { ...details, imageData: 'data:image/svg+xml;base64,PHN2Zz4=' }), 422, 'unsafe file rejection'); checks.unsafeFilesBlocked = true;
    expectStatus(await send('POST', { ...details, imageData }, readOnlyToken), 403, 'read-only write'); checks.readOnlyBlocked = true;
    expectStatus(await send('DELETE', { id: image.id }), 200, 'remove'); checks.remove = true;
    const remaining = await (await send('GET')).json();
    if (remaining.length) throw new Error('Image removal did not persist.');
  } finally {
    try {
      await sql.begin(async tx => {
        await tx`select set_config('app.allow_thesis_delete','on',true)`;
        await tx`delete from public.companies where company_id=${id} and name='Temporary image release validation'`;
      });
      const [remaining] = await sql`select count(*)::int as count from public.companies where company_id=${id}`;
      if (remaining.count !== 0) throw new Error('Release fixture cleanup failed.');
      checks.fixtureRemoved = true;
    } finally { await sql.end(); }
  }
  console.log('[Thesis images production check]', JSON.stringify(checks));
}
