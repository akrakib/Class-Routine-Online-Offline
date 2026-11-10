# Class Routine 2.0

Existing Class Routine app upgraded in place. The Android client remains a Capacitor 8.5.2 application with its original single-page HTML/CSS/JavaScript interface and local preferences storage.

## App identity

- Application ID / namespace: `com.akabir.classroutine`
- Display name: `Class Routine`
- Supported initial cohorts: 4th Semester — Group A and Group B

## Project layout

```text
www/                 Student app UI and offline cache
admin/               Secure web-based admin panel
backend/src/         Cloudflare Worker API
backend/migrations/  D1 schema and Group B seed data
backend/scripts/     Secure admin hash generation helper
android/             Capacitor Android project
backups/pre-2.0/     Copies of important original files
store/               Store listing and privacy policy
```

## Android development

```sh
npm install
npx cap sync android
npx cap open android
```

Use JDK 21 for the Capacitor 8 Android build. Android SDK Platform/Build Tools must be installed through Android Studio's SDK Manager. Connect a phone with USB debugging enabled and select it as the run target.

## Backend and Admin Panel

Follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for Cloudflare D1 setup, migration, first-admin creation, Worker deployment, and connecting the app to the API. See [`docs/GITHUB.md`](docs/GITHUB.md) for source control and GitHub release guidance.

## Offline behavior

The selected semester/group and each group's last successfully fetched routine are stored locally using Capacitor Preferences. The app keeps showing cached data if the network or API is unavailable. Routine sync runs on app resume, network reconnect, and every 30 minutes; ETags avoid re-downloading unchanged routines.

## Important

The Cloudflare Worker must be deployed and `www/app-config.js` must contain its HTTPS URL before online synchronization can work. Without this deployment, the app remains usable with its local cached data and the seeded Group B routine. Building app code changes requires a new APK; routine publishing does not.
