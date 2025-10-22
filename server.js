const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(express.json());

// Import scrapers
const amazonScraper = require('./scrapers/amazon');
const targetScraper = require('./scrapers/target');
const crateAndBarrelScraper = require('./scrapers/crateandbarrel');

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
            const [amazonItems, targetItems, crateAndBarrelItems] = await Promise.allSettled([
                amazonScraper.getItems(process.env.AMAZON_REGISTRY_ID),
                targetScraper.getItems(process.env.TARGET_REGISTRY_ID),
                crateAndBarrelScraper.getItems(process.env.CRATE_AND_BARREL_REGISTRY_ID)
            ]);
            
            if (amazonItems.status === 'fulfilled') items.push(...amazonItems.value);
            if (targetItems.status === 'fulfilled') items.push(...targetItems.value);
            if (crateAndBarrelItems.status === 'fulfilled') items.push(...crateAndBarrelItems.value);
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
        console.error(`Error fetching ${req.params.store} registry:`, error);
        res.status(500).json({
            success: false,
            error: `Failed to fetch ${req.params.store} registry`,
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
