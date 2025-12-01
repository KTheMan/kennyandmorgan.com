// Navigation functionality
document.addEventListener('DOMContentLoaded', () => {
    initAccessControl().catch(error => {
        console.error('Access control failed to initialize:', error);
    });
    initNavigation();
    initCountdown();
    initForms();
    initRegistry().catch(error => {
        console.error('Unable to initialize registry filters:', error);
    });
    initAccommodationsMap().catch(error => {
        console.error('Unable to load accommodations map:', error);
    });
    initAccommodationScrollHint();
    initAdminMenu();
});

let registryConfig = {
    apiBaseUrl: '',
    registries: []
};

let latestGuestLookupResults = [];
const registryFastPollClicks = new Map();
const REGISTRY_FAST_POLL_CLICK_THROTTLE_MS = 60 * 1000;
const ACCESS_LEVELS = {
    locked: 'locked',
    family: 'family',
    party: 'party',
    admin: 'admin'
};
const ACCESS_LEVEL_STORAGE_KEY = 'km_access_level';
const ACCESS_TOKEN_STORAGE_KEY = 'km_access_token';
let currentAccessLevel = ACCESS_LEVELS.locked;
let hasUnlockedOnce = false;
const ACCESS_ORDER = [ACCESS_LEVELS.locked, ACCESS_LEVELS.family, ACCESS_LEVELS.party, ACCESS_LEVELS.admin];

const weddingPartyMembers = [
    {
        name: 'Maya Thompson',
        role: 'Matron of Honor',
        bio: "Morgan's older sister and resident hype queen. She keeps everyone laughing and on time.",
        photo: 'https://placehold.co/200x200?text=Maya'
    },
    {
        name: 'Alex Ramirez',
        role: 'Best Man',
        bio: "Kenny's college roommate turned lifelong confidant. Master of speeches and dad jokes.",
        photo: 'https://placehold.co/200x200?text=Alex'
    },
    {
        name: 'Jada Lee',
        role: 'Maid of Honor',
        bio: "Morgan's childhood best friend who knows every embarrassing story and still shows up early.",
        photo: 'https://placehold.co/200x200?text=Jada'
    },
    {
        name: 'Theo Patel',
        role: 'Groomsman',
        bio: 'Pick-up basketball MVP and Kenny’s startup co-founder. Also the unofficial DJ.',
        photo: 'https://placehold.co/200x200?text=Theo'
    },
    {
        name: 'Riley Chen',
        role: 'Bridesmaid',
        bio: 'Met Morgan in grad school and bonded over late-night study snacks and travel plans.',
        photo: 'https://placehold.co/200x200?text=Riley'
    },
    {
        name: 'Jordan Brooks',
        role: 'Groomsman',
        bio: "Cousin, camping buddy, and the guy who double-checks Kenny's cuff links.",
        photo: 'https://placehold.co/200x200?text=Jordan'
    },
    {
        name: 'Priya Singh',
        role: 'Bridesmaid',
        bio: 'Office bestie turned soul sister. She organized the group chat and the spa day.',
        photo: 'https://placehold.co/200x200?text=Priya'
    },
    {
        name: 'Evan Ortiz',
        role: 'Groomsman',
        bio: "Bandmate from Kenny's college days and lead guitarist for the reception surprise.",
        photo: 'https://placehold.co/200x200?text=Evan'
    },
    {
        name: 'Lila Nguyen',
        role: 'Bridesmaid',
        bio: 'Met Morgan during her first week in Santa Cruz and has been her brunch date ever since.',
        photo: 'https://placehold.co/200x200?text=Lila'
    },
    {
        name: 'Marcus Hill',
        role: 'Groomsman',
        bio: 'High school teammate and reigning cornhole champion. Keeper of Kenny’s spare vows.',
        photo: 'https://placehold.co/200x200?text=Marcus'
    },
    {
        name: 'Sofia Bennett',
        role: 'Bridesmaid',
        bio: "Morgan's fashion muse and florist consultant. She designed the bouquet vision board.",
        photo: 'https://placehold.co/200x200?text=Sofia'
    },
    {
        name: 'Carter Lewis',
        role: 'Groomsman',
        bio: 'Resident spreadsheet wizard who turned budget chaos into calm.',
        photo: 'https://placehold.co/200x200?text=Carter'
    },
    {
        name: 'Naomi Fields',
        role: 'Bridesmaid',
        bio: 'College roommate, meditation partner, and fearless toastmaster.',
        photo: 'https://placehold.co/200x200?text=Naomi'
    },
    {
        name: 'Henry Watkins',
        role: 'Groomsman',
        bio: "Kenny's little brother who always brings the energy (and the snacks).",
        photo: 'https://placehold.co/200x200?text=Henry'
    },
    {
        name: 'Zoe Martinez',
        role: 'Officiant',
        bio: 'Mutual friend who introduced Kenny and Morgan. She gets to tell the story again, officially.',
        photo: 'https://placehold.co/200x200?text=Zoe'
    }
];

async function initAccessControl() {
    renderWeddingPartyMembers();
    const passwordInput = document.getElementById('accessPassword');
    const statusEl = document.getElementById('accessStatus');
    const form = document.getElementById('accessForm');

    const resumed = await resumeAccessSession();
    if (!resumed) {
        showOverlay();
        passwordInput?.focus();
        updateAccessVisibility();
    }

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        await handleAccessUnlock(passwordInput, statusEl);
    });
}

async function handleAccessUnlock(passwordInput, statusEl) {
    const password = passwordInput?.value || '';
    const trimmed = password.trim();
    if (!trimmed) {
        if (statusEl) {
            statusEl.textContent = 'Please enter the password to continue.';
            statusEl.classList.add('is-error');
        }
        return;
    }

    if (statusEl) {
        statusEl.textContent = 'Unlocking...';
        statusEl.classList.remove('is-error');
    }

    try {
        const result = await authenticateAccessPassword(trimmed);
        persistAccessToken(result.token);
        applyAccessLevel(result.accessLevel);
        if (statusEl) {
            statusEl.textContent = '';
        }
    } catch (error) {
        console.error('Unable to unlock access:', error);
        if (statusEl) {
            statusEl.textContent = error.message || 'Incorrect password. Please try again.';
            statusEl.classList.add('is-error');
        }
        showOverlay();
    } finally {
        if (passwordInput) {
            passwordInput.value = '';
        }
    }
}

async function resumeAccessSession() {
    const token = getStoredAccessToken();
    if (!token) {
        return false;
    }
    try {
        const session = await fetchAccessSession(token);
        persistAccessToken(token);
        applyAccessLevel(session.accessLevel);
        return true;
    } catch (error) {
        console.warn('Stored access token is no longer valid:', error);
        clearStoredAccess();
        return false;
    }
}

async function authenticateAccessPassword(password) {
    const response = await fetch('/api/access/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
    });
    const data = await safeJson(response);
    if (!response.ok || data.success === false) {
        const error = new Error(data.error || data.message || 'Unable to authenticate.');
        error.status = response.status;
        throw error;
    }
    return data;
}

async function fetchAccessSession(token) {
    const response = await fetch('/api/access/session', {
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await safeJson(response);
    if (!response.ok || data.success === false) {
        const error = new Error(data.error || data.message || 'Access session invalid.');
        error.status = response.status;
        throw error;
    }
    return data;
}

async function safeJson(response) {
    try {
        return await response.json();
    } catch (error) {
        return {};
    }
}

function getStoredAccessToken() {
    try {
        return localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
    } catch (error) {
        console.warn('Unable to read stored access token:', error);
        return null;
    }
}

function persistAccessToken(token) {
    if (!token) {
        clearStoredAccess();
        return;
    }
    try {
        localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
    } catch (error) {
        console.warn('Unable to persist access token:', error);
    }
}

function clearStoredAccess() {
    try {
        localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
        localStorage.removeItem(ACCESS_LEVEL_STORAGE_KEY);
    } catch (error) {
        console.warn('Unable to clear stored access data:', error);
    }
}

function applyAccessLevel(level) {
    const sanitized = normalizeAccessLevel(level);
    currentAccessLevel = sanitized;
    document.body.dataset.accessLevel = sanitized;
    try {
        localStorage.setItem(ACCESS_LEVEL_STORAGE_KEY, sanitized);
    } catch (error) {
        console.warn('Unable to persist access level:', error);
    }

    if (sanitized === ACCESS_LEVELS.locked) {
        showOverlay();
    } else {
        hideOverlay();
        if (!hasUnlockedOnce) {
            setInitialSection('home');
            hasUnlockedOnce = true;
        }
    }
    updateAccessVisibility();
}

function showOverlay() {
    document.body.classList.add('access-locked');
    document.getElementById('accessOverlay')?.removeAttribute('hidden');
}

function hideOverlay() {
    document.body.classList.remove('access-locked');
    document.getElementById('accessOverlay')?.setAttribute('hidden', 'hidden');
}

function updateAccessVisibility() {
    const nodes = document.querySelectorAll('[data-access-visible]');
    nodes.forEach(node => {
        const requiredLevel = normalizeAccessLevel(node.dataset.accessVisible);
        const allowed = hasAccess(requiredLevel);
        node.classList.toggle('is-access-granted', allowed);
        node.setAttribute('aria-hidden', String(!allowed));
        if (!allowed && node.classList.contains('page') && node.classList.contains('active')) {
            setInitialSection('home');
        }
    });
    setAdminMenuVisibility();
}

function normalizeAccessLevel(value) {
    const normalized = (value || '').toLowerCase();
    if (ACCESS_ORDER.includes(normalized)) {
        return normalized;
    }
    return ACCESS_LEVELS.locked;
}

function getAccessRank(level) {
    const normalized = normalizeAccessLevel(level);
    const index = ACCESS_ORDER.indexOf(normalized);
    return index === -1 ? 0 : index;
}

function hasAccess(requiredLevel) {
    if (!requiredLevel || requiredLevel === ACCESS_LEVELS.locked) {
        return getAccessRank(currentAccessLevel) >= 0;
    }
    return getAccessRank(currentAccessLevel) >= getAccessRank(requiredLevel);
}

function renderWeddingPartyMembers() {
    const grid = document.getElementById('weddingPartyGrid');
    if (!grid) {
        return;
    }
    grid.innerHTML = weddingPartyMembers.map(member => {
        const imageUrl = member.photo || `https://placehold.co/200x200?text=${encodeURIComponent(member.name.split(' ')[0] || 'Friend')}`;
        return `
            <article class="party-card">
                <img src="${imageUrl}" alt="${member.name}" loading="lazy">
                <h3 class="party-name">${member.name}</h3>
                <p class="party-role">${member.role}</p>
                <p class="party-bio">${member.bio}</p>
            </article>
        `;
    }).join('');
}

function initAdminMenu() {
    const container = document.querySelector('.admin-quick-menu');
    const toggle = document.getElementById('adminMenuToggle');
    const panel = document.getElementById('adminMenuPanel');
    if (!container || !toggle || !panel) {
        return;
    }

    const adminLinks = [
        { label: 'Admin Console', href: 'admin.html' },
        { label: 'Registry API Docs', href: 'API_README.md', external: true },
        { label: 'Deployment Notes', href: 'DEPLOYMENT.md', external: true }
    ];

    panel.innerHTML = adminLinks.map(link => {
        const attrs = link.external ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a class="admin-menu-link" role="menuitem" href="${link.href}"${attrs}>${link.label}</a>`;
    }).join('');
    panel.setAttribute('aria-hidden', 'true');

    const closeMenu = () => {
        container.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        panel.setAttribute('aria-hidden', 'true');
    };

    const openMenu = () => {
        container.classList.add('is-open');
        toggle.setAttribute('aria-expanded', 'true');
        panel.setAttribute('aria-hidden', 'false');
    };

    toggle.addEventListener('click', () => {
        if (container.classList.contains('is-open')) {
            closeMenu();
        } else {
            openMenu();
        }
    });

    document.addEventListener('click', (event) => {
        if (!container.classList.contains('is-open')) {
            return;
        }
        if (!container.contains(event.target)) {
            closeMenu();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && container.classList.contains('is-open')) {
            closeMenu();
            toggle.focus();
        }
    });

    setAdminMenuVisibility();
}

function setAdminMenuVisibility() {
    const container = document.querySelector('.admin-quick-menu');
    const toggle = document.getElementById('adminMenuToggle');
    const panel = document.getElementById('adminMenuPanel');
    if (!container) {
        return;
    }
    const allowed = hasAccess(ACCESS_LEVELS.admin);
    container.classList.toggle('is-accessible', allowed);
    if (!allowed) {
        container.classList.remove('is-open');
        toggle?.setAttribute('aria-expanded', 'false');
        panel?.setAttribute('aria-hidden', 'true');
    }
}

// Navigation
function initNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    const burger = document.querySelector('.burger');
    const nav = document.querySelector('.nav-links');

    const navigate = (link, event) => {
        event?.preventDefault();
        const targetId = link.getAttribute('href')?.substring(1);
        if (!targetId) {
            return;
        }

        // Update active nav link
        navLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');

        // Show target page
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
        });
        document.getElementById(targetId)?.classList.add('active');

        // Close mobile menu
        nav.classList.remove('active');
        burger.classList.remove('toggle');

        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Handle navigation clicks
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            if (link.closest('.access-conditional') && !link.closest('.access-conditional').classList.contains('is-access-granted')) {
                return;
            }
            navigate(link, e);
        });
    });

    // Mobile menu toggle
    burger.addEventListener('click', () => {
        nav.classList.toggle('active');
        burger.classList.toggle('toggle');
    });

    burger.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            burger.click();
        }
    });
}

function setInitialSection(sectionId) {
    const target = document.querySelector(`.nav-link[href="#${sectionId}"]`);
    if (target) {
        target.click();
    }
}

// Countdown Timer
function initCountdown() {
    const weddingDate = new Date('2026-09-12T15:00:00').getTime();
    
    function updateCountdown() {
        const now = new Date().getTime();
        const distance = weddingDate - now;
        
        if (distance < 0) {
            document.getElementById('countdown').innerHTML = '<h2>We\'re Married!</h2>';
            return;
        }
        
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);
        
        document.getElementById('days').textContent = days;
        document.getElementById('hours').textContent = hours;
        document.getElementById('minutes').textContent = minutes;
        document.getElementById('seconds').textContent = seconds;
    }
    
    updateCountdown();
    setInterval(updateCountdown, 1000);
}

// Form Handling
function initForms() {
    // Address Form
    const addressForm = document.getElementById('addressForm');
    addressForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleAddressSubmit(e.target);
    });

    // RSVP Form
    const rsvpForm = document.getElementById('rsvpForm');
    rsvpForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleRSVPSubmit(e.target);
    });

    setupGuestLookup();

    // Show/hide guest count based on attendance
    const attendingRadios = document.querySelectorAll('input[name="attending"]');
    attendingRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            const guestCountGroup = document.getElementById('guestCountGroup');
            if (e.target.value === 'yes') {
                guestCountGroup.style.display = 'block';
                document.getElementById('guestCount').required = true;
            } else {
                guestCountGroup.style.display = 'none';
                document.getElementById('guestCount').required = false;
            }
        });
    });
}

function setupGuestLookup() {
    const lookupButton = document.getElementById('guestLookupButton');
    const nameInput = document.getElementById('rsvpName');
    const guestCountGroup = document.getElementById('guestCountGroup');
    const guestCountInput = document.getElementById('guestCount');
    const hiddenGroupInput = document.getElementById('guestGroupId');
    const resultsContainer = document.getElementById('guestLookupResults');
    const messageElement = document.getElementById('guestLookupMessage');

    if (!lookupButton || !nameInput || !resultsContainer || !messageElement) {
        return;
    }

    const setLookupState = (text, variant = 'info') => {
        messageElement.textContent = text;
        messageElement.className = `guest-lookup-message is-${variant}`;
    };

    const resetResults = () => {
        latestGuestLookupResults = [];
        resultsContainer.innerHTML = '';
        if (hiddenGroupInput) {
            hiddenGroupInput.value = '';
        }
    };

    lookupButton.addEventListener('click', async () => {
        const query = nameInput.value.trim();
        resetResults();

        if (!query) {
            setLookupState('Please enter your full name first.', 'error');
            return;
        }

        lookupButton.disabled = true;
        lookupButton.textContent = 'Searching...';
        setLookupState('Looking up your party...', 'info');

        try {
            const apiBase = resolveApiBaseUrl();
            const response = await fetch(`${apiBase}/api/guests/search?name=${encodeURIComponent(query)}`);

            if (!response.ok) {
                throw new Error('Search request failed');
            }

            const data = await response.json();

            if (!data.success || !Array.isArray(data.results) || !data.results.length) {
                setLookupState('We could not find a party with that name. Double-check the spelling or reach out to us.', 'error');
                return;
            }

            latestGuestLookupResults = data.results;
            renderGuestLookupResults(resultsContainer, data.results);
            setLookupState('Select your party below to auto-fill the RSVP.', 'success');
        } catch (error) {
            console.error('Guest lookup failed:', error);
            setLookupState('Something went wrong while searching. Please try again or contact us.', 'error');
        } finally {
            lookupButton.disabled = false;
            lookupButton.textContent = 'Find My Party';
        }
    });

    resultsContainer.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-select-group]');
        if (!trigger) {
            return;
        }

        const { selectGroup: groupId } = trigger.dataset;
        const selectedGroup = latestGuestLookupResults.find(group => group.groupId === groupId);
        if (!selectedGroup) {
            return;
        }

        if (hiddenGroupInput) {
            hiddenGroupInput.value = selectedGroup.groupId;
        }

        if (guestCountGroup && guestCountInput && selectedGroup.guests?.length) {
            guestCountGroup.classList.remove('hidden');
            guestCountInput.value = selectedGroup.guests.length;
        }

        if (selectedGroup.guests?.length) {
            nameInput.value = selectedGroup.primaryGuest || selectedGroup.guests[0].fullName;
        }

        setLookupState(`Loaded guests for ${selectedGroup.primaryGuest || 'your party'}.`, 'success');
    });
}

function renderGuestLookupResults(container, groups) {
    container.innerHTML = groups.map((group, index) => {
        const guestList = group.guests?.map(guest => {
            const role = guest.isPlusOne ? ' (plus one)' : '';
            return `<li>${guest.fullName}${role}</li>`;
        }).join('') || '';

        return `
            <article class="guest-result-card" data-group-id="${group.groupId}">
                <div class="guest-result-header">
                    <div>
                        <p class="guest-result-label">Party ${index + 1}</p>
                        <p class="guest-result-title">${group.primaryGuest || 'Guest Party'}</p>
                    </div>
                    <button type="button" class="btn btn-secondary guest-result-select" data-select-group="${group.groupId}">Use This Party</button>
                </div>
                <p class="guest-result-summary">Guests on this invitation:</p>
                <ul class="guest-result-list">${guestList}</ul>
            </article>
        `;
    }).join('');
}

function handleAddressSubmit(form) {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    
    // In a real application, this would send data to a backend
    // For now, we'll simulate a successful submission
    console.log('Address submitted:', data);
    
    // Store in localStorage for demo purposes
    const addresses = JSON.parse(localStorage.getItem('addresses') || '[]');
    addresses.push({
        ...data,
        submittedAt: new Date().toISOString()
    });
    localStorage.setItem('addresses', JSON.stringify(addresses));
    
    showMessage('addressMessage', 'Thank you! Your address has been saved.', 'success');
    form.reset();
}

async function handleRSVPSubmit(form) {
    const submitButton = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    const payload = {
        name: data.rsvpName,
        email: data.rsvpEmail,
        attending: data.attending === 'yes',
        guestCount: data.guestCount ? Number(data.guestCount) : undefined,
        dietaryRestrictions: data.dietaryRestrictions || '',
        specialMessage: data.specialMessage || data.songRequest || '',
        songRequest: data.songRequest || '',
        guestGroupId: data.guestGroupId || '',
        mealChoice: data.mealChoice || ''
    };

    const apiBase = resolveApiBaseUrl();
    submitButton?.setAttribute('disabled', 'disabled');
    submitButton?.classList.add('is-loading');

    try {
        const response = await fetch(`${apiBase}/api/rsvp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Submission failed');
        }

        showMessage('rsvpMessage', result.message || 'Thank you for your RSVP!', 'success');
        form.reset();
        document.getElementById('guestCountGroup').style.display = 'none';
    } catch (error) {
        console.error('Unable to submit RSVP:', error);
        showMessage('rsvpMessage', 'We could not save your RSVP. Please try again or contact us directly.', 'error');
    } finally {
        submitButton?.removeAttribute('disabled');
        submitButton?.classList.remove('is-loading');
    }
}

function showMessage(elementId, message, type) {
    const messageEl = document.getElementById(elementId);
    messageEl.textContent = message;
    messageEl.className = `message ${type}`;
    messageEl.style.display = 'block';
    
    setTimeout(() => {
        messageEl.style.display = 'none';
    }, 5000);
}

// Registry Management
async function initRegistry() {
    await loadRegistryConfig();

    const registryFilter = document.getElementById('registryFilter');

    if (!registryFilter) {
        return;
    }

    registryFilter.addEventListener('change', (event) => {
        loadRegistryItems(event.target.value || 'all');
    });

    registryFilter.value = 'all';
    registryFilter.disabled = true;

    // Load all items initially and build filter options
    await loadRegistryItems('all', { refreshFilters: true });
    setupRegistryFastPollListener();
}

async function loadRegistryConfig() {
    try {
        const response = await fetch('registry.config.json', { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        const registries = Array.isArray(data.registries)
            ? data.registries
                .map(entry => ({
                    ...entry,
                    store: (entry.store || '').toLowerCase()
                }))
                .filter(entry => entry.store)
            : [];
        registryConfig = {
            apiBaseUrl: data.apiBaseUrl || '',
            registries
        };
    } catch (error) {
        console.warn('Unable to load registry.config.json, falling back to defaults.', error);
        registryConfig = {
            apiBaseUrl: '',
            registries: []
        };
    }

    return registryConfig;
}

async function loadRegistryItems(filter, options = {}) {
    const registryContainer = document.getElementById('registryItems');
    const loadingEl = document.getElementById('registryLoading');
    
    // Show loading
    loadingEl.style.display = 'block';
    registryContainer.innerHTML = '';
    
    try {
        const endpoint = buildRegistryEndpoint(filter);
        const fetchOptions = getRegistryFetchOptions(filter);
        const response = await fetch(endpoint, fetchOptions);
        
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success && data.items) {
            if (options.refreshFilters || filter === 'all') {
                updateRegistryFilterOptions(data.items);
            }
            displayRegistryItems(data.items);
        } else {
            throw new Error('Invalid response format');
        }
    } catch (error) {
        console.error('Error loading registry items:', error);
        // Show error message - no fallback to mock data
        displayRegistryItems([]);
        showRegistryError('Unable to load registry items. Please ensure valid registry IDs are configured.');
        resetRegistryFilterOptions();
    } finally {
        loadingEl.style.display = 'none';
    }
}

function updateRegistryFilterOptions(items) {
    const registryFilter = document.getElementById('registryFilter');
    if (!registryFilter) {
        return;
    }

    const previousValue = registryFilter.value;

    // Remove existing store options except "all"
    Array.from(registryFilter.querySelectorAll('option:not([value="all"])')).forEach(option => option.remove());

    const storeCounts = items.reduce((acc, item) => {
        const key = (item.store || '').toLowerCase().trim();
        if (!key) {
            return acc;
        }
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    const storesWithItems = Object.entries(storeCounts)
        .filter(([, count]) => count > 0)
        .sort((a, b) => capitalizeStore(a[0]).localeCompare(capitalizeStore(b[0])));

    storesWithItems.forEach(([store]) => {
        const option = document.createElement('option');
        option.value = store;
        option.textContent = capitalizeStore(store);
        registryFilter.appendChild(option);
    });

    const canKeepPrevious = previousValue !== 'all' && storesWithItems.some(([store]) => store === previousValue);
    registryFilter.value = canKeepPrevious ? previousValue : 'all';
    registryFilter.disabled = registryFilter.options.length <= 1;
}

function setupRegistryFastPollListener() {
    const registryContainer = document.getElementById('registryItems');
    if (!registryContainer) {
        return;
    }
    registryContainer.addEventListener('click', (event) => {
        const link = event.target.closest('.registry-item-link');
        if (!link) {
            return;
        }
        const cacheId = link.dataset.cacheId;
        if (cacheId) {
            flagRegistryItemForFastPoll(cacheId);
        }
    });
}

function resetRegistryFilterOptions() {
    const registryFilter = document.getElementById('registryFilter');
    if (!registryFilter) {
        return;
    }
    Array.from(registryFilter.querySelectorAll('option:not([value="all"])')).forEach(option => option.remove());
    registryFilter.value = 'all';
    registryFilter.disabled = true;
}

function showRegistryError(message) {
    const registryContainer = document.getElementById('registryItems');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'registry-error';
    errorDiv.style.cssText = 'grid-column: 1/-1; text-align: center; padding: 20px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; color: #856404;';
    errorDiv.textContent = message;
    registryContainer.insertBefore(errorDiv, registryContainer.firstChild);
}


function displayRegistryItems(items) {
    const registryContainer = document.getElementById('registryItems');
    
    if (items.length === 0) {
        registryContainer.innerHTML = '<p style="text-align: center; grid-column: 1/-1; padding: 40px 20px; color: var(--slate-gray);">No registry items available. Registry IDs must be configured to display items.</p>';
        return;
    }
    
    registryContainer.innerHTML = items.map(item => {
        const purchased = formatQuantityValue(item.purchasedQuantity);
        const wanted = formatQuantityValue(item.wantedQuantity);
        const refreshLabel = item.fastPollActive ? 'Live refresh (2 min)' : 'Hourly refresh';
        const refreshClass = item.fastPollActive ? 'registry-item-refresh is-live' : 'registry-item-refresh';
        const priceDisplay = formatRegistryPrice(item.price);
        const cacheIdAttr = item.cacheId ? ` data-cache-id="${item.cacheId}"` : '';
        const imageSrc = item.image || 'https://via.placeholder.com/300x300/D4A373/FFFFFF?text=Registry+Item';
        return `
        <div class="registry-item"${cacheIdAttr}>
            <img src="${imageSrc}" alt="${item.name}" class="registry-item-image">
            <div class="registry-item-details">
                <div class="registry-item-name">${item.name}</div>
                <div class="registry-item-store">${capitalizeStore(item.store)}</div>
                <div class="registry-item-price">${priceDisplay}</div>
                <div class="registry-item-quantities">
                    <span class="registry-item-qty">${purchased} / ${wanted} purchased</span>
                    <span class="${refreshClass}">${refreshLabel}</span>
                </div>
                <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="registry-item-link"${cacheIdAttr}>
                    View on ${capitalizeStore(item.store)}
                </a>
            </div>
        </div>`;
    }).join('');
}

function capitalizeStore(store) {
    const storeNames = {
        'amazon': 'Amazon',
        'target': 'Target',
        'crateandbarrel': 'Crate & Barrel',
        'potterybarn': 'Pottery Barn',
        'williamsonoma': 'Williams-Sonoma',
        'rei': 'REI',
        'zola': 'Zola',
        'heathceramics': 'Heath Ceramics'
    };
    return storeNames[store] || store;
}

function findRegistryConfig(filter) {
    if (!registryConfig.registries.length || filter === 'all') {
        return null;
    }
    return registryConfig.registries.find(entry => entry.store === filter) || null;
}

function buildRegistryEndpoint(filter) {
    const config = findRegistryConfig(filter);

    if (config?.endpoint) {
        const hasQuery = config.endpoint.includes('?');
        const params = new URLSearchParams();

        if (config.registryId) {
            params.set('registry', config.registryId);
        }
        if (config.token) {
            params.set('token', config.token);
        }

        const query = params.toString();
        if (query) {
            return `${config.endpoint}${hasQuery ? '&' : '?'}${query}`;
        }
        return config.endpoint;
    }

    const baseUrl = config?.apiBaseUrl || registryConfig.apiBaseUrl;
    if (baseUrl) {
        return filter === 'all'
            ? `${baseUrl.replace(/\/$/, '')}/api/registry`
            : `${baseUrl.replace(/\/$/, '')}/api/registry/${filter}`;
    }

    const defaultBase = window.location.origin;
    return filter === 'all'
        ? `${defaultBase}/api/registry`
        : `${defaultBase}/api/registry/${filter}`;
}

function getRegistryFetchOptions(filter) {
    const config = findRegistryConfig(filter);
    if (!config || !config.headers) {
        return {};
    }

    const headers = {};
    Object.entries(config.headers).forEach(([key, value]) => {
        if (typeof value === 'string' && value.trim()) {
            headers[key] = value;
        }
    });

    return { headers };
}

async function flagRegistryItemForFastPoll(cacheId) {
    const now = Date.now();
    const lastClick = registryFastPollClicks.get(cacheId);
    if (lastClick && (now - lastClick) < REGISTRY_FAST_POLL_CLICK_THROTTLE_MS) {
        return;
    }
    registryFastPollClicks.set(cacheId, now);
    try {
        const apiBase = resolveApiBaseUrl();
        await fetch(`${apiBase}/api/registry/items/${cacheId}/fast-poll`, { method: 'POST' });
    } catch (error) {
        console.warn('Unable to schedule fast poll for item', cacheId, error);
    }
}

function formatRegistryPrice(price) {
    if (typeof price === 'number' && Number.isFinite(price)) {
        return `$${price.toFixed(2)}`;
    }
    return '—';
}

function formatQuantityValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    return '—';
}

// Accommodation map + interactions
async function initAccommodationsMap() {
    const mapContainer = document.getElementById('accommodationMap');
    if (!mapContainer || typeof L === 'undefined') {
        return;
    }

    const geocodeCacheKey = 'accommodationGeoCache';
    let geocodeCache = {};

    try {
        geocodeCache = JSON.parse(localStorage.getItem(geocodeCacheKey) || '{}');
    } catch (error) {
        console.warn('Unable to read geocode cache, starting fresh.', error);
    }

    const saveGeocodeCache = () => {
        try {
            localStorage.setItem(geocodeCacheKey, JSON.stringify(geocodeCache));
        } catch (error) {
            console.warn('Unable to persist geocode cache.', error);
        }
    };

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const geocodeAddress = async (address) => {
        if (!address) {
            return null;
        }
        if (geocodeCache[address]) {
            return geocodeCache[address];
        }
        try {
            const params = new URLSearchParams({
                format: 'json',
                limit: '1',
                q: address
            });
            const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
                headers: {
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            if (!data.length) {
                return null;
            }
            const coords = {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon)
            };
            geocodeCache[address] = coords;
            saveGeocodeCache();
            await sleep(1200); // respect Nominatim rate limits
            return coords;
        } catch (error) {
            console.error('Geocoding failed for', address, error);
            return null;
        }
    };

    const accommodationElements = Array.from(document.querySelectorAll('.accommodation-item'));
    const accommodations = [];

    for (const [index, element] of accommodationElements.entries()) {
        let lat = parseFloat(element.dataset.lat);
        let lng = parseFloat(element.dataset.lng);
        const address = element.dataset.address || element.querySelector('.accommodation-address')?.textContent.trim() || '';

        if ((Number.isNaN(lat) || Number.isNaN(lng)) && address) {
            const coords = await geocodeAddress(address);
            if (coords) {
                lat = coords.lat;
                lng = coords.lng;
                element.dataset.lat = coords.lat;
                element.dataset.lng = coords.lng;
            }
        }

        if (Number.isNaN(lat) || Number.isNaN(lng)) {
            continue;
        }

        accommodations.push({
            id: element.dataset.accommodationId || `accommodation-${index}`,
            name: element.querySelector('.accommodation-name')?.textContent.trim() || 'Accommodation',
            address,
            lat,
            lng,
            element
        });
    }

    const venueCard = document.querySelector('[data-venue-card="hollins-house"]');
    let venuePoint = null;

    if (venueCard) {
        let venueLat = parseFloat(venueCard.dataset.lat);
        let venueLng = parseFloat(venueCard.dataset.lng);
        const venueAddress = venueCard.dataset.address || venueCard.querySelector('.address')?.textContent.replace(/\s+/g, ' ').trim() || '20 Clubhouse Rd, Santa Cruz, CA 95060';

        if ((Number.isNaN(venueLat) || Number.isNaN(venueLng)) && venueAddress) {
            const coords = await geocodeAddress(venueAddress);
            if (coords) {
                venueLat = coords.lat;
                venueLng = coords.lng;
                venueCard.dataset.lat = coords.lat;
                venueCard.dataset.lng = coords.lng;
            }
        }

        if (!Number.isNaN(venueLat) && !Number.isNaN(venueLng)) {
            venuePoint = {
                id: 'venue-hollins-house',
                name: 'Hollins House (Venue)',
                address: venueAddress,
                lat: venueLat,
                lng: venueLng,
                element: venueCard,
                isVenue: true
            };
        }
    }

    const mapPoints = venuePoint ? [...accommodations, venuePoint] : accommodations;

    if (!mapPoints.length) {
        mapContainer.innerHTML = '<p class="map-empty">Map data is unavailable at the moment.</p>';
        return;
    }

    const averageLat = mapPoints.reduce((sum, acc) => sum + acc.lat, 0) / mapPoints.length;
    const averageLng = mapPoints.reduce((sum, acc) => sum + acc.lng, 0) / mapPoints.length;

    const map = L.map(mapContainer, { scrollWheelZoom: false }).setView([averageLat, averageLng], 12);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd'
    }).addTo(map);

    map.scrollWheelZoom.disable();
    mapContainer.addEventListener('mouseenter', () => map.scrollWheelZoom.enable());
    mapContainer.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());

    const defaultStyle = {
        radius: 8,
        color: '#C9A961',
        weight: 2,
        fillColor: '#C9A961',
        fillOpacity: 0.85
    };
    const activeStyle = {
        ...defaultStyle,
        radius: 11,
        color: '#FFFFFF',
        weight: 3,
        fillOpacity: 1
    };
    const venueStyle = {
        radius: 12,
        color: '#0F77FF',
        weight: 3,
        fillColor: '#0F77FF',
        fillOpacity: 0.95
    };
    const venueActiveStyle = {
        ...venueStyle,
        radius: 14,
        color: '#FFFFFF'
    };

    const markers = {};
    let activeId = null;
    const bounds = [];

    const getMarkerStyle = (point, isActive) => {
        if (point.isVenue) {
            return isActive ? venueActiveStyle : venueStyle;
        }
        return isActive ? activeStyle : defaultStyle;
    };

    const toggleElementState = (point, isActive) => {
        if (!point.element) {
            return;
        }
        if (point.isVenue) {
            point.element.classList.toggle('venue-active', isActive);
        } else {
            point.element.classList.toggle('active', isActive);
        }
    };

    const setActive = (id) => {
        if (activeId === id) return;
        activeId = id;

        mapPoints.forEach((point) => {
            const isActive = point.id === id;
            toggleElementState(point, isActive);
            const marker = markers[point.id];
            if (marker && marker.setStyle) {
                marker.setStyle(getMarkerStyle(point, isActive));
            }
            if (!isActive && marker) {
                marker.closePopup();
            }
        });
    };

    const clearActive = () => {
        activeId = null;
        mapPoints.forEach((point) => {
            toggleElementState(point, false);
            const marker = markers[point.id];
            if (marker) {
                marker.setStyle(getMarkerStyle(point, false));
                marker.closePopup();
            }
        });
    };

    const focusCard = (element) => {
        if (!element) return;
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.focus({ preventScroll: true });
    };

    mapPoints.forEach((point) => {
        const marker = L.circleMarker([point.lat, point.lng], getMarkerStyle(point, false)).addTo(map);
        marker.bindPopup(`<strong>${point.name}</strong><br>${point.address}`);
        marker.bindTooltip(point.isVenue ? `${point.name}` : point.name, { direction: 'top', offset: [0, -8] });
        markers[point.id] = marker;
        bounds.push([point.lat, point.lng]);

        marker.on('mouseover', () => setActive(point.id));
        marker.on('mouseout', () => {
            if (activeId === point.id) {
                clearActive();
            }
        });
        marker.on('click', () => {
            setActive(point.id);
            marker.openPopup();
            focusCard(point.element);
        });

        if (point.element) {
            point.element.addEventListener('mouseenter', () => {
                setActive(point.id);
            });

            point.element.addEventListener('mouseleave', () => {
                if (activeId === point.id) {
                    clearActive();
                }
            });

            point.element.addEventListener('focus', () => setActive(point.id));
            point.element.addEventListener('blur', () => {
                if (activeId === point.id) {
                    clearActive();
                }
            });
        }
    });

    if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [30, 30] });
    }
}

function initAccommodationScrollHint() {
    const list = document.querySelector('.accommodation-list');
    const hint = document.querySelector('.accommodation-scroll-hint');

    if (!list || !hint) {
        return;
    }

    const updateHintVisibility = () => {
        const isScrollable = list.scrollHeight - list.clientHeight > 2;
        if (!isScrollable) {
            hint.classList.add('is-hidden');
            return;
        }

        const reachedBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 2;
        hint.classList.toggle('is-hidden', reachedBottom);
    };

    list.addEventListener('scroll', updateHintVisibility);
    window.addEventListener('resize', updateHintVisibility);
    updateHintVisibility();
}

// Registry Scraping Functions (for real implementation)
// Note: In a production environment, you would need a backend service to handle
// actual scraping due to CORS and authentication requirements

/**
 * Scrapes registry items from various stores via backend API
 * This function communicates with the backend server which handles
 * actual scraping to avoid CORS and authentication issues
 */
async function scrapeRegistry(store, registryId) {
    try {
        const apiUrl = getApiUrl();
        const endpoint = `${apiUrl}/api/registry/${store}`;
        
        const response = await fetch(endpoint);
        
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success && data.items) {
            return data.items;
        }
        
        return [];
    } catch (error) {
        console.error(`Error scraping ${store}:`, error);
        return [];
    }
}

/**
 * Aggregates items from multiple registries via backend API
 */
async function aggregateRegistries(registries) {
    try {
        const apiUrl = getApiUrl();
        const endpoint = `${apiUrl}/api/registry?store=all`;
        
        const response = await fetch(endpoint);
        
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success && data.items) {
            // Sort by name
            return data.items.sort((a, b) => a.name.localeCompare(b.name));
        }
        
        return [];
    } catch (error) {
        console.error('Error aggregating registries:', error);
        return [];
    }
}

// For production use, you would call these functions with actual registry IDs:
// const registries = [
//     { store: 'amazon', id: 'YOUR_AMAZON_REGISTRY_ID' },
//     { store: 'target', id: 'YOUR_TARGET_REGISTRY_ID' },
//     { store: 'crateandbarrel', id: 'YOUR_CB_REGISTRY_ID' }
// ];
// aggregateRegistries(registries).then(displayRegistryItems);

function resolveApiBaseUrl() {
    if (registryConfig.apiBaseUrl) {
        return registryConfig.apiBaseUrl.replace(/\/$/, '');
    }
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:3000';
    }
    return window.location.origin;
}

function getApiUrl() {
    return resolveApiBaseUrl();
}
