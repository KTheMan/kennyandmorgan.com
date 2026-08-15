# Seating Chart

A hard fork of [gabriel1ll7/Seating-Planner](https://github.com/gabriel1ll7/Seating-Planner)
("Seating.Art"), adapted to run as static assets served from
`kennyandmorgan.com/seating-chart/` against this repo's own Supabase
project, instead of Seating-Planner's original Express + PostgreSQL
server. We don't run or maintain upstream Seating-Planner's backend —
this fork replaces it entirely.

## What changed from upstream

- **Backend**: Seating-Planner's Express routes are replaced by the
  `seating-chart-api` Supabase Edge Function
  (`../supabase/functions/seating-chart-api`) — a stateless "worker"
  instead of a long-running Node process + its own PostgreSQL database.
  All auth/hashing/rate-limiting logic lives in Postgres RPCs
  (`../supabase/migrations/20260816090000_seating_chart_view_edit_pins.sql`
  and the multi-venue migration before it), called only via the worker's
  service-role client — none of those RPCs are reachable directly from
  the browser.
- **Multiple venues, shareable by link, two independent PINs**: each
  chart has a slug (`?v=<slug>`, since GitHub Pages can't serve arbitrary
  sub-paths for a static SPA), an **edit PIN** (always on), and an
  **optional, admin-toggleable view PIN**.
  - **Anyone with the link** can *view* a chart by default — no auth.
  - **Anyone with the link + the edit PIN** can *edit* it (editing always
    implies viewing, even if a view PIN is on).
  - Per-chart, the admin can flip a **"View PIN" switch** in the header
    to also require a PIN just to *see* that chart — useful if its guest
    list is sensitive. Off by default, so behavior is unchanged unless
    an admin turns it on for a specific chart.
  - **The site admin** (existing `km_access_token` session, reused
    because this app is served same-origin under `/seating-chart/`) has
    full access to every chart regardless of either PIN, plus a venue
    manager (list/create charts) at `/seating-chart/` with no `?v=`
    param. See `src/components/VenueGate.tsx` / `VenueManager.tsx` /
    `AdminGate.tsx`.
  - PIN attempts are rate-limited server-side per chart, per PIN kind
    (view vs. edit), per IP (10 per 15 minutes) since a 4-digit PIN is
    only 10,000 combinations.
- **Guest model matches the wedding site's own `guests` table**, not
  upstream's flat `firstName`/`lastName` pair: `fullName`, `groupId`,
  `isPrimary`, `isPlusOne`, `isChild`, meal/dietary notes (see
  `src/types/seatingChart.ts`). The sidebar's "Unassigned" list clusters
  guests by party (`groupId`) under a small header instead of a flat
  alphabetical list.
- **Guest import connector**: a "Sync Accepted Guests" button in the
  sidebar (`src/lib/api/guestConnector.ts`), **admin-only** — PIN-only
  editors can add guests manually but never trigger a pull of the real
  RSVP list. Pulls accepted RSVPs grouped by party from the wedding
  site's `guests` table via the worker, and drops any not already on the
  canvas into "Unassigned". Already-imported guests (matched by
  `weddingGuestId`) are left alone so re-syncing never disturbs seating
  you've already done.

Everything else — the canvas, drag-and-drop, table/seat model — is
upstream Seating-Planner's frontend, unmodified beyond what the above
required.

**Worth knowing:** with a chart's view PIN off (the default), anyone with
its link can view guest names/seating with zero auth, same tradeoff as
upstream. Turn a chart's view PIN on (admin-only, in the header) before
sharing it anywhere you don't fully trust, or if its guest list is
sensitive.

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
