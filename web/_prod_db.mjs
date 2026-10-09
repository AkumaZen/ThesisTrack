// Shared by the _prod_*.mjs scripts. Reads the production database URL from an env file (never
// printing it) and refuses any database that isn't the Neon production endpoint, so a stale file
// (`.production.env` still holds the retired Aiven URL) can't send a write to the wrong place.
import fs from 'node:fs';

/** Neon project holy-leaf-50072157, branch production. Not a secret: the password is in the URL. */
export const PRODUCTION_ENDPOINT = 'ep-damp-haze-azf572ro';

/**
 * The direct (non-pooler) production URL from `envPath`: NEON_DB_URL if the file has it, else
 * DATABASE_URL. Prints the host it will use, and exits if that isn't production.
 */
export function productionDatabaseUrl(envPath) {
	if (!envPath) {
		console.error('Pass the env file holding the production URL (e.g. ../.env).');
		process.exit(1);
	}
	const text = fs.readFileSync(envPath, 'utf8');
	const read = (name) => {
		const m = text.match(new RegExp(`^${name}\s*=\s*(.+)$`, 'm'));
		return m ? m[1].trim().replace(/^(["'])(.*)\1$/, '$2') : null;
	};
	const found = read('NEON_DB_URL') ? 'NEON_DB_URL' : read('DATABASE_URL') ? 'DATABASE_URL' : null;
	if (!found) {
		console.error(`Neither NEON_DB_URL nor DATABASE_URL is set in ${envPath}`);
		process.exit(1);
	}
	let url;
	try {
		url = new URL(read(found));
	} catch {
		console.error(`${found} in ${envPath} is not a valid URL`);
		process.exit(1);
	}
	// Scripts use the direct address: the pooler runs in transaction mode.
	url.hostname = url.hostname.replace('-pooler.', '.');
	console.log(`Database host (${found}): ${url.hostname}`);
	if (!url.hostname.startsWith(`${PRODUCTION_ENDPOINT}.`) || !url.hostname.endsWith('.neon.tech')) {
		console.error(`Refusing: that is not the Neon production database (${PRODUCTION_ENDPOINT}).`);
		process.exit(1);
	}
	return url.toString();
}
