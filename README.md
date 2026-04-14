# Kenny & Morgan's Wedding Website

A static wedding website built with HTML, CSS, and vanilla JavaScript for GitHub Pages.

## Current architecture

- **Hosting:** GitHub Pages
- **Backend:** Supabase RPCs + tables
- **Registry:** MyRegistry page only (`https://www.myregistry.com/giftlist/morganandkenny`)
- **Admin:** `admin.html` uses the same Supabase-backed access/session flow as the main site

## Features

- password-gated access tiers
- guest party lookup
- RSVP submission
- address collection
- admin guest CRUD and CSV import
- accommodations map
- direct MyRegistry link

## Project structure

```text
kennyandmorgan.com/
├── index.html
├── admin.html
├── script.js
├── admin.js
├── styles.css
├── site-config.js
├── data-client.js
├── site.config.example.json
├── supabase/
│   ├── schema.sql
│   └── seed.example.sql
└── tests/
```

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure runtime settings:
```bash
cp site.config.example.json site.config.json
```

`site.config.json` is for local use only and is ignored by Git. Do not commit populated local fallback passwords or other sensitive values.

3. In Supabase:
- run `supabase/schema.sql`
- run `supabase/seed.example.sql` after replacing the sample passwords
- verify Row Level Security remains enabled on every table

4. Preview locally:
```bash
npx http-server . -p 8000
```

## Runtime config

`site.config.json` is the runtime config file used by the static site.

- **Local development:** create it from `site.config.example.json`
- **GitHub Pages:** the deploy workflow generates it from GitHub Actions variables and secrets

```json
{
  "registryPageUrl": "https://www.myregistry.com/giftlist/morganandkenny",
  "supabase": {
    "url": "https://YOUR_PROJECT.supabase.co",
    "anonKey": "YOUR_SUPABASE_ANON_KEY",
    "sessionTtlMs": 3600000
  },
  "localFallbackAccess": {
    "familyPassword": "",
    "partyPassword": "",
    "adminPassword": ""
  }
}
```

`localFallbackAccess` only exists to make localhost previews/tests usable when Supabase is unavailable and should never be committed or deployed.

## Deployment

GitHub Pages deployment is handled by `.github/workflows/deploy-pages.yml`.

Before deploying from a public repository, configure the required GitHub Actions variables/secrets and follow `SECURITY.md`.

## Testing

Run the Playwright suite:

```bash
npm test
```

The Playwright config starts its own static server on port `4173`, so you do not need to start a separate server before running the test suite.

## Free-tier fallback if Supabase is not a fit

Best alternative: **Cloudflare Pages + Workers + D1**.
