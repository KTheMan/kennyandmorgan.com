# Registry Scraping Implementation - Summary

## What Was Built

This implementation adds a complete registry scraping and API system to the Kenny & Morgan wedding website. The system fetches registry items from multiple stores (Amazon, Target, Crate & Barrel) and displays them in an aggregated view.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Frontend (Browser)                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐        │
│  │ index.html │  │ script.js  │  │ styles.css │        │
│  └────────────┘  └────────────┘  └────────────┘        │
└─────────────────────────┬───────────────────────────────┘
                          │ HTTP Requests
                          │ (API Calls)
┌─────────────────────────▼───────────────────────────────┐
│              Backend API (Node.js/Express)               │
│  ┌──────────────────────────────────────────────────┐   │
│  │                  server.js                       │   │
│  │  • Health check endpoint                         │   │
│  │  • Registry aggregation endpoint                 │   │
│  │  • Store-specific endpoints                      │   │
│  └──────────────────────────────────────────────────┘   │
│                          │                               │
│  ┌──────────────────────┴────────────────────────────┐  │
│  │               Scraper Modules                     │  │
│  │  ┌────────┐  ┌────────┐  ┌─────────────────┐     │  │
│  │  │Amazon  │  │Target  │  │Crate & Barrel   │     │  │
│  │  │Scraper │  │Scraper │  │Scraper          │     │  │
│  │  └────────┘  └────────┘  └─────────────────┘     │  │
│  └───────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────┘
                           │ Web Scraping / API Calls
┌──────────────────────────▼──────────────────────────────┐
│                  External Registry Sites                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐      │
│  │ Amazon   │  │ Target   │  │ Crate & Barrel   │      │
│  │ Registry │  │ Registry │  │ Registry         │      │
│  └──────────┘  └──────────┘  └──────────────────┘      │
└─────────────────────────────────────────────────────────┘
```

## Files Created

### Backend API
- **`server.js`** - Main Express server with API endpoints
- **`scrapers/amazon.js`** - Amazon registry scraper
- **`scrapers/target.js`** - Target registry scraper
- **`scrapers/crateandbarrel.js`** - Crate & Barrel registry scraper
- **`package.json`** - Node.js dependencies and scripts
- **`.env.example`** - Environment variable template

### Documentation
- **`API_README.md`** - Comprehensive API documentation
- **`DEPLOYMENT.md`** - Deployment guide for various platforms
- **`SUMMARY.md`** - This file

### Developer Tools
- **`start-dev.sh`** - Development environment setup for Linux/Mac
- **`start-dev.bat`** - Development environment setup for Windows

### Configuration
- **`.gitignore`** - Updated to exclude .env and node_modules

## Files Modified

- **`script.js`** - Updated to call backend API instead of using mock data
- **`README.md`** - Updated with API setup and usage instructions

## Key Features

### 1. Backend API Server
- RESTful API built with Express.js
- CORS support for cross-origin requests
- Error handling and fallback to mock data
- Health check endpoint for monitoring

### 2. Modular Scrapers
Each scraper module:
- Attempts to fetch real registry data when configured
- Uses Cheerio for HTML parsing
- Includes retry logic and error handling
- Falls back to mock data on failure
- Can be easily extended or replaced

### 3. Frontend Integration
- Automatic API URL detection (localhost vs production)
- Loading states and error messages
- Store filtering (Amazon, Target, Crate & Barrel, All)
- Graceful degradation when API unavailable

### 4. Security
- No hardcoded credentials (uses .env)
- CORS origin validation (no wildcards)
- Input sanitization in error messages
- Updated dependencies (axios v1.12.0)
- All CodeQL vulnerabilities fixed

### 5. Developer Experience
- One-command development setup scripts
- Comprehensive documentation
- Clear deployment guides
- Example environment file

## API Endpoints

### `GET /api/health`
Health check endpoint
```json
{
  "status": "ok",
  "message": "Registry API is running"
}
```

### `GET /api/registry`
Get all registry items
```bash
# Get all items
curl http://localhost:3000/api/registry

# Filter by store
curl http://localhost:3000/api/registry?store=amazon
```

### `GET /api/registry/:store`
Get items from specific store
```bash
curl http://localhost:3000/api/registry/amazon
curl http://localhost:3000/api/registry/target
curl http://localhost:3000/api/registry/crateandbarrel
```

## Quick Start

### Development Setup

1. **Clone and install:**
```bash
git clone <repository-url>
cd kennyandmorgan.com
npm install
```

2. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your registry IDs
```

3. **Start development servers:**
```bash
# Linux/Mac
./start-dev.sh

# Windows
start-dev.bat
```

Access:
- Frontend: http://localhost:8000
- Backend API: http://localhost:3000

### Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed instructions on deploying to:
- Heroku
- Vercel
- AWS
- DigitalOcean

## How It Works

### 1. Frontend Makes Request
When a user navigates to the registry page or clicks a filter button, the frontend calls the backend API:

```javascript
const response = await fetch('http://localhost:3000/api/registry?store=amazon');
const data = await response.json();
displayRegistryItems(data.items);
```

### 2. Backend Receives Request
The Express server routes the request to the appropriate handler:

```javascript
app.get('/api/registry', async (req, res) => {
  const items = await fetchFromAllStores();
  res.json({ success: true, items });
});
```

### 3. Scrapers Fetch Data
Each scraper attempts to fetch real data from the registry site:

```javascript
// Try to fetch real data
const response = await axios.get(registryUrl);
const $ = cheerio.load(response.data);
// Parse HTML and extract items

// If anything fails, return mock data
catch (error) {
  return getMockData();
}
```

### 4. Response Returned
The backend aggregates results and returns them to the frontend:

```json
{
  "success": true,
  "count": 12,
  "items": [
    {
      "id": "amazon-1",
      "name": "KitchenAid Stand Mixer",
      "store": "amazon",
      "price": 379.99,
      "image": "https://...",
      "url": "https://amazon.com/..."
    }
  ]
}
```

### 5. Frontend Displays Items
The frontend renders the items in a grid layout with filtering options.

## Current Limitations & Future Improvements

### Current Limitations
1. **Mock Data Default**: Without real registry IDs, returns placeholder data
2. **No Caching**: Every request fetches fresh data (can be slow)
3. **Basic Scraping**: HTML structure changes may break scrapers
4. **No Authentication**: Doesn't handle authenticated/private registries

### Recommended Improvements
1. **Use Official APIs**: Apply for Amazon Product Advertising API
2. **Add Caching**: Implement Redis or in-memory cache (15-30 min TTL)
3. **Rate Limiting**: Prevent abuse and respect registry site limits
4. **Monitoring**: Add logging and alerting for scraping failures
5. **Database**: Store registry items for better performance
6. **Admin Panel**: UI for managing registry IDs and cache

## Testing

### Manual Testing
```bash
# Test health endpoint
curl http://localhost:3000/api/health

# Test all registries
curl http://localhost:3000/api/registry

# Test specific store
curl http://localhost:3000/api/registry/amazon
```

### Frontend Testing
1. Navigate to http://localhost:8000
2. Click "Registry" in navigation
3. Verify items load
4. Test filter buttons (Amazon, Target, Crate & Barrel, All)
5. Verify loading states and error handling

## Security Considerations

### ✅ Implemented
- Environment variables for sensitive data
- .env excluded from git
- CORS origin validation
- Input sanitization
- Updated dependencies
- CodeQL security scanning

### ⚠️ Important Notes
- Registry sites may block scraping attempts
- Review each site's Terms of Service before scraping
- Consider using official APIs for production
- Implement rate limiting to prevent abuse
- Use HTTPS in production

## Support

For questions or issues:
1. Check [API_README.md](API_README.md) for API details
2. Check [DEPLOYMENT.md](DEPLOYMENT.md) for deployment help
3. Review server logs for errors
4. Open an issue in the repository

## License

MIT - Same as the main wedding website project
