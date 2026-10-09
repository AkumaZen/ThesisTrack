// Resets one user's password on production. Reads the production URL from the
// given .env file internally - never logs it. Usage:
//   node _prod_reset_password.mjs <envFile> <email> <newPassword>
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { productionDatabaseUrl } from './_prod_db.mjs';

const [envPath, email, newPassword] = process.argv.slice(2);
if (!envPath || !email || !newPassword) {
	console.error('usage: node _prod_reset_password.mjs <envFile> <email> <newPassword>');
	process.exit(1);
}

const url = productionDatabaseUrl(envPath);

// Matches web/src/lib/server/auth.ts's hashPassword() exactly - PBKDF2-
// HMAC-SHA256, 260k iterations, "saltHex$digestHex" format.
const salt = randomBytes(16);
const digest = pbkdf2Sync(newPassword, salt, 260_000, 32, 'sha256');
const hash = `${salt.toString('hex')}$${digest.toString('hex')}`;

const client = postgres(url, { max: 1, ssl: 'require' });
const result = await client`update users set password_hash = ${hash} where email = ${email} returning email`;
await client.end();

if (!result.length) {
	console.error(`No user found with email ${email}`);
	process.exit(1);
}
console.log(`Password reset for ${email}.`);
