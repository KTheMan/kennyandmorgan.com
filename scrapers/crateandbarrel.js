const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Crate & Barrel Registry Scraper
 * Note: Crate & Barrel registries may require authentication or have anti-scraping
 * measures. This is a basic implementation.
 */

class CrateAndBarrelScraper {
    constructor() {
        this.baseUrl = 'https://www.crateandbarrel.com';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
        };
    }

    /**
     * Fetch registry items from Crate & Barrel
     * @param {string} registryId - Crate & Barrel registry ID
     * @returns {Promise<Array>} Array of registry items
     */
    async getItems(registryId) {
        if (!registryId || registryId === 'your-crate-and-barrel-registry-id') {
            console.warn('Crate & Barrel registry ID not configured, returning mock data');
            return this.getMockData();
        }

        try {
            // Crate & Barrel registry URL pattern
            const url = `${this.baseUrl}/gift-registry/view-registry?registryId=${registryId}`;
            const response = await axios.get(url, { 
                headers: this.headers,
                timeout: 10000
            });
            
            const $ = cheerio.load(response.data);
            const items = [];

            // Parse the registry page structure
            // Note: Crate & Barrel's HTML structure may change, this is a basic example
            $('.product-item, .registry-item').each((index, element) => {
                const $item = $(element);
                
                // Extract item details
                const name = $item.find('.product-name, h3, h4').text().trim();
                const priceStr = $item.find('.product-price, .price').text().trim();
                const price = this.parsePrice(priceStr);
                const imageUrl = $item.find('img').first().attr('src') || 
                               $item.find('img').first().attr('data-src') || '';
                const productUrl = $item.find('a.product-link, a').first().attr('href');
                
                if (name && productUrl) {
                    items.push({
                        id: `crateandbarrel-${index}`,
                        name: name,
                        store: 'crateandbarrel',
                        price: price,
                        image: imageUrl.startsWith('http') ? imageUrl : `${this.baseUrl}${imageUrl}`,
                        url: productUrl.startsWith('http') ? productUrl : `${this.baseUrl}${productUrl}`,
                        available: true
                    });
                }
            });

            return items;
        } catch (error) {
            console.error('Error scraping Crate & Barrel registry:', error.message);
            // Return mock data as fallback
            return this.getMockData();
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
                id: 'crateandbarrel-1',
                name: 'Cast Iron Skillet Set',
                store: 'crateandbarrel',
                price: 129.99,
                image: 'https://via.placeholder.com/300x300/2F4F4F/FFFFFF?text=Skillet+Set',
                url: 'https://crateandbarrel.com',
                available: true
            },
            {
                id: 'crateandbarrel-2',
                name: 'Wine Glass Set',
                store: 'crateandbarrel',
                price: 79.99,
                image: 'https://via.placeholder.com/300x300/D4A373/FFFFFF?text=Wine+Glasses',
                url: 'https://crateandbarrel.com',
                available: true
            },
            {
                id: 'crateandbarrel-3',
                name: 'Dinner Plate Set',
                store: 'crateandbarrel',
                price: 159.99,
                image: 'https://via.placeholder.com/300x300/FAEBD7/333333?text=Dinner+Plates',
                url: 'https://crateandbarrel.com',
                available: true
            },
            {
                id: 'crateandbarrel-4',
                name: 'Flatware Set',
                store: 'crateandbarrel',
                price: 99.99,
                image: 'https://via.placeholder.com/300x300/8B4513/FFFFFF?text=Flatware+Set',
                url: 'https://crateandbarrel.com',
                available: true
            }
        ];
    }
}

module.exports = new CrateAndBarrelScraper();
