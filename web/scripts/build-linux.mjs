// Runs the production build (`npm run build`) inside a Linux container, the way Vercel builds it.
// On Windows the Vercel adapter cannot create its function symlinks without Developer Mode (EPERM),
// so this is how to verify a production build here. Needs Docker. The repo is mounted read-only and
// copied in without node_modules, build output or env files, so nothing on the host changes.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../..');
const script = [
	'set -e',
	// The concall function is packaged with pip (scripts/package-concall.mjs); vercel-runtime needs Python 3.12+, hence trixie.
	'apt-get update -qq >/dev/null && apt-get install -y -qq python3-pip >/dev/null',
	'mkdir /repo && cd /src',
	"tar --exclude=./web/node_modules --exclude=./services/concall/.venv --exclude=./web/.vercel --exclude=./web/.svelte-kit --exclude=./web/test-results --exclude='*.env' --exclude='./web/.env*' -cf - web services | tar -xf - -C /repo",
	'cd /repo/web',
	'npm ci --no-audit --no-fund --loglevel=error',
	'npm run build',
	'ls .vercel/output/functions'
].join(' && ');

const run = spawnSync(
	'docker',
	['run', '--rm', '-e', 'PIP_BREAK_SYSTEM_PACKAGES=1', '-v', `${repo}:/src:ro`, 'node:24-trixie-slim', 'bash', '-c', script],
	{ stdio: 'inherit' }
);
process.exit(run.status ?? 1);
