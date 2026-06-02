const ACCESS_TOKEN_KEY = 'km_access_token';
const REQUIRED_ACCESS_LEVEL = 'admin';
const TOAST_AUTO_DISMISS_MS = 4500;
const toastTimers = new WeakMap();

const state = {
    token: localStorage.getItem(ACCESS_TOKEN_KEY) || null,
    accessLevel: null,
    guests: [],
    filteredGuests: [],
    guestFilter: '',
    isLoadingGuests: false,
    adultMealOptions: ['Gnocchi', 'Atlantic Salmon', 'Flank Steak'],
    childMealLabel: "Child's Meal"
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
    const guestTable = document.getElementById('guestTable');
    const guestFilterInput = document.getElementById('guestTableFilter');
    const newGuestButton = document.getElementById('newGuestButton');
    const guestIsChildInput = document.getElementById('guestIsChild');
    const guestFlyoutCloseButton = document.getElementById('guestFlyoutCloseButton');
    const refreshRehearsalLunchButton = document.getElementById('refreshRehearsalLunchButton');

    loginForm?.addEventListener('submit', handleLogin);
    logoutButton?.addEventListener('click', handleLogout);
    refreshButton?.addEventListener('click', loadGuests);
    guestForm?.addEventListener('submit', handleGuestSubmit);
    guestResetButton?.addEventListener('click', resetGuestForm);
    csvImportButton?.addEventListener('click', handleCsvImport);
    openCsvImportModalButton?.addEventListener('click', openCsvImportModal);
    csvImportModalCloseButton?.addEventListener('click', closeCsvImportModal);
    csvImportModalCancelButton?.addEventListener('click', closeCsvImportModal);
    guestTable?.addEventListener('click', handleTableClick);
    guestIsChildInput?.addEventListener('change', updateGuestMealChoiceControl);
    guestFlyoutCloseButton?.addEventListener('click', closeGuestFlyout);
    csvImportModalBackdrop?.addEventListener('click', event => {
        if (event.target === csvImportModalBackdrop) {
            closeCsvImportModal();
        }
    });
    refreshRehearsalLunchButton?.addEventListener('click', loadRehearsalLunchRsvps);
    guestFilterInput?.addEventListener('input', event => {
        setGuestFilter(event.target.value || '');
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
        if (document.getElementById('guestId')?.value) {
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
    if (!query) {
        state.filteredGuests = [...state.guests];
        return;
    }

    state.filteredGuests = state.guests.filter(guest => {
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
        return haystack.includes(query);
    });
}

function setGuestFilter(value) {
    state.guestFilter = value;
    applyGuestFilter();
    renderGuestTable();
}

function renderGuestTable() {
    const tbody = document.querySelector('#guestTable tbody');
    if (!tbody) {
        return;
    }

    if (state.isLoadingGuests) {
        const skeletonWidths = ['70%', '50%', '30%', '30%', '30%', '35%', '45%', '55%', '45%', '40%', '65%', '50%', '55%', '55%', '80%', '40%', '80%', '60%'];
        const skeletonRow = () => `<tr class="skeleton-row">${skeletonWidths.map(w =>
            `<td><span class="skeleton-cell" style="width:${w}"></span></td>`
        ).join('')}</tr>`;
        tbody.innerHTML = Array(5).fill(0).map(skeletonRow).join('');
        return;
    }

    const countEl = document.getElementById('guestFilterCount');

    if (!state.guests.length) {
        tbody.innerHTML = '<tr><td colspan="18" class="table-empty">No guests on file yet. Use "+ New Guest" or import a CSV.</td></tr>';
        if (countEl) countEl.textContent = '';
        return;
    }

    const visibleGuests = state.filteredGuests.length || !state.guestFilter
        ? state.filteredGuests
        : state.guests;

    if (!visibleGuests.length) {
        tbody.innerHTML = '<tr><td colspan="18" class="table-empty">No guests match this filter.</td></tr>';
        if (countEl) countEl.textContent = `0 of ${state.guests.length}`;
        return;
    }

    if (countEl) {
        countEl.textContent = state.guestFilter
            ? `${visibleGuests.length} of ${state.guests.length} guests`
            : `${state.guests.length} guests`;
    }

    const editingId = document.getElementById('guestId')?.value;

    tbody.innerHTML = visibleGuests.map(guest => {
        const rsvpStatus = guest.rsvpStatus || 'pending';
        const rsvpBadge = `<span class="rsvp-badge rsvp-badge--${escapeHtml(rsvpStatus)}">${escapeHtml(rsvpStatus)}</span>`;
        const isEditing = editingId && String(guest.id) === String(editingId);
        return `
        <tr data-guest-id="${guest.id}" data-guest-name="${escapeHtml(guest.fullName || '')}"${isEditing ? ' class="is-editing"' : ''}>
            <td class="px-3 py-2">${escapeHtml(guest.fullName || '')}</td>
            <td class="px-3 py-2">${escapeHtml(guest.groupId || '')}</td>
            <td class="px-3 py-2">${guest.isPrimary ? 'Yes' : 'No'}</td>
            <td class="px-3 py-2">${guest.isPlusOne ? 'Yes' : 'No'}</td>
            <td class="px-3 py-2">${guest.isChild ? 'Yes' : 'No'}</td>
            <td class="px-3 py-2">${guest.isInvitedToRehearsalLunch ? 'Yes' : 'No'}</td>
            <td class="px-3 py-2">${guest.isHmuEligible ? 'Yes' : 'No'}</td>
            <td class="px-3 py-2">${escapeHtml(getHmuSelectionLabel(guest.hmuSelection))}</td>
            <td class="px-3 py-2">${rsvpBadge}</td>
            <td class="px-3 py-2">${escapeHtml(getMealDisplayValue(guest) || '—')}</td>
            <td class="px-3 py-2">${escapeHtml(guest.dietaryNotes || '—')}</td>
            <td class="px-3 py-2 whitespace-normal max-w-[14rem] align-top">${escapeHtml(guest.rsvpSubmitterName || '—')}</td>
            <td class="px-3 py-2 whitespace-normal max-w-[14rem] align-top">${escapeHtml(guest.rsvpSubmitterEmail || '—')}</td>
            <td class="px-3 py-2 whitespace-normal max-w-[14rem] align-top">${escapeHtml(guest.rsvpSongRequest || '—')}</td>
            <td class="px-3 py-2 whitespace-normal max-w-[18rem] align-top">${escapeHtml(guest.rsvpSpecialMessage || '—')}</td>
            <td class="px-3 py-2">${escapeHtml(formatGuestAddress(guest) || '—')}</td>
            <td class="px-3 py-2 whitespace-nowrap">${formatDate(guest.lastRsvpAt)}</td>
            <td class="px-3 py-2 table-actions whitespace-nowrap">
                <button type="button" class="table-action table-action--edit">Edit</button>
                <button type="button" class="table-action table-action--delete">Delete</button>
            </td>
        </tr>`;
    }).join('');
}

function handleTableClick(event) {
    const button = event.target.closest('.table-action');
    if (!button) {
        return;
    }

    const row = button.closest('tr');
    const guestId = Number(row?.dataset.guestId);
    const guest = state.guests.find(item => item.id === guestId);

    if (button.classList.contains('table-action--confirm-no')) {
        const actionsCell = row?.querySelector('.table-actions');
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
        const actionsCell = row?.querySelector('.table-actions');
        if (actionsCell) {
            const name = escapeHtml(guest.fullName || 'this guest');
            actionsCell.innerHTML = `<span style="font-size:0.7rem;color:#b91c1c;margin-right:0.25rem">Delete ${name}?</span><button type="button" class="table-action table-action--confirm-yes">Yes</button> <button type="button" class="table-action table-action--confirm-no">No</button>`;
        }
    }
}

function populateGuestForm(guest) {
    clearGuestFieldErrors();
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
        isPrimary: formData.get('isPrimary') === 'on' || document.getElementById('guestIsPrimary').checked,
        isPlusOne: formData.get('isPlusOne') === 'on' || document.getElementById('guestIsPlusOne').checked,
        isChild: formData.get('isChild') === 'on' || document.getElementById('guestIsChild').checked,
        isInvitedToRehearsalLunch: formData.get('isInvitedToRehearsalLunch') === 'on' || document.getElementById('guestIsInvitedToRehearsalLunch').checked,
        isHmuEligible: formData.get('isHmuEligible') === 'on' || document.getElementById('guestIsHmuEligible').checked,
        rsvpStatus: formData.get('rsvpStatus') || 'pending',
        hmuSelection: formData.get('hmuSelection') || 'not_selected',
        mealChoice: (formData.get('isChild') === 'on' || document.getElementById('guestIsChild').checked)
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

    const guestId = document.getElementById('guestId').value;
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
    const data = await window.KMDataClient.getMenuOptions();
    if (!data?.success) {
        return;
    }
    const adultMeals = Array.isArray(data.adultMeals)
        ? data.adultMeals.filter(item => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
        : [];
    state.adultMealOptions = adultMeals.length ? adultMeals : state.adultMealOptions;
    state.childMealLabel = (data.childMeal || '').toString().trim() || state.childMealLabel;
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
        renderGuestTable();
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
    const total = state.guests.length;
    const accepted = state.guests.filter(g => g.rsvpStatus === 'accepted').length;
    const declined = state.guests.filter(g => g.rsvpStatus === 'declined').length;
    const pending = state.guests.filter(g => !g.rsvpStatus || g.rsvpStatus === 'pending').length;

    const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    setEl('statTotal', total || '\u2014');
    setEl('statAccepted', accepted || '0');
    setEl('statDeclined', declined || '0');
    setEl('statPending', pending || '0');
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
