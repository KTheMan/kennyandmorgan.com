const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { parse: parseCsv } = require('csv-parse/sync');
const config = require('./config');
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
const {
    storeKeys,
    isRegisteredStore,
    queueStoreRefresh,
    refreshAllStores,
    ensureStoreFreshness,
    startPolling,
    getCachedItems,
    scheduleFastPoll
} = require('./services/registryService');

const app = express();
const PORT = config.server.port;
const ADMIN_SESSION_TTL_MS = config.admin.sessionTtlMs;
const ADMIN_SALT_ROUNDS = config.admin.saltRounds;
const adminSessions = new Map();
const allowedOrigins = config.cors.allowedOrigins || [];

// Middleware
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
        const envPassword = config.admin.password;

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

function extractAdminToken(req) {
    const header = req.headers.authorization || '';
    if (header.toLowerCase().startsWith('bearer ')) {
        return header.slice(7).trim();
    }
    if (req.headers['x-admin-token']) {
        return String(req.headers['x-admin-token']).trim();
    }
    if (req.query.token) {
        return String(req.query.token).trim();
    }
    return null;
}

function requireAdminAuth(req, res, next) {
    cleanupExpiredSessions();
    const token = extractAdminToken(req);
    if (!token || !adminSessions.has(token)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.adminToken = token;
    req.adminSession = adminSessions.get(token);
    req.adminSession.lastSeenAt = Date.now();
    return next();
}

ensureAdminPasswordHash();

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

app.get('/api/registry', async (req, res) => {
    try {
        const storeParam = (req.query.store || 'all').toLowerCase();
        const includeUnavailable = req.query.includeUnavailable === 'true';
        const forceRefresh = req.query.forceRefresh === 'true';

        if (storeParam !== 'all' && !isRegisteredStore(storeParam)) {
            return res.status(400).json({ success: false, error: 'Invalid store name' });
        }

        if (forceRefresh) {
            if (storeParam === 'all') {
                await refreshAllStores('api-force');
            } else {
                await queueStoreRefresh(storeParam, { reason: 'api-force' });
            }
        } else if (storeParam === 'all') {
            storeKeys.forEach(store => ensureStoreFreshness(store));
        } else {
            ensureStoreFreshness(storeParam);
        }

        const items = getCachedItems({ store: storeParam, includeUnavailable });
        res.json({ success: true, store: storeParam, count: items.length, items });
    } catch (error) {
        console.error('Error serving cached registry items:', error);
        res.status(500).json({ success: false, error: 'Failed to load registry items', message: error.message });
    }
});

app.get('/api/registry/:store', async (req, res) => {
    try {
        const store = (req.params.store || '').toLowerCase();
        const includeUnavailable = req.query.includeUnavailable === 'true';
        const forceRefresh = req.query.forceRefresh === 'true';

        if (!isRegisteredStore(store)) {
            return res.status(400).json({ success: false, error: 'Invalid store name' });
        }

        if (forceRefresh) {
            await queueStoreRefresh(store, { reason: 'api-force' });
        } else {
            ensureStoreFreshness(store);
        }

        const items = getCachedItems({ store, includeUnavailable });
        res.json({ success: true, store, count: items.length, items });
    } catch (error) {
        console.error('Error serving cached store registry:', error);
        res.status(500).json({ success: false, error: 'Failed to load registry store', message: error.message });
    }
});

app.post('/api/registry/items/:id/fast-poll', async (req, res) => {
    try {
        const cacheId = parseInt(req.params.id, 10);
        if (!cacheId) {
            return res.status(400).json({ success: false, error: 'Invalid item id' });
        }
        const record = await scheduleFastPoll(cacheId);
        if (!record) {
            return res.status(404).json({ success: false, error: 'Registry item not found' });
        }
        res.json({
            success: true,
            cacheId,
            store: record.store,
            fastPollUntil: record.fast_poll_until,
            fastPollActive: Boolean(record.fast_poll_until && new Date(record.fast_poll_until).getTime() > Date.now())
        });
    } catch (error) {
        console.error('Failed to schedule fast poll:', error);
        res.status(500).json({ success: false, error: 'Unable to schedule fast polling', message: error.message });
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

refreshAllStores('startup').catch(error => {
    console.warn('[registry] Initial refresh failed:', error.message);
});

startPolling();

// Start server
app.listen(PORT, () => {
    console.log(`Registry API server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
