const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Target Registry Scraper
 * Note: Target may have an official API for registries. Check Target's developer
 * documentation for official API access.
 */

class TargetScraper {
    constructor() {
        this.baseUrl = 'https://www.target.com';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
        };
    }

    /**
     * Fetch registry items from Target
     * @param {string} registryId - Target registry ID
     * @returns {Promise<Array>} Array of registry items
     */
    async getItems(registryId) {
        if (!registryId || registryId === 'your-target-registry-id') {
            console.warn('Target registry ID not configured, returning empty array');
            return [];
        }

        try {
            // Target often uses a different URL pattern for registries
            const url = `${this.baseUrl}/gift-registry/${registryId}`;
            const response = await axios.get(url, { 
                headers: this.headers,
                timeout: 10000
            });
            
            const $ = cheerio.load(response.data);
            const items = [];

            // Parse the registry page structure
            // Note: Target's HTML structure may change, this is a basic example
            $('[data-test="registry-item"], .registry-item').each((index, element) => {
                const $item = $(element);
                
                // Extract item details
                const name = $item.find('[data-test="product-title"], h3, h4').text().trim();
                const priceStr = $item.find('[data-test="product-price"], .price').text().trim();
                const price = this.parsePrice(priceStr);
                const imageUrl = $item.find('img').first().attr('src') || '';
                const productUrl = $item.find('a').first().attr('href');
                
                if (name && productUrl) {
                    items.push({
                        id: `target-${index}`,
                        name: name,
                        store: 'target',
                        price: price,
                        image: imageUrl.startsWith('http') ? imageUrl : `${this.baseUrl}${imageUrl}`,
                        url: productUrl.startsWith('http') ? productUrl : `${this.baseUrl}${productUrl}`,
                        available: true
                    });
                }
            });

            return items;
        } catch (error) {
            console.error('Error scraping Target registry:', error.message);
            // Return empty array on error
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
                id: 'target-1',
                name: 'Nespresso Coffee Machine',
                store: 'target',
                price: 199.99,
                image: 'https://via.placeholder.com/300x300/8B4513/FFFFFF?text=Coffee+Machine',
                url: 'https://target.com',
                available: true
            },
            {
                id: 'target-2',
                name: 'Stainless Steel Cookware Set',
                store: 'target',
                price: 299.99,
                image: 'https://via.placeholder.com/300x300/556B2F/FFFFFF?text=Cookware+Set',
                url: 'https://target.com',
                available: true
            },
            {
                id: 'target-3',
                name: 'Bamboo Cutting Board Set',
                store: 'target',
                price: 49.99,
                image: 'https://via.placeholder.com/300x300/2F4F4F/FFFFFF?text=Cutting+Boards',
                url: 'https://target.com',
                available: true
            },
            {
                id: 'target-4',
                name: 'Dutch Oven',
                store: 'target',
                price: 119.99,
                image: 'https://via.placeholder.com/300x300/D4A373/FFFFFF?text=Dutch+Oven',
                url: 'https://target.com',
                available: true
            }
        ];
    }
}

module.exports = new TargetScraper();
