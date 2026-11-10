# GitHub source control and deployment

## Create the repository

1. Create an empty private or public repository on GitHub (for example `class-routine-2`).
2. Open a terminal in the project root. Ensure `admin-user.sql`, `.dev.vars`, keystores, `local.properties`, `node_modules`, and build outputs are not staged; the included `.gitignore` excludes them.
3. Run:

```sh
git init
git add .
git status
git commit -m "Class Routine 2.0 source"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
git push -u origin main
```

Review `git status` before committing. Never commit admin passwords, admin-user SQL, Cloudflare API tokens, `.dev.vars`, Android signing keys, or `android/local.properties`.

## Deploy the Worker

From `backend/`, authenticate Wrangler and deploy using the instructions in `DEPLOYMENT.md`. Cloudflare D1 migrations must be applied to the intended database before deploying the API. The Worker source and Admin Panel are both versioned in this repository.

For a future CI deployment, add a GitHub Actions workflow using repository secrets for `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; grant the token only the required Workers Scripts and D1 permissions. Do not place the token in source files.

## Android releases

Routine data changes are published from the Admin Panel and do not need a new APK. When Android UI, JavaScript, native configuration, or plugins change, update the version code, build a new APK/AAB in Android Studio, and publish it as a new release. Keep the release keystore and passwords outside GitHub.
