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
- admin-only seating chart (`/seating-chart`)

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
├── seating-chart-app/    # hard fork of gabriel1ll7/Seating-Planner, built to /seating-chart
├── supabase/
│   ├── schema.sql
│   ├── functions/seating-chart-api  # worker backing the seating chart fork
│   └── seed.example.sql
└── tests/
```

## Seating chart

`/seating-chart` is a hard fork of [gabriel1ll7/Seating-Planner](https://github.com/gabriel1ll7/Seating-Planner)
("Seating.Art"), built from `seating-chart-app/` and published as a static
subfolder of this site. It doesn't run upstream's Express/PostgreSQL
server — `supabase/functions/seating-chart-api` replaces that as a
Supabase Edge Function.

Charts are shareable by link (`/seating-chart/?v=<slug>`) and
PIN-protected the same way upstream's are, just backed by our own
Supabase project instead of a separate server: anyone with the link can
view a chart, anyone with the link + its PIN can edit it, and the site
admin (existing login, reused since this app is served same-origin) has
full access to every chart plus a venue manager to create/list them. A
"Sync Accepted Guests" button in the sidebar (admin-only) pulls accepted
RSVPs, grouped by party, from this site's `guests` table via that same
worker. See `seating-chart-app/README.md` for details.

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
- if your project already existed before PRs #39, #40, and #41, run `supabase/init-pr39-pr41.sql` (replace password placeholders first) to align function/table changes and reseed access hashes
- verify Row Level Security remains enabled on every table

4. Preview locally:
```bash
npx http-server . -p 8000
```

### Existing Supabase project upgrade (PRs #39, #40, #41)

1. Open Supabase SQL Editor.
2. Paste `supabase/init-pr39-pr41.sql`.
3. Replace:
   - `family-password-here`
   - `party-password-here`
   - `admin-password-here`
4. Run the script once to update functions/tables and refresh access hashes.

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
