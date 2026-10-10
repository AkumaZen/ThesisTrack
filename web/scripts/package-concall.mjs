import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// SvelteKit owns Build Output API; append Python to that same deployment.
const directory = resolve('.vercel/output/functions/_internal/concall-research.func');
await mkdir(directory, { recursive: true });
for (const name of ['server.py', 'internal.py', 'concall_downloader']) {
  await cp(resolve('../services/concall', name), resolve(directory, name), { recursive: true, filter: (path) => !path.includes('__pycache__') });
}
const python = process.env.TRACKER_BUILD_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const installed = spawnSync(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', '--platform', 'manylinux2014_x86_64', '--python-version', '3.12', '--only-binary=:all:', '--target', directory, '-r', resolve('../services/concall/requirements.txt'), 'psycopg[binary]>=3.2,<4', 'vercel-runtime==0.22.1'], { stdio: 'inherit' });
if (installed.status !== 0) throw new Error('Internal Concall function dependencies failed to install');
// Uses Vercel's published Python runtime and documented runtime bootstrap contract.
await writeFile(resolve(directory, 'vc__handler__python.py'), `import os\nimport sys\n_here = os.path.dirname(__file__)\nsys.path.insert(0, _here)\nos.environ.update({"__VC_HANDLER_MODULE_NAME":"internal","__VC_HANDLER_ENTRYPOINT":"internal.py","__VC_HANDLER_ENTRYPOINT_ABS":os.path.join(_here,"internal.py"),"__VC_HANDLER_VENDOR_DIR":".","__VC_HANDLER_VARIABLE_NAME":"app"})\nfrom vercel_runtime.vc_init import vc_handler\n`);
await writeFile(resolve(directory, '.vc-config.json'), JSON.stringify({ runtime: 'python3.12', handler: 'vc__handler__python.vc_handler', maxDuration: 300, supportsResponseStreaming: true, regions: ['sin1'] }));
const path = resolve('.vercel/output/config.json');
const config = JSON.parse(await readFile(path, 'utf8'));
config.routes.unshift({ src: '^/_internal/concall-research$', dest: '/_internal/concall-research' });
await writeFile(path, JSON.stringify(config));
console.log('Packaged internal Concall function in the ThesisTrack deployment.');
