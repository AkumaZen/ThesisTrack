import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

// Production credentials are sensitive Vercel variables. Apply the additive migration inside
// the production build before dependent code can be promoted, without exporting those secrets.
if (process.env.VERCEL_ENV === 'production') {
  const connection = process.env.DATABASE_URL;
  if (!connection) throw new Error('Production DATABASE_URL is missing.');
  const host = new URL(connection).hostname.replace('-pooler.', '.');
  if (!host.startsWith('ep-damp-haze-azf572ro.') || !host.endsWith('.neon.tech')) {
    throw new Error('Refusing document migration: database is not the expected Neon production endpoint.');
  }
  const migration = await readFile(new URL('../drizzle/0035_company_document_summaries.sql', import.meta.url), 'utf8');
  const imageMigration = await readFile(new URL('../drizzle/0036_thesis_images.sql', import.meta.url), 'utf8');
  const client = postgres(connection, { max: 1, ssl: 'require', prepare: false, connect_timeout: 15 });
  try {
    await client.begin(async (tx) => {
      await tx`set local lock_timeout = '5s'`;
      await tx`set local statement_timeout = '20s'`;
      await tx.unsafe(migration);
      await tx.unsafe(imageMigration);
      const [images] = await tx`select to_regclass('public.thesis_images') as name`;
      if (!images?.name) throw new Error('Thesis image migration verification failed.');
      const [column] = await tx`select data_type from information_schema.columns where table_schema = 'valuation' and table_name = 'announcements' and column_name = 'document_summary'`;
      if (column?.data_type !== 'jsonb') throw new Error('Document summary migration verification failed.');
    });
    console.log('Production migrations 0035 and 0036 verified: document summaries and thesis images.');
  } finally {
    await client.end();
  }
} else {
  console.log('Production document migration skipped outside a production deployment.');
}
