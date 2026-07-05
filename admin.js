const ACCESS_TOKEN_KEY = 'km_access_token';
const REQUIRED_ACCESS_LEVEL = 'admin';
const TOAST_AUTO_DISMISS_MS = 4500;
const GUEST_VIEW_MODE_KEY = 'km_admin_guest_view';
const GUEST_FIELDS_KEY = 'km_admin_guest_fields';
const DEFAULT_GUEST_FIELDS = ['fullName', 'groupId', 'isPrimary', 'rsvpStatus', 'updatedAt'];

const GUEST_FIELDS = {
    fullName: { label: 'Full Name', type: 'text', sortable: true },
    groupId: { label: 'Group', type: 'text', sortable: true },
    isPrimary: { label: 'Primary', type: 'boolean', sortable: true },
    isPlusOne: { label: 'Plus One', type: 'boolean', sortable: true },
    isChild: { label: 'Child', type: 'boolean', sortable: true },
    isInvitedToRehearsalLunch: { label: 'Rehearsal Lunch', type: 'boolean', sortable: true },
    isHmuEligible: { label: 'HMU Eligible', type: 'boolean', sortable: true },
    hmuSelection: { label: 'HMU Selection', type: 'select', sortable: true },
    rsvpStatus: { label: 'RSVP', type: 'status', sortable: true },
    mealChoice: { label: 'Meal', type: 'text', sortable: true },
    dietaryNotes: { label: 'Dietary', type: 'text', sortable: false },
    rsvpSubmitterName: { label: 'RSVP Name', type: 'text', sortable: false },
    rsvpSubmitterEmail: { label: 'RSVP Email', type: 'text', sortable: false },
    rsvpSongRequest: { label: 'Song Request', type: 'text', sortable: false },
    rsvpSpecialMessage: { label: 'Special Message', type: 'text', sortable: false },
    addressLine1: { label: 'Address', type: 'text', sortable: false },
    updatedAt: { label: 'Updated', type: 'date', sortable: true },
};

function loadVisibleFields() {
    const stored = localStorage.getItem(GUEST_FIELDS_KEY);
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            console.error('Failed to parse visible fields from storage', e);
        }
    }
    return DEFAULT_GUEST_FIELDS;
}

function saveVisibleFields(fields) {
    localStorage.setItem(GUEST_FIELDS_KEY, JSON.stringify(fields));
    state.visibleFields = fields;
}

const toastTimers = new WeakMap();

function debounce(fn, delay) {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
}

const state = {
    token: localStorage.getItem(ACCESS_TOKEN_KEY) || null,
    accessLevel: null,
    guests: [],
    filteredGuests: [],
    guestFilter: '',
    isLoadingGuests: false,
    adultMealOptions: ['Gnocchi', 'Atlantic Salmon', 'Flank Steak'],
    childMealLabel: "Child's Meal",
    viewMode: localStorage.getItem(GUEST_VIEW_MODE_KEY) || 'table',
    filters: {
        rsvpStatus: ['pending', 'accepted', 'declined'],
        isPrimary: null,
        isPlusOne: null,
        isChild: null,
        isInvitedToRehearsalLunch: null,
        isHmuEligible: null
    },
    visibleFields: loadVisibleFields(),
    editingGuestId: null
};

function parseBooleanValue(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value === 1;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
            return true;
        }
        if (normalized === 'false' || normalized === '0' || normalized === 'no') {
            return false;
        }
    }
    return false;
}

function normalizeAdminGuestRecord(guest = {}) {
    return {
        ...guest,
        isInvitedToRehearsalLunch: parseBooleanValue(
            guest.isInvitedToRehearsalLunch ?? guest.is_invited_to_rehearsal_lunch
        ),
        isHmuEligible: parseBooleanValue(
            guest.isHmuEligible ?? guest.is_hmu_eligible ?? guest.isEligibleForMakeup ?? guest.is_eligible_for_makeup
        )
    };
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await window.KMSiteConfig.load();
    } catch (error) {
        console.warn('Unable to load site config, continuing with defaults.', error);
    }
    initAdminApp();
});

function initAdminApp() {
    const loginForm = document.getElementById('adminLoginForm');
    const logoutButton = document.getElementById('adminLogoutButton');
    const refreshButton = document.getElementById('refreshGuestsButton');
    const guestForm = document.getElementById('guestForm');
    const guestResetButton = document.getElementById('guestResetButton');
    const csvImportButton = document.getElementById('csvImportButton');
    const openCsvImportModalButton = document.getElementById('openCsvImportModalButton');
    const csvImportModalBackdrop = document.getElementById('csvImportModalBackdrop');
    const csvImportModalCloseButton = document.getElementById('csvImportModalCloseButton');
    const csvImportModalCancelButton = document.getElementById('csvImportModalCancelButton');
    const guestTableContainer = document.getElementById('guestTableContainer');
    const guestFilterInput = document.getElementById('guestTableFilter');
    const newGuestButton = document.getElementById('newGuestButton');
    const guestIsChildInput = document.getElementById('guestIsChild');
    const guestFlyoutCloseButton = document.getElementById('guestFlyoutCloseButton');
    const refreshRehearsalLunchButton = document.getElementById('refreshRehearsalLunchButton');
    const viewTableButton = document.getElementById('viewTableButton');
    const viewCardButton = document.getElementById('viewCardButton');
    const toggleFiltersButton = document.getElementById('toggleFiltersButton');
    const toggleColumnsButton = document.getElementById('toggleColumnsButton');
    const filterPanel = document.getElementById('filterPanel');
    const columnsPanel = document.getElementById('columnsPanel');

    loginForm?.addEventListener('submit', handleLogin);
    logoutButton?.addEventListener('click', handleLogout);
    refreshButton?.addEventListener('click', loadGuests);
    guestForm?.addEventListener('submit', handleGuestSubmit);
    guestResetButton?.addEventListener('click', resetGuestForm);
    csvImportButton?.addEventListener('click', handleCsvImport);
    openCsvImportModalButton?.addEventListener('click', openCsvImportModal);
    csvImportModalCloseButton?.addEventListener('click', closeCsvImportModal);
    csvImportModalCancelButton?.addEventListener('click', closeCsvImportModal);
    guestTableContainer?.addEventListener('click', handleTableClick);
    guestIsChildInput?.addEventListener('change', updateGuestMealChoiceControl);
    guestFlyoutCloseButton?.addEventListener('click', closeGuestFlyout);
    csvImportModalBackdrop?.addEventListener('click', event => {
        if (event.target === csvImportModalBackdrop) {
            closeCsvImportModal();
        }
    });
    refreshRehearsalLunchButton?.addEventListener('click', loadRehearsalLunchRsvps);
    guestFilterInput?.addEventListener('input', debounce(event => {
        setGuestFilter(event.target.value || '');
    }, 150));

    viewTableButton?.addEventListener('click', () => setViewMode('table'));
    viewCardButton?.addEventListener('click', () => setViewMode('card'));

    toggleFiltersButton?.addEventListener('click', () => {
        filterPanel?.classList.toggle('hidden');
    });

    toggleColumnsButton?.addEventListener('click', () => {
        columnsPanel?.classList.toggle('hidden');
        if (!columnsPanel?.classList.contains('hidden')) {
            renderColumnToggles();
        }
    });

    // Filter inputs
    document.querySelectorAll('input[name="statusFilter"]').forEach(el => {
        el.addEventListener('change', () => {
            const checked = Array.from(document.querySelectorAll('input[name="statusFilter"]:checked')).map(i => i.value);
            state.filters.rsvpStatus = checked;
            applyGuestFilter();
            renderGuestTable();
        });
    });

    document.querySelectorAll('input[name="typeFilter"]').forEach(el => {
        el.addEventListener('change', () => {
            const val = el.value;
            state.filters[val] = el.checked ? true : null;
            applyGuestFilter();
            renderGuestTable();
        });
    });

    newGuestButton?.addEventListener('click', () => {
        resetGuestForm();
        openGuestFlyout();
    });

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') {
            return;
        }
        if (isCsvImportModalOpen()) {
            closeCsvImportModal();
            return;
        }
        if (isGuestFlyoutOpen()) {
            resetGuestForm();
            closeGuestFlyout();
            return;
        }
        if (state.editingGuestId) {
            resetGuestForm();
        }
    });

    if (guestFilterInput) {
        guestFilterInput.value = state.guestFilter;
    }

    if (state.token) {
        verifySession()
            .then(() => toggleConsole(true))
            .then(() => Promise.all([loadGuests(), loadRehearsalLunchRsvps()]))
            .catch(() => {
                setAuthToken(null);
                toggleConsole(false);
            });
    }

    // Set initial view mode button styles
    setViewMode(state.viewMode);

    loadMenuOptions()
        .then(() => {
            renderGuestMealOptions();
            updateGuestMealChoiceControl();
        })
        .catch(error => {
            console.warn('Unable to load menu options, using defaults.', error);
            renderGuestMealOptions();
            updateGuestMealChoiceControl();
        });
}

function pushToast(message, variant = 'info') {
    if (!message) {
        return;
    }
    const stack = document.getElementById('adminToastStack');
    if (!stack) {
        return;
    }
    const toast = document.createElement('div');
    toast.className = `admin-toast admin-toast--${variant}`;
    toast.textContent = message;
    stack.appendChild(toast);
    const timeoutId = setTimeout(() => dismissToast(toast), TOAST_AUTO_DISMISS_MS);
    toastTimers.set(toast, timeoutId);
    toast.addEventListener('click', () => dismissToast(toast));
}

function dismissToast(toast) {
    if (!toast) {
        return;
    }
    const timeoutId = toastTimers.get(toast);
    if (timeoutId) {
        clearTimeout(timeoutId);
    }
    toastTimers.delete(toast);
    toast.classList.add('is-hiding');
    setTimeout(() => {
        toast.remove();
    }, 200);
}

function setFieldError(elementId, message) {
    const el = document.getElementById(elementId);
    if (!el) {
        return;
    }
    if (message) {
        el.textContent = message;
        el.classList.add('is-visible');
    } else {
        el.textContent = '';
        el.classList.remove('is-visible');
    }
}

function clearGuestFieldErrors() {
    setFieldError('guestFullNameError');
    setFieldError('guestGroupIdError');
}

async function verifySession() {
    const session = await window.KMDataClient.getAccessSession(state.token);
    if (session.accessLevel !== REQUIRED_ACCESS_LEVEL) {
        const error = new Error('Admin-level access is required.');
        error.status = 403;
        throw error;
    }
    state.accessLevel = session.accessLevel;
    return session;
}

function handleUnauthorized() {
    setAuthToken(null);
    toggleConsole(false);
    showMessage('adminLoginMessage', 'Your session expired. Please unlock the main site with the admin password again.', 'error');
    pushToast('Session expired. Please sign in again.', 'error');
}

function setAuthToken(token) {
    state.token = token;
    if (token) {
        localStorage.setItem(ACCESS_TOKEN_KEY, token);
    } else {
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        state.accessLevel = null;
    }
}

async function handleLogin(event) {
    event.preventDefault();
    const form = event.target;
    const password = form.password.value.trim();
    if (!password) {
        showMessage('adminLoginMessage', 'Password is required.', 'error');
        return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton?.setAttribute('disabled', 'disabled');
    submitButton?.classList.add('is-loading');

    try {
        const result = await window.KMDataClient.loginAccess(password);
        if (result.accessLevel !== REQUIRED_ACCESS_LEVEL) {
            showMessage('adminLoginMessage', 'That password unlocks the site, but not the admin console.', 'error');
            pushToast('Admin-level password required.', 'error');
            return;
        }
        setAuthToken(result.token);
        state.accessLevel = result.accessLevel;
        toggleConsole(true);
        showMessage('adminLoginMessage', '', 'success');
        pushToast('Admin console unlocked.', 'success');
        await Promise.all([loadGuests(), loadRehearsalLunchRsvps()]);
    } catch (error) {
        console.error('Login failed:', error);
        showMessage('adminLoginMessage', error.message || 'Unable to log in.', 'error');
        pushToast(error.message || 'Unable to log in.', 'error');
    } finally {
        submitButton?.removeAttribute('disabled');
        submitButton?.classList.remove('is-loading');
        form.reset();
    }
}

async function handleLogout() {
    try {
        if (state.token) {
            await window.KMDataClient.logoutAccess(state.token);
        }
    } catch (error) {
        console.warn('Logout error:', error);
    } finally {
        setAuthToken(null);
        toggleConsole(false);
        showMessage('adminLoginMessage', 'You have been signed out.', 'success');
        pushToast('Signed out.', 'info');
    }
}

function toggleConsole(isAuthenticated) {
    const loginPanel = document.getElementById('adminLoginPanel');
    const consolePanel = document.getElementById('adminConsole');
    const statsRow = document.getElementById('adminStatsRow');
    const logoutButton = document.getElementById('adminLogoutButton');
    if (isAuthenticated) {
        loginPanel?.classList.add('hidden');
        consolePanel?.classList.remove('hidden');
        statsRow?.classList.remove('hidden');
        logoutButton?.classList.remove('hidden');
    } else {
        loginPanel?.classList.remove('hidden');
        consolePanel?.classList.add('hidden');
        statsRow?.classList.add('hidden');
        logoutButton?.classList.add('hidden');
        closeGuestFlyout();
        closeCsvImportModal();
    }
}

async function loadGuests() {
    state.isLoadingGuests = true;
    renderGuestTable();
    try {
        const data = await window.KMDataClient.listAdminGuests(state.token);
        state.guests = (data.guests || []).map(normalizeAdminGuestRecord);
        applyGuestFilter();
    } catch (error) {
        console.error('Unable to load guests:', error);
        showMessage('guestFormMessage', 'Unable to load guests. Please try again.', 'error');
        pushToast('Unable to load guests.', 'error');
    } finally {
        state.isLoadingGuests = false;
        renderGuestTable();
        renderStats();
    }
}

function applyGuestFilter() {
    const query = (state.guestFilter || '').trim().toLowerCase();
    
    state.filteredGuests = state.guests.filter(guest => {
        // 1. Search Query
        if (query) {
            const haystack = [
                guest.fullName,
                guest.groupId,
                guest.email,
                guest.rsvpSubmitterName,
                guest.rsvpSubmitterEmail,
                guest.rsvpSongRequest,
                guest.rsvpSpecialMessage,
                guest.notes,
                guest.addressLine1,
                guest.addressLine2,
                guest.city,
                guest.state,
                guest.postalCode
            ].filter(Boolean).join(' ').toLowerCase();
            if (!haystack.includes(query)) return false;
        }

        // 2. RSVP Status Filter
        if (state.filters.rsvpStatus && state.filters.rsvpStatus.length > 0) {
            const status = guest.rsvpStatus || 'pending';
            if (!state.filters.rsvpStatus.includes(status)) return false;
        }

        // 3. Boolean Filters
        const booleanFilters = ['isPrimary', 'isPlusOne', 'isChild', 'isInvitedToRehearsalLunch', 'isHmuEligible'];
        for (const field of booleanFilters) {
            if (state.filters[field] !== null) {
                if (guest[field] !== state.filters[field]) return false;
            }
        }

        return true;
    });
}

function setGuestFilter(value) {
    state.guestFilter = value;
    applyGuestFilter();
    renderGuestTable();
}

function resolveFieldValue(fieldKey, guest = {}) {
    const field = GUEST_FIELDS[fieldKey];
    const raw = guest[fieldKey];

    if (fieldKey === 'updatedAt') {
        return { value: formatDate(raw), isHtml: false };
    }
    if (fieldKey === 'mealChoice') {
        return { value: getMealDisplayValue(guest) || '—', isHtml: false };
    }
    if (fieldKey === 'hmuSelection') {
        return { value: getHmuSelectionLabel(raw), isHtml: false };
    }
    if (fieldKey === 'addressLine1') {
        return { value: formatGuestAddress(guest) || '—', isHtml: false };
    }
    if (field && field.type === 'boolean') {
        return { value: raw ? 'Yes' : 'No', isHtml: false };
    }
    if (fieldKey === 'rsvpStatus') {
        const status = raw || 'pending';
        return {
            value: `<span class="rsvp-badge rsvp-badge--${escapeHtml(status)}">${escapeHtml(status)}</span>`,
            isHtml: true
        };
    }

    return { value: raw || '—', isHtml: false };
}

function renderGuestSkeleton(container) {
    const columnCount = state.visibleFields.length + 1;
    container.innerHTML = `
        <table id="guestTable" class="min-w-full text-left text-sm">
            <tbody class="divide-y divide-border bg-white">
                ${Array(5).fill(0).map(() => `
                    <tr class="skeleton-row">
                        ${Array(columnCount).fill(0).map(() => `<td><span class="skeleton-cell"></span></td>`).join('')}
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
}

function renderGuestEmptyState(container, countEl) {
    container.innerHTML = '<div class="table-empty p-8 text-center">No guests on file yet. Use "+ New Guest" or import a CSV.</div>';
    if (countEl) countEl.textContent = '';
}

function renderGuestNoMatchState(container, countEl) {
    container.innerHTML = '<div class="table-empty p-8 text-center">No guests match this filter.</div>';
    if (countEl) countEl.textContent = `0 of ${state.guests.length}`;
}

function renderGuestCards(container, guests, countEl) {
    if (countEl) {
        countEl.textContent = state.guestFilter
            ? `${guests.length} of ${state.guests.length} guests`
            : `${state.guests.length} guests`;
    }

    const cardsHtml = guests.map(guest => {
        const isEditing = state.editingGuestId !== null && String(guest.id) === String(state.editingGuestId);
        const rsvpStatus = guest.rsvpStatus || 'pending';
        const rsvpBadge = `<span class="rsvp-badge rsvp-badge--${escapeHtml(rsvpStatus)}">${escapeHtml(rsvpStatus)}</span>`;

        const fieldContent = state.visibleFields.map(fieldKey => {
            const field = GUEST_FIELDS[fieldKey];
            if (!field) return '';

            const resolved = resolveFieldValue(fieldKey, guest);
            const displayHtml = resolved.isHtml ? resolved.value : escapeHtml(String(resolved.value));

            return `<div class="flex justify-between py-1 border-b border-border/50 last:border-0">
                <span class="text-xs text-muted-foreground">${escapeHtml(field.label)}</span>
                <span class="text-xs font-medium">${displayHtml}</span>
            </div>`;
        }).join('');

        return `
        <div data-guest-id="${guest.id}" class="p-4 rounded-lg border border-border bg-white shadow-sm transition-all ${isEditing ? 'ring-2 ring-accent bg-accent/5' : ''}">
            <div class="flex justify-between items-start mb-3">
                <h4 class="font-semibold text-sm">${escapeHtml(guest.fullName || 'Unknown Guest')}</h4>
                ${rsvpBadge}
            </div>
            <div class="space-y-1 mb-4">${fieldContent}</div>
            <div class="flex justify-end gap-2 pt-3 border-t border-border table-actions">
                <button type="button" class="table-action table-action--edit">Edit</button>
                <button type="button" class="table-action table-action--delete">Delete</button>
            </div>
        </div>`;
    }).join('');

    container.innerHTML = `<div id="guestCards" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">${cardsHtml}</div>`;
}

function renderGuestTableRows(container, guests, countEl) {
    if (countEl) {
        countEl.textContent = state.guestFilter
            ? `${guests.length} of ${state.guests.length} guests`
            : `${state.guests.length} guests`;
    }

    const visibleFields = state.visibleFields;

    let headerHtml = `<thead class="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground"><tr>`;
    visibleFields.forEach(fieldKey => {
        const field = GUEST_FIELDS[fieldKey];
        headerHtml += `<th class="px-3 py-3 font-medium">${field ? escapeHtml(field.label) : escapeHtml(fieldKey)}</th>`;
    });
    headerHtml += `<th class="px-3 py-3 font-medium"></th></tr></thead>`;

    const bodyHtml = `<tbody class="divide-y divide-border bg-white">${guests.map(guest => {
        const isEditing = state.editingGuestId !== null && String(guest.id) === String(state.editingGuestId);

        let rowHtml = `<tr data-guest-id="${guest.id}" data-guest-name="${escapeHtml(guest.fullName || '')}"${isEditing ? ' class="is-editing"' : ''}>`;

        visibleFields.forEach(fieldKey => {
            const resolved = resolveFieldValue(fieldKey, guest);
            rowHtml += `<td class="px-3 py-2">${resolved.isHtml ? resolved.value : escapeHtml(String(resolved.value))}</td>`;
        });

        rowHtml += `<td class="px-3 py-2 table-actions whitespace-nowrap">
            <button type="button" class="table-action table-action--edit">Edit</button>
            <button type="button" class="table-action table-action--delete">Delete</button>
        </td></tr>`;
        return rowHtml;
    }).join('')}</tbody>`;

    const table = document.createElement('table');
    table.id = 'guestTable';
    table.className = 'min-w-full text-left text-sm';
    table.innerHTML = headerHtml + bodyHtml;

    container.innerHTML = '';
    container.appendChild(table);
}

function renderGuestTable() {
    const container = document.getElementById('guestTableContainer');
    if (!container) return;

    const countEl = document.getElementById('guestFilterCount');
    const visibleGuests = state.filteredGuests;

    if (state.isLoadingGuests) {
        renderGuestSkeleton(container);
        if (countEl) countEl.textContent = '';
        return;
    }

    if (!state.guests.length) {
        renderGuestEmptyState(container, countEl);
        return;
    }

    if (!visibleGuests.length) {
        renderGuestNoMatchState(container, countEl);
        return;
    }

    if (state.viewMode === 'card') {
        renderGuestCards(container, visibleGuests, countEl);
    } else {
        renderGuestTableRows(container, visibleGuests, countEl);
    }
}

function handleTableClick(event) {
    const button = event.target.closest('.table-action');
    if (!button) {
        return;
    }

    const rowOrCard = button.closest('tr') || button.closest('[data-guest-id]');
    const guestId = Number(rowOrCard?.dataset.guestId);
    const guest = state.guests.find(item => item.id === guestId);

    if (button.classList.contains('table-action--confirm-no')) {
        const actionsCell = rowOrCard?.querySelector('.table-actions');
        if (actionsCell) {
            actionsCell.innerHTML = '<button type="button" class="table-action table-action--edit">Edit</button> <button type="button" class="table-action table-action--delete">Delete</button>';
        }
        return;
    }

    if (button.classList.contains('table-action--confirm-yes')) {
        deleteGuestRecord(guestId);
        return;
    }

    if (!guest) {
        return;
    }

    if (button.classList.contains('table-action--edit')) {
        populateGuestForm(guest);
        openGuestFlyout();
    } else if (button.classList.contains('table-action--delete')) {
        const actionsCell = rowOrCard?.querySelector('.table-actions');
        if (actionsCell) {
            const name = escapeHtml(guest.fullName || 'this guest');
            actionsCell.innerHTML = `<span style="font-size:0.7rem;color:#b91c1c;margin-right:0.25rem">Delete ${name}?</span><button type="button" class="table-action table-action--confirm-yes">Yes</button> <button type="button" class="table-action table-action--confirm-no">No</button>`;
        }
    }
}

function populateGuestForm(guest) {
    clearGuestFieldErrors();
    state.editingGuestId = guest.id;
    document.getElementById('guestId').value = guest.id;
    document.getElementById('guestFullName').value = guest.fullName || '';
    document.getElementById('guestEmail').value = guest.email || '';
    document.getElementById('guestGroupId').value = guest.groupId || '';
    document.getElementById('guestIsPrimary').checked = Boolean(guest.isPrimary);
    document.getElementById('guestIsPlusOne').checked = Boolean(guest.isPlusOne);
    document.getElementById('guestIsChild').checked = Boolean(guest.isChild);
    document.getElementById('guestIsInvitedToRehearsalLunch').checked = Boolean(guest.isInvitedToRehearsalLunch);
    document.getElementById('guestIsHmuEligible').checked = Boolean(guest.isHmuEligible);
    document.getElementById('guestRsvpStatus').value = guest.rsvpStatus || 'pending';
    document.getElementById('guestHmuSelection').value = guest.hmuSelection || 'not_selected';
    const mealSelect = document.getElementById('guestMealChoice');
    if (mealSelect) {
        renderGuestMealOptions(normalizeMealChoice(guest.mealChoice || ''));
    }
    document.getElementById('guestDietaryNotes').value = guest.dietaryNotes || '';
    document.getElementById('guestAddressLine1').value = guest.addressLine1 || '';
    document.getElementById('guestAddressLine2').value = guest.addressLine2 || '';
    document.getElementById('guestCity').value = guest.city || '';
    document.getElementById('guestState').value = guest.state || '';
    document.getElementById('guestPostalCode').value = guest.postalCode || '';
    document.getElementById('guestNotes').value = guest.notes || '';

    const titleEl = document.getElementById('guestFormTitle');
    const subtitleEl = document.getElementById('guestFormSubtitle');
    if (titleEl) titleEl.textContent = `Editing: ${guest.fullName || 'Guest'}`;
    if (subtitleEl) subtitleEl.textContent = 'Update the fields below, then click Save Guest. Press Esc to cancel.';

    document.querySelectorAll('#guestTable tbody tr.is-editing').forEach(r => r.classList.remove('is-editing'));
    const editRow = document.querySelector(`#guestTable tbody tr[data-guest-id="${guest.id}"]`);
    editRow?.classList.add('is-editing');
    updateGuestMealChoiceControl();
}

function resetGuestForm() {
    const form = document.getElementById('guestForm');
    form?.reset();
    state.editingGuestId = null;
    document.getElementById('guestId').value = '';
    clearGuestFieldErrors();
    showMessage('guestFormMessage', '', 'success');

    const titleEl = document.getElementById('guestFormTitle');
    const subtitleEl = document.getElementById('guestFormSubtitle');
    if (titleEl) titleEl.textContent = 'Add New Guest';
    if (subtitleEl) subtitleEl.textContent = 'Fill in the fields below to create a new guest entry.';

    document.querySelectorAll('#guestTable tbody tr.is-editing').forEach(r => r.classList.remove('is-editing'));
    renderGuestMealOptions();
    updateGuestMealChoiceControl();
}

async function handleGuestSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    clearGuestFieldErrors();
    const payload = {
        fullName: formData.get('fullName')?.toString().trim(),
        email: formData.get('email')?.toString().trim() || undefined,
        groupId: formData.get('groupId')?.toString().trim(),
        isPrimary: document.getElementById('guestIsPrimary').checked,
        isPlusOne: document.getElementById('guestIsPlusOne').checked,
        isChild: document.getElementById('guestIsChild').checked,
        isInvitedToRehearsalLunch: document.getElementById('guestIsInvitedToRehearsalLunch').checked,
        isHmuEligible: document.getElementById('guestIsHmuEligible').checked,
        rsvpStatus: formData.get('rsvpStatus') || 'pending',
        hmuSelection: formData.get('hmuSelection') || 'not_selected',
        mealChoice: document.getElementById('guestIsChild').checked
            ? state.childMealLabel
            : (formData.get('mealChoice') || ''),
        dietaryNotes: formData.get('dietaryNotes')?.toString().trim() || '',
        notes: formData.get('notes')?.toString().trim() || '',
        addressLine1: formData.get('addressLine1')?.toString().trim() || '',
        addressLine2: formData.get('addressLine2')?.toString().trim() || '',
        city: formData.get('city')?.toString().trim() || '',
        state: formData.get('state')?.toString().trim() || '',
        postalCode: formData.get('postalCode')?.toString().trim() || ''
    };
    payload.is_invited_to_rehearsal_lunch = payload.isInvitedToRehearsalLunch;
    payload.is_hmu_eligible = payload.isHmuEligible;

    let hasFieldErrors = false;
    if (!payload.fullName) {
        setFieldError('guestFullNameError', 'Full name is required.');
        hasFieldErrors = true;
    }
    if (!payload.groupId) {
        setFieldError('guestGroupIdError', 'Group ID is required.');
        hasFieldErrors = true;
    }

    if (hasFieldErrors) {
        showMessage('guestFormMessage', 'Please fix the highlighted fields.', 'error');
        return;
    }

    const guestId = state.editingGuestId;
    const submitButton = document.getElementById('guestSaveButton');
    submitButton?.setAttribute('disabled', 'disabled');
    submitButton?.classList.add('is-loading');

    try {
        if (guestId) {
            await window.KMDataClient.saveAdminGuest(state.token, payload, guestId);
            showMessage('guestFormMessage', 'Guest updated.', 'success');
            pushToast('Guest updated.', 'success');
        } else {
            await window.KMDataClient.saveAdminGuest(state.token, payload);
            showMessage('guestFormMessage', 'Guest added.', 'success');
            pushToast('Guest added.', 'success');
        }
        resetGuestForm();
        await loadGuests();
    } catch (error) {
        console.error('Unable to save guest:', error);
        showMessage('guestFormMessage', error.message || 'Unable to save guest.', 'error');
        pushToast(error.message || 'Unable to save guest.', 'error');
    } finally {
        submitButton?.removeAttribute('disabled');
        submitButton?.classList.remove('is-loading');
    }
}

async function loadMenuOptions() {
    try {
        const data = await window.KMDataClient.getMenuOptions();
        if (!data?.success) {
            return;
        }
        const adultMeals = Array.isArray(data.adultMeals)
            ? data.adultMeals.filter(item => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
            : [];
        state.adultMealOptions = adultMeals.length ? adultMeals : state.adultMealOptions;
        state.childMealLabel = (data.childMeal || '').toString().trim() || state.childMealLabel;
    } catch (error) {
        console.warn('Unable to load menu options:', error);
    }
}

function renderGuestMealOptions(selectedValue = '') {
    const select = document.getElementById('guestMealChoice');
    if (!select) {
        return;
    }
    const normalizedSelected = normalizeMealChoice(selectedValue);
    const options = [
        { value: '', label: 'Not Selected' },
        ...state.adultMealOptions.map(meal => ({ value: meal, label: meal }))
    ];
    select.innerHTML = options.map(option => `
        <option value="${escapeHtml(option.value)}" ${option.value === normalizedSelected ? 'selected' : ''}>${escapeHtml(option.label)}</option>
    `).join('');
}

function updateGuestMealChoiceControl() {
    const isChild = document.getElementById('guestIsChild')?.checked;
    const select = document.getElementById('guestMealChoice');
    const childMessage = document.getElementById('guestChildMealDisplay');
    if (!select) {
        return;
    }
    if (isChild) {
        select.value = '';
        select.setAttribute('disabled', 'disabled');
    } else {
        select.removeAttribute('disabled');
    }
    if (childMessage) {
        childMessage.textContent = `Child guest meal: ${state.childMealLabel}`;
        childMessage.classList.toggle('hidden', !isChild);
    }
}

async function deleteGuestRecord(guestId) {
    try {
        await window.KMDataClient.deleteAdminGuest(state.token, guestId);
        state.guests = state.guests.filter(guest => guest.id !== guestId);
        if (state.editingGuestId === guestId) {
            resetGuestForm();
            closeGuestFlyout();
        }
        applyGuestFilter();
        renderGuestTable();
        renderStats();
        showMessage('guestFormMessage', 'Guest removed.', 'success');
        pushToast('Guest removed.', 'info');
    } catch (error) {
        console.error('Unable to delete guest:', error);
        showMessage('guestFormMessage', error.message || 'Unable to delete guest.', 'error');
        pushToast(error.message || 'Unable to delete guest.', 'error');
    }
}

async function handleCsvImport() {
    const fileInput = document.getElementById('csvFileInput');
    const file = fileInput?.files?.[0];
    if (!file) {
        showMessage('csvImportMessage', 'Select a CSV file to import.', 'error');
        return;
    }

    const button = document.getElementById('csvImportButton');
    button?.setAttribute('disabled', 'disabled');
    button?.classList.add('is-loading');

    try {
        const csvText = await file.text();
        const result = await window.KMDataClient.importAdminGuests(state.token, csvText);
        showMessage('csvImportMessage', `Imported ${result.inserted || 0} guests.`, 'success');
        pushToast(`Imported ${result.inserted || 0} guests.`, 'success');
        fileInput.value = '';
        await loadGuests();
        closeCsvImportModal();
    } catch (error) {
        console.error('CSV import failed:', error);
        showMessage('csvImportMessage', error.message || 'Unable to import CSV.', 'error');
        pushToast(error.message || 'Unable to import CSV.', 'error');
    } finally {
        button?.removeAttribute('disabled');
        button?.classList.remove('is-loading');
    }
}

function showMessage(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (!el) {
        return;
    }
    if (!message) {
        el.style.display = 'none';
        el.textContent = '';
        el.classList.remove('success', 'error');
        return;
    }
    el.textContent = message;
    el.classList.remove('success', 'error');
    el.classList.add(type === 'error' ? 'error' : 'success');
    el.style.display = 'block';
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeMealChoice(value) {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return '';
    }
    const legacy = {
        gnocchi: 'Gnocchi',
        salmon: 'Atlantic Salmon',
        steak: 'Flank Steak'
    };
    return legacy[normalized.toLowerCase()] || normalized;
}

function getMealDisplayValue(guest = {}) {
    if (guest.isChild) {
        return state.childMealLabel;
    }
    return normalizeMealChoice(guest.mealChoice || '');
}

function getHmuSelectionLabel(value) {
    const normalized = String(value || 'not_selected').trim().toLowerCase();
    const labels = {
        not_selected: 'Not selected',
        hair: 'Hair',
        makeup: 'Makeup',
        hair_makeup: 'Hair + Makeup',
        opt_out: 'Opt-out'
    };
    return labels[normalized] || 'Not selected';
}

function formatDate(value) {
    if (!value) {
        return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatGuestAddress(guest = {}) {
    const parts = [guest.addressLine1, guest.addressLine2].filter(Boolean);
    const locality = [guest.city, guest.state].filter(Boolean).join(', ');
    if (locality) {
        parts.push(locality);
    }
    if (guest.postalCode) {
        parts.push(guest.postalCode);
    }
    return parts.join(', ');
}

function openGuestFlyout() {
    const flyout = document.getElementById('guestFlyout');
    if (!flyout) {
        return;
    }
    flyout.classList.remove('hidden');
    flyout.setAttribute('aria-hidden', 'false');
    setTimeout(() => document.getElementById('guestFullName')?.focus(), 100);
}

function closeGuestFlyout() {
    const flyout = document.getElementById('guestFlyout');
    if (!flyout) {
        return;
    }
    flyout.classList.add('hidden');
    flyout.setAttribute('aria-hidden', 'true');
}

function isGuestFlyoutOpen() {
    const flyout = document.getElementById('guestFlyout');
    return Boolean(flyout && !flyout.classList.contains('hidden'));
}

function openCsvImportModal() {
    const modalBackdrop = document.getElementById('csvImportModalBackdrop');
    if (!modalBackdrop) {
        return;
    }
    showMessage('csvImportMessage', '', 'success');
    modalBackdrop.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeCsvImportModal() {
    const modalBackdrop = document.getElementById('csvImportModalBackdrop');
    if (!modalBackdrop) {
        return;
    }
    modalBackdrop.classList.add('hidden');
    document.body.style.overflow = '';
}

function isCsvImportModalOpen() {
    const modalBackdrop = document.getElementById('csvImportModalBackdrop');
    return Boolean(modalBackdrop && !modalBackdrop.classList.contains('hidden'));
}

function renderStats() {
    const counts = state.guests.reduce((acc, guest) => {
        acc.total += 1;
        if (guest.rsvpStatus === 'accepted') {
            acc.accepted += 1;
        } else if (guest.rsvpStatus === 'declined') {
            acc.declined += 1;
        } else {
            acc.pending += 1;
        }
        return acc;
    }, { total: 0, accepted: 0, declined: 0, pending: 0 });

    const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    setEl('statTotal', counts.total || '\u2014');
    setEl('statAccepted', counts.accepted || '0');
    setEl('statDeclined', counts.declined || '0');
    setEl('statPending', counts.pending || '0');
}

function setViewMode(mode) {
    state.viewMode = mode;
    localStorage.setItem(GUEST_VIEW_MODE_KEY, mode);
    
    const tableBtn = document.getElementById('viewTableButton');
    const cardBtn = document.getElementById('viewCardButton');
    
    if (mode === 'table') {
        tableBtn?.classList.add('bg-white', 'shadow-sm', 'text-foreground');
        tableBtn?.classList.remove('text-muted-foreground');
        cardBtn?.classList.remove('bg-white', 'shadow-sm', 'text-foreground');
        cardBtn?.classList.add('text-muted-foreground');
    } else {
        cardBtn?.classList.add('bg-white', 'shadow-sm', 'text-foreground');
        cardBtn?.classList.remove('text-muted-foreground');
        tableBtn?.classList.remove('bg-white', 'shadow-sm', 'text-foreground');
        tableBtn?.classList.add('text-muted-foreground');
    }
    
    renderGuestTable();
}

function renderColumnToggles() {
    const container = document.getElementById('columnToggles');
    if (!container) return;
    
    container.innerHTML = Object.entries(GUEST_FIELDS).map(([key, field]) => {
        const checked = state.visibleFields.includes(key) ? 'checked' : '';
        return `
        <label class="flex items-center gap-2 text-xs cursor-pointer hover:bg-secondary/50 p-1 rounded">
            <input type="checkbox" data-field="${key}" ${checked} class="rounded border-input accent-accent column-toggle">
            ${escapeHtml(field.label)}
        </label>`;
    }).join('');
    
    container.querySelectorAll('.column-toggle').forEach(el => {
        el.addEventListener('change', (e) => {
            const field = e.target.dataset.field;
            let current = [...state.visibleFields];
            if (e.target.checked) {
                if (!current.includes(field)) current.push(field);
            } else {
                current = current.filter(f => f !== field);
            }
            saveVisibleFields(current);
            renderGuestTable();
        });
    });
}

async function loadRehearsalLunchRsvps() {
    try {
        const data = await window.KMDataClient.listAdminRehearsalLunchRsvps(state.token);
        renderRehearsalLunchTable(data.rsvps || []);
    } catch (error) {
        console.error('Unable to load rehearsal lunch RSVPs:', error);
        pushToast('Unable to load rehearsal lunch RSVPs.', 'error');
    }
}

function renderRehearsalLunchTable(rsvps) {
    const tbody = document.querySelector('#rehearsalLunchTable tbody');
    if (!tbody) {
        return;
    }
    if (!rsvps.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="table-empty">No rehearsal lunch RSVPs yet.</td></tr>';
        return;
    }
    tbody.innerHTML = rsvps.map(r => {
        const status = r.rsvpStatus || 'accepted';
        const badge = `<span class="rsvp-badge rsvp-badge--${escapeHtml(status)}">${escapeHtml(status)}</span>`;
        return `
        <tr>
            <td class="px-3 py-2">${escapeHtml(r.fullName || '')}</td>
            <td class="px-3 py-2">${escapeHtml(r.email || '—')}</td>
            <td class="px-3 py-2">${badge}</td>
            <td class="px-3 py-2 whitespace-nowrap">${formatDate(r.submittedAt)}</td>
        </tr>`;
    }).join('');
}
