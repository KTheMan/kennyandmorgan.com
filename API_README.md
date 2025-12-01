# Registry API Documentation

## Overview

This is a backend API service that handles registry scraping and aggregation for the Kenny & Morgan wedding website. It fetches registry items from multiple stores (Amazon, Target, Crate & Barrel) and provides them through a RESTful API.

## Setup

### Prerequisites

- Node.js (v14 or higher)
- npm (Node Package Manager)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

3. Configure your registry IDs in `.env` (they are consumed by `config/index.js` and fed into every scraper/worker):
```
AMAZON_REGISTRY_ID=your-actual-amazon-registry-id
TARGET_REGISTRY_ID=your-actual-target-registry-id
CRATE_AND_BARREL_REGISTRY_ID=your-actual-crate-and-barrel-registry-id
```

### Running the Server

Development mode:
```bash
npm start
```

The server will start on port 3000 by default (configurable via PORT environment variable).

## API Endpoints

### Health Check

**GET** `/api/health`

Check if the API is running.

**Response:**
```json
{
  "status": "ok",
  "message": "Registry API is running"
}
```

### Access Tokens & Overlay Passwords

The site-wide overlay and the admin console both authenticate through these endpoints. All passwords are hashed with bcrypt and stored in the `admin_settings` table—no plaintext secrets leave the server.

**POST** `/api/access/login`

- Body: `{ "password": "Binx123!" }`
- Response:
```json
{
  "success": true,
  "token": "<bearer token>",
  "accessLevel": "admin",
  "expiresIn": 3600000
}
```

**GET** `/api/access/session`

- Requires `Authorization: Bearer <token>` header.
- Returns the current access level so the frontend can resume sessions without re-prompting for a password.

**POST** `/api/access/logout`

- Requires the same bearer token header and revokes the session immediately.

> ℹ️ Only the admin-level password (defaults to `Binx123!` or `ACCESS_PASSWORD_ADMIN`) can access `/api/admin/*` routes. Family/party tiers stop at front-end content unlocks and will receive `403` responses if they hit privileged endpoints.

### Get All Registry Items

**GET** `/api/registry`

Fetch cached items from all registries. Results come from the SQLite registry cache; the service will lazily refresh stores that are stale unless `forceRefresh=true` is passed.

**Query Parameters:**
- `store` (optional): Filter by store name (`amazon`, `target`, `crateandbarrel`, etc., or `all`)
- `includeUnavailable` (optional): `true` to include items that were marked unavailable in the cache
- `forceRefresh` (optional): `true` to run a one-off fetch for the requested store(s) before returning cached rows

**Response:**
```json
{
  "success": true,
  "store": "all",
  "count": 12,
  "items": [
    {
      "cacheId": 42,
      "id": "amazon-1",
      "name": "KitchenAid Stand Mixer",
      "store": "amazon",
      "price": 379.99,
      "image": "https://...",
      "url": "https://amazon.com/...",
      "available": true,
      "fastPollActive": false
    }
  ]
}
```

### Get Items from Specific Store

**GET** `/api/registry/:store`

Fetch cached items from a specific store, with the same `includeUnavailable` and `forceRefresh` query parameters described above.

**Parameters:**
- `store`: Store name (`amazon`, `target`, or `crateandbarrel`)

**Response:**
```json
{
  "success": true,
  "store": "amazon",
  "count": 4,
  "items": [...]
}
```

### Schedule Fast Polling for a Single Item

**POST** `/api/registry/items/:id/fast-poll`

Marks a cached item (referenced by `cacheId`) for accelerated refreshes. Useful when guests click through to a store product page.

**Response:**
```json
{
  "success": true,
  "cacheId": 42,
  "store": "amazon",
  "fastPollUntil": "2025-12-01T18:45:00.000Z",
  "fastPollActive": true
}
```

## Architecture

### Scraper Modules

The API uses a modular scraper architecture with separate modules for each store:

- **`scrapers/amazon.js`**: Amazon registry scraper
- **`scrapers/target.js`**: Target registry scraper
- **`scrapers/crateandbarrel.js`**: Crate & Barrel registry scraper

Each scraper module:
1. Pulls registry IDs from `config.registry.storeIds` (populated from `.env`).
2. Attempts to fetch real registry data when configured with a valid registry ID.
3. Falls back to mock data if no ID is set or the remote call fails.

### Cache & Poller

- `services/registryService.js` coordinates scrapes, writes everything to SQLite via `db/registryCache.js`, and exposes helper functions to the Express routes.
- `refreshAllStores()` runs at boot so caches warm up before the first request.
- `startPolling()` keeps stores fresh by:
  - Doing a slow sweep every `REGISTRY_POLL_INTERVAL_MS` (default: hourly) to refresh stale stores.
  - Running a fast-poll loop that watches for items flagged by `/api/registry/items/:id/fast-poll` and temporarily re-polls their stores every `REGISTRY_FAST_POLL_INTERVAL_MS`.
- Registry APIs never hit the scrapers directly; everything goes through the cache for predictable latency and rate limiting.

### Error Handling

The API includes comprehensive error handling:
- Invalid store names return 400 Bad Request
- Scraping errors are logged and return mock data
- Network errors return 500 Internal Server Error
- Failed stores in aggregate requests don't break the entire response

## Web Scraping Notes

### Important Considerations

1. **CORS**: Web scraping requires a backend service because browsers block cross-origin requests.

2. **Rate Limiting**: Registry sites may rate-limit or block automated requests. Consider:
   - Adding delays between requests
   - Implementing caching
   - Using official APIs where available

3. **Terms of Service**: Review each store's terms of service before scraping.

4. **HTML Changes**: Store websites change their HTML structure frequently. Scrapers may need updates.

### Recommended Approach

**Use Official APIs when available:**

- **Amazon**: Amazon Product Advertising API (requires approval)
  - Apply at: https://affiliate-program.amazon.com/
  - Provides official access to product data
  
- **Target**: Check Target's developer documentation for registry APIs

- **Crate & Barrel**: May require web scraping or contact their developer support

### Current Implementation

The current implementation:
- Uses basic HTML parsing with Cheerio
- Includes user-agent headers to mimic browser requests
- Has timeout protection (10 seconds)
- Falls back to mock data on errors

For production use, you should:
1. Apply for and use official APIs where available
2. Implement caching to reduce requests
3. Add rate limiting
4. Consider using a proxy service for scraping
5. Monitor and update selectors when sites change

## Security

### Environment Variables

Never commit your `.env` file to version control. It contains:
- Registry IDs
- API keys
- Secret credentials

The `.gitignore` file is configured to exclude `.env`.

### CORS Configuration

The API uses CORS middleware to control which origins can access it. Configure allowed origins in `.env`:

```
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
```

## Deployment

### Heroku

1. Create a Heroku app
2. Set environment variables in Heroku dashboard
3. Deploy:
```bash
git push heroku main
```

### Vercel/Netlify

These platforms support serverless functions. You may need to adapt the Express app to serverless format.

### AWS/DigitalOcean

Deploy as a standard Node.js application with PM2 or similar process manager.

## Development

### Mock Data

When registry IDs are not configured, the API returns mock data. This allows:
- Development without real registry accounts
- Testing the frontend
- Demonstrating functionality

### Testing

Test API endpoints with curl:

```bash
# Health check
curl http://localhost:3000/api/health

# All registries
curl http://localhost:3000/api/registry

# Specific store
curl http://localhost:3000/api/registry/amazon

# Filter all registries
curl "http://localhost:3000/api/registry?store=target"
```

## Troubleshooting

### Server won't start

- Check if port 3000 is available
- Verify all dependencies are installed (`npm install`)
- Check for syntax errors in `.env` file

### No items returned

- Verify registry IDs are correct
- Check server logs for scraping errors
- Ensure network connectivity
- Registry sites may be blocking requests

### CORS errors

- Add your frontend URL to `ALLOWED_ORIGINS` in `.env`
- Restart the server after changing `.env`

## License

MIT - Same as the main wedding website project
