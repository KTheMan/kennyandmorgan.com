# Kenny & Morgan's Wedding Website

A beautiful, responsive wedding website built with vanilla JavaScript, HTML, and CSS.

## Features

### 🏠 Home Page
- Elegant display of wedding date and location
- Live countdown timer to the wedding day
- Beautiful, responsive design with wedding color scheme

### 📬 Address Collection
- Form to collect guest addresses for save the dates and invitations
- Client-side storage using localStorage (can be connected to a backend)
- Email validation and required field handling

### 💌 RSVP System
- Comprehensive RSVP form with attendance confirmation
- Guest count tracking
- Dietary restrictions and allergy notes
- Song requests for the reception
- Special messages for the couple
- Party lookup backed by SQLite so guests can search by name
- RSVP submissions are written to the SQLite database with meal choices and dietary notes

### 🎨 Theme Information
- Wedding color palette display with interactive swatches
- Dress code information
- Wedding style description

### 🎁 Gift Registry
- Aggregated view of items from multiple stores
- Filter by store (Amazon, Target, Crate & Barrel)
- Mock data with placeholder for real registry integration
- Direct links to purchase items

### 🔐 Admin Console
- Password-protected dashboard at `admin.html`
- Login against the hashed `ADMIN_PASSWORD` configured in `.env`
- Live table view of all guests with CRUD actions
- CSV import utility for quickly loading or updating the roster
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
- **Node.js + Express** - API for registry scraping, RSVP submissions, and admin routes
- **SQLite (better-sqlite3)** - Guest roster, RSVPs, and admin settings
- **bcryptjs & csv-parse** - Admin authentication + CSV import helpers
- **LocalStorage API** - Address form demo persistence

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

### Full Setup (With Registry API)

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
python3 -m http.server 8000
# Or use any other static file server
# Frontend accessible at http://localhost:8000
```

### Accessing the Admin Console

After both servers are running, visit `http://localhost:8000/admin.html` (or the equivalent static host path) and log in with the `ADMIN_PASSWORD` defined in your `.env`. Successful login unlocks the guest table, CRUD form, and CSV importer.

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

#### Connect to Backend
The address collection form currently uses LocalStorage as a demo. To wire it (or any additional forms) to your backend:

1. Update `handleAddressSubmit()` in `script.js`:
```javascript
async function handleAddressSubmit(form) {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    
    const response = await fetch('YOUR_API_ENDPOINT/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    
    // Handle response...
}
```

2. Similar updates for any other forms that should write to the server (the RSVP form is already connected to `/api/rsvp`).

#### Implement Real Registry Scraping

The registry section now includes a working backend API for scraping. See [API_README.md](API_README.md) for detailed documentation.

**Quick Setup:**

1. **Install Dependencies:**
```bash
npm install
```

2. **Configure Registry IDs:**
```bash
cp .env.example .env
# Edit .env with your registry IDs
```

3. **Start the Backend Server:**
```bash
npm start
```

4. **Update Frontend Configuration:**
   - For local development, the frontend automatically connects to `http://localhost:3000`
   - For production, set the `API_URL` environment variable

**Architecture:**

- **Backend API** (`server.js`): Express server handling API requests
- **Scraper Modules** (`scrapers/`): Store-specific scraping logic
  - `amazon.js`: Amazon registry scraper
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

The RSVP flow now talks directly to SQLite. Guests can locate their party, submit responses (including meal selections and dietary notes), and the data is saved via the Express API.

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
- `POST /api/rsvp` records the RSVP, meal choice, dietary notes, and song request, while updating every guest in the selected party.
- `admin.html` uses `/api/admin/*` routes for authentication, CRUD, and CSV import/export workflows.

Use `admin.html` after logging in with `ADMIN_PASSWORD` to oversee RSVP statuses, edit guests, or bulk import CSV data (the importer accepts headers such as `fullName`, `groupId`, `isPrimary`, `mealChoice`, `dietaryNotes`, etc.).

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