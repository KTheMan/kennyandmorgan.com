const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { parse: parseCsv } = require('csv-parse/sync');
const {
    searchGuestGroupsByName,
    recordRsvpSubmission,
    listGuests,
    createGuest,
    updateGuest,
    deleteGuest,
    importGuests,
    getAdminPasswordHash,
    setAdminPasswordHash
} = require('./db/guestDatabase');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_SESSION_TTL_MS = parseInt(process.env.ADMIN_SESSION_TTL_MS || `${1000 * 60 * 60}`, 10);
const ADMIN_SALT_ROUNDS = parseInt(process.env.ADMIN_SALT_ROUNDS || '10', 10);
const adminSessions = new Map();

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
app.use(express.json({ limit: '1mb' }));

function ensureAdminPasswordHash() {
    try {
        const storedHash = getAdminPasswordHash();
        const envPassword = process.env.ADMIN_PASSWORD;

        if (!storedHash && envPassword) {
            const hash = bcrypt.hashSync(envPassword, ADMIN_SALT_ROUNDS);
            setAdminPasswordHash(hash);
            return;
        }

        if (storedHash && envPassword && !bcrypt.compareSync(envPassword, storedHash)) {
            const hash = bcrypt.hashSync(envPassword, ADMIN_SALT_ROUNDS);
            setAdminPasswordHash(hash);
        }

        if (!storedHash && !envPassword) {
            console.warn('ADMIN_PASSWORD is not configured. Admin login will be unavailable.');
        }
    } catch (error) {
        console.error('Failed to ensure admin password hash:', error);
    }
}

function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [token, meta] of adminSessions.entries()) {
        if (!meta?.createdAt || now - meta.createdAt > ADMIN_SESSION_TTL_MS) {
            adminSessions.delete(token);
        }
    }
}

function createAdminSession() {
    cleanupExpiredSessions();
    const token = crypto.randomBytes(32).toString('hex');
    adminSessions.set(token, { createdAt: Date.now() });
    return token;
}

function validateAdminSession(token) {
    if (!token || !adminSessions.has(token)) {
        return false;
    }
    const meta = adminSessions.get(token);
    if (!meta?.createdAt || Date.now() - meta.createdAt > ADMIN_SESSION_TTL_MS) {
        adminSessions.delete(token);
        return false;
    }
    meta.createdAt = Date.now();
    adminSessions.set(token, meta);
    return true;
}

function extractAuthToken(req) {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }
    return null;
}

function requireAdminAuth(req, res, next) {
    const token = extractAuthToken(req);
    if (!validateAdminSession(token)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.adminToken = token;
    return next();
}

ensureAdminPasswordHash();

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

app.get('/api/guests/search', (req, res) => {
    try {
        const query = req.query.name?.trim();
        const limit = req.query.limit;

        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'Missing required "name" query parameter.'
            });
        }

        const results = searchGuestGroupsByName(query, { limit });

        return res.json({
            success: true,
            count: results.length,
            results
        });
    } catch (error) {
        console.error('Error searching guest list:', error);
        return res.status(500).json({
            success: false,
            error: 'Unable to search guest list at this time.'
        });
    }
});

app.post('/api/rsvp', (req, res) => {
    try {
        const {
            name,
            rsvpName,
            email,
            rsvpEmail,
            attending,
            guestCount,
            dietaryRestrictions,
            specialMessage,
            songRequest,
            guestGroupId,
            mealChoice
        } = req.body || {};

        const submitterName = (rsvpName || name || '').trim();
        const submitterEmail = (rsvpEmail || email || '').trim();
        const attendingFlag = attending === true || attending === 'yes';
        const guests = parseInt(guestCount, 10) || 1;
        const normalizedMealChoice = (mealChoice || '').trim();
        const normalizedDietary = (dietaryRestrictions || '').trim();
        const normalizedMessage = (specialMessage || '').trim();
        const normalizedSongRequest = (songRequest || '').trim();
        const normalizedGroupId = (guestGroupId || '').trim();

        if (!submitterName) {
            return res.status(400).json({ success: false, error: 'RSVP name is required.' });
        }

        if (!submitterEmail) {
            return res.status(400).json({ success: false, error: 'RSVP email is required.' });
        }

        const status = recordRsvpSubmission({
            name: submitterName,
            email: submitterEmail,
            attending: attendingFlag,
            guestCount: guests,
            dietaryRestrictions: normalizedDietary || null,
            specialMessage: (normalizedMessage || normalizedSongRequest) || null,
            songRequest: normalizedSongRequest || null,
            mealChoice: normalizedMealChoice || null,
            guestGroupId: normalizedGroupId || null
        });

        return res.json({
            success: true,
            status,
            message: attendingFlag
                ? 'Thank you for your RSVP! We cannot wait to celebrate with you.'
                : 'We appreciate the update and will miss you at the celebration.'
        });
    } catch (error) {
        console.error('Failed to record RSVP:', error);
        return res.status(500).json({ success: false, error: 'Unable to save your RSVP right now.' });
    }
});

app.post('/api/admin/login', (req, res) => {
    try {
        const { password } = req.body || {};
        const storedHash = getAdminPasswordHash();

        if (!storedHash) {
            return res.status(503).json({ success: false, error: 'Admin password is not configured.' });
        }

        if (!password || !bcrypt.compareSync(password, storedHash)) {
            return res.status(401).json({ success: false, error: 'Invalid password.' });
        }

        const token = createAdminSession();
        return res.json({ success: true, token, expiresIn: ADMIN_SESSION_TTL_MS });
    } catch (error) {
        console.error('Admin login failed:', error);
        return res.status(500).json({ success: false, error: 'Unable to log in.' });
    }
});

app.post('/api/admin/logout', requireAdminAuth, (req, res) => {
    adminSessions.delete(req.adminToken);
    res.json({ success: true });
});

app.get('/api/admin/session', requireAdminAuth, (req, res) => {
    res.json({ success: true, expiresIn: ADMIN_SESSION_TTL_MS });
});

app.get('/api/admin/guests', requireAdminAuth, (req, res) => {
    try {
        const guests = listGuests();
        res.json({ success: true, count: guests.length, guests });
    } catch (error) {
        console.error('Failed to list guests:', error);
        res.status(500).json({ success: false, error: 'Unable to load guests.' });
    }
});

app.post('/api/admin/guests', requireAdminAuth, (req, res) => {
    try {
        const payload = req.body || {};
        if (!payload.fullName || !payload.groupId) {
            return res.status(400).json({ success: false, error: 'fullName and groupId are required.' });
        }
        const id = createGuest(payload);
        res.status(201).json({ success: true, id });
    } catch (error) {
        console.error('Failed to create guest:', error);
        res.status(500).json({ success: false, error: 'Unable to create guest.' });
    }
});

app.patch('/api/admin/guests/:id', requireAdminAuth, (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) {
            return res.status(400).json({ success: false, error: 'Invalid guest id.' });
        }
        const didUpdate = updateGuest(id, req.body || {});
        if (!didUpdate) {
            return res.status(400).json({ success: false, error: 'No valid fields provided for update.' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Failed to update guest:', error);
        res.status(500).json({ success: false, error: 'Unable to update guest.' });
    }
});

app.delete('/api/admin/guests/:id', requireAdminAuth, (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) {
            return res.status(400).json({ success: false, error: 'Invalid guest id.' });
        }
        deleteGuest(id);
        res.json({ success: true });
    } catch (error) {
        console.error('Failed to delete guest:', error);
        res.status(500).json({ success: false, error: 'Unable to delete guest.' });
    }
});

app.post('/api/admin/guests/import', requireAdminAuth, (req, res) => {
    try {
        const { csv } = req.body || {};
        if (!csv || !csv.trim()) {
            return res.status(400).json({ success: false, error: 'CSV data is required.' });
        }

        const rows = parseCsv(csv, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });

        const normalized = rows.map(row => ({
            fullName: row.fullName || row.full_name || row.name,
            email: row.email,
            groupId: row.groupId || row.group_id,
            isPrimary: row.isPrimary === 'true' || row.isPrimary === true || row.isPrimary === '1' || row.is_primary === '1',
            isPlusOne: row.isPlusOne === 'true' || row.isPlusOne === true || row.isPlusOne === '1' || row.is_plus_one === '1',
            notes: row.notes || row.note,
            rsvpStatus: row.rsvpStatus || row.rsvp_status,
            mealChoice: row.mealChoice || row.meal_choice,
            dietaryNotes: row.dietaryNotes || row.dietary_notes
        })).filter(row => row.fullName && row.groupId);

        if (!normalized.length) {
            return res.status(400).json({ success: false, error: 'CSV must contain fullName and groupId columns.' });
        }

        const inserted = importGuests(normalized);
        res.json({ success: true, inserted });
    } catch (error) {
        console.error('Failed to import guests:', error);
        res.status(500).json({ success: false, error: 'Unable to import CSV data.' });
    }
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
