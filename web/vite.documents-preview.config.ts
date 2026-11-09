import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { previewDocuments } from './preview-documents/data.ts';

// Separate, local-only Vite entry. It does not change SvelteKit authentication or production routes.
export default defineConfig({
	root: fileURLToPath(new URL('./preview-documents', import.meta.url)), publicDir: false,
	resolve: { alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) } },
	plugins: [tailwindcss(), svelte({ compilerOptions: { runes: true } }), {
		name: 'local-document-preview',
		configureServer(server) {
			server.middlewares.use(async (request, response, next) => {
				if (request.url?.startsWith('/api/companies/LOCAL_PREVIEW/documents')) {
					const state = new URL(request.headers.referer ?? 'http://localhost').searchParams.get('state');
					await new Promise((done) => setTimeout(done, state === 'loading' ? 12000 : request.method === 'POST' ? 1200 : 250));
					response.setHeader('Content-Type', 'application/json');
					if (state === 'error') { response.statusCode = 503; response.end(JSON.stringify({ detail: 'The document service is temporarily unavailable. Try loading saved documents again.' })); return; }
					response.end(JSON.stringify({ documents: state === 'empty' ? [] : state === 'pending' ? previewDocuments.filter((d) => !d.analysis) : previewDocuments, warnings: state === 'warning' ? ['The exchange did not respond. Previously saved documents are shown; refresh again in a moment.'] : [] }));
					return;
				}
				if (request.url === '/sample-filing.pdf') {
					const text = 'Illustrative source filing. Local UI preview only. Not a real company announcement.';
					const stream = `BT /F1 14 Tf 50 750 Td (${text}) Tj ET`;
					const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 900] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
					let pdf = '%PDF-1.4\n'; const offsets = [0];
					objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
					const start = pdf.length;
					pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
					response.setHeader('Content-Type', 'application/pdf'); response.end(pdf); return;
				}
				next();
			});
		}
	}],
	server: { host: '127.0.0.1', port: 5188, strictPort: true }
});
