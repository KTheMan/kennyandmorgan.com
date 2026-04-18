# Deployment Guide

## Production model

- deploy the site with **GitHub Pages**
- store guest/admin data and cached registry items in **Supabase**
- proxy the **MyRegistry** gift list through a Supabase Edge Function so guests see live registry data in the site's own theming

## Supabase setup

1. Open the Supabase SQL editor.
2. Run or re-run `supabase/schema.sql` to create/update tables, RPCs, and supporting functions.
3. Run `supabase/seed.example.sql` after replacing the sample passwords.
4. Verify Row Level Security is enabled on every table.

## Supabase Edge Functions

The `fetch-registry` Edge Function proxies registry data from MyRegistry, caches it in the
`registry_items` table, and returns the items to the static site. It refreshes the cache
whenever it is older than 10 minutes by default (configurable via the `REGISTRY_CACHE_TTL_SECONDS`
environment variable on the Edge Function).

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

`deploy-edge-functions.yml` deploys Edge Functions automatically on every push to `main`
that changes files under `supabase/functions/`. It requires:

- **Repository secret**: `SUPABASE_ACCESS_TOKEN` – your Supabase personal access token
- **Repository variable**: `SUPABASE_PROJECT_ID` – your Supabase project reference ID

### Optional: custom cache TTL or registry URL

Set these environment variables on the `fetch-registry` function in the Supabase dashboard
(**Edge Functions → fetch-registry → Environment Variables**):

| Variable | Default | Description |
|---|---|---|
| `MYREGISTRY_URL` | `https://www.myregistry.com/giftlist/morganandkenny` | Full gift list URL |
| `REGISTRY_CACHE_TTL_SECONDS` | `600` | How long (seconds) to cache items before re-fetching |

## Runtime config

GitHub Pages is static, so runtime values live in `site.config.json`.

Start from:

```bash
cp site.config.example.json site.config.json
```

`site.config.json` is now a local-only file and is ignored by Git.

For GitHub Pages deployments, the workflow generates `site.config.json` from GitHub Actions variables and secrets.

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

See `SECURITY.md` for the full public-repository hardening checklist and secret migration walkthrough.

## Local preview

```bash
npm install
npx http-server . -p 8000
```

## Free-tier fallback

If Supabase is not the right fit, the best free-tier replacement is **Cloudflare Pages + Workers + D1**.
