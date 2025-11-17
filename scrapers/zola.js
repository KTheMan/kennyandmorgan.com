const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Zola Registry Scraper
 * Based on the wedding-registry-scraper Ruby implementation
 */

class ZolaScraper {
    constructor() {
        this.baseUrl = 'https://www.zola.com';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
        };
    }

    /**
     * Fetch registry items from Zola
     * @param {string} registryId - Zola registry ID
     * @returns {Promise<Array>} Array of registry items
     */
    async getItems(registryId) {
        if (!registryId || registryId === 'your-zola-registry-id') {
            console.warn('Zola registry ID not configured, returning empty array');
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
            $('#all-panel .product-tile').each((index, element) => {
                const $item = $(element);
                
                // Extract item details
                const name = $item.find('.single-product-name').text().trim();
                const productId = $item.find('.single-product').attr('id') || '';
                
                // Get price
                const priceData = $item.find('[data-price]').attr('data-price');
                const price = this.parsePrice(priceData);
                
                // Check if this is a variable price item (cash fund)
                const priceText = $item.find('.product-price').text().trim();
                const isVariablePrice = priceText.includes('Contribute what you wish');
                
                // Get image URL
                const imageUrl = $item.find('[data-image-url]').attr('data-image-url') || '';
                
                // Get product URL
                const productHref = $item.find('.content a').first().attr('href') || '';
                const productUrl = productHref ? `${this.baseUrl}/${productHref.replace(/^\//, '')}` : url;
                
                // Extract quantity information from the needed section
                const neededText = $item.find('.needed').text().trim();
                const remainingMatch = neededText.match(/Still Needs:\s*(\d+)/i);
                const desiredMatch = neededText.match(/Requested:\s*(\d+)/i);
                
                const remaining = remainingMatch ? parseInt(remainingMatch[1]) : 0;
                const desired = desiredMatch ? parseInt(desiredMatch[1]) : 0;
                
                // Determine if fulfilled
                let isFulfilled = false;
                if (isVariablePrice) {
                    // For variable price items, check if price goal is met
                    isFulfilled = price <= 0;
                } else {
                    // For fixed price items, check remaining quantity
                    isFulfilled = remaining <= 0;
                }
                
                if (name) {
                    items.push({
                        id: `zola-${productId || index}`,
                        name: name,
                        store: 'zola',
                        price: price,
                        image: imageUrl.startsWith('http') ? imageUrl : `${this.baseUrl}${imageUrl}`,
                        url: productUrl,
                        available: !isFulfilled,
                        remaining: remaining,
                        desired: desired,
                        isVariablePrice: isVariablePrice
                    });
                }
            });

            return items;
        } catch (error) {
            console.error('Error scraping Zola registry:', error.message);
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
                id: 'zola-1',
                name: 'Honeymoon Fund',
                store: 'zola',
                price: 500.00,
                image: 'https://via.placeholder.com/300x300/D4A373/FFFFFF?text=Honeymoon+Fund',
                url: 'https://zola.com',
                available: true,
                remaining: 500,
                desired: 2000,
                isVariablePrice: true
            },
            {
                id: 'zola-2',
                name: 'Le Creuset Dutch Oven - 5.5 Qt',
                store: 'zola',
                price: 349.99,
                image: 'https://via.placeholder.com/300x300/8B4513/FFFFFF?text=Dutch+Oven',
                url: 'https://zola.com',
                available: true,
                remaining: 1,
                desired: 1,
                isVariablePrice: false
            },
            {
                id: 'zola-3',
                name: 'Brooklinen Luxe Sheet Set',
                store: 'zola',
                price: 149.99,
                image: 'https://via.placeholder.com/300x300/FAEBD7/333333?text=Sheet+Set',
                url: 'https://zola.com',
                available: true,
                remaining: 2,
                desired: 2,
                isVariablePrice: false
            },
            {
                id: 'zola-4',
                name: 'Date Night Fund',
                store: 'zola',
                price: 200.00,
                image: 'https://via.placeholder.com/300x300/556B2F/FFFFFF?text=Date+Night+Fund',
                url: 'https://zola.com',
                available: true,
                remaining: 200,
                desired: 500,
                isVariablePrice: true
            }
        ];
    }
}

module.exports = new ZolaScraper();
