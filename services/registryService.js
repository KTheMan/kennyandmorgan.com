const config = require('../config');
const {
    upsertRegistryItems,
    getRegistryItems,
    markItemForFastPoll,
    getFastPollCandidates,
    touchFastPollTimestamp,
    getStoreState
} = require('../db/registryCache');
const amazonScraper = require('../scrapers/amazon');
const targetScraper = require('../scrapers/target');
const crateAndBarrelScraper = require('../scrapers/crateandbarrel');
const potteryBarnScraper = require('../scrapers/potterybarn');
const williamsSonomaScraper = require('../scrapers/williamsonoma');
const reiScraper = require('../scrapers/rei');
const zolaScraper = require('../scrapers/zola');
const heathCeramicsScraper = require('../scrapers/heathceramics');

const registryStoreFetchers = {
    amazon: () => amazonScraper.getItems(process.env.AMAZON_REGISTRY_ID),
    target: () => targetScraper.getItems(process.env.TARGET_REGISTRY_ID),
    crateandbarrel: () => crateAndBarrelScraper.getItems(process.env.CRATE_AND_BARREL_REGISTRY_ID),
    potterybarn: () => potteryBarnScraper.getItems(process.env.POTTERY_BARN_REGISTRY_ID),
    williamsonoma: () => williamsSonomaScraper.getItems(process.env.WILLIAMS_SONOMA_REGISTRY_ID),
    rei: () => reiScraper.getItems(process.env.REI_REGISTRY_ID),
    zola: () => zolaScraper.getItems(process.env.ZOLA_REGISTRY_ID),
    heathceramics: () => heathCeramicsScraper.getItems(process.env.HEATH_CERAMICS_REGISTRY_ID)
};

const storeKeys = Object.keys(registryStoreFetchers);
const activeStoreRefreshes = new Map();
let pollingInitialized = false;

function isRegisteredStore(storeKey) {
    return Boolean(registryStoreFetchers[(storeKey || '').toLowerCase()]);
}

async function refreshStore(storeKey, options = {}) {
    const normalizedStore = (storeKey || '').toLowerCase();
    const fetcher = registryStoreFetchers[normalizedStore];
    if (!fetcher) {
        return null;
    }
    const reason = options.reason || 'manual';
    try {
        const items = await fetcher();
        const result = upsertRegistryItems(normalizedStore, Array.isArray(items) ? items : []);
        if (config.features.logRegistryDebug && !options.silent) {
            console.log(`[registry] Updated ${normalizedStore} cache with ${result.inserted} items (${reason})`);
        }
        return result;
    } catch (error) {
        if (!options.silent) {
            console.error(`[registry] Failed to refresh ${normalizedStore}:`, error.message);
        }
        throw error;
    }
}

function queueStoreRefresh(storeKey, options = {}) {
    const normalizedStore = (storeKey || '').toLowerCase();
    if (!isRegisteredStore(normalizedStore)) {
        return Promise.resolve(null);
    }
    if (activeStoreRefreshes.has(normalizedStore)) {
        return activeStoreRefreshes.get(normalizedStore);
    }
    const promise = refreshStore(normalizedStore, options).finally(() => {
        activeStoreRefreshes.delete(normalizedStore);
    });
    activeStoreRefreshes.set(normalizedStore, promise);
    return promise;
}

function needsFullPoll(storeKey) {
    const state = getStoreState(storeKey);
    if (!state?.last_full_poll_at) {
        return true;
    }
    const lastPollMs = new Date(state.last_full_poll_at).getTime();
    if (!Number.isFinite(lastPollMs)) {
        return true;
    }
    return (Date.now() - lastPollMs) > config.registry.pollIntervalMs;
}

function ensureStoreFreshness(storeKey) {
    if (needsFullPoll(storeKey)) {
        queueStoreRefresh(storeKey, { reason: 'lazy-refresh', silent: true }).catch(() => {});
    }
}

async function refreshAllStores(reason = 'scheduled') {
    await Promise.all(storeKeys.map(store => queueStoreRefresh(store, { reason, silent: reason !== 'startup' })));
}

function startPolling() {
    if (pollingInitialized) {
        return;
    }
    pollingInitialized = true;

    setInterval(() => {
        storeKeys.forEach(store => ensureStoreFreshness(store));
    }, Math.max(15_000, Math.floor(config.registry.pollIntervalMs / 2))); // keep caches warm without rushing

    setInterval(async () => {
        const candidates = getFastPollCandidates(config.registry.fastPollIntervalMs)
            .slice(0, config.registry.fastPollBatchLimit);
        if (!candidates.length) {
            return;
        }
        const grouped = candidates.reduce((acc, row) => {
            acc[row.store] = acc[row.store] || [];
            acc[row.store].push(row);
            return acc;
        }, {});

        await Promise.all(Object.entries(grouped).map(async ([store, rows]) => {
            try {
                await queueStoreRefresh(store, { reason: 'fast-poll', silent: true });
                rows.forEach(row => touchFastPollTimestamp(row.id));
            } catch (error) {
                console.error(`[registry] Fast poll failed for ${store}:`, error.message);
            }
        }));
    }, config.registry.fastPollSweepMs);
}

function getCachedItems(options = {}) {
    return getRegistryItems(options);
}

async function scheduleFastPoll(cacheId) {
    const record = markItemForFastPoll(cacheId, config.registry.fastPollDurationMs);
    if (record?.store) {
        queueStoreRefresh(record.store, { reason: 'user-fast-poll', silent: true }).catch(() => {});
    }
    return record;
}

module.exports = {
    storeKeys,
    isRegisteredStore,
    queueStoreRefresh,
    refreshAllStores,
    ensureStoreFreshness,
    startPolling,
    getCachedItems,
    scheduleFastPoll
};
