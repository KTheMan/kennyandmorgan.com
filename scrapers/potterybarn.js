const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Pottery Barn Registry Scraper
 * Based on the wedding-registry-scraper Ruby implementation
 */

class PotteryBarnScraper {
    constructor() {
        this.baseUrl = 'https://www.potterybarn.com';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
        };
    }

    /**
     * Fetch registry items from Pottery Barn
     * @param {string} registryId - Pottery Barn registry ID
     * @returns {Promise<Array>} Array of registry items
     */
    async getItems(registryId) {
        if (!registryId || registryId === 'your-pottery-barn-registry-id') {
            console.warn('Pottery Barn registry ID not configured, returning empty array');
            return [];
        }

        try {
            const url = `${this.baseUrl}/registry/view/${registryId}`;
            const response = await axios.get(url, { 
                headers: this.headers,
                timeout: 10000
            });
            
            const $ = cheerio.load(response.data);
            const items = [];

            // Parse the registry page structure based on Ruby implementation
            $('.regListItem').each((index, element) => {
                const $item = $(element);
                
                // Extract item details
                const name = $item.find('.product-name').text().trim();
                const priceStr = $item.find('.product-price .price-amount').text().trim();
                const price = this.parsePrice(priceStr);
                
                // Get image URL - convert thumbnail to larger size
                let imageUrl = $item.find('.product-image img').first().attr('src') || '';
                if (imageUrl && imageUrl.includes('f.jpg')) {
                    imageUrl = imageUrl.replace(/f\.jpg$/, 'c.jpg');
                }
                
                const productSku = $item.find('.product-sku').text().trim();
                
                // Extract quantity information
                const remaining = parseInt($item.find('.still-needs').text().trim()) || 0;
                const desired = parseInt($item.find('.requested').text().trim()) || 0;
                
                if (name) {
                    items.push({
                        id: `potterybarn-${productSku || index}`,
                        name: name,
                        store: 'potterybarn',
                        price: price,
                        image: imageUrl.startsWith('http') ? imageUrl : `${this.baseUrl}${imageUrl}`,
                        url: url, // Pottery Barn uses modal pop-ups, so we link to the registry page
                        available: remaining > 0,
                        remaining: remaining,
                        desired: desired
                    });
                }
            });

            return items;
        } catch (error) {
            console.error('Error scraping Pottery Barn registry:', error.message);
            return [];
        }
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
                id: 'potterybarn-1',
                name: 'Classic Organic Bath Towel',
                store: 'potterybarn',
                price: 29.99,
                image: 'https://via.placeholder.com/300x300/D4A373/FFFFFF?text=Bath+Towel',
                url: 'https://potterybarn.com',
                available: true,
                remaining: 4,
                desired: 6
            },
            {
                id: 'potterybarn-2',
                name: 'Grand Embroidered Pillow Cover',
                store: 'potterybarn',
                price: 79.99,
                image: 'https://via.placeholder.com/300x300/FAEBD7/333333?text=Pillow+Cover',
                url: 'https://potterybarn.com',
                available: true,
                remaining: 2,
                desired: 4
            },
            {
                id: 'potterybarn-3',
                name: 'Mason Reclaimed Wood Bookcase',
                store: 'potterybarn',
                price: 699.99,
                image: 'https://via.placeholder.com/300x300/8B4513/FFFFFF?text=Bookcase',
                url: 'https://potterybarn.com',
                available: true,
                remaining: 1,
                desired: 1
            },
            {
                id: 'potterybarn-4',
                name: 'Everyday Ceramic Dinner Plate Set',
                store: 'potterybarn',
                price: 149.99,
                image: 'https://via.placeholder.com/300x300/556B2F/FFFFFF?text=Dinner+Plates',
                url: 'https://potterybarn.com',
                available: false,
                remaining: 0,
                desired: 2
            }
        ];
    }
}

module.exports = new PotteryBarnScraper();
