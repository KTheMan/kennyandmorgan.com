(function(window) {
    const ACCESS_LEVELS = ['family', 'party', 'admin'];
    const LOCAL_TOKEN_PREFIX = 'local-demo:';

    async function ensureConfig() {
        return window.KMSiteConfig.load();
    }

    async function callSupabaseRpc(fn, params = {}) {
        const config = await ensureConfig();
        const client = window.KMSiteConfig.getSupabaseClient(config);
        if (!client) {
            throw new Error('Supabase is not configured.');
        }

        const { data, error } = await client.rpc(fn, params);
        if (error) {
            throw new Error(error.message || 'Supabase request failed.');
        }
        return data;
    }

    function getFallbackPasswords(config = window.KMSiteConfig.getSync()) {
        const configured = config?.localFallbackAccess || {};
        return {
            family: configured.familyPassword || '',
            party: configured.partyPassword || '',
            admin: configured.adminPassword || ''
        };
    }

    function getLocalAccessLevel(password) {
        const passwords = getFallbackPasswords();
        const candidate = (password || '').trim();
        if (!candidate) {
            return null;
        }
        if (!passwords.family && !passwords.party && !passwords.admin) {
            return 'admin';
        }
        for (const level of [...ACCESS_LEVELS].reverse()) {
            if (passwords[level] && candidate === passwords[level]) {
                return level;
            }
        }
        return null;
    }

    function buildLocalToken(level) {
        return `${LOCAL_TOKEN_PREFIX}${level}`;
    }

    function parseLocalToken(token) {
        if (!token || typeof token !== 'string' || !token.startsWith(LOCAL_TOKEN_PREFIX)) {
            return null;
        }
        const level = token.slice(LOCAL_TOKEN_PREFIX.length);
        return ACCESS_LEVELS.includes(level) ? level : null;
    }

    function canUseLocalFallback() {
        return window.KMSiteConfig.isLocalhost();
    }

    async function loginAccess(password) {
        const config = await ensureConfig();

        if (window.KMSiteConfig.isSupabaseConfigured(config)) {
            try {
                return await callSupabaseRpc('login_access', {
                    candidate_password: password,
                    session_ttl_ms: config.supabase.sessionTtlMs || 1000 * 60 * 60
                });
            } catch (error) {
                if (!canUseLocalFallback()) {
                    throw error;
                }
            }
        }

        const accessLevel = getLocalAccessLevel(password);
        if (!accessLevel) {
            throw new Error('Invalid password.');
        }

        return {
            success: true,
            token: buildLocalToken(accessLevel),
            accessLevel,
            expiresIn: config.supabase.sessionTtlMs || 1000 * 60 * 60
        };
    }

    async function getAccessSession(token) {
        const config = await ensureConfig();

        if (window.KMSiteConfig.isSupabaseConfigured(config)) {
            try {
                return await callSupabaseRpc('get_access_session', {
                    session_token: token
                });
            } catch (error) {
                if (!canUseLocalFallback()) {
                    throw error;
                }
            }
        }

        const accessLevel = parseLocalToken(token);
        if (!accessLevel) {
            throw new Error('Access session invalid.');
        }

        return {
            success: true,
            accessLevel,
            expiresIn: config.supabase.sessionTtlMs || 1000 * 60 * 60
        };
    }

    async function logoutAccess(token) {
        const config = await ensureConfig();

        if (window.KMSiteConfig.isSupabaseConfigured(config)) {
            try {
                return await callSupabaseRpc('logout_access', {
                    session_token: token
                });
            } catch (error) {
                if (!canUseLocalFallback()) {
                    throw error;
                }
            }
        }

        if (!parseLocalToken(token)) {
            throw new Error('Access session invalid.');
        }

        return { success: true };
    }

    async function searchGuestGroups(query, limit = 5) {
        const data = await callSupabaseRpc('search_guest_groups', {
            search_name: query,
            max_results: limit
        });

        return {
            success: true,
            count: Array.isArray(data) ? data.length : 0,
            results: Array.isArray(data) ? data : []
        };
    }

    async function submitRsvp(payload) {
        return callSupabaseRpc('submit_rsvp', {
            payload
        });
    }

    function loadLocalCollection(key) {
        try {
            return JSON.parse(localStorage.getItem(key) || '[]');
        } catch (error) {
            return [];
        }
    }

    async function submitAddress(payload) {
        try {
            return await callSupabaseRpc('save_address_submission', {
                payload
            });
        } catch (error) {
            if (!canUseLocalFallback()) {
                throw error;
            }

            const entries = loadLocalCollection('addresses');
            entries.push({
                ...payload,
                submittedAt: new Date().toISOString()
            });
            localStorage.setItem('addresses', JSON.stringify(entries));
            return { success: true, storedLocally: true };
        }
    }

    async function listAdminGuests(token) {
        const guests = await callSupabaseRpc('list_admin_guests', {
            session_token: token
        });

        return {
            success: true,
            guests: Array.isArray(guests) ? guests : []
        };
    }

    async function saveAdminGuest(token, payload, guestId) {
        return callSupabaseRpc('admin_upsert_guest', {
            session_token: token,
            guest_id: guestId ? Number(guestId) : null,
            payload
        });
    }

    async function deleteAdminGuest(token, guestId) {
        return callSupabaseRpc('admin_delete_guest', {
            session_token: token,
            guest_id: Number(guestId)
        });
    }

    function parseCsv(text) {
        const rows = [];
        let current = '';
        let row = [];
        let inQuotes = false;

        const pushValue = () => {
            row.push(current);
            current = '';
        };

        const pushRow = () => {
            if (row.length === 1 && row[0] === '' && !rows.length) {
                row = [];
                return;
            }
            rows.push(row);
            row = [];
        };

        for (let i = 0; i < text.length; i += 1) {
            const char = text[i];
            const next = text[i + 1];

            if (char === '"') {
                if (inQuotes && next === '"') {
                    current += '"';
                    i += 1;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }

            if (char === ',' && !inQuotes) {
                pushValue();
                continue;
            }

            if ((char === '\n' || char === '\r') && !inQuotes) {
                if (char === '\r' && next === '\n') {
                    i += 1;
                }
                pushValue();
                pushRow();
                continue;
            }

            current += char;
        }

        pushValue();
        if (row.length && row.some(cell => cell !== '')) {
            pushRow();
        }

        if (!rows.length) {
            return [];
        }

        const [headers, ...dataRows] = rows;
        return dataRows
            .filter(values => values.some(value => value && value.trim() !== ''))
            .map(values => headers.reduce((acc, header, index) => {
                acc[header] = values[index] || '';
                return acc;
            }, {}));
    }

    function normalizeHeaderKey(key) {
        return (key || '').toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
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

        const declinedMatches = ['declined', 'decline', 'not attending', 'cannot attend', "can't attend", "won't attend", 'will not attend', 'regretfully declines'];
        if (declinedMatches.some(match => normalized === match || normalized.includes(match))) {
            return 'declined';
        }

        return undefined;
    }

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

    function finalizeImportedGuests(rows) {
        const primaryTracker = new Set();
        return rows
            .map(normalizeGuestImportRow)
            .filter(row => row && row.fullName && row.groupId)
            .map(row => {
                const normalized = { ...row };
                if (typeof normalized.isPrimary !== 'boolean') {
                    const key = normalized.groupId.toLowerCase();
                    if (!primaryTracker.has(key)) {
                        normalized.isPrimary = true;
                        primaryTracker.add(key);
                    } else {
                        normalized.isPrimary = false;
                    }
                } else if (normalized.isPrimary) {
                    primaryTracker.add(normalized.groupId.toLowerCase());
                }

                if (typeof normalized.isPlusOne !== 'boolean') {
                    normalized.isPlusOne = (normalized.fullName || '').toLowerCase().includes('guest');
                }

                return normalized;
            });
    }

    async function importAdminGuests(token, csvText) {
        const rows = finalizeImportedGuests(parseCsv(csvText));
        if (!rows.length) {
            throw new Error('CSV must contain recognizable name and party/group columns.');
        }

        return callSupabaseRpc('admin_import_guests', {
            session_token: token,
            payload: rows
        });
    }

    async function getRegistryItems() {
        const config = await ensureConfig();
        if (!window.KMSiteConfig.isSupabaseConfigured(config)) {
            return { success: false, items: [] };
        }

        const fnUrl = `${config.supabase.url}/functions/v1/fetch-registry`;
        const response = await fetch(fnUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config.supabase.anonKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Registry proxy returned ${response.status}`);
        }

        const data = await response.json();
        return { success: data.success !== false, items: Array.isArray(data.items) ? data.items : [] };
    }

    window.KMDataClient = {
        loginAccess,
        getAccessSession,
        logoutAccess,
        searchGuestGroups,
        submitRsvp,
        submitAddress,
        listAdminGuests,
        saveAdminGuest,
        deleteAdminGuest,
        importAdminGuests,
        getRegistryItems
    };
})(window);
