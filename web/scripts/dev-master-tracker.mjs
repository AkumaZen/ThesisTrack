import { spawn } from 'node:child_process';

// A local, isolated feature preview. This command never points at the real database.
const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5180', '--strictPort'], {
  stdio: 'inherit', env: { ...process.env, VERCEL: '', DATABASE_URL: 'postgres://test:test@127.0.0.1:1/tracker_test', MASTER_TRACKER_TEST_MODE: 'true', DISABLE_BACKGROUND_JOBS: 'true' }
});
child.on('exit', (code) => process.exit(code ?? 1));
process.on('SIGINT', () => child.kill('SIGINT'));
