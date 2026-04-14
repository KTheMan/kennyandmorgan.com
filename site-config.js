(function(window) {
    const DEFAULT_CONFIG = {
        apiBaseUrl: '',
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
        },
        registries: []
    };

    let configPromise = null;
    let supabaseClient = null;

    function isPlainObject(value) {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    function mergeConfig(base, extra) {
        const merged = { ...base };
        Object.entries(extra || {}).forEach(([key, value]) => {
            if (Array.isArray(value)) {
                merged[key] = value.slice();
                return;
            }
            if (isPlainObject(value) && isPlainObject(base[key])) {
                merged[key] = mergeConfig(base[key], value);
                return;
            }
            merged[key] = value;
        });
        return merged;
    }

    function normalizeLegacyConfig(raw) {
        if (!raw || typeof raw !== 'object') {
            return {};
        }
        return {
            apiBaseUrl: raw.apiBaseUrl || '',
            registries: Array.isArray(raw.registries) ? raw.registries : []
        };
    }

    function isLocalhost() {
        return ['localhost', '127.0.0.1'].includes(window.location.hostname);
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
            } catch (siteConfigError) {
                try {
                    loaded = normalizeLegacyConfig(await fetchJsonConfig('registry.config.json'));
                } catch (legacyConfigError) {
                    loaded = {};
                }
            }

            const config = mergeConfig(DEFAULT_CONFIG, loaded);
            if (isLocalhost() && !config.apiBaseUrl) {
                config.apiBaseUrl = 'http://localhost:3000';
            }

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

    function getApiBaseUrl(config = getSync()) {
        if (config?.apiBaseUrl) {
            return config.apiBaseUrl.replace(/\/$/, '');
        }
        if (isLocalhost()) {
            return 'http://localhost:3000';
        }
        return window.location.origin;
    }

    window.KMSiteConfig = {
        DEFAULT_CONFIG,
        load,
        getSync,
        isLocalhost,
        isSupabaseConfigured,
        getSupabaseClient,
        getApiBaseUrl
    };
})(window);
