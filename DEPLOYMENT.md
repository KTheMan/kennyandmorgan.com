# Deployment Guide

## Production model

- deploy the site with **GitHub Pages**
- store guest/admin data in **Supabase**
- send guests to the shared **MyRegistry** page: `https://www.myregistry.com/giftlist/morganandkenny`

## Supabase setup

1. Open the Supabase SQL editor.
2. Run `supabase/schema.sql`.
3. Run `supabase/seed.example.sql` after replacing the sample passwords.
4. Verify Row Level Security is enabled on every table.

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
