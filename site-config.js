(function(window) {
    const DEFAULT_CONFIG = {
        registryPageUrl: 'https://www.myregistry.com/giftlist/morganandkenny',
        supabase: {
            url: '',
            anonKey: '',
            sessionTtlMs: 1000 * 60 * 60
        },
        localFallbackAccess: {
            familyPassword: '',
            partyPassword: '',
            adminPassword: ''
        }
    };

    let configPromise = null;
    let supabaseClient = null;

    function isPlainObject(value) {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    function mergeConfig(base, extra) {
        const merged = { ...base };
        Object.entries(extra || {}).forEach(([key, value]) => {
            if (isPlainObject(value) && isPlainObject(base[key])) {
                merged[key] = mergeConfig(base[key], value);
                return;
            }
            merged[key] = value;
        });
        return merged;
    }

    async function fetchJsonConfig(path) {
        const response = await fetch(path, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
    }

    async function load() {
        if (configPromise) {
            return configPromise;
        }

        configPromise = (async () => {
            let loaded = {};

            try {
                loaded = await fetchJsonConfig('site.config.json');
            } catch (error) {
                loaded = {};
            }

            const config = mergeConfig(DEFAULT_CONFIG, loaded);
            window.__KM_SITE_CONFIG = config;
            return config;
        })();

        return configPromise;
    }

    function getSync() {
        return window.__KM_SITE_CONFIG || DEFAULT_CONFIG;
    }

    function isSupabaseConfigured(config = getSync()) {
        return Boolean(config?.supabase?.url && config?.supabase?.anonKey);
    }

    function getSupabaseClient(config = getSync()) {
        if (!isSupabaseConfigured(config)) {
            return null;
        }
        if (supabaseClient) {
            return supabaseClient;
        }
        if (!window.supabase || typeof window.supabase.createClient !== 'function') {
            throw new Error('Supabase client library is not available.');
        }
        supabaseClient = window.supabase.createClient(config.supabase.url, config.supabase.anonKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        });
        return supabaseClient;
    }

    function isLocalhost() {
        return ['localhost', '127.0.0.1'].includes(window.location.hostname);
    }

    window.KMSiteConfig = {
        DEFAULT_CONFIG,
        load,
        getSync,
        getSupabaseClient,
        isSupabaseConfigured,
        isLocalhost
    };
})(window);
