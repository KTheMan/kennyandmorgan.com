const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Amazon Registry Scraper
 * Note: This is a basic implementation. For production use, consider using the
 * official Amazon Product Advertising API which requires approval and API keys.
 */

class AmazonScraper {
    constructor() {
        this.baseUrl = 'https://www.amazon.com';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
        };
    }

    /**
     * Fetch registry items from Amazon
     * @param {string} registryId - Amazon registry ID
     * @returns {Promise<Array>} Array of registry items
     */
    async getItems(registryId) {
        if (!registryId || registryId === 'your-amazon-registry-id') {
            console.warn('Amazon registry ID not configured, returning mock data');
            return this.getMockData();
        }

        try {
            const url = `${this.baseUrl}/wedding/registry/${registryId}`;
            const response = await axios.get(url, { 
                headers: this.headers,
                timeout: 10000
            });
            
            const $ = cheerio.load(response.data);
            const items = [];

            // Parse the registry page structure
            // Note: Amazon's HTML structure may change, this is a basic example
            $('.registry-item, .a-spacing-base').each((index, element) => {
                const $item = $(element);
                
                // Extract item details
                const name = $item.find('.a-link-normal[title]').attr('title') || 
                            $item.find('h5, h3').text().trim();
                const priceStr = $item.find('.a-price .a-offscreen').first().text().trim() ||
                                $item.find('.a-price-whole').first().text().trim();
                const price = this.parsePrice(priceStr);
                const imageUrl = $item.find('img').first().attr('src') || '';
                const productUrl = $item.find('.a-link-normal').first().attr('href');
                
                if (name && productUrl) {
                    items.push({
                        id: `amazon-${index}`,
                        name: name,
                        store: 'amazon',
                        price: price,
                        image: imageUrl.startsWith('http') ? imageUrl : `${this.baseUrl}${imageUrl}`,
                        url: productUrl.startsWith('http') ? productUrl : `${this.baseUrl}${productUrl}`,
                        available: true
                    });
                }
            });

            return items;
        } catch (error) {
            console.error('Error scraping Amazon registry:', error.message);
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
                id: 'amazon-1',
                name: 'KitchenAid Stand Mixer',
                store: 'amazon',
                price: 379.99,
                image: 'https://via.placeholder.com/300x300/D4A373/FFFFFF?text=Stand+Mixer',
                url: 'https://amazon.com',
                available: true
            },
            {
                id: 'amazon-2',
                name: 'Egyptian Cotton Sheet Set',
                store: 'amazon',
                price: 149.99,
                image: 'https://via.placeholder.com/300x300/FAEBD7/333333?text=Sheet+Set',
                url: 'https://amazon.com',
                available: true
            },
            {
                id: 'amazon-3',
                name: 'Instant Pot Duo',
                store: 'amazon',
                price: 89.99,
                image: 'https://via.placeholder.com/300x300/8B4513/FFFFFF?text=Instant+Pot',
                url: 'https://amazon.com',
                available: true
            },
            {
                id: 'amazon-4',
                name: 'Cuisinart Food Processor',
                store: 'amazon',
                price: 199.99,
                image: 'https://via.placeholder.com/300x300/556B2F/FFFFFF?text=Food+Processor',
                url: 'https://amazon.com',
                available: true
            }
        ];
    }
}

module.exports = new AmazonScraper();
