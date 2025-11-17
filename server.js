const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        // Check if the origin is in the allowed list
        if (allowedOrigins.indexOf(origin) === -1 && allowedOrigins[0] !== '*') {
            const msg = 'The CORS policy for this site does not allow access from the specified origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(express.json());

// Import scrapers
const amazonScraper = require('./scrapers/amazon');
const targetScraper = require('./scrapers/target');
const crateAndBarrelScraper = require('./scrapers/crateandbarrel');
const potteryBarnScraper = require('./scrapers/potterybarn');
const williamsSonomaScraper = require('./scrapers/williamsonoma');
const reiScraper = require('./scrapers/rei');
const zolaScraper = require('./scrapers/zola');
const heathCeramicsScraper = require('./scrapers/heathceramics');

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Registry API is running' });
});

// Get all registry items
app.get('/api/registry', async (req, res) => {
    try {
        const { store } = req.query;
        
        let items = [];
        
        if (!store || store === 'all') {
            // Fetch from all stores
            const results = await Promise.allSettled([
                amazonScraper.getItems(process.env.AMAZON_REGISTRY_ID),
                targetScraper.getItems(process.env.TARGET_REGISTRY_ID),
                crateAndBarrelScraper.getItems(process.env.CRATE_AND_BARREL_REGISTRY_ID),
                potteryBarnScraper.getItems(process.env.POTTERY_BARN_REGISTRY_ID),
                williamsSonomaScraper.getItems(process.env.WILLIAMS_SONOMA_REGISTRY_ID),
                reiScraper.getItems(process.env.REI_REGISTRY_ID),
                zolaScraper.getItems(process.env.ZOLA_REGISTRY_ID),
                heathCeramicsScraper.getItems(process.env.HEATH_CERAMICS_REGISTRY_ID)
            ]);
            
            results.forEach(result => {
                if (result.status === 'fulfilled') {
                    items.push(...result.value);
                }
            });
        } else {
            // Fetch from specific store
            switch(store.toLowerCase()) {
                case 'amazon':
                    items = await amazonScraper.getItems(process.env.AMAZON_REGISTRY_ID);
                    break;
                case 'target':
                    items = await targetScraper.getItems(process.env.TARGET_REGISTRY_ID);
                    break;
                case 'crateandbarrel':
                    items = await crateAndBarrelScraper.getItems(process.env.CRATE_AND_BARREL_REGISTRY_ID);
                    break;
                case 'potterybarn':
                    items = await potteryBarnScraper.getItems(process.env.POTTERY_BARN_REGISTRY_ID);
                    break;
                case 'williamsonoma':
                    items = await williamsSonomaScraper.getItems(process.env.WILLIAMS_SONOMA_REGISTRY_ID);
                    break;
                case 'rei':
                    items = await reiScraper.getItems(process.env.REI_REGISTRY_ID);
                    break;
                case 'zola':
                    items = await zolaScraper.getItems(process.env.ZOLA_REGISTRY_ID);
                    break;
                case 'heathceramics':
                    items = await heathCeramicsScraper.getItems(process.env.HEATH_CERAMICS_REGISTRY_ID);
                    break;
                default:
                    return res.status(400).json({ error: 'Invalid store name' });
            }
        }
        
        res.json({
            success: true,
            count: items.length,
            items: items
        });
    } catch (error) {
        console.error('Error fetching registry items:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch registry items',
            message: error.message
        });
    }
});

// Get items from a specific store
app.get('/api/registry/:store', async (req, res) => {
    try {
        const { store } = req.params;
        let items = [];
        
        switch(store.toLowerCase()) {
            case 'amazon':
                items = await amazonScraper.getItems(process.env.AMAZON_REGISTRY_ID);
                break;
            case 'target':
                items = await targetScraper.getItems(process.env.TARGET_REGISTRY_ID);
                break;
            case 'crateandbarrel':
                items = await crateAndBarrelScraper.getItems(process.env.CRATE_AND_BARREL_REGISTRY_ID);
                break;
            case 'potterybarn':
                items = await potteryBarnScraper.getItems(process.env.POTTERY_BARN_REGISTRY_ID);
                break;
            case 'williamsonoma':
                items = await williamsSonomaScraper.getItems(process.env.WILLIAMS_SONOMA_REGISTRY_ID);
                break;
            case 'rei':
                items = await reiScraper.getItems(process.env.REI_REGISTRY_ID);
                break;
            case 'zola':
                items = await zolaScraper.getItems(process.env.ZOLA_REGISTRY_ID);
                break;
            case 'heathceramics':
                items = await heathCeramicsScraper.getItems(process.env.HEATH_CERAMICS_REGISTRY_ID);
                break;
            default:
                return res.status(400).json({ error: 'Invalid store name' });
        }
        
        res.json({
            success: true,
            store: store,
            count: items.length,
            items: items
        });
    } catch (error) {
        const storeNames = {
            'amazon': 'Amazon',
            'target': 'Target',
            'crateandbarrel': 'Crate & Barrel',
            'potterybarn': 'Pottery Barn',
            'williamsonoma': 'Williams-Sonoma',
            'rei': 'REI',
            'zola': 'Zola',
            'heathceramics': 'Heath Ceramics'
        };
        const storeName = storeNames[req.params.store.toLowerCase()] || 'registry';
        console.error(`Error fetching ${storeName} registry:`, error);
        res.status(500).json({
            success: false,
            error: `Failed to fetch ${storeName} registry`,
            message: error.message
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: err.message
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Registry API server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
