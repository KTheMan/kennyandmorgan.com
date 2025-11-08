const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Williams-Sonoma Registry Scraper
 * Based on the wedding-registry-scraper Ruby implementation
 */

class WilliamsSonomaScraper {
    constructor() {
        this.baseUrl = 'https://www.williams-sonoma.com';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
        };
    }

    /**
     * Fetch registry items from Williams-Sonoma
     * @param {string} registryId - Williams-Sonoma registry ID
     * @returns {Promise<Array>} Array of registry items
     */
    async getItems(registryId) {
        if (!registryId || registryId === 'your-williams-sonoma-registry-id') {
            console.warn('Williams-Sonoma registry ID not configured, returning empty array');
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
            $('table.registry-category-list tbody tr').each((index, element) => {
                const $item = $(element);
                
                // Extract item details
                const name = $item.find('.product-detail .product-info .title a').text().trim();
                const itemNumberMatch = $item.find('.product-detail .product-info .item-number').text().trim().match(/:\s*(\d+)/);
                const itemNumber = itemNumberMatch ? itemNumberMatch[1] : '';
                
                // Get price - check for sale price first, then regular price
                let price = 0;
                const salePrice = $item.find('td.price .price-state.price-special .currencyUSD .price-amount').text().trim();
                const regularPrice = $item.find('td.price .price-state.price-standard .currencyUSD .price-amount').text().trim();
                price = this.parsePrice(salePrice || regularPrice);
                
                // Get image URL - convert thumbnail to larger size
                let imageUrl = $item.find('img').first().attr('src') || '';
                if (imageUrl && imageUrl.includes('f.jpg')) {
                    imageUrl = imageUrl.replace(/f\.jpg$/, 'c.jpg');
                }
                
                // Extract quantity information
                const remaining = parseInt($item.find('td.still-needs').text().trim()) || 0;
                const desired = parseInt($item.find('td.requested').text().trim()) || 0;
                
                if (name) {
                    items.push({
                        id: `williamsonoma-${itemNumber || index}`,
                        name: name,
                        store: 'williamsonoma',
                        price: price,
                        image: imageUrl.startsWith('http') ? imageUrl : `${this.baseUrl}${imageUrl}`,
                        url: url, // Williams-Sonoma uses modal pop-ups, so we link to the registry page
                        available: remaining > 0,
                        remaining: remaining,
                        desired: desired
                    });
                }
            });

            return items;
        } catch (error) {
            console.error('Error scraping Williams-Sonoma registry:', error.message);
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
                id: 'williamsonoma-1',
                name: 'Professional Nonstick 10-Piece Cookware Set',
                store: 'williamsonoma',
                price: 449.99,
                image: 'https://via.placeholder.com/300x300/2F4F4F/FFFFFF?text=Cookware+Set',
                url: 'https://williams-sonoma.com',
                available: true,
                remaining: 1,
                desired: 1
            },
            {
                id: 'williamsonoma-2',
                name: 'Open Kitchen by Williams Sonoma Stainless-Steel Mixing Bowls',
                store: 'williamsonoma',
                price: 79.99,
                image: 'https://via.placeholder.com/300x300/D4A373/FFFFFF?text=Mixing+Bowls',
                url: 'https://williams-sonoma.com',
                available: true,
                remaining: 2,
                desired: 3
            },
            {
                id: 'williamsonoma-3',
                name: 'Shun Classic 8" Chef\'s Knife',
                store: 'williamsonoma',
                price: 159.99,
                image: 'https://via.placeholder.com/300x300/8B4513/FFFFFF?text=Chefs+Knife',
                url: 'https://williams-sonoma.com',
                available: true,
                remaining: 1,
                desired: 1
            },
            {
                id: 'williamsonoma-4',
                name: 'All-Clad Stainless Steel Roasting Pan',
                store: 'williamsonoma',
                price: 249.99,
                image: 'https://via.placeholder.com/300x300/556B2F/FFFFFF?text=Roasting+Pan',
                url: 'https://williams-sonoma.com',
                available: false,
                remaining: 0,
                desired: 1
            }
        ];
    }
}

module.exports = new WilliamsSonomaScraper();
