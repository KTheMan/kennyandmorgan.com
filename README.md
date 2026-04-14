# Kenny & Morgan's Wedding Website

A beautiful, responsive wedding website built with vanilla JavaScript, HTML, and CSS.

## Features

### 🏠 Home Page
- Elegant display of wedding date and location
- Live countdown timer to the wedding day
- Beautiful, responsive design with wedding color scheme

### 📬 Address Collection
- Form to collect guest addresses for save the dates and invitations
- Stores submissions in Supabase when `site.config.json` is configured
- Email validation and required field handling

### 💌 RSVP System
- Comprehensive RSVP form with attendance confirmation
- Guest count tracking
- Dietary restrictions and allergy notes
- Song requests for the reception
- Special messages for the couple
- Party lookup can run against Supabase RPCs (recommended for GitHub Pages) or the legacy local SQLite API
- RSVP submissions are written to Supabase in GitHub Pages mode, with the legacy SQLite flow still available for local server mode

### 🎨 Theme Information
- Wedding color palette display with interactive swatches
- Dress code information
- Wedding style description

### 🎁 Gift Registry
- Links guests to a single shared MyRegistry page: `https://www.myregistry.com/giftlist/morganandkenny`
- Can optionally preview stored registry items from Supabase
- Keeps the wedding site static-hosting friendly for GitHub Pages

### 🔐 Admin Console
- Password-protected dashboard at `admin.html`
- Shares the same overlay password flow as the main site and can validate passwords against Supabase
- Live table view of all guests with CRUD actions
- CSV import utility for quickly loading or updating the roster (now with address columns)
- Manual guest form with RSVP status, meal choice, and dietary note fields

## Color Palette

- **Tan** (#D4A373) - Warm, inviting primary color
- **Brown** (#8B4513) - Rich, elegant accent
- **Slate Gray** (#2F4F4F) - Sophisticated neutral
- **Antique White** (#FAEBD7) - Soft background
- **Dark Olive Green** (#556B2F) - Natural accent

## Technical Details

### Technologies Used
- **HTML5** - Semantic markup
- **CSS3** - Modern styling with CSS Grid and Flexbox
- **Vanilla JavaScript** - Frontend interactions and admin console UI
- **Supabase** - Recommended backend for GitHub Pages hosting (access control, RSVPs, guest management, address storage, optional registry previews)
- **Node.js + Express + SQLite** - Legacy local API mode that still works for local development
- **bcryptjs & csv-parse** - Legacy local admin authentication + CSV import helpers
- **LocalStorage API** - Localhost fallback for static previews/tests

### File Structure
```
kennyandmorgan.com/
├── index.html          # Main HTML file with all sections
├── admin.html          # Password-protected admin portal
├── styles.css          # Complete styling and responsive design
├── script.js           # All JavaScript functionality
├── admin.js            # Admin console interactions
├── server.js           # Express API (registry + RSVP)
├── db/                 # SQLite helpers and seed utilities
└── README.md           # This file
```

### Responsive Design
- Mobile-first approach
- Breakpoints at 768px and 480px
- Hamburger menu for mobile devices
- Optimized layouts for all screen sizes

## How to Use

### Basic Setup (Static Site Only)
1. Clone the repository
2. Open `index.html` in a web browser
3. No build process required!

### GitHub Pages + Supabase Setup (Recommended)

1. **Install dependencies**
```bash
npm install
```

2. **Configure the runtime file used by GitHub Pages**
```bash
cp site.config.example.json site.config.json
```

3. **Set up Supabase**
   - Open the SQL editor in Supabase and run `supabase/schema.sql`
   - Seed your access passwords (and optional registry preview rows) with `supabase/seed.example.sql`
   - Verify Row Level Security stays enabled on each Supabase table before publishing with the anon key
   - `site.config.json` already points at the provided Supabase project URL and publishable key, so GitHub Pages can use it at runtime

4. **Enable GitHub Pages**
   - Merge the Pages workflow in `.github/workflows/deploy-pages.yml`
   - In GitHub repository settings, enable Pages to deploy from GitHub Actions

5. **Publish**
   - Push to `main`
   - GitHub Actions deploys the static site

> Because GitHub Pages serves static files, `site.config.json` is the runtime equivalent of a `.env.local` file for this project.

### Legacy Local Server Setup

#### Quick Start

**Linux/Mac:**
```bash
./start-dev.sh
```

**Windows:**
```batch
start-dev.bat
```

This will:
1. Install dependencies
2. Create .env file from template (if not exists)
3. Start backend API server on port 3000
4. Start frontend server on port 8000

#### Manual Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your registry IDs
```

3. **Start backend server:**
```bash
npm start
# Server runs on http://localhost:3000
```

4. **Start frontend server (in another terminal):**
```bash
npx http-server . -p 8000
# Or use any other static file server
# Frontend accessible at http://localhost:8000
```

### Configuration Overview

For GitHub Pages deployments, configure `site.config.json`:

- `registryPageUrl`: the shared MyRegistry page guests should use
- `supabase.url` / `supabase.anonKey`: public runtime values for the Supabase project
- `supabase.sessionTtlMs`: browser session length for access tokens
- `localFallbackAccess`: optional localhost-only passwords for static previews/tests

For the legacy Node server flow, the original `.env` configuration still works through `config/index.js`:

All runtime options flow through `config/index.js`, which normalizes environment variables and exposes a single config object to the rest of the app. Key sections:

- `server`: `PORT` plus any future server toggles.
- `cors`: `ALLOWED_ORIGINS` list (comma separated; use `*` to allow everyone for quick demos).
- `admin`: `ADMIN_PASSWORD`, `ADMIN_SESSION_TTL_MS`, `ADMIN_SALT_ROUNDS`.
- `access`: `ACCESS_PASSWORD_FAMILY`, `ACCESS_PASSWORD_PARTY`, `ACCESS_PASSWORD_ADMIN` seed the password overlay (the server hashes and stores them automatically—`ACCESS_PASSWORD_ADMIN` defaults to `Binx123!`).
- `database`: `DATABASE_PATH` / `GUEST_DB_PATH` toggle for the SQLite file.
- `registry`: Poll intervals (`REGISTRY_*`), fast-poll knobs, and the per-store registry IDs (`AMAZON_REGISTRY_ID`, `TARGET_REGISTRY_ID`, etc.).

Update `.env` as usual and restart the server—everything else reads from the shared config module so you never have to chase `process.env` usage across files again.

### Accessing the Admin Console

On GitHub Pages, unlock the main site with the admin-level password stored in Supabase, then open `admin.html`. The front-end stores the returned token in `localStorage` and reuses it for admin RPC calls. In legacy local server mode, the same flow still works through `/api/access/login`.

### Password Overlay & Access Tokens
- In GitHub Pages mode, the password modal calls Supabase RPC functions defined in `supabase/schema.sql`.
- Successful logins receive a bearer token (default TTL: one hour) saved as `km_access_token` in `localStorage`.
- Configure separate family/party/admin tiers in the `access_passwords` table.

See [API_README.md](API_README.md) for detailed API documentation.
See [DEPLOYMENT.md](DEPLOYMENT.md) for production deployment instructions.

### Customization

#### Update Wedding Details
Edit `index.html` to change:
- Couple names (line 33)
- Wedding date (line 37)
- Location and address (lines 40-43)
- Ceremony time (line 46)

#### Change Countdown Date
Edit `script.js` line 51:
```javascript
const weddingDate = new Date('2026-06-15T16:00:00').getTime();
```

#### Customize Colors
Edit the CSS variables in `styles.css` (lines 8-14):
```css
:root {
    --primary-tan: #D4A373;
    --primary-brown: #8B4513;
    --slate-gray: #2F4F4F;
    --antique-white: #FAEBD7;
    --olive-green: #556B2F;
}
```

#### Backend Notes

- GitHub Pages mode reads and writes through Supabase using the helpers in `site-config.js` and `data-client.js`.
- Legacy local mode still uses `server.js` and the SQLite-backed helpers in `db/`.
- Registry scraping is no longer the primary production path; guests should use the shared MyRegistry page, while optional preview items can be stored in Supabase.

## Free-tier fallback if Supabase is not a fit

If Supabase ends up feeling heavy for this repo, the best free-tier replacement is **Cloudflare Pages + D1 + Workers**:

- It keeps the same static-site deployment model as GitHub Pages
- D1 can store guests, RSVPs, addresses, and access-password metadata cheaply
- A small Worker can replace the Supabase RPC layer for auth and admin actions

Other workable free tiers: **Firebase Spark** (Firestore/Auth) or **Appwrite Cloud** if you want a more turnkey dashboard.
  - `target.js`: Target registry scraper
  - `crateandbarrel.js`: Crate & Barrel registry scraper
- **Frontend Updates** (`script.js`): Updated to call backend API

**Features:**

- Real-time registry data fetching
- Automatic fallback to mock data
- Store filtering (Amazon, Target, Crate & Barrel, or All)
- Error handling and graceful degradation
- CORS-compliant API design

**Note:** For production use, consider:
- Using official APIs (e.g., Amazon Product Advertising API)
- Implementing caching to reduce requests
- Adding rate limiting
- Reviewing each store's terms of service

### Guest Lookup, RSVP Storage & Admin Tools (SQLite)

The RSVP flow now talks directly to SQLite. Guests can locate their party (via a Fuse.js fuzzy search that still requires first+last name input), give every invited person an accept/decline response, pick meals for those attending, and even rename placeholder “Guest” entries before submitting. Dietary notes and song requests still travel with the party, and everything is saved via the Express API.

1. **Install dependencies (already included):** `better-sqlite3`
2. **Create or seed the guest database:**

```bash
npm run seed:guests               # Loads data/guests.sample.json
npm run seed:guests custom.json   # Provide your own JSON array
```

Seed files expect objects shaped like:

```json
{
    "fullName": "Alex Guest",
    "email": "alex@example.com",
    "groupId": "GUEST-001",
    "isPrimary": true,
    "isPlusOne": false,
    "notes": "Welcome party"
}
```

3. **Configure the database path (optional):**

Set `GUEST_DB_PATH` in `.env` if you want the SQLite file somewhere other than `data/guests.db`.

4. **Run the API:** `npm start`

- `GET /api/guests/search?name=` powers the "Find My Party" button.
- `POST /api/rsvp` records each guest’s RSVP status, meal choice, and optional plus-one name while also storing party-level dietary notes and song requests.
- `admin.html` uses `/api/admin/*` routes for authentication, CRUD, and CSV import/export workflows.

Use `admin.html` after logging in with `ADMIN_PASSWORD` to oversee RSVP statuses, edit guests, or bulk import CSV data. The importer now natively reads The Knot exports (`First Name`, `Last Name`, `Party`, `Street Address 1/2`, `Wedding Day - RSVP`, etc.) in addition to our legacy headers (`fullName`, `groupId`, `isPrimary`, `mealChoice`, `dietaryNotes`, `addressLine1`, `addressLine2`, `city`, `state`, `postalCode`, …).

### Registry Cache & Fast Polling

- Registry scrapers still power the data, but their results are written to SQLite via `db/registryCache.js`.
- `REGISTRY_POLL_INTERVAL_MS` controls the slow cadence (defaults to 1 hour) for refreshing each store.
- Every item tracks wanted and purchased quantities; if the upstream site omits them we retain the previously cached value.
- When a guest clicks “View on …” we hit `POST /api/registry/items/:cacheId/fast-poll`, which:
    1. Flags that item for accelerated polling for 30 minutes (`REGISTRY_FAST_POLL_DURATION_MS`).
    2. The fast-poll worker re-fetches the store every `REGISTRY_FAST_POLL_INTERVAL_MS` (default 120s) while the flag is active.
    3. The UI shows “Live refresh” for items currently in the fast lane.
- Extra knobs: `REGISTRY_FAST_POLL_SWEEP_MS` (how often we look for candidates) and `REGISTRY_FAST_POLL_BATCH_LIMIT` (how many stores/items to refresh per sweep).
- API helpers: `GET /api/registry?store=amazon&includeUnavailable=true` pulls directly from the cache, while `forceRefresh=true` on either `/api/registry` or `/api/registry/:store` will trigger a one-off fetch before returning cached data.

## Deployment

### GitHub Pages
This site is ready for GitHub Pages deployment:

1. Go to repository Settings
2. Navigate to Pages section
3. Select source: Deploy from a branch
4. Choose branch: main or master
5. Select folder: / (root)
6. Click Save

Your site will be available at: `https://username.github.io/repository-name/`

### Custom Domain
To use a custom domain:
1. Add a `CNAME` file with your domain
2. Configure DNS settings at your domain registrar
3. Update GitHub Pages settings

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Future Enhancements

Potential additions:
- Photo gallery
- Wedding party introductions
- Accommodation suggestions
- Transportation information
- Wedding schedule/timeline
- Guest book
- Live streaming link
- Real-time RSVP count display

## License

This project is open source and available for anyone to use for their own wedding website.

## Contact

For questions or support, please contact the repository owner.

---

Made with ❤️ for Kenny & Morgan
