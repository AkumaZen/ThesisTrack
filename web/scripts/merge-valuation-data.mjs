// One-time copy of a Valuation Dashboard database into ThesisTrack's `valuation`
// schema (created by drizzle/0010_merge_valuation.sql - apply that first).
//
// People are matched by name: a dashboard user "Rohit.Negi" is the ThesisTrack
// user whose display_name is "Rohit.Negi" (rohit.negi@rdc.in). Every user_id,
// every 'user:<id>' template scope and every stored in-app link is rewritten to
// the merged app; dashboard admins become admins. Sessions are not copied -
// everyone signs in once with their ThesisTrack email and password.
//
// Runs in one transaction: either everything is copied or nothing is.
// Refuses to run into a valuation schema that already has data unless --replace
// is given, which empties the valuation tables first.
//
// Usage:
//   SOURCE_DATABASE_URL=postgres://...valdash DATABASE_URL=postgres://...thesis \
//     node scripts/merge-valuation-data.mjs [--replace]
import postgres from 'postgres';

const sourceUrl = process.env.SOURCE_DATABASE_URL;
const targetUrl = process.env.DATABASE_URL;
if (!sourceUrl || !targetUrl) {
	console.error('Set SOURCE_DATABASE_URL (Valuation Dashboard) and DATABASE_URL (ThesisTrack).');
	process.exit(1);
}
const replace = process.argv.includes('--replace');
const ssl = (url) => (url.includes('sslmode=require') ? 'require' : undefined);

// Parents before children, so foreign keys hold at every insert.
const TABLES = [
	'company_cache',
	'sparkline_cache',
	'company_growth_series_cache',
	'benchmark_series_cache',
	'nifty500_series_cache',
	'saved_valuations',
	'stage_scan_cache',
	'sector_majors',
	'sector_baskets',
	'symbol_name_cache',
	'user_sectors',
	'alerts',
	'alert_reads',
	'alert_user_prefs',
	'app_meta',
	'alert_state',
	'alert_settings',
	'valuation_versions',
	'activity_log',
	'company_notes',
	'valuation_status',
	'coverage',
	'watchlists',
	'watchlist_members',
	'user_prefs',
	'valuation_templates',
	'valuation_template_defaults'
];
const SERIAL_TABLES = ['alerts', 'valuation_versions', 'activity_log', 'company_notes', 'watchlists', 'valuation_templates'];
const PAGE_PREFIXES = ['/company/', '/sector-rotation', '/stage-scanner', '/alerts', '/compare', '/settings', '/sectors'];

const source = postgres(sourceUrl, { max: 1, ssl: ssl(sourceUrl), onnotice: () => {} });
const target = postgres(targetUrl, { max: 1, ssl: ssl(targetUrl), onnotice: () => {} });

function rewriteHref(href) {
	if (typeof href !== 'string') return href;
	return PAGE_PREFIXES.some((p) => href.startsWith(p)) ? `/valuation${href}` : href;
}

try {
	const sourceUsers = await source`select id, username, role from users`;
	const targetUsers = await target`select id, display_name from public.users`;
	const byName = new Map(targetUsers.map((u) => [u.display_name.toLowerCase(), u.id]));
	const idMap = new Map();
	const unmatched = [];
	for (const u of sourceUsers) {
		const id = byName.get(u.username.toLowerCase());
		if (id === undefined) unmatched.push(u.username);
		else idMap.set(u.id, id);
	}
	if (unmatched.length) {
		console.error(
			`No ThesisTrack user has the display name of: ${unmatched.join(', ')}.\n` +
				'Create them (or set their display_name) first, then run this again.'
		);
		process.exit(1);
	}
	const mapUser = (id) => {
		const mapped = idMap.get(id);
		if (mapped === undefined) throw new Error(`row references unknown dashboard user id ${id}`);
		return mapped;
	};

	await target.begin(async (tx) => {
		if (replace) {
			await tx.unsafe(`truncate ${TABLES.map((t) => `valuation.${t}`).join(', ')} restart identity cascade`);
		} else {
			for (const t of TABLES) {
				const [{ n }] = await tx.unsafe(`select count(*)::int as n from valuation.${t}`);
				if (n > 0) throw new Error(`valuation.${t} already has ${n} rows - rerun with --replace to overwrite`);
			}
		}

		for (const table of TABLES) {
			const rows = await source.unsafe(`select * from public.${table}`);
			if (rows.length === 0) {
				console.log(`  ${table}: 0`);
				continue;
			}
			const mapped = rows.map((r) => {
				const row = { ...r };
				if ('user_id' in row) row.user_id = mapUser(row.user_id);
				if (table === 'valuation_template_defaults' && row.scope.startsWith('user:')) {
					row.scope = `user:${mapUser(Number(row.scope.slice(5)))}`;
				}
				if (table === 'alerts') row.href = rewriteHref(row.href);
				return row;
			});
			// Insert in chunks - postgres caps a statement at 65535 parameters.
			const columns = Object.keys(mapped[0]);
			const chunk = Math.max(1, Math.floor(60000 / columns.length));
			for (let i = 0; i < mapped.length; i += chunk) {
				await tx`insert into ${tx('valuation.' + table)} ${tx(mapped.slice(i, i + chunk), columns)}`;
			}
			console.log(`  ${table}: ${rows.length}`);
		}

		for (const table of SERIAL_TABLES) {
			await tx.unsafe(
				`select setval(pg_get_serial_sequence('valuation.${table}', 'id'), coalesce((select max(id) from valuation.${table}), 0) + 1, false)`
			);
		}

		for (const u of sourceUsers.filter((x) => x.role === 'admin')) {
			await tx`update public.users set role = 'admin' where id = ${mapUser(u.id)}`;
			console.log(`  ${u.username} is an admin`);
		}
	});
	console.log('Valuation data copied.');
} catch (e) {
	console.error(`Copy failed, nothing was changed: ${e.message}`);
	process.exitCode = 1;
} finally {
	await source.end();
	await target.end();
}
