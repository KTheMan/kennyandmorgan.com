const path = require('path');
require('dotenv').config();

const bool = (value, fallback = false) => {
    if (value === undefined) return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = value.toString().toLowerCase();
    return normalized === 'true' || normalized === '1';
};

const numberFromEnv = (key, fallback) => {
    const raw = process.env[key];
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const listFromEnv = (value) => (value ? value.split(',').map(item => item.trim()).filter(Boolean) : []);

const databasePath = process.env.DATABASE_PATH
    || process.env.GUEST_DB_PATH
    || path.join(__dirname, '..', 'data', 'guests.db');

const config = {
    env: process.env.NODE_ENV || 'development',
    server: {
        port: numberFromEnv('PORT', 3000)
    },
    cors: {
        allowedOrigins: listFromEnv(process.env.ALLOWED_ORIGINS)
    },
    database: {
        path: databasePath
    },
    admin: {
        password: process.env.ADMIN_PASSWORD || '',
        sessionTtlMs: numberFromEnv('ADMIN_SESSION_TTL_MS', 1000 * 60 * 60),
        saltRounds: numberFromEnv('ADMIN_SALT_ROUNDS', 10)
    },
    access: {
        familyPassword: process.env.ACCESS_PASSWORD_FAMILY || '',
        partyPassword: process.env.ACCESS_PASSWORD_PARTY || '',
        adminPassword: process.env.ACCESS_PASSWORD_ADMIN || process.env.ADMIN_PASSWORD || 'Binx123!'
    },
    registry: {
        pollIntervalMs: numberFromEnv('REGISTRY_POLL_INTERVAL_MS', 1000 * 60 * 60),
        fastPollIntervalMs: numberFromEnv('REGISTRY_FAST_POLL_INTERVAL_MS', 1000 * 120),
        fastPollDurationMs: numberFromEnv('REGISTRY_FAST_POLL_DURATION_MS', 1000 * 60 * 30),
        fastPollSweepMs: numberFromEnv('REGISTRY_FAST_POLL_SWEEP_MS', 1000 * 30),
        fastPollBatchLimit: numberFromEnv('REGISTRY_FAST_POLL_BATCH_LIMIT', 5),
        storeIds: {
            amazon: process.env.AMAZON_REGISTRY_ID || '',
            target: process.env.TARGET_REGISTRY_ID || '',
            crateandbarrel: process.env.CRATE_AND_BARREL_REGISTRY_ID || '',
            potterybarn: process.env.POTTERY_BARN_REGISTRY_ID || '',
            williamsonoma: process.env.WILLIAMS_SONOMA_REGISTRY_ID || '',
            rei: process.env.REI_REGISTRY_ID || '',
            zola: process.env.ZOLA_REGISTRY_ID || '',
            heathceramics: process.env.HEATH_CERAMICS_REGISTRY_ID || ''
        }
    },
    features: {
        logRegistryDebug: bool(process.env.LOG_REGISTRY_DEBUG, false)
    }
};

module.exports = config;
