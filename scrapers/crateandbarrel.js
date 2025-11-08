const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Crate & Barrel Registry Scraper
 * Improved implementation based on wedding-registry-scraper Ruby implementation
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
            console.warn('Crate & Barrel registry ID not configured, returning empty array');
            return [];
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

            // Parse the registry page structure based on Ruby implementation
            // Look for .jsItemRow but exclude empty category rows
            $('.jsItemRow:not(.emptyCategoryRow)').each((index, element) => {
                const $item = $(element);
                
                // Extract item details
                const name = $item.find('.itemTitle').text().trim();
                
                // Extract SKU
                const skuText = $item.find('.skuNum').text().trim();
                const skuMatch = skuText.match(/SKU\s+(\S+)/);
                const sku = skuMatch ? skuMatch[1] : '';
                
                // Get price - check for sale price first, then regular price
                let price = 0;
                const salePriceText = $item.find('.salePrice').text().trim();
                const regPriceText = $item.find('.regPrice').text().trim();
                
                if (salePriceText) {
                    price = this.parsePrice(salePriceText);
                } else if (regPriceText) {
                    price = this.parsePrice(regPriceText);
                }
                
                // Get image URL and enhance quality
                let imageUrl = $item.find('img').first().attr('src') || '';
                // Convert thumbnail to higher resolution popup zoom image
                if (imageUrl && imageUrl.includes('$web_itembasket$')) {
                    imageUrl = imageUrl.replace(/\$web_itembasket\$/, '&$web_popup_zoom$&wid=379&hei=379');
                }
                
                // Extract quantity information from table cells
                const cells = $item.find('td');
                const desired = cells.eq(4) ? parseInt(cells.eq(4).find('.itemHas').text().trim()) || 0 : 0;
                const fulfilled = cells.eq(5) ? parseInt(cells.eq(5).find('.itemHas').text().trim()) || 0 : 0;
                const remaining = desired - fulfilled;
                
                if (name) {
                    items.push({
                        id: `crateandbarrel-${sku || index}`,
                        name: name,
                        store: 'crateandbarrel',
                        price: price,
                        image: imageUrl.startsWith('http') ? imageUrl : `${this.baseUrl}${imageUrl}`,
                        url: url, // Crate & Barrel uses modal pop-ups, so we link to the registry page
                        available: remaining > 0,
                        remaining: remaining,
                        desired: desired
                    });
                }
            });

            return items;
        } catch (error) {
            console.error('Error scraping Crate & Barrel registry:', error.message);
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
                id: 'crateandbarrel-1',
                name: 'Cast Iron Skillet Set',
                store: 'crateandbarrel',
                price: 129.99,
                image: 'https://via.placeholder.com/300x300/2F4F4F/FFFFFF?text=Skillet+Set',
                url: 'https://crateandbarrel.com',
                available: true,
                remaining: 1,
                desired: 1
            },
            {
                id: 'crateandbarrel-2',
                name: 'Wine Glass Set',
                store: 'crateandbarrel',
                price: 79.99,
                image: 'https://via.placeholder.com/300x300/D4A373/FFFFFF?text=Wine+Glasses',
                url: 'https://crateandbarrel.com',
                available: true,
                remaining: 2,
                desired: 4
            },
            {
                id: 'crateandbarrel-3',
                name: 'Dinner Plate Set',
                store: 'crateandbarrel',
                price: 159.99,
                image: 'https://via.placeholder.com/300x300/FAEBD7/333333?text=Dinner+Plates',
                url: 'https://crateandbarrel.com',
                available: true,
                remaining: 6,
                desired: 8
            },
            {
                id: 'crateandbarrel-4',
                name: 'Flatware Set',
                store: 'crateandbarrel',
                price: 99.99,
                image: 'https://via.placeholder.com/300x300/8B4513/FFFFFF?text=Flatware+Set',
                url: 'https://crateandbarrel.com',
                available: false,
                remaining: 0,
                desired: 2
            }
        ];
    }
}

module.exports = new CrateAndBarrelScraper();
