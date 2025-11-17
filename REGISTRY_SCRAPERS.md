# Registry Scrapers Implementation

This document describes the registry scrapers ported from [wedding-registry-scraper](https://github.com/pariser/wedding-registry-scraper) and implemented for the Kenny & Morgan wedding website.

## Overview

The project now supports 8 different wedding registry stores:
1. Amazon
2. Target
3. Crate & Barrel (improved)
4. Pottery Barn (new)
5. Williams-Sonoma (new)
6. REI (new)
7. Zola (new)
8. Heath Ceramics (new)

## Implementation Details

### Scraper Structure

Each scraper follows a consistent pattern:

```javascript
class StoreScraper {
    constructor() {
        this.baseUrl = 'https://www.store.com';
        this.headers = {
            'User-Agent': '...',
            'Accept': '...',
            // ... other headers
        };
    }

    async getItems(registryId) {
        // Fetch and parse registry items
        // Returns array of items or empty array on error
    }

    parsePrice(priceStr) {
        // Helper to parse price strings to numbers
    }

    getMockData() {
        // Returns mock data for development/testing
    }
}
```

### Data Structure

Each registry item has the following structure:

```javascript
{
    id: 'store-sku',          // Unique identifier
    name: 'Product Name',      // Item name
    store: 'storename',        // Store identifier (lowercase)
    price: 99.99,              // Price as number
    image: 'https://...',      // Image URL
    url: 'https://...',        // Product or registry URL
    available: true,           // Availability status
    remaining: 2,              // Items still needed (optional)
    desired: 4                 // Total items requested (optional)
}
```

### Store-Specific Implementations

#### Pottery Barn
- Selector: `.regListItem`
- Features: SKU extraction, quantity tracking
- Image Enhancement: Converts `f.jpg` thumbnails to `c.jpg` for better quality

#### Williams-Sonoma
- Selector: `table.registry-category-list tbody tr`
- Features: Sale price detection, item number extraction
- Price Logic: Checks sale price first, falls back to regular price

#### REI
- Selector: `table.registryList tr.tr0`
- Features: Table-based parsing, product link extraction
- Note: Images require additional fetch to product page (currently placeholder)

#### Zola
- Selector: `#all-panel .product-tile`
- Features: Variable price support (cash funds), fulfillment tracking
- Special: Distinguishes between fixed-price items and contribution funds

#### Heath Ceramics
- Selector: `table#shopping-cart-table tbody tr`
- Features: Custom SKU handling, fulfillment parsing
- Note: May require XHR requests for product images

#### Crate & Barrel (Improved)
- Selector: `.jsItemRow:not(.emptyCategoryRow)` (improved from basic selectors)
- Features: SKU extraction, sale price detection, image quality enhancement
- Image Enhancement: Converts to popup zoom quality (`web_popup_zoom`)
- Quantity Tracking: Calculates remaining from desired and fulfilled

## Backend Integration

### API Endpoints

1. **Get All Registries**
   ```
   GET /api/registry?store=all
   ```
   Returns items from all configured stores.

2. **Get Store-Specific Registry**
   ```
   GET /api/registry/:store
   ```
   Returns items from a specific store (e.g., `/api/registry/zola`).

### Configuration

Registry IDs are configured via environment variables:

```env
POTTERY_BARN_REGISTRY_ID=your-pottery-barn-registry-id
WILLIAMS_SONOMA_REGISTRY_ID=your-williams-sonoma-registry-id
REI_REGISTRY_ID=your-rei-registry-id
ZOLA_REGISTRY_ID=your-zola-registry-id
HEATH_CERAMICS_REGISTRY_ID=your-heath-ceramics-registry-id
```

## Frontend Integration

### Store Filter Buttons

The frontend includes buttons for filtering by store:

```html
<button class="registry-btn" data-registry="potterybarn">Pottery Barn</button>
<button class="registry-btn" data-registry="williamsonoma">Williams-Sonoma</button>
<button class="registry-btn" data-registry="rei">REI</button>
<button class="registry-btn" data-registry="zola">Zola</button>
<button class="registry-btn" data-registry="heathceramics">Heath Ceramics</button>
```

### Store Name Mapping

Store identifiers are mapped to display names:

```javascript
const storeNames = {
    'potterybarn': 'Pottery Barn',
    'williamsonoma': 'Williams-Sonoma',
    'rei': 'REI',
    'zola': 'Zola',
    'heathceramics': 'Heath Ceramics'
};
```

## Error Handling

All scrapers implement graceful error handling:
- Invalid or unconfigured registry IDs return empty arrays
- Network errors are logged and return empty arrays
- The API continues to work even if some stores fail

## Testing

All scrapers include:
1. Syntax validation (Node.js -c)
2. Structure validation (required methods present)
3. Mock data validation (correct fields and store names)
4. API endpoint testing (all endpoints respond correctly)

## Production Considerations

1. **Terms of Service**: Review each store's ToS before scraping
2. **Rate Limiting**: Consider implementing rate limits to avoid overwhelming stores
3. **Caching**: Implement caching to reduce scraping frequency
4. **Official APIs**: Where available, prefer official APIs over scraping
5. **Error Monitoring**: Monitor scraper failures in production
6. **Updates**: Registry page structures may change; monitor and update selectors

## Improvements from Ruby Implementation

1. **Consistent Error Handling**: All scrapers return empty arrays on error
2. **Mock Data**: Each scraper includes mock data for development
3. **Unified Structure**: All scrapers follow the same pattern
4. **Enhanced Metadata**: Added `remaining` and `desired` fields for quantity tracking
5. **Better Type Safety**: Price parsing is standardized across all scrapers

## Future Enhancements

1. **Image Fetching**: Implement async image fetching for REI and Heath Ceramics
2. **Caching Layer**: Add Redis or in-memory caching
3. **Webhook Support**: Add webhooks for registry updates
4. **Analytics**: Track which items are most viewed
5. **Purchase Tracking**: Integrate with store APIs to track purchases
