# Deployment Guide

## Recommended production setup

This repository is now designed to run as a **static GitHub Pages site** with **Supabase** handling:

- access-password validation
- guest lookup
- RSVP submissions
- address submissions
- admin guest CRUD/import
- optional registry preview storage

The wedding registry itself now points guests to the single aggregated MyRegistry page:

`https://www.myregistry.com/giftlist/morganandkenny`

## 1. Configure Supabase

1. Create or open the Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Run `supabase/seed.example.sql` after replacing the sample passwords.
4. Optionally add preview rows to `public.registry_items` if you want the site to show saved registry cards before linking guests out to MyRegistry.

## 2. Configure the static runtime file

GitHub Pages cannot read server-side environment variables at runtime, so this project uses `site.config.json`.

The checked-in config already contains the provided Supabase URL and publishable key:

```json
{
  "registryPageUrl": "https://www.myregistry.com/giftlist/morganandkenny",
  "supabase": {
    "url": "https://hewiaylxiueuqtokaczg.supabase.co",
    "anonKey": "sb_publishable_zR9XTJhZ_xUdbQrpZ7iUzw_QwhKZxX7"
  }
}
```

If you need a fresh copy, start from `site.config.example.json`.

## 3. Enable GitHub Pages deployment

This repository includes `.github/workflows/deploy-pages.yml`.

In GitHub:

1. Open **Settings → Pages**
2. Set the source to **GitHub Actions**
3. Merge/push to `main`
4. The workflow deploys the repository root as the Pages artifact

A `.nojekyll` file is included so assets are served without Jekyll processing.

## 4. Local preview

### Static preview (closest to production)

```bash
npm install
npx http-server . -p 8000
```

### Legacy local API mode

If you still want to use the original Node/SQLite backend locally:

```bash
cp .env.example .env
npm install
npm start
npx http-server . -p 8000
```

The browser helpers prefer Supabase when configured, but the legacy `/api/*` flow still works for local development.

## Free-tier alternative if Supabase is not a fit

The cleanest free-tier replacement is **Cloudflare Pages + Workers + D1**.

Why it fits this repo well:

- static Pages-style deployment
- cheap SQLite-like storage via D1
- Workers can replace the Supabase RPC auth/admin layer
- easy to keep the MyRegistry link/proxy approach without running a full Node server

If you want a more managed product instead, Firebase Spark and Appwrite Cloud are the next-best free options.
