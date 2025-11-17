const axios = require('axios');
const cheerio = require('cheerio');

/**
 * REI Registry Scraper
 * Based on the wedding-registry-scraper Ruby implementation
 */

class REIScraper {
    constructor() {
        this.baseUrl = 'https://www.rei.com';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
        };
    }

    /**
     * Fetch registry items from REI
     * @param {string} registryId - REI registry ID
     * @returns {Promise<Array>} Array of registry items
     */
    async getItems(registryId) {
        if (!registryId || registryId === 'your-rei-registry-id') {
            console.warn('REI registry ID not configured, returning empty array');
            return [];
        }

        try {
            const url = `${this.baseUrl}/wishlist/${registryId}`;
            const response = await axios.get(url, { 
                headers: this.headers,
                timeout: 10000
            });
            
            const $ = cheerio.load(response.data);
            const items = [];

            // Parse the registry page structure based on Ruby implementation
            $('table.registryList').first().find('tr.tr0').each((index, element) => {
                const $item = $(element);
                const $cells = $item.find('td');
                
                if ($cells.length < 6) return; // Skip rows without enough data
                
                // Extract item details from table cells
                const nameCell = $cells.eq(1);
                const name = nameCell.children().first().text().trim();
                const sku = nameCell.children().last().text().trim();
                
                const priceStr = $cells.eq(3).text().trim();
                const price = this.parsePrice(priceStr);
                
                const desired = parseInt($cells.eq(4).text().trim()) || 0;
                const remaining = parseInt($cells.eq(5).text().trim()) || 0;
                
                // Try to get product URL
                const productLink = $item.find('a[name=prod]').first();
                let productUrl = url; // Default to registry page
                if (productLink.length > 0) {
                    const href = productLink.attr('href');
                    if (href) {
                        productUrl = href.startsWith('http') ? href : `${this.baseUrl}${href.replace(/^\//, '')}`;
                    }
                }
                
                // For REI, we'd need to fetch the product page to get the image
                // For now, we'll use a placeholder or skip detailed image fetching
                const imageUrl = this.getProductImagePlaceholder();
                
                if (name) {
                    items.push({
                        id: `rei-${sku || index}`,
                        name: name,
                        store: 'rei',
                        price: price,
                        image: imageUrl,
                        url: productUrl,
                        available: remaining > 0,
                        remaining: remaining,
                        desired: desired
                    });
                }
            });

            return items;
        } catch (error) {
            console.error('Error scraping REI registry:', error.message);
            return [];
        }
    }

    /**
     * Get product image from product page
     * Note: This requires an additional HTTP request per product
     */
    async getProductImage(productUrl) {
        try {
            const response = await axios.get(productUrl, {
                headers: this.headers,
                timeout: 5000
            });
            
            const $ = cheerio.load(response.data);
            
            // Try multiple selectors for REI product images
            let imageUrl = $('#zoomLink').attr('href');
            if (!imageUrl) {
                imageUrl = $('#js-product-primary-img').attr('data-high-res-img');
            }
            if (!imageUrl) {
                imageUrl = $('.product-image img').first().attr('src');
            }
            
            if (imageUrl) {
                return imageUrl.startsWith('http') ? imageUrl : `${this.baseUrl}/${imageUrl.replace(/^\//, '')}`;
            }
        } catch (error) {
            console.error('Error fetching product image:', error.message);
        }
        
        return this.getProductImagePlaceholder();
    }

    /**
     * Get placeholder image for REI products
     */
    getProductImagePlaceholder() {
        return 'https://via.placeholder.com/300x300/556B2F/FFFFFF?text=REI+Product';
    }

    /**
     * Parse price string to number
     */
    parsePrice(priceStr) {
        if (!priceStr) return 0;
        const cleaned = priceStr.replace(/[^0-9.]/g, '');
        return parseFloat(cleaned) || 0;
    }

    /**
     * Get mock data for development/testing
     */
    getMockData() {
        return [
            {
                id: 'rei-1',
                name: 'REI Co-op Camp Stove',
                store: 'rei',
                price: 89.99,
                image: 'https://via.placeholder.com/300x300/556B2F/FFFFFF?text=Camp+Stove',
                url: 'https://rei.com',
                available: true,
                remaining: 1,
                desired: 1
            },
            {
                id: 'rei-2',
                name: 'Hydro Flask 32 oz Wide Mouth',
                store: 'rei',
                price: 44.99,
                image: 'https://via.placeholder.com/300x300/2F4F4F/FFFFFF?text=Water+Bottle',
                url: 'https://rei.com',
                available: true,
                remaining: 3,
                desired: 4
            },
            {
                id: 'rei-3',
                name: 'REI Co-op Backpacking Bundle',
                store: 'rei',
                price: 299.99,
                image: 'https://via.placeholder.com/300x300/8B4513/FFFFFF?text=Backpack+Bundle',
                url: 'https://rei.com',
                available: true,
                remaining: 1,
                desired: 1
            },
            {
                id: 'rei-4',
                name: 'ENO DoubleNest Hammock',
                store: 'rei',
                price: 69.99,
                image: 'https://via.placeholder.com/300x300/D4A373/FFFFFF?text=Hammock',
                url: 'https://rei.com',
                available: false,
                remaining: 0,
                desired: 1
            }
        ];
    }
}

module.exports = new REIScraper();
