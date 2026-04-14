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

The checked-in config already contains the provided Supabase URL and publishable key.

## GitHub Pages

This repository includes `.github/workflows/deploy-pages.yml`.

In GitHub:

1. Open **Settings → Pages**
2. Choose **GitHub Actions** as the source
3. Push to `main`

## Local preview

```bash
npm install
npx http-server . -p 8000
```

## Free-tier fallback

If Supabase is not the right fit, the best free-tier replacement is **Cloudflare Pages + Workers + D1**.
