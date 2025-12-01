const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { parse: parseCsv } = require('csv-parse/sync');
const config = require('./config');
const ACCESS_LEVELS = {
    FAMILY: 'family',
    PARTY: 'party',
    ADMIN: 'admin'
};
const {
    searchGuestGroupsByName,
    recordRsvpSubmission,
    listGuests,
    createGuest,
    updateGuest,
    deleteGuest,
    importGuests,
    getAccessPasswordHash,
    setAccessPasswordHash
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
const ACCESS_SESSION_TTL_MS = config.admin.sessionTtlMs;
const ACCESS_SALT_ROUNDS = config.admin.saltRounds;
const ACCESS_LEVEL_ORDER = [ACCESS_LEVELS.FAMILY, ACCESS_LEVELS.PARTY, ACCESS_LEVELS.ADMIN];
const accessSessions = new Map();
const allowedOrigins = (config.cors.allowedOrigins && config.cors.allowedOrigins.length)
    ? config.cors.allowedOrigins
    : ['*'];

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
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Admin-Token'],
    optionsSuccessStatus: 204
}));
app.use(express.json({ limit: '1mb' }));

function ensureAccessPasswordHash(level, candidatePassword) {
    try {
        const storedHash = getAccessPasswordHash(level);
        const password = (candidatePassword || '').trim();

        if (!storedHash && password) {
            const hash = bcrypt.hashSync(password, ACCESS_SALT_ROUNDS);
            setAccessPasswordHash(level, hash);
            return;
        }

        if (storedHash && password && !bcrypt.compareSync(password, storedHash)) {
            const hash = bcrypt.hashSync(password, ACCESS_SALT_ROUNDS);
            setAccessPasswordHash(level, hash);
        }

        if (!storedHash && !password) {
            console.warn(`No password configured for ${level} access.`);
        }
    } catch (error) {
        console.error(`Failed to ensure ${level} password hash:`, error);
    }
}

function ensureAccessPasswords() {
    ensureAccessPasswordHash(ACCESS_LEVELS.FAMILY, config.access.familyPassword);
    ensureAccessPasswordHash(ACCESS_LEVELS.PARTY, config.access.partyPassword);
    ensureAccessPasswordHash(ACCESS_LEVELS.ADMIN, config.access.adminPassword);
}

function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [token, meta] of accessSessions.entries()) {
        if (!meta?.createdAt || now - meta.createdAt > ACCESS_SESSION_TTL_MS) {
            accessSessions.delete(token);
        }
    }
}

function createAccessSession(level) {
    cleanupExpiredSessions();
    const token = crypto.randomBytes(32).toString('hex');
    accessSessions.set(token, { createdAt: Date.now(), level });
    return token;
}

function extractAccessToken(req) {
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

function getAccessRank(level) {
    const normalized = (level || '').toLowerCase();
    const idx = ACCESS_LEVEL_ORDER.indexOf(normalized);
    return idx === -1 ? -1 : idx;
}

function requireAccessLevel(requiredLevel) {
    return function accessMiddleware(req, res, next) {
        cleanupExpiredSessions();
        const token = extractAccessToken(req);
        if (!token) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        const session = accessSessions.get(token);
        if (!session) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
        if (getAccessRank(session.level) < getAccessRank(requiredLevel)) {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        session.lastSeenAt = Date.now();
        req.accessToken = token;
        req.accessLevel = session.level;
        return next();
    };
}

function resolveAccessLevelFromPassword(password) {
    const candidate = (password || '').trim();
    if (!candidate) {
        return null;
    }
    const levelsByPriority = [...ACCESS_LEVEL_ORDER].reverse();
    for (const level of levelsByPriority) {
        const hash = getAccessPasswordHash(level);
        if (hash && bcrypt.compareSync(candidate, hash)) {
            return level;
        }
    }
    return null;
}

ensureAccessPasswords();

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
            mealChoice,
            guestResponses
        } = req.body || {};

        const submitterName = (rsvpName || name || '').trim();
        const submitterEmail = (rsvpEmail || email || '').trim();
        const guests = parseInt(guestCount, 10) || 1;
        const normalizedMealChoice = (mealChoice || '').trim();
        const normalizedDietary = (dietaryRestrictions || '').trim();
        const normalizedMessage = (specialMessage || '').trim();
        const normalizedSongRequest = (songRequest || '').trim();
        const normalizedGroupId = (guestGroupId || '').trim();
        const normalizedGuestResponses = Array.isArray(guestResponses)
            ? guestResponses.map(response => ({
                guestId: parseInt(response.guestId, 10),
                status: (response.status || '').toLowerCase(),
                mealChoice: (response.mealChoice || '').trim(),
                name: (response.name || '').trim()
            })).filter(response => Number.isInteger(response.guestId) && ['accepted', 'declined'].includes(response.status))
            : [];

        if (normalizedGuestResponses.length && !normalizedGroupId) {
            return res.status(400).json({ success: false, error: 'guestGroupId is required when submitting per-guest responses.' });
        }

        const attendingFlag = normalizedGuestResponses.length
            ? normalizedGuestResponses.some(response => response.status === 'accepted')
            : (attending === true || attending === 'yes');
        const acceptedCount = normalizedGuestResponses.filter(response => response.status === 'accepted').length;

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
            guestCount: acceptedCount || guests,
            dietaryRestrictions: normalizedDietary || null,
            specialMessage: (normalizedMessage || normalizedSongRequest) || null,
            songRequest: normalizedSongRequest || null,
            mealChoice: normalizedMealChoice || null,
            guestGroupId: normalizedGroupId || null,
            guestResponses: normalizedGuestResponses
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

app.post('/api/access/login', (req, res) => {
    try {
        const { password } = req.body || {};
        const level = resolveAccessLevelFromPassword(password);
        if (!level) {
            return res.status(401).json({ success: false, error: 'Invalid password.' });
        }
        const token = createAccessSession(level);
        return res.json({ success: true, token, accessLevel: level, expiresIn: ACCESS_SESSION_TTL_MS });
    } catch (error) {
        console.error('Access login failed:', error);
        return res.status(500).json({ success: false, error: 'Unable to authenticate.' });
    }
});

app.post('/api/access/logout', requireAccessLevel(ACCESS_LEVELS.FAMILY), (req, res) => {
    accessSessions.delete(req.accessToken);
    res.json({ success: true });
});

app.get('/api/access/session', requireAccessLevel(ACCESS_LEVELS.FAMILY), (req, res) => {
    res.json({ success: true, accessLevel: req.accessLevel, expiresIn: ACCESS_SESSION_TTL_MS });
});

app.get('/api/admin/guests', requireAccessLevel(ACCESS_LEVELS.ADMIN), (req, res) => {
    try {
        const guests = listGuests();
        res.json({ success: true, count: guests.length, guests });
    } catch (error) {
        console.error('Failed to list guests:', error);
        res.status(500).json({ success: false, error: 'Unable to load guests.' });
    }
});

app.post('/api/admin/guests', requireAccessLevel(ACCESS_LEVELS.ADMIN), (req, res) => {
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

app.patch('/api/admin/guests/:id', requireAccessLevel(ACCESS_LEVELS.ADMIN), (req, res) => {
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

app.delete('/api/admin/guests/:id', requireAccessLevel(ACCESS_LEVELS.ADMIN), (req, res) => {
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

app.post('/api/admin/guests/import', requireAccessLevel(ACCESS_LEVELS.ADMIN), (req, res) => {
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

        const normalized = rows
            .map(normalizeGuestImportRow)
            .filter(row => row && row.fullName && row.groupId);

        if (!normalized.length) {
            return res.status(400).json({ success: false, error: 'CSV must contain recognizable name and party/group columns.' });
        }

        const primaryTracker = new Set();
        normalized.forEach(row => {
            if (typeof row.isPrimary !== 'boolean') {
                const key = row.groupId.toLowerCase();
                if (!primaryTracker.has(key)) {
                    row.isPrimary = true;
                    primaryTracker.add(key);
                } else {
                    row.isPrimary = false;
                }
            } else if (row.isPrimary) {
                primaryTracker.add(row.groupId.toLowerCase());
            }

            if (typeof row.isPlusOne !== 'boolean') {
                const normalizedName = (row.fullName || '').toLowerCase();
                row.isPlusOne = normalizedName.includes('guest');
            }

            row.notes = row.notes || null;
        });

        const inserted = importGuests(normalized);
        res.json({ success: true, inserted });
    } catch (error) {
        console.error('Failed to import guests:', error);
        res.status(500).json({ success: false, error: 'Unable to import CSV data.' });
    }
});

function normalizeGuestImportRow(row = {}) {
    const get = buildCsvAccessor(row);

    const firstName = get('first name', 'firstname', 'given name');
    const lastName = get('last name', 'lastname', 'surname');
    let fullName = get('full name', 'fullname', 'name');
    if (!fullName) {
        fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    }

    const groupId = get('group id', 'groupid', 'party', 'household', 'family');
    if (!fullName || !groupId) {
        return null;
    }

    const rawRsvp = get('rsvp', 'rsvp status', 'wedding day - rsvp');
    const normalizedRsvp = normalizeRsvpStatus(rawRsvp);
    const phone = get('phone', 'phone number', 'mobile');
    const myNotes = get('my notes');
    const thankYou = get('wedding day - thank you sent', 'thank you sent');
    const giftReceived = get('wedding day - gift received', 'gift received');
    const coupleNote = get('send a note to the couple?', 'note to couple');
    const country = get('country');

    const labeledNotes = [
        myNotes || '',
        phone ? `Phone: ${phone}` : '',
        country && country.toLowerCase() !== 'united states' ? `Country: ${country}` : '',
        thankYou ? `Thank you sent: ${thankYou}` : '',
        giftReceived ? `Gift received: ${giftReceived}` : '',
        coupleNote ? `Couple note: ${coupleNote}` : '',
        !normalizedRsvp && rawRsvp ? `RSVP (original): ${rawRsvp}` : ''
    ].filter(Boolean).join(' | ');

    const isPrimaryFlag = parseBoolean(get('is primary', 'isprimary', 'primary'));
    const isPlusOneFlag = parseBoolean(get('is plus one', 'isplusone', 'plus one'));

    return {
        fullName,
        email: get('email') || undefined,
        groupId,
        isPrimary: typeof isPrimaryFlag === 'boolean' ? isPrimaryFlag : undefined,
        isPlusOne: typeof isPlusOneFlag === 'boolean' ? isPlusOneFlag : undefined,
        notes: labeledNotes || undefined,
        rsvpStatus: normalizedRsvp,
        mealChoice: get('meal choice', 'mealchoice') || undefined,
        dietaryNotes: get('dietary notes', 'dietarynotes') || undefined,
        addressLine1: get('street address 1', 'address line 1', 'address1', 'street') || undefined,
        addressLine2: get('street address 2', 'address line 2', 'address2', 'street2') || undefined,
        city: get('city') || undefined,
        state: get('state', 'state/province', 'province') || undefined,
        postalCode: get('zip', 'postal code', 'zip/postal code', 'zipcode', 'zip code') || undefined
    };
}

function buildCsvAccessor(row = {}) {
    const lookup = {};
    Object.entries(row).forEach(([key, value]) => {
        const normalizedKey = normalizeHeaderKey(key);
        if (normalizedKey) {
            lookup[normalizedKey] = value;
        }
    });

    return (...candidates) => {
        for (const candidate of candidates) {
            const normalizedCandidate = normalizeHeaderKey(candidate);
            if (!normalizedCandidate) {
                continue;
            }
            if (Object.prototype.hasOwnProperty.call(lookup, normalizedCandidate)) {
                const raw = lookup[normalizedCandidate];
                if (raw === undefined || raw === null) {
                    continue;
                }
                const value = typeof raw === 'string' ? raw.trim() : raw;
                if (value === '') {
                    continue;
                }
                return value;
            }
        }
        return '';
    };
}

function normalizeHeaderKey(key) {
    return (key || '').toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseBoolean(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    const normalized = (value || '').toString().trim().toLowerCase();
    if (!normalized) {
        return null;
    }
    if (['yes', 'true', '1', 'y'].includes(normalized)) {
        return true;
    }
    if (['no', 'false', '0', 'n'].includes(normalized)) {
        return false;
    }
    return null;
}

function normalizeRsvpStatus(value) {
    if (!value) {
        return undefined;
    }
    const normalized = value.toString().trim().toLowerCase();
    if (!normalized) {
        return undefined;
    }

    const acceptedMatches = ['attending', 'accepted', 'accepts', 'yes', 'will attend', 'going', 'confirmed'];
    if (acceptedMatches.some(match => normalized === match || normalized.includes(match))) {
        return 'accepted';
    }

    const pendingMatches = ['no response', 'pending', 'tbd', 'awaiting', 'unknown'];
    if (pendingMatches.some(match => normalized === match || normalized.includes(match))) {
        return 'pending';
    }

    const declinedMatches = ['declined', 'decline', 'not attending', 'cannot attend', "can't attend", 'won\'t attend', 'will not attend', 'regretfully declines'];
    if (declinedMatches.some(match => normalized === match || normalized.includes(match))) {
        return 'declined';
    }

    return undefined;
}

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
