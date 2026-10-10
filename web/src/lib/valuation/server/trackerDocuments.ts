import { env } from '$env/dynamic/private';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export async function internalTrackerDocuments(input: { bseCode: string; quarters: string[]; refresh: boolean }) {
	if (env.VERCEL) {
		const host = env.VERCEL_URL;
		if (!host || !env.CONCALL_SERVICE_TOKEN) throw new Error('Internal document function is not configured');
		const response = await fetch(`https://${host}/_internal/concall-research`, {
			method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.CONCALL_SERVICE_TOKEN}`,
				...(env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}) },
			body: JSON.stringify(input), signal: AbortSignal.timeout(180000)
		});
		if (!response.ok) throw new Error(`Internal document function returned HTTP ${response.status}`);
		return response.json();
	}
	const directory = resolve('../services/concall');
	const virtualPython = resolve(directory, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
	return new Promise((done, reject) => {
		const processHandle = spawn(existsSync(virtualPython) ? virtualPython : 'python3', ['internal.py'], { cwd: directory, env: { ...process.env, ...env }, timeout: 180000, windowsHide: true });
		let output = '';
		processHandle.stdout.on('data', (chunk) => { output += chunk; });
		processHandle.stderr.resume();
		processHandle.on('error', reject);
		processHandle.on('close', (code) => { if (code !== 0) reject(new Error('Internal document research failed')); else { try { done(JSON.parse(output)); } catch { reject(new Error('Invalid internal research response')); } } });
		processHandle.stdin.end(JSON.stringify(input));
	});
}
