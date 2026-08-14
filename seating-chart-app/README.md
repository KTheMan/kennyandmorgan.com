# Seating Chart

A hard fork of [gabriel1ll7/Seating-Planner](https://github.com/gabriel1ll7/Seating-Planner)
("Seating.Art"), adapted to run as static assets served from
`kennyandmorgan.com/seating-chart/` against this repo's own Supabase
project, instead of Seating-Planner's original Express + PostgreSQL
server. We don't run or maintain upstream Seating-Planner's backend —
this fork replaces it entirely.

## What changed from upstream

- **Backend**: Seating-Planner's Express routes (`POST /api/venues`,
  `GET/PUT /api/venues/:slug`, PIN validation) are replaced by the
  `seating-chart-api` Supabase Edge Function
  (`../supabase/functions/seating-chart-api`) — a stateless "worker"
  instead of a long-running Node process + its own PostgreSQL database.
- **Single venue**: this is a private, single-event tool, not the
  upstream multi-tenant/shareable-slug product. There's one fixed venue
  (`kenny-and-morgan`), no venue creation flow, and no shareable links.
- **Auth**: no PIN system. The whole app is gated behind the wedding
  site's existing admin login (see `src/components/AdminGate.tsx` /
  `src/lib/adminAuth.ts`) — sign in at `/admin.html`, then this app reuses
  that session. There is no login form here.
- **Guest import connector**: a "Sync Accepted Guests" button in the
  sidebar (`src/lib/api/guestConnector.ts`) pulls accepted RSVPs grouped
  by party from the wedding site's `guests` table via the worker, and
  drops any not already on the canvas into "Unassigned". Already-imported
  guests (matched by `weddingGuestId`) are left alone so re-syncing never
  disturbs seating you've already done.

Everything else — the canvas, drag-and-drop, table/seat model — is
upstream Seating-Planner's frontend, unmodified beyond what the above
required.

## Local development

```bash
npm install
npm run dev
```

This app fetches `../site.config.json` at runtime for its Supabase URL +
anon key, same as the main site's `site-config.js` — see the repo root
`README.md` for how that file is generated. It also expects an admin
session (`km_access_token` in localStorage) already set by signing in at
`/admin.html` on the main site, since it's served same-origin under
`/seating-chart/` in production.

## Build

```bash
npm run build
```

Output goes to `dist/`; the main site's GitHub Pages deploy workflow
copies it to `/seating-chart/`.

## License

MIT, inherited from upstream Seating-Planner — see `LICENSE`.
