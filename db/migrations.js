function columnExists(db, table, column) {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    return info.some(row => row.name === column);
}

function ensureColumn(db, table, column, definition) {
    if (!columnExists(db, table, column)) {
        db.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
    }
}

function runMigrations(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS guests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            email TEXT,
            group_id TEXT NOT NULL,
            is_primary INTEGER DEFAULT 0,
            is_plus_one INTEGER DEFAULT 0,
            rsvp_status TEXT DEFAULT 'pending',
            meal_choice TEXT,
            dietary_notes TEXT,
            last_rsvp_at TEXT,
            notes TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS admin_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS rsvp_submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT,
            submitter_name TEXT NOT NULL,
            submitter_email TEXT,
            attending INTEGER NOT NULL,
            guest_count INTEGER NOT NULL,
            meal_choice TEXT,
            dietary_notes TEXT,
            special_message TEXT,
            song_request TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS registry_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            store TEXT NOT NULL,
            external_id TEXT NOT NULL,
            source_item_id TEXT,
            name TEXT NOT NULL,
            price REAL,
            currency TEXT,
            url TEXT,
            image_url TEXT,
            available INTEGER DEFAULT 1,
            wanted_quantity INTEGER,
            purchased_quantity INTEGER,
            metadata_json TEXT,
            last_polled_at TEXT,
            fast_poll_until TEXT,
            last_fast_poll_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(store, external_id)
        );

        CREATE TABLE IF NOT EXISTS registry_store_state (
            store TEXT PRIMARY KEY,
            last_full_poll_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_guests_group ON guests(group_id);
        CREATE INDEX IF NOT EXISTS idx_guests_name ON guests(full_name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_rsvp_group ON rsvp_submissions(group_id);
        CREATE INDEX IF NOT EXISTS idx_registry_store ON registry_items(store);
        CREATE INDEX IF NOT EXISTS idx_registry_fast_poll ON registry_items(fast_poll_until);
    `);

    ensureColumn(db, 'guests', 'rsvp_status', "rsvp_status TEXT DEFAULT 'pending'");
    ensureColumn(db, 'guests', 'meal_choice', 'meal_choice TEXT');
    ensureColumn(db, 'guests', 'dietary_notes', 'dietary_notes TEXT');
    ensureColumn(db, 'guests', 'last_rsvp_at', 'last_rsvp_at TEXT');
    ensureColumn(db, 'guests', 'address_line1', 'address_line1 TEXT');
    ensureColumn(db, 'guests', 'address_line2', 'address_line2 TEXT');
    ensureColumn(db, 'guests', 'city', 'city TEXT');
    ensureColumn(db, 'guests', 'state', 'state TEXT');
    ensureColumn(db, 'guests', 'postal_code', 'postal_code TEXT');
    ensureColumn(db, 'rsvp_submissions', 'song_request', 'song_request TEXT');
}

module.exports = runMigrations;
