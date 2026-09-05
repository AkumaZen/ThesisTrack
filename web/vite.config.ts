import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	],
	server: {
		watch: {
			// Docker Desktop's Windows bind mount doesn't reliably forward native
			// filesystem change events into the container, so Vite's default
			// chokidar watcher silently misses edits made on the host. Polling
			// works around that at the cost of a bit of CPU - worth it since a
			// stale dev server was the actual, repeated problem, not a one-off.
			usePolling: true,
			interval: 300
		}
	}
});
