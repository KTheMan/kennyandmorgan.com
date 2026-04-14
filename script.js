// Navigation functionality
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await window.KMSiteConfig.load();
    } catch (error) {
        console.warn('Unable to load site config, continuing with defaults.', error);
    }

    initNavigation();
    initCountdown();
    initForms();

    await initAccessControl().catch(error => {
        console.error('Access control failed to initialize:', error);
    });
    await initRegistry().catch(error => {
        console.error('Unable to initialize registry link:', error);
    });
    await initAccommodationsMap().catch(error => {
        console.error('Unable to load accommodations map:', error);
    });
    initAccommodationScrollHint();
    initAdminMenu();
});

let latestGuestLookupResults = [];
let activeGuestParty = null;
const guestResponseState = new Map();
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
const MEAL_OPTIONS = [
    { value: '', label: 'Select a meal' },
    { value: 'chicken', label: 'Chicken' },
    { value: 'steak', label: 'Steak' },
    { value: 'vegetarian', label: 'Vegetarian' }
];

const weddingPartyMembers = [
    {
        name: 'Alexis Miller',
        role: 'Matron of Honor',
        bio: "Morgan's older sister and resident hype queen. The glue that holds the crew together.",
        photo: 'https://placehold.co/200x200?text=Alexis'
    },
    {
        name: 'Chayton Whiskey',
        role: 'Best Man',
        bio: "Kenny's best friend since middle school, and all-around goofball who keeps the energy high.",
        photo: 'https://placehold.co/200x200?text=Chayton'
    },
    {
        name: 'Najah Izquierdo',
        role: 'Maid of Honor',
        bio: "Morgan's best friend who knows every embarrassing story and still shows up early.",
        photo: 'https://placehold.co/200x200?text=Najah'
    },
    {
        name: 'Sam Calderon',
        role: 'Groomsman',
        bio: 'D&D game master and Kenny’s partner in crime for all things nerdy and adventurous.',
        photo: 'https://placehold.co/200x200?text=Sam'
    },
    {
        name: 'Raquel Esquerra',
        role: 'Bridesmaid',
        bio: 'Met Morgan in high school and bonded over late-night study snacks and travel plans.',
        photo: 'https://placehold.co/200x200?text=Raquel'
    },
    {
        name: 'Roy Calderon',
        role: 'Groomsman',
        bio: "Kindred spirit to Sam and Kenny, always ready with a joke and a helping hand.",
        photo: 'https://placehold.co/200x200?text=Roy'
    },
    {
        name: 'Jen Miller',
        role: 'Bridesmaid',
        bio: 'Sister-in-law and supporter for all things wedding planning. She keeps everyone laughing and on time.',
        photo: 'https://placehold.co/200x200?text=Jen'
    },
    {
        name: 'Weston Cargay',
        role: 'Groomsman',
        bio: "Cousin and adventure partner who’s always been there for the big moments and bonding over the small ones.",
        photo: 'https://placehold.co/200x200?text=Weston'
    },
    {
        name: 'Alyssa Graham',
        role: 'Bridesmaid',
        bio: 'Work bestie turned every other type of bestie. She’s been there through it all.',
        photo: 'https://placehold.co/200x200?text=Alyssa'
    },
    {
        name: 'Anthony Sacci',
        role: 'Groomsman',
        bio: 'Kindergarten day one friend who has seen it all who can always be counted on for a good time.',
        photo: 'https://placehold.co/200x200?text=Anthony'
    },
    {
        name: 'Tim Miller',
        role: 'Bridesman',
        bio: "Morgan's older brother and steadfast supporter through every life chapter.",
        photo: 'https://placehold.co/200x200?text=Tim'
    },
    {
        name: 'Kelcie Bettencourt',
        role: 'Groomswoman',
        bio: 'Middle school best friend who has been a constant source of support and laughter.',
        photo: 'https://placehold.co/200x200?text=Kelcie'
    },
    {
        name: 'Haley Zimmer',
        role: 'Bridesmaid',
        bio: 'College roommate, meditation partner, and fearless toastmaster.',
        photo: 'https://placehold.co/200x200?text=Haley'
    },
    {
        name: 'Ryan Gordon',
        role: 'Groomsman',
        bio: "Kenny's older brother who always brings the energy (and the electronics).",
        photo: 'https://placehold.co/200x200?text=Ryan'
    },
    {
        name: 'Gabe Lapp',
        role: 'Officiant',
        bio: 'High school partner in crime and lifelong best friend honored with leading this special day.',
        photo: 'https://placehold.co/200x200?text=Gabe'
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
    return window.KMDataClient.loginAccess(password);
}

async function fetchAccessSession(token) {
    return window.KMDataClient.getAccessSession(token);
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
}

function setupGuestLookup() {
    const lookupButton = document.getElementById('guestLookupButton');
    const nameInput = document.getElementById('rsvpName');
    const hiddenGroupInput = document.getElementById('guestGroupId');
    const resultsContainer = document.getElementById('guestLookupResults');
    const messageElement = document.getElementById('guestLookupMessage');
    const guestResponseList = document.getElementById('guestResponseList');

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
        resetGuestResponseSection();
    };

    lookupButton.addEventListener('click', async () => {
        const query = nameInput.value.trim();
        resetResults();

        if (!query) {
            setLookupState('Please enter your full name first.', 'error');
            return;
        }

        const nameParts = query.split(/\s+/).filter(Boolean);
        if (nameParts.length < 2) {
            setLookupState('Please enter your first and last name to continue.', 'error');
            return;
        }

        lookupButton.disabled = true;
        lookupButton.textContent = 'Searching...';
        setLookupState('Looking up your party...', 'info');

        try {
            const data = await window.KMDataClient.searchGuestGroups(query);

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

        if (selectedGroup.guests?.length) {
            nameInput.value = selectedGroup.primaryGuest || selectedGroup.guests[0].fullName;
        }

        setActiveGuestParty(selectedGroup);
        setGuestResponseMessage('');
        setLookupState(`Loaded guests for ${selectedGroup.primaryGuest || 'your party'}.`, 'success');
    });

    guestResponseList?.addEventListener('change', handleGuestResponseListInput);
    guestResponseList?.addEventListener('input', handleGuestResponseListInput);
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

function resetGuestResponseSection() {
    activeGuestParty = null;
    guestResponseState.clear();
    const section = document.getElementById('guestResponseSection');
    const list = document.getElementById('guestResponseList');
    setGuestResponseMessage('');
    if (section) {
        section.classList.add('hidden');
    }
    if (list) {
        list.innerHTML = '';
    }
}

function setActiveGuestParty(group) {
    if (!group) {
        resetGuestResponseSection();
        return;
    }
    activeGuestParty = {
        groupId: group.groupId,
        guests: Array.isArray(group.guests) ? group.guests : []
    };
    guestResponseState.clear();
    activeGuestParty.guests.forEach(guest => {
        guestResponseState.set(guest.id, {
            status: normalizeGuestStatus(guest.rsvpStatus),
            mealChoice: guest.mealChoice || '',
            nameOverride: '',
            originalName: guest.fullName
        });
    });
    renderGuestResponseSection();
}

function renderGuestResponseSection() {
    const section = document.getElementById('guestResponseSection');
    const list = document.getElementById('guestResponseList');
    if (!section || !list) {
        return;
    }
    if (!activeGuestParty) {
        section.classList.add('hidden');
        list.innerHTML = '';
        return;
    }
    section.classList.remove('hidden');

    list.innerHTML = activeGuestParty.guests.map(guest => {
        const state = guestResponseState.get(guest.id) || {};
        const displayName = (state.nameOverride && state.nameOverride.trim()) || guest.fullName;
        const requiresNameField = guest.fullName.toLowerCase().includes('guest');
        const mealWrapperClass = state.status === 'accepted' ? 'guest-response-meal' : 'guest-response-meal hidden';
        const guestRole = guest.isPlusOne ? 'Plus One' : (guest.isPrimary ? 'Primary Guest' : 'Guest');
        return `
            <div class="guest-response-card${requiresNameField ? ' is-guest-placeholder' : ''}" data-guest-card="${guest.id}">
                <div class="guest-response-header">
                    <p class="guest-response-name">${escapeHtml(displayName)}</p>
                    <p class="guest-response-tag">${guestRole}</p>
                </div>
                <div class="guest-response-status">
                    ${renderGuestStatusOption(guest.id, 'accepted', 'Joyfully Accepts', state.status === 'accepted')}
                    ${renderGuestStatusOption(guest.id, 'declined', 'Regretfully Declines', state.status === 'declined')}
                </div>
                <div class="${mealWrapperClass}" data-guest-meal-wrapper="${guest.id}">
                    <label>
                        Meal Preference
                        <select data-guest-meal="${guest.id}">
                            ${renderMealOptions(state.mealChoice)}
                        </select>
                    </label>
                </div>
                ${requiresNameField ? renderGuestNameInput(guest.id, state.nameOverride) : ''}
            </div>
        `;
    }).join('');
}

function renderGuestStatusOption(guestId, value, label, isChecked) {
    return `
        <label>
            <input type="radio" name="guest-status-${guestId}" value="${value}" data-guest-status="${guestId}" ${isChecked ? 'checked' : ''}>
            <span>${label}</span>
        </label>
    `;
}

function renderMealOptions(selectedValue) {
    return MEAL_OPTIONS.map(option => `
        <option value="${option.value}" ${option.value === selectedValue ? 'selected' : ''}>${option.label}</option>
    `).join('');
}

function renderGuestNameInput(guestId, currentValue = '') {
    return `
        <div class="guest-response-name-input">
            <label>
                Guest Name (optional)
                <input type="text" placeholder="Add their name" data-guest-name="${guestId}" value="${escapeHtmlAttr(currentValue || '')}">
            </label>
        </div>
    `;
}

function handleGuestResponseListInput(event) {
    const target = event.target;
    if (!activeGuestParty || !target) {
        return;
    }

    if (target.matches('[data-guest-status]')) {
        const guestId = Number(target.dataset.guestStatus);
        const state = guestResponseState.get(guestId) || {};
        state.status = target.value;
        guestResponseState.set(guestId, state);
        setGuestResponseMessage('');
        const mealWrapper = document.querySelector(`[data-guest-meal-wrapper="${guestId}"]`);
        if (mealWrapper) {
            mealWrapper.classList.toggle('hidden', state.status !== 'accepted');
        }
    } else if (target.matches('[data-guest-meal]')) {
        const guestId = Number(target.dataset.guestMeal);
        const state = guestResponseState.get(guestId) || {};
        state.mealChoice = target.value;
        guestResponseState.set(guestId, state);
    } else if (target.matches('[data-guest-name]')) {
        const guestId = Number(target.dataset.guestName);
        const state = guestResponseState.get(guestId) || {};
        state.nameOverride = target.value;
        guestResponseState.set(guestId, state);
        const card = target.closest('[data-guest-card]');
        const nameEl = card?.querySelector('.guest-response-name');
        if (nameEl) {
            nameEl.textContent = target.value.trim() || state.originalName || nameEl.textContent;
        }
    }
}

function getGuestDisplayName(guestId) {
    const guest = activeGuestParty?.guests?.find(item => item.id === guestId);
    const state = guestResponseState.get(guestId);
    const override = state?.nameOverride?.trim();
    return override || guest?.fullName || 'this guest';
}

function validateGuestResponses(responses) {
    if (!activeGuestParty || !responses.length) {
        return { valid: false, message: 'Please look up your party and respond for each guest.' };
    }

    const incomplete = responses.find(response => !response.status);
    if (incomplete) {
        return { valid: false, message: `Please choose accept or decline for ${getGuestDisplayName(incomplete.guestId)}.` };
    }

    const missingMeal = responses.find(response => response.status === 'accepted' && !response.mealChoice);
    if (missingMeal) {
        return { valid: false, message: `Select a meal for ${getGuestDisplayName(missingMeal.guestId)}.` };
    }

    return { valid: true };
}

function buildGuestResponsesPayload() {
    if (!activeGuestParty) {
        return [];
    }
    return activeGuestParty.guests.map(guest => {
        const state = guestResponseState.get(guest.id) || {};
        return {
            guestId: guest.id,
            status: state.status || null,
            mealChoice: state.status === 'accepted' ? (state.mealChoice || '') : '',
            name: state.nameOverride?.trim() || undefined
        };
    });
}

function setGuestResponseMessage(message = '', variant = 'error') {
    const element = document.getElementById('guestResponseMessage');
    if (!element) {
        return;
    }
    element.textContent = message || '';
    element.classList.remove('is-success');
    if (message && variant === 'success') {
        element.classList.add('is-success');
    }
}

function normalizeGuestStatus(value) {
    const normalized = (value || '').toLowerCase();
    if (['accepted', 'declined', 'pending'].includes(normalized)) {
        return normalized === 'pending' ? null : normalized;
    }
    return null;
}

async function handleAddressSubmit(form) {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);

    try {
        const result = await window.KMDataClient.submitAddress(data);
        showMessage('addressMessage', result.message || 'Thank you! Your address has been saved.', 'success');
        form.reset();
    } catch (error) {
        console.error('Unable to save address:', error);
        showMessage('addressMessage', 'We could not save your address right now. Please try again later.', 'error');
    }
}

async function handleRSVPSubmit(form) {
    const submitButton = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    const payload = {
        name: data.rsvpName,
        email: data.rsvpEmail,
        dietaryRestrictions: data.dietaryRestrictions || '',
        specialMessage: data.specialMessage || data.songRequest || '',
        songRequest: data.songRequest || '',
        guestGroupId: data.guestGroupId || ''
    };

    if (!payload.guestGroupId) {
        setGuestResponseMessage('Please find your party first.');
        showMessage('rsvpMessage', 'Please look up your party before submitting your RSVP.', 'error');
        return;
    }

    const guestResponses = buildGuestResponsesPayload();
    const validation = validateGuestResponses(guestResponses);
    if (!validation.valid) {
        setGuestResponseMessage(validation.message || 'Please complete the RSVP for each guest.');
        showMessage('rsvpMessage', validation.message || 'Please complete the RSVP for each guest.', 'error');
        return;
    }

    payload.guestResponses = guestResponses;
    payload.attending = guestResponses.some(response => response.status === 'accepted');
    const attendingCount = guestResponses.filter(response => response.status === 'accepted').length;
    if (attendingCount > 0) {
        payload.guestCount = attendingCount;
    }

    submitButton?.setAttribute('disabled', 'disabled');
    submitButton?.classList.add('is-loading');

    try {
        const result = await window.KMDataClient.submitRsvp(payload);

        showMessage('rsvpMessage', result.message || 'Thank you for your RSVP!', 'success');
        form.reset();
        resetGuestResponseSection();
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
function initRegistry() {
    const registryLink = document.querySelector('.registry-direct-link a');
    if (registryLink) {
        registryLink.href = getRegistryPageUrl();
    }
}

function getRegistryPageUrl() {
    const config = window.KMSiteConfig?.getSync?.();
    return config?.registryPageUrl || window.KMSiteConfig?.DEFAULT_CONFIG?.registryPageUrl || '';
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

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtmlAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
}
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtmlAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
}
