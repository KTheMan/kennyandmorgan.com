const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Heath Ceramics Registry Scraper
 * Based on the wedding-registry-scraper Ruby implementation
 */

class HeathCeramicsScraper {
    constructor() {
        this.baseUrl = 'https://www.heathceramics.com';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
        };
    }

    /**
     * Fetch registry items from Heath Ceramics
     * @param {string} registryId - Heath Ceramics registry ID
     * @returns {Promise<Array>} Array of registry items
     */
    async getItems(registryId) {
        if (!registryId || registryId === 'your-heath-ceramics-registry-id') {
            console.warn('Heath Ceramics registry ID not configured, returning empty array');
            return [];
        }

        try {
            const url = `${this.baseUrl}/registry/${registryId}`;
            const response = await axios.get(url, { 
                headers: this.headers,
                timeout: 10000
            });
            
            const $ = cheerio.load(response.data);
            const items = [];

            // Parse the registry page structure based on Ruby implementation
            $('table#shopping-cart-table tbody tr').each((index, element) => {
                const $item = $(element);
                
                // Extract item details
                const name = $item.find('.attentionText').text().trim();
                
                // Try to get SKU from the product info
                let sku = '';
                const skuTexts = $item.find('.ctxProductCol .tinyText');
                skuTexts.each((i, el) => {
                    const text = $(el).text();
                    if (text.includes('SKU')) {
                        const match = text.match(/SKU:\s*(\S+)/);
                        if (match) {
                            sku = match[1];
                        }
                    }
                });
                
                // If no SKU found, use parameterized name
                if (!sku) {
                    sku = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                }
                
                // Get price
                const priceStr = $item.find('.price').text().trim();
                const price = this.parsePrice(priceStr);
                
                // Extract quantity information
                const fulfillmentText = $item.find('.fulfilled').text().trim();
                let remaining = 0;
                let desired = 0;
                
                // Parse fulfillment text like "2 of 4" (2 fulfilled, 4 desired)
                const fulfillmentMatch = fulfillmentText.match(/(\d+)\s+of\s+(\d+)/);
                if (fulfillmentMatch) {
                    const fulfilled = parseInt(fulfillmentMatch[1]);
                    desired = parseInt(fulfillmentMatch[2]);
                    remaining = desired - fulfilled;
                }
                
                // Get image URL - may require additional request to product detail page
                const detailUrl = $item.find('[data-url]').attr('data-url');
                let imageUrl = this.getProductImagePlaceholder();
                
                if (name) {
                    items.push({
                        id: `heathceramics-${sku || index}`,
                        name: name,
                        store: 'heathceramics',
                        price: price,
                        image: imageUrl,
                        url: url, // Default to registry page
                        available: remaining > 0,
                        remaining: remaining,
                        desired: desired,
                        detailUrl: detailUrl // Store for potential image fetching
                    });
                }
            });

            return items;
        } catch (error) {
            console.error('Error scraping Heath Ceramics registry:', error.message);
            return [];
        }
    }

    /**
     * Get product image from product detail page
     * Note: This requires an additional HTTP request and special handling for Heath Ceramics
     */
    async getProductImage(detailUrl) {
        if (!detailUrl) {
            return this.getProductImagePlaceholder();
        }

        try {
            const response = await axios.get(detailUrl, {
                headers: {
                    ...this.headers,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                timeout: 5000
            });
            
            const $ = cheerio.load(response.data);
            
            // Try multiple selectors for Heath Ceramics product images
            let imageUrl = $('ul.mixMatchList li:last-child img[src]').attr('src');
            if (!imageUrl) {
                imageUrl = $('.imagesScrollable img[src]').first().attr('src');
            }
            
            if (imageUrl) {
                return imageUrl.startsWith('http') ? imageUrl : `${this.baseUrl}${imageUrl}`;
            }
        } catch (error) {
            console.error('Error fetching product image:', error.message);
        }
        
        return this.getProductImagePlaceholder();
    }

    /**
     * Get placeholder image for Heath Ceramics products
     */
    getProductImagePlaceholder() {
        return 'https://via.placeholder.com/300x300/2F4F4F/FFFFFF?text=Heath+Ceramics';
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
                id: 'heathceramics-1',
                name: 'Coupe Dinner Plate - Opaque White',
                store: 'heathceramics',
                price: 38.00,
                image: 'https://via.placeholder.com/300x300/FAEBD7/333333?text=Dinner+Plate',
                url: 'https://heathceramics.com',
                available: true,
                remaining: 6,
                desired: 8
            },
            {
                id: 'heathceramics-2',
                name: 'Coupe Bowl - Moonstone',
                store: 'heathceramics',
                price: 32.00,
                image: 'https://via.placeholder.com/300x300/2F4F4F/FFFFFF?text=Bowl',
                url: 'https://heathceramics.com',
                available: true,
                remaining: 4,
                desired: 8
            },
            {
                id: 'heathceramics-3',
                name: 'Coupe Mug - Redwood',
                store: 'heathceramics',
                price: 28.00,
                image: 'https://via.placeholder.com/300x300/8B4513/FFFFFF?text=Mug',
                url: 'https://heathceramics.com',
                available: true,
                remaining: 3,
                desired: 4
            },
            {
                id: 'heathceramics-4',
                name: 'Coupe Salad Plate - Indigo',
                store: 'heathceramics',
                price: 30.00,
                image: 'https://via.placeholder.com/300x300/556B2F/FFFFFF?text=Salad+Plate',
                url: 'https://heathceramics.com',
                available: false,
                remaining: 0,
                desired: 8
            }
        ];
    }
}

module.exports = new HeathCeramicsScraper();
