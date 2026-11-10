import { pbkdf2Sync, randomBytes } from 'node:crypto';
const username = process.env.ADMIN_USERNAME;
const password = process.env.ADMIN_PASSWORD;
if (!username || !password || password.length < 14) {
  console.error('Set ADMIN_USERNAME and ADMIN_PASSWORD (at least 14 characters) in your shell, then run this script.');
  process.exit(1);
}
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('base64url');
const salt64 = salt.toString('base64');
const esc = s => s.replaceAll("'", "''");
console.log(`INSERT INTO admin_users(username,password_hash,password_salt) VALUES('${esc(username)}','${hash}','${salt64}');`);
