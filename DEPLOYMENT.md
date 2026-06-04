# Deployment Guide

## Production model

- deploy the site with **GitHub Pages**
- store guest/admin data and cached registry items in **Supabase**
- proxy the **MyRegistry** gift list through a Supabase Edge Function so guests
  see live registry data in the site's own theming

## Supabase setup

Use the Supabase CLI migration workflow for all new database changes. The live
production database is treated as the source of truth through the current
baseline migration, and future changes should be added as new files in
`supabase/migrations/`.

Do not run `supabase db reset --linked`, `supabase db reset --db-url`, or the
full `supabase/schema.sql` against production. Remote reset drops user-created
database objects.

### First-time production baseline

The current production schema is captured in:

```text
supabase/migrations/20260604070000_production_baseline.sql
```

That file intentionally refuses to run against any existing database that
already contains the wedding site tables. For production, mark it as applied in
Supabase migration history instead of executing it.

After GitHub repository secrets/variables are configured, run the manual
**Baseline Supabase Database Migrations** workflow with this confirmation value:

```text
hewiaylxiueuqtokaczg/20260604070000
```

If the workflow completes and the dry run reports no pending production SQL, set
this repository variable:

```text
SUPABASE_DB_MIGRATIONS_BASELINED=true
```

Production database deployments stay disabled until that variable is set.

If Supabase reports old remote-only migration history entries, repair the
history before enabling deployment. The archived versions are:

```bash
supabase migration repair 20260529080000 20260603000000 20260604000000 20260604053000 \
  --status reverted \
  --linked
```

Then mark the baseline applied:

```bash
supabase migration repair 20260604070000 --status applied --linked
supabase db push --linked --dry-run
```

Those commands change only Supabase's migration history table. They do not drop
or rewrite guest RSVP data.

### Automated database deployment via GitHub Actions

`deploy-database.yml` deploys database migrations on pushes to `main` that
change `supabase/config.toml` or files under `supabase/migrations/`. It requires:

- **Repository secret**: `SUPABASE_ACCESS_TOKEN`
- **Repository secret**: `SUPABASE_DB_PASSWORD`
- **Repository variable**: `SUPABASE_PROJECT_ID`
- **Repository variable**: `SUPABASE_DB_MIGRATIONS_BASELINED`

`verify-database-migrations.yml` starts an ephemeral local Supabase database for
pull requests and applies the migration files there first. This only touches the
temporary CI database.

For future schema changes:

1. Create a new migration under `supabase/migrations/`.
2. Keep `supabase/schema.sql` updated as the readable current-state reference.
3. Open a PR so the local migration verification workflow runs.
4. Merge to `main`; GitHub Actions runs `supabase db push` against production.

### Database backups

Supabase manages daily backups for Pro, Team, and Enterprise projects. Free
projects should create their own logical backups with the Supabase CLI and keep
them off-site. This repo includes `backup-database.yml` for that portable backup
path.

The backup workflow:

- dumps the `public` schema
- dumps `public` table data with `COPY`
- dumps role definitions
- dumps Supabase migration history
- writes a small manifest
- encrypts the archive before uploading anything

Because this repository is public, raw backup SQL must never be committed or
uploaded as an unencrypted artifact.

Required backup configuration:

- **Repository secret**: `SUPABASE_ACCESS_TOKEN`
- **Repository secret**: `SUPABASE_DB_PASSWORD`
- **Repository secret**: `SUPABASE_BACKUP_PASSPHRASE`
- **Repository variable**: `SUPABASE_PROJECT_ID`

The encrypted GitHub Actions artifact is retained for 90 days. For longer-lived
off-site storage, configure an S3-compatible bucket such as Cloudflare R2:

- **Repository variable**: `SUPABASE_BACKUP_S3_BUCKET`
- **Repository variable**: `SUPABASE_BACKUP_S3_PREFIX` (optional)
- **Repository variable**: `SUPABASE_BACKUP_S3_REGION` (optional)
- **Repository variable**: `SUPABASE_BACKUP_S3_ENDPOINT_URL` (for R2/B2/etc.)
- **Repository secret**: `SUPABASE_BACKUP_S3_ACCESS_KEY_ID`
- **Repository secret**: `SUPABASE_BACKUP_S3_SECRET_ACCESS_KEY`

To decrypt a downloaded backup:

```bash
gpg --decrypt kennyandmorgan-supabase-*.tar.gz.gpg > backup.tar.gz
tar -xzf backup.tar.gz
```

Restore into a disposable/new database first, then verify before pointing the
production site at restored data.

## Supabase Edge Functions

The `fetch-registry` Edge Function now uses a split flow:

- `POST /functions/v1/fetch-registry` performs fast MyRegistry sync for
  presence/core fields when stale, then returns cached rows immediately.
- `POST /functions/v1/fetch-registry?mode=enrich` runs high-resolution image
  enrichment in the background path.
- `POST /functions/v1/fetch-registry?mode=enrich&limit=5` limits each enrichment
  run to a bounded batch (default `limit=5`) so cron invocations can chip away
  safely.

Fast sync stores `registry_image_url`; enrichment updates `resolved_image_url`;
clients display `resolved_image_url ?? registry_image_url`. Background
enrichment responses include batch metadata (`total_cached_items`,
`total_eligible_items`, `attempted_this_run`, `upgraded_this_run`,
`skipped_already_good`, `configured_limit_used`).

### First-time setup

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli).
2. Link your project:
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```
3. Deploy the function:
   ```bash
   supabase functions deploy fetch-registry --no-verify-jwt
   ```

### Automated deployment via GitHub Actions

`deploy-edge-functions.yml` deploys Edge Functions automatically on every push
to `main` that changes files under `supabase/functions/`. It requires:

- **Repository secret**: `SUPABASE_ACCESS_TOKEN` – your Supabase personal access
  token
- **Repository variable**: `SUPABASE_PROJECT_ID` – your Supabase project
  reference ID

### Optional: custom cache TTL or registry URL

Set these environment variables on the `fetch-registry` function in the Supabase
dashboard (**Edge Functions → fetch-registry → Environment Variables**):

| Variable                     | Default                                              | Description                                          |
| ---------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| `MYREGISTRY_URL`             | `https://www.myregistry.com/giftlist/morganandkenny` | Full gift list URL                                   |
| `REGISTRY_CACHE_TTL_SECONDS` | `600`                                                | How long (seconds) to cache items before re-fetching |

## Runtime config

GitHub Pages is static, so runtime values live in `site.config.json`.

Start from:

```bash
cp site.config.example.json site.config.json
```

`site.config.json` is now a local-only file and is ignored by Git.

For GitHub Pages deployments, the workflow generates `site.config.json` from
GitHub Actions variables and secrets.

Required configuration:

- **Repository variables**
  - `SITE_REGISTRY_PAGE_URL`
  - `SITE_SUPABASE_URL`
  - `SITE_SUPABASE_SESSION_TTL_MS`
- **Repository secrets**
  - `SITE_SUPABASE_ANON_KEY`

## GitHub Pages

This repository includes `.github/workflows/deploy-pages.yml`.

In GitHub:

1. Open **Settings → Pages**
2. Choose **GitHub Actions** as the source
3. Open **Settings → Secrets and variables → Actions**
4. Add the required variables and secret listed above
5. Push to `main` or run the workflow manually

### Wedding-party image normalization

`deploy-pages.yml` converts every non-`.png` image in `images/` into a same-name
`.png` for deployment (for example `alexis.heic` becomes `alexis.png`). The
conversion currently covers prior inputs (`.heic`, `.jpeg`, `.jpg`) plus other
common Pillow-supported formats such as `.heif`, `.avif`, `.webp`, `.gif`,
`.bmp`, and `.tiff`. If any source image cannot be converted, the deploy fails
before publishing.

See `SECURITY.md` for the full public-repository hardening checklist and secret
migration walkthrough.

## Local preview

```bash
npm install
npx http-server . -p 8000
```

## Free-tier fallback

If Supabase is not the right fit, the best free-tier replacement is **Cloudflare
Pages + Workers + D1**.
