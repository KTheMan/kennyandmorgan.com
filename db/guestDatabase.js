const { getDb } = require('./index');

function searchGuestGroupsByName(name, options = {}) {
    const rawTerm = (name || '').trim().replace(/\s+/g, ' ');
    if (!rawTerm) {
        return [];
    }

    const parts = rawTerm.toLowerCase().split(' ').filter(Boolean);
    if (parts.length < 2) {
        return [];
    }

    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');
    const firstPattern = `${escapeForLike(firstName)}%`;
    const lastPattern = `%${escapeForLike(lastName)}%`;

    const limit = Math.min(Math.max(parseInt(options.limit, 10) || 5, 1), 25);
    const db = getDb();

    const groupStmt = db.prepare(`
        SELECT DISTINCT group_id
        FROM guests
        WHERE LOWER(full_name) LIKE @first ESCAPE '\\'
          AND LOWER(full_name) LIKE @last ESCAPE '\\'
        LIMIT @limit
    `);

    const groupMatches = groupStmt.all({
        first: firstPattern,
        last: lastPattern,
        limit
    });
    if (!groupMatches.length) {
        return [];
    }

    const placeholders = groupMatches.map(() => '?').join(',');
    const membersStmt = db.prepare(`
         SELECT id, full_name, email, group_id, is_primary, is_plus_one, notes, rsvp_status, meal_choice, dietary_notes,
             address_line1, address_line2, city, state, postal_code
        FROM guests
        WHERE group_id IN (${placeholders})
        ORDER BY is_primary DESC, full_name COLLATE NOCASE
    `);

    const members = membersStmt.all(...groupMatches.map(match => match.group_id));

    return groupMatches.map(match => {
        const guests = members
            .filter(member => member.group_id === match.group_id)
            .map(mapGuestRow);

        return {
            groupId: match.group_id,
            primaryGuest: guests.find(guest => guest.isPrimary)?.fullName || guests[0]?.fullName || '',
            guests
        };
    });
}

function mapGuestRow(row) {
    return {
        id: row.id,
        fullName: row.full_name,
        email: row.email || null,
        isPrimary: Boolean(row.is_primary),
        isPlusOne: Boolean(row.is_plus_one),
        notes: row.notes || null,
        rsvpStatus: row.rsvp_status || 'pending',
        mealChoice: row.meal_choice || null,
        dietaryNotes: row.dietary_notes || null,
        addressLine1: row.address_line1 || null,
        addressLine2: row.address_line2 || null,
        city: row.city || null,
        state: row.state || null,
        postalCode: row.postal_code || null
    };
}

function escapeForLike(value) {
    return (value || '').replace(/[\\%_]/g, match => `\\${match}`);
}

function replaceGuestRoster(guestList = []) {
    const db = getDb();
    const clearStmt = db.prepare('DELETE FROM guests');
    const insertStmt = db.prepare(`
        INSERT INTO guests (full_name, email, group_id, is_primary, is_plus_one, notes, rsvp_status, meal_choice, dietary_notes,
            address_line1, address_line2, city, state, postal_code)
        VALUES (@full_name, @email, @group_id, @is_primary, @is_plus_one, @notes, @rsvp_status, @meal_choice, @dietary_notes,
            @address_line1, @address_line2, @city, @state, @postal_code)
    `);

    const insertMany = db.transaction(rows => {
        clearStmt.run();
        rows.forEach(row => insertStmt.run({
            full_name: row.fullName,
            email: row.email || null,
            group_id: row.groupId,
            is_primary: row.isPrimary ? 1 : 0,
            is_plus_one: row.isPlusOne ? 1 : 0,
            notes: row.notes || null,
            rsvp_status: row.rsvpStatus || 'pending',
            meal_choice: row.mealChoice || null,
            dietary_notes: row.dietaryNotes || null,
            address_line1: row.addressLine1 || null,
            address_line2: row.addressLine2 || null,
            city: row.city || null,
            state: row.state || null,
            postal_code: row.postalCode || null
        }));
    });

    insertMany(guestList);
}

function listGuests() {
    const db = getDb();
    return db.prepare(`
        SELECT id, full_name, email, group_id, is_primary, is_plus_one, rsvp_status, meal_choice, dietary_notes, notes, last_rsvp_at,
               address_line1, address_line2, city, state, postal_code
        FROM guests
        ORDER BY group_id, is_primary DESC, full_name COLLATE NOCASE
    `).all().map(mapGuestRowWithMeta);
}

function mapGuestRowWithMeta(row) {
    return {
        ...mapGuestRow(row),
        groupId: row.group_id,
        lastRsvpAt: row.last_rsvp_at
    };
}

function createGuest(guest) {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO guests (full_name, email, group_id, is_primary, is_plus_one, notes, rsvp_status, meal_choice, dietary_notes,
            address_line1, address_line2, city, state, postal_code)
        VALUES (@full_name, @email, @group_id, @is_primary, @is_plus_one, @notes, @rsvp_status, @meal_choice, @dietary_notes,
            @address_line1, @address_line2, @city, @state, @postal_code)
    `);

    const result = stmt.run({
        full_name: guest.fullName,
        email: guest.email || null,
        group_id: guest.groupId,
        is_primary: guest.isPrimary ? 1 : 0,
        is_plus_one: guest.isPlusOne ? 1 : 0,
        notes: guest.notes || null,
        rsvp_status: guest.rsvpStatus || 'pending',
        meal_choice: guest.mealChoice || null,
        dietary_notes: guest.dietaryNotes || null,
        address_line1: guest.addressLine1 || null,
        address_line2: guest.addressLine2 || null,
        city: guest.city || null,
        state: guest.state || null,
        postal_code: guest.postalCode || null
    });

    return result.lastInsertRowid;
}

function updateGuest(id, updates) {
    const db = getDb();
    const fields = [];
    const params = { id };

    const mappings = {
        fullName: 'full_name',
        email: 'email',
        groupId: 'group_id',
        isPrimary: 'is_primary',
        isPlusOne: 'is_plus_one',
        notes: 'notes',
        rsvpStatus: 'rsvp_status',
        mealChoice: 'meal_choice',
        dietaryNotes: 'dietary_notes',
        addressLine1: 'address_line1',
        addressLine2: 'address_line2',
        city: 'city',
        state: 'state',
        postalCode: 'postal_code'
    };

    Object.entries(mappings).forEach(([key, column]) => {
        if (Object.prototype.hasOwnProperty.call(updates, key)) {
            fields.push(`${column} = @${column}`);
            params[column] = key.startsWith('is_') ? (updates[key] ? 1 : 0) : updates[key];
            if (key === 'isPrimary' || key === 'isPlusOne') {
                params[column] = updates[key] ? 1 : 0;
            }
        }
    });

    if (!fields.length) {
        return false;
    }

    const stmt = db.prepare(`
        UPDATE guests
        SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = @id
    `);
    stmt.run(params);
    return true;
}

function deleteGuest(id) {
    const db = getDb();
    db.prepare('DELETE FROM guests WHERE id = ?').run(id);
}

function importGuests(rows = []) {
    const normalized = rows.map(row => ({
        full_name: row.fullName,
        email: row.email || null,
        group_id: row.groupId,
        is_primary: row.isPrimary ? 1 : 0,
        is_plus_one: row.isPlusOne ? 1 : 0,
        notes: row.notes || null,
        rsvp_status: row.rsvpStatus || 'pending',
        meal_choice: row.mealChoice || null,
        dietary_notes: row.dietaryNotes || null,
        address_line1: row.addressLine1 || null,
        address_line2: row.addressLine2 || null,
        city: row.city || null,
        state: row.state || null,
        postal_code: row.postalCode || null
    }));

    const db = getDb();
    const insertStmt = db.prepare(`
        INSERT INTO guests (full_name, email, group_id, is_primary, is_plus_one, notes, rsvp_status, meal_choice, dietary_notes,
            address_line1, address_line2, city, state, postal_code)
        VALUES (@full_name, @email, @group_id, @is_primary, @is_plus_one, @notes, @rsvp_status, @meal_choice, @dietary_notes,
            @address_line1, @address_line2, @city, @state, @postal_code)
    `);

    const insertMany = db.transaction(payload => {
        payload.forEach(row => insertStmt.run(row));
    });

    insertMany(normalized);
    return normalized.length;
}

function getAdminPasswordHash() {
    return getSecretValue('admin_password_hash');
}

function setAdminPasswordHash(hash) {
    setSecretValue('admin_password_hash', hash);
}

function getAccessPasswordHash(level) {
    return getSecretValue(`access_${normalizeAccessLevel(level)}_hash`);
}

function setAccessPasswordHash(level, hash) {
    setSecretValue(`access_${normalizeAccessLevel(level)}_hash`, hash);
}

function normalizeAccessLevel(level) {
    const normalized = (level || '').toLowerCase();
    if (!['family', 'party', 'admin'].includes(normalized)) {
        throw new Error(`Unsupported access level: ${level}`);
    }
    return normalized;
}

function getSecretValue(key) {
    const db = getDb();
    const row = db.prepare('SELECT value FROM admin_settings WHERE key = ?').get(key);
    return row?.value || null;
}

function setSecretValue(key, value) {
    const db = getDb();
    db.prepare(`
        INSERT INTO admin_settings (key, value)
        VALUES (@key, @value)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run({ key, value });
}

function recordRsvpSubmission(data) {
    const db = getDb();
    const status = data.attending ? 'accepted' : 'declined';
    const guestResponses = Array.isArray(data.guestResponses) ? data.guestResponses : [];

    const insertStmt = db.prepare(`
        INSERT INTO rsvp_submissions (group_id, submitter_name, submitter_email, attending, guest_count, meal_choice, dietary_notes, special_message, song_request)
        VALUES (@groupId, @name, @email, @attending, @guestCount, @mealChoice, @dietaryRestrictions, @specialMessage, @songRequest)
    `);

    insertStmt.run({
        groupId: data.guestGroupId || null,
        name: data.name,
        email: data.email || null,
        attending: data.attending ? 1 : 0,
        guestCount: data.guestCount || 1,
        mealChoice: data.mealChoice || null,
        dietaryRestrictions: data.dietaryRestrictions || null,
        specialMessage: data.specialMessage || null,
        songRequest: data.songRequest || null
    });

    if (guestResponses.length) {
        const updateStmt = db.prepare(`
            UPDATE guests
            SET rsvp_status = @status,
                meal_choice = CASE WHEN @meal_choice IS NULL OR @meal_choice = '' THEN meal_choice ELSE @meal_choice END,
                full_name = CASE WHEN @full_name IS NULL OR @full_name = '' THEN full_name ELSE @full_name END,
                last_rsvp_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = @guest_id AND (@group_id IS NULL OR group_id = @group_id)
        `);

        guestResponses.forEach(response => {
            const normalizedStatus = normalizeGuestResponseStatus(response.status);
            if (!normalizedStatus) {
                return;
            }
            updateStmt.run({
                status: normalizedStatus,
                meal_choice: response.mealChoice || null,
                full_name: response.name || null,
                guest_id: response.guestId,
                group_id: data.guestGroupId || null
            });
        });
    } else if (data.guestGroupId) {
        db.prepare(`
            UPDATE guests
            SET rsvp_status = @status,
                meal_choice = COALESCE(@meal_choice, meal_choice),
                last_rsvp_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE group_id = @group_id
        `).run({
            status,
            meal_choice: data.mealChoice || null,
            group_id: data.guestGroupId
        });
    }

    if (data.guestGroupId && data.dietaryRestrictions) {
        db.prepare(`
            UPDATE guests
            SET dietary_notes = COALESCE(@dietary_notes, dietary_notes),
                updated_at = CURRENT_TIMESTAMP
            WHERE group_id = @group_id
        `).run({
            dietary_notes: data.dietaryRestrictions,
            group_id: data.guestGroupId
        });
    }

    return status;
}

function normalizeGuestResponseStatus(value) {
    const normalized = (value || '').toString().trim().toLowerCase();
    if (normalized === 'accepted' || normalized === 'declined') {
        return normalized;
    }
    return null;
}

module.exports = {
    searchGuestGroupsByName,
    replaceGuestRoster,
    listGuests,
    createGuest,
    updateGuest,
    deleteGuest,
    importGuests,
    getAdminPasswordHash,
    setAdminPasswordHash,
    getAccessPasswordHash,
    setAccessPasswordHash,
    recordRsvpSubmission
};
