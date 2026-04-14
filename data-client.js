(function(window) {
    const ACCESS_LEVELS = ['family', 'party', 'admin'];
    const LOCAL_TOKEN_PREFIX = 'local-demo:';

    async function ensureConfig() {
        return window.KMSiteConfig.load();
    }

    function getSupabaseClient() {
        return window.KMSiteConfig.getSupabaseClient(window.KMSiteConfig.getSync());
    }

    function shouldUseSupabase(config = window.KMSiteConfig.getSync()) {
        return window.KMSiteConfig.isSupabaseConfigured(config);
    }

    function canUseLocalFallback(config = window.KMSiteConfig.getSync()) {
        return window.KMSiteConfig.isLocalhost();
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

    async function callApi(path, options = {}) {
        const config = await ensureConfig();
        const baseUrl = window.KMSiteConfig.getApiBaseUrl(config);
        const headers = options.headers ? { ...options.headers } : {};
        if (options.body && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }

        const response = await fetch(`${baseUrl}${path}`, {
            ...options,
            headers
        });

        let data = {};
        try {
            data = await response.json();
        } catch (error) {
            data = {};
        }

        if (!response.ok || data.success === false) {
            const message = data.error || data.message || `Request failed with ${response.status}.`;
            const err = new Error(message);
            err.status = response.status;
            throw err;
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

    async function loginAccess(password) {
        const config = await ensureConfig();
        if (shouldUseSupabase(config)) {
            try {
                return await callSupabaseRpc('login_access', {
                    candidate_password: password,
                    session_ttl_ms: config.supabase.sessionTtlMs || 1000 * 60 * 60
                });
            } catch (error) {
                if (!canUseLocalFallback(config)) {
                    throw error;
                }
            }
        }

        try {
            return await callApi('/api/access/login', {
                method: 'POST',
                body: JSON.stringify({ password })
            });
        } catch (error) {
            if (!canUseLocalFallback(config)) {
                throw error;
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
    }

    async function getAccessSession(token) {
        const config = await ensureConfig();
        if (shouldUseSupabase(config)) {
            try {
                return await callSupabaseRpc('get_access_session', {
                    session_token: token
                });
            } catch (error) {
                if (!canUseLocalFallback(config)) {
                    throw error;
                }
            }
        }

        try {
            return await callApi('/api/access/session', {
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (error) {
            if (!canUseLocalFallback(config)) {
                throw error;
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
    }

    async function logoutAccess(token) {
        const config = await ensureConfig();
        if (shouldUseSupabase(config)) {
            try {
                return await callSupabaseRpc('logout_access', {
                    session_token: token
                });
            } catch (error) {
                if (!canUseLocalFallback(config)) {
                    throw error;
                }
            }
        }

        try {
            return await callApi('/api/access/logout', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (error) {
            if (!canUseLocalFallback(config)) {
                throw error;
            }
            return { success: true };
        }
    }

    async function searchGuestGroups(query, limit = 5) {
        const config = await ensureConfig();
        if (shouldUseSupabase(config)) {
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
        return callApi(`/api/guests/search?name=${encodeURIComponent(query)}&limit=${limit}`);
    }

    async function submitRsvp(payload) {
        const config = await ensureConfig();
        if (shouldUseSupabase(config)) {
            return callSupabaseRpc('submit_rsvp', {
                payload
            });
        }
        return callApi('/api/rsvp', {
            method: 'POST',
            body: JSON.stringify(payload)
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
        const config = await ensureConfig();
        if (shouldUseSupabase(config)) {
            return callSupabaseRpc('save_address_submission', {
                payload
            });
        }

        try {
            return await callApi('/api/addresses', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        } catch (error) {
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
        const config = await ensureConfig();
        if (shouldUseSupabase(config)) {
            const guests = await callSupabaseRpc('list_admin_guests', {
                session_token: token
            });
            return {
                success: true,
                guests: Array.isArray(guests) ? guests : []
            };
        }
        return callApi('/api/admin/guests', {
            headers: { Authorization: `Bearer ${token}` }
        });
    }

    async function saveAdminGuest(token, payload, guestId) {
        const config = await ensureConfig();
        if (shouldUseSupabase(config)) {
            return callSupabaseRpc('admin_upsert_guest', {
                session_token: token,
                guest_id: guestId ? Number(guestId) : null,
                payload
            });
        }

        const path = guestId ? `/api/admin/guests/${guestId}` : '/api/admin/guests';
        const method = guestId ? 'PATCH' : 'POST';
        return callApi(path, {
            method,
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
    }

    async function deleteAdminGuest(token, guestId) {
        const config = await ensureConfig();
        if (shouldUseSupabase(config)) {
            return callSupabaseRpc('admin_delete_guest', {
                session_token: token,
                guest_id: Number(guestId)
            });
        }
        return callApi(`/api/admin/guests/${guestId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
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

        for (let index = 0; index < text.length; index += 1) {
            const char = text[index];
            const next = text[index + 1];

            if (char === '"') {
                if (inQuotes && next === '"') {
                    current += '"';
                    index += 1;
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
                    index += 1;
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
        const config = await ensureConfig();
        if (shouldUseSupabase(config)) {
            const rows = finalizeImportedGuests(parseCsv(csvText));
            if (!rows.length) {
                throw new Error('CSV must contain recognizable name and party/group columns.');
            }
            return callSupabaseRpc('admin_import_guests', {
                session_token: token,
                payload: rows
            });
        }
        return callApi('/api/admin/guests/import', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({ csv: csvText })
        });
    }

    async function listRegistryItems(filter = 'all') {
        const config = await ensureConfig();
        if (shouldUseSupabase(config)) {
            const items = await callSupabaseRpc('list_registry_items', {
                store_filter: filter === 'all' ? null : filter,
                include_unavailable: false
            });
            return {
                success: true,
                items: Array.isArray(items) ? items : []
            };
        }

        const baseUrl = window.KMSiteConfig.getApiBaseUrl(config);
        const endpoint = filter === 'all'
            ? `${baseUrl}/api/registry`
            : `${baseUrl}/api/registry/${filter}`;
        return callApi(endpoint.replace(baseUrl, ''), {});
    }

    async function flagRegistryItemForFastPoll(cacheId) {
        const config = await ensureConfig();
        if (shouldUseSupabase(config)) {
            return { success: true, skipped: true };
        }
        return callApi(`/api/registry/items/${cacheId}/fast-poll`, {
            method: 'POST'
        });
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
        listRegistryItems,
        flagRegistryItemForFastPoll
    };
})(window);
