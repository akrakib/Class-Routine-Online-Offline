# Class Routine 2.0 — setup and deployment

## Architecture

- Android client: existing Capacitor 8.5.2 app; HTML/CSS/JavaScript remains in `www/`.
- API and admin hosting: one Cloudflare Worker with Workers Static Assets serving `admin/`.
- Database: Cloudflare D1 (`backend/migrations/`).
- Public API: `GET /api/routine?group=A|B` only returns published class rows and published announcements.
- Admin API: session-cookie protected endpoints under `/api/admin/*`.
- Offline: Capacitor Preferences caches each group independently. A failed request never clears the last valid cache. Routine requests use ETags and a 30-minute background refresh interval.

## 1. Cloudflare account and tools

1. Create/sign in to a Cloudflare account.
2. Install Node.js 20+ and npm.
3. From `backend/`, run `npm install`.
4. Authenticate Wrangler: `npx wrangler login`.

## 2. Create D1 and configure the Worker

From `backend/`:

```sh
npx wrangler d1 create class-routine-db
```

Copy the returned database UUID into `backend/wrangler.toml` in place of `REPLACE_WITH_D1_DATABASE_ID`.

Apply the migrations:

```sh
npx wrangler d1 migrations apply class-routine-db --remote
```

Migration `0002_seed_group_b.sql` imports the existing supplied 4th Semester Group B routine. Group A starts empty until the administrator adds and publishes its classes.

## 3. Create the first administrator

There is no public registration endpoint. Generate a PBKDF2-SHA256 password hash locally. Choose a unique username and a password of at least 14 characters.

PowerShell:

```powershell
$env:ADMIN_USERNAME = "your-admin-username"
$env:ADMIN_PASSWORD = Read-Host "Enter a strong admin password"
node scripts/create-admin-hash.mjs | Set-Content -Encoding utf8 admin-user.sql
Remove-Item Env:ADMIN_PASSWORD
```

Bash:

```sh
read -r -p 'Admin username: ' ADMIN_USERNAME
read -r -s -p 'Admin password (14+ chars): ' ADMIN_PASSWORD; echo
export ADMIN_USERNAME ADMIN_PASSWORD
node scripts/create-admin-hash.mjs > admin-user.sql
unset ADMIN_PASSWORD
```

Execute the generated SQL:

```sh
npx wrangler d1 execute class-routine-db --remote --file=admin-user.sql
```

Delete `admin-user.sql` after successful execution. It contains only the salted password hash, not the plaintext password. Never commit it to GitHub. The database stores PBKDF2-SHA256 hashes (310,000 iterations), not passwords.

## 4. Configure origins and deploy

Edit `backend/wrangler.toml`:

- Set `APP_ORIGIN` to the final HTTPS Worker URL (for example `https://class-routine-api.<account>.workers.dev`).
- Set `ALLOWED_ORIGINS` to `capacitor://localhost,http://localhost` for the Android WebView origins. Add any custom web app origin only if you intentionally host the student app on a separate domain.

Deploy:

```sh
npx wrangler deploy
```

The Admin Panel is served at the Worker root URL. Sign in using the username/password created in step 3. Do not create student accounts.

## 5. Connect the Android app to the API

Edit `www/app-config.js` and set:

```js
window.CLASS_ROUTINE_API_URL = 'https://YOUR-WORKER-URL.workers.dev';
```

Then from the project root:

```sh
npm install
npx cap sync android
npx cap open android
```

Build the APK in Android Studio using **Build → Build Bundle(s) / APK(s) → Build APK(s)**. Routine content updates are delivered from D1 and do not require a new APK. Changes to the app's HTML/JavaScript/native code do require a new APK build and release.

## 6. Test checklist

- [ ] First launch displays Group A / Group B selection.
- [ ] Selected group persists after force-close/restart.
- [ ] Settings allows switching groups.
- [ ] Group A and B show only their own published classes.
- [ ] Group B seeded routine matches the existing supplied app.
- [ ] Admin can log in; no student login/registration is present.
- [ ] Admin can add, edit, delete and publish classes for each group.
- [ ] Admin can publish announcements for one group or all groups.
- [ ] Unpublished classes are not returned by the public API.
- [ ] ETag returns 304 when routine/announcement counts and publication timestamp are unchanged.
- [ ] After one successful sync, disable internet and verify the last routine remains visible.
- [ ] Change group while offline and verify that group's own cache/empty state is shown.
- [ ] Re-enable internet and verify the routine synchronizes.

## Security notes

- Administrator credentials are never embedded in frontend code or Android assets.
- Admin sessions use random 256-bit tokens; only SHA-256 token hashes are stored in D1. Browser cookie is `HttpOnly`, `Secure`, `SameSite=Strict`.
- Login uses PBKDF2-SHA256 and D1-backed per-IP throttling (six failed attempts per 15-minute window).
- Admin endpoints require a valid session; public API is read-only and returns only published records.
- All SQL values use D1 prepared statement bindings.
- CORS is allow-listed. Keep the list limited to the Worker origin and the Capacitor origins.
- Use HTTPS only. Do not publish database IDs as secrets (they are identifiers), and do not commit admin SQL, passwords, tokens, or Wrangler credentials.

## Free-tier note

The design uses Cloudflare Workers, Workers Static Assets, and D1. Their current free-tier limits and availability are controlled by Cloudflare and may change; check the Cloudflare dashboard before launch. No Firebase or paid third-party service is required by this source project.
