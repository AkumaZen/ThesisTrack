import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import postgres from 'postgres';

// Run from the repository root. Secret values go only to child stdin/database driver.
const privateEnv = dotenv.parse(readFileSync('.env'));
const databaseUrl = privateEnv.NEON_DB_URL;
const key = privateEnv.OPEN_AI_KEY || privateEnv.OPENAI_API_KEY;
if (!databaseUrl || !key) throw new Error('Production database and OpenAI credentials are required');
const cli = process.platform === 'win32' ? process.env.APPDATA + '/npm/node_modules/vercel/dist/index.js' : '/usr/local/lib/node_modules/vercel/dist/index.js';
const configure = (name, value) => new Promise((done, reject) => {
  const child = spawn(process.execPath, [cli, 'env', 'add', name, 'production', '--force', '--sensitive'], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
  let error = ''; child.stderr.on('data', (chunk) => { error += chunk; });
  child.on('error', reject);
  child.on('close', (code) => code === 0 ? done() : reject(new Error(`Failed to configure ${name}: exit ${code}`)));
  child.stdin.end(value);
});
for (const [name, value] of Object.entries({ OPEN_AI_KEY: key, OPENAI_MODEL: 'gpt-5.6-luna', CONCALL_SERVICE_TOKEN: randomBytes(32).toString('hex') })) {
  await configure(name, value); console.log(`Configured ${name} privately.`);
}
const sql = postgres(databaseUrl, { max: 1, prepare: false, ssl: 'require', connect_timeout: 15 });
try {
  for (const file of ['0015_master_tracker.sql', '0016_master_tracker_documents.sql']) {
    await sql.begin(async (transaction) => { await transaction.unsafe(readFileSync('web/drizzle/' + file, 'utf8')); });
    console.log(`Applied ${file}.`);
  }
} finally { await sql.end(); }
