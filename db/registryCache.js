const crypto = require('crypto');
const { getDb } = require('./index');

function normalizeStore(store) {
    return (store || '').toLowerCase();
}

function deriveExternalId(store, item) {
    const explicitId = item.externalId || item.sourceId || item.registryItemId;
    if (explicitId) {
        return explicitId.trim();
    }
    const url = (item.url || '').split('?')[0].trim();
    if (url) {
        return url;
    }
    if (item.id) {
        return `${store}:${item.id}`;
    }
    if (item.name) {
        return `${store}:${item.name.toLowerCase()}`;
    }
    return crypto.createHash('sha1').update(`${store}-${JSON.stringify(item)}`).digest('hex');
}

function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = parseFloat(value.replace(/[^0-9.]/g, ''));
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
}

function normalizeItem(store, item) {
    const externalId = deriveExternalId(store, item);
    if (!externalId) {
        return null;
    }

    const price = toNumber(item.price);
    const wanted = toNumber(item.wantedQuantity);
    const purchased = toNumber(item.purchasedQuantity);

    return {
        store,
        external_id: externalId,
        source_item_id: item.id || null,
        name: item.name || 'Registry Item',
        price,
        currency: item.currency || 'USD',
        url: item.url || null,
        image_url: item.image || null,
        available: item.available === false ? 0 : 1,
        wanted_quantity: Number.isFinite(wanted) ? Math.max(0, Math.floor(wanted)) : null,
        purchased_quantity: Number.isFinite(purchased) ? Math.max(0, Math.floor(purchased)) : null,
        metadata_json: item.metadata ? JSON.stringify(item.metadata) : null,
        last_polled_at: new Date().toISOString()
    };
}

function upsertRegistryItems(store, items = []) {
    const db = getDb();
    const normalizedStore = normalizeStore(store);
    const normalizedItems = items
        .map(item => normalizeItem(normalizedStore, item))
        .filter(item => item && item.url);

    if (!normalizedItems.length) {
        return { store: normalizedStore, inserted: 0 };
    }

    const insertStmt = db.prepare(`
        INSERT INTO registry_items (
            store, external_id, source_item_id, name, price, currency, url, image_url, available,
            wanted_quantity, purchased_quantity, metadata_json, last_polled_at, updated_at
        ) VALUES (
            @store, @external_id, @source_item_id, @name, @price, @currency, @url, @image_url, @available,
            @wanted_quantity, @purchased_quantity, @metadata_json, @last_polled_at, CURRENT_TIMESTAMP
        )
        ON CONFLICT(store, external_id) DO UPDATE SET
            name = excluded.name,
            price = excluded.price,
            currency = excluded.currency,
            url = excluded.url,
            image_url = excluded.image_url,
            available = excluded.available,
            last_polled_at = excluded.last_polled_at,
            updated_at = CURRENT_TIMESTAMP,
            wanted_quantity = COALESCE(excluded.wanted_quantity, registry_items.wanted_quantity),
            purchased_quantity = COALESCE(excluded.purchased_quantity, registry_items.purchased_quantity),
            metadata_json = COALESCE(excluded.metadata_json, registry_items.metadata_json)
    `);

    const markStoreStmt = db.prepare(`
        INSERT INTO registry_store_state (store, last_full_poll_at)
        VALUES (@store, @timestamp)
        ON CONFLICT(store) DO UPDATE SET last_full_poll_at = excluded.last_full_poll_at
    `);

    const placeholders = normalizedItems.map(() => '?').join(',');
    const deactivateMissingSql = `
        UPDATE registry_items
        SET available = 0, updated_at = CURRENT_TIMESTAMP
        WHERE store = ? AND external_id NOT IN (${placeholders})
    `;

    const tx = db.transaction(() => {
        normalizedItems.forEach(item => insertStmt.run(item));
        db.prepare(deactivateMissingSql).run(normalizedStore, ...normalizedItems.map(item => item.external_id));
        markStoreStmt.run({ store: normalizedStore, timestamp: new Date().toISOString() });
    });

    tx();
    return { store: normalizedStore, inserted: normalizedItems.length };
}

function getRegistryItems(options = {}) {
    const db = getDb();
    const store = normalizeStore(options.store);
    const includeUnavailable = Boolean(options.includeUnavailable);
    const nowIso = new Date().toISOString();

    let rows;
    if (store && store !== 'all') {
        rows = db.prepare(`
            SELECT *
            FROM registry_items
            WHERE store = @store ${includeUnavailable ? '' : 'AND available = 1'}
            ORDER BY name COLLATE NOCASE
        `).all({ store });
    } else {
        rows = db.prepare(`
            SELECT *
            FROM registry_items
            WHERE ${includeUnavailable ? '1=1' : 'available = 1'}
            ORDER BY store, name COLLATE NOCASE
        `).all();
    }

    return rows.map(row => mapRegistryRow(row, nowIso));
}

function mapRegistryRow(row, nowIso = new Date().toISOString()) {
    return {
        cacheId: row.id,
        id: row.source_item_id,
        store: row.store,
        externalId: row.external_id,
        name: row.name,
        price: typeof row.price === 'number' ? row.price : null,
        currency: row.currency || 'USD',
        url: row.url,
        image: row.image_url,
        available: Boolean(row.available),
        wantedQuantity: row.wanted_quantity,
        purchasedQuantity: row.purchased_quantity,
        lastPolledAt: row.last_polled_at,
        fastPollUntil: row.fast_poll_until,
        fastPollActive: Boolean(row.fast_poll_until && row.fast_poll_until > nowIso)
    };
}

function getItemById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM registry_items WHERE id = ?').get(id);
}

function markItemForFastPoll(id, durationMs) {
    const db = getDb();
    const until = new Date(Date.now() + durationMs).toISOString();
    const result = db.prepare(`
        UPDATE registry_items
        SET fast_poll_until = @until,
            last_fast_poll_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = @id
    `).run({ until, id });

    if (!result.changes) {
        return null;
    }
    return getItemById(id);
}

function getFastPollCandidates(fastIntervalMs) {
    const db = getDb();
    const nowIso = new Date().toISOString();
    const threshold = new Date(Date.now() - fastIntervalMs).toISOString();
    const rows = db.prepare(`
        SELECT *
        FROM registry_items
        WHERE fast_poll_until IS NOT NULL
          AND fast_poll_until > @nowIso
          AND (last_fast_poll_at IS NULL OR last_fast_poll_at < @threshold)
    `).all({ nowIso, threshold });
    return rows;
}

function touchFastPollTimestamp(id) {
    const db = getDb();
    db.prepare(`
        UPDATE registry_items
        SET last_fast_poll_at = @timestamp,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = @id
    `).run({ id, timestamp: new Date().toISOString() });
}

function getStoreState(store) {
    const db = getDb();
    return db.prepare('SELECT * FROM registry_store_state WHERE store = ?').get(normalizeStore(store));
}

module.exports = {
    upsertRegistryItems,
    getRegistryItems,
    getItemById,
    markItemForFastPoll,
    getFastPollCandidates,
    touchFastPollTimestamp,
    getStoreState
};
