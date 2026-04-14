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
    isLoadingGuests: false
};

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
    const guestTable = document.getElementById('guestTable');
    const guestFilterInput = document.getElementById('guestTableFilter');

    loginForm?.addEventListener('submit', handleLogin);
    logoutButton?.addEventListener('click', handleLogout);
    refreshButton?.addEventListener('click', loadGuests);
    guestForm?.addEventListener('submit', handleGuestSubmit);
    guestResetButton?.addEventListener('click', resetGuestForm);
    csvImportButton?.addEventListener('click', handleCsvImport);
    guestTable?.addEventListener('click', handleTableClick);
    guestFilterInput?.addEventListener('input', event => {
        setGuestFilter(event.target.value || '');
    });

    if (guestFilterInput) {
        guestFilterInput.value = state.guestFilter;
    }

    if (state.token) {
        verifySession()
            .then(() => toggleConsole(true))
            .then(loadGuests)
            .catch(() => {
                setAuthToken(null);
                toggleConsole(false);
            });
    }
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
        await loadGuests();
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
    if (isAuthenticated) {
        loginPanel?.classList.add('hidden');
        consolePanel?.classList.remove('hidden');
    } else {
        loginPanel?.classList.remove('hidden');
        consolePanel?.classList.add('hidden');
    }
}

async function loadGuests() {
    state.isLoadingGuests = true;
    renderGuestTable();
    try {
        const data = await window.KMDataClient.listAdminGuests(state.token);
        state.guests = data.guests || [];
        applyGuestFilter();
    } catch (error) {
        console.error('Unable to load guests:', error);
        showMessage('guestFormMessage', 'Unable to load guests. Please try again.', 'error');
        pushToast('Unable to load guests.', 'error');
    } finally {
        state.isLoadingGuests = false;
        renderGuestTable();
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
        tbody.innerHTML = '<tr><td colspan="9" class="table-empty">Loading guests…</td></tr>';
        return;
    }

    if (!state.guests.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="table-empty">No guests on file yet. Click “Add Guest” or import a CSV.</td></tr>';
        return;
    }

    const visibleGuests = state.filteredGuests.length || !state.guestFilter
        ? state.filteredGuests
        : state.guests;

    if (!visibleGuests.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="table-empty">No guests match this filter.</td></tr>';
        return;
    }

    tbody.innerHTML = visibleGuests.map(guest => `
        <tr data-guest-id="${guest.id}">
            <td>${escapeHtml(guest.fullName || '')}</td>
            <td>${escapeHtml(guest.groupId || '')}</td>
            <td>${guest.isPrimary ? 'Yes' : 'No'}</td>
            <td>${guest.isPlusOne ? 'Yes' : 'No'}</td>
            <td>${escapeHtml((guest.rsvpStatus || 'pending').toUpperCase())}</td>
            <td>${escapeHtml(guest.mealChoice || '—')}</td>
            <td>${escapeHtml(guest.dietaryNotes || '—')}</td>
            <td>${escapeHtml(formatGuestAddress(guest) || '—')}</td>
            <td>${formatDate(guest.lastRsvpAt)}</td>
            <td class="table-actions">
                <button type="button" class="table-action table-action--edit">Edit</button>
                <button type="button" class="table-action table-action--delete">Delete</button>
            </td>
        </tr>
    `).join('');
}

function handleTableClick(event) {
    const button = event.target.closest('.table-action');
    if (!button) {
        return;
    }

    const row = button.closest('tr');
    const guestId = Number(row?.dataset.guestId);
    const guest = state.guests.find(item => item.id === guestId);

    if (!guest) {
        return;
    }

    if (button.classList.contains('table-action--edit')) {
        populateGuestForm(guest);
    } else if (button.classList.contains('table-action--delete')) {
        deleteGuestRecord(guestId);
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
    document.getElementById('guestRsvpStatus').value = guest.rsvpStatus || 'pending';
    document.getElementById('guestMealChoice').value = guest.mealChoice || '';
    document.getElementById('guestDietaryNotes').value = guest.dietaryNotes || '';
    document.getElementById('guestAddressLine1').value = guest.addressLine1 || '';
    document.getElementById('guestAddressLine2').value = guest.addressLine2 || '';
    document.getElementById('guestCity').value = guest.city || '';
    document.getElementById('guestState').value = guest.state || '';
    document.getElementById('guestPostalCode').value = guest.postalCode || '';
    document.getElementById('guestNotes').value = guest.notes || '';
}

function resetGuestForm() {
    const form = document.getElementById('guestForm');
    form?.reset();
    document.getElementById('guestId').value = '';
    clearGuestFieldErrors();
    showMessage('guestFormMessage', '', 'success');
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
        rsvpStatus: formData.get('rsvpStatus') || 'pending',
        mealChoice: formData.get('mealChoice') || '',
        dietaryNotes: formData.get('dietaryNotes')?.toString().trim() || '',
        notes: formData.get('notes')?.toString().trim() || '',
        addressLine1: formData.get('addressLine1')?.toString().trim() || '',
        addressLine2: formData.get('addressLine2')?.toString().trim() || '',
        city: formData.get('city')?.toString().trim() || '',
        state: formData.get('state')?.toString().trim() || '',
        postalCode: formData.get('postalCode')?.toString().trim() || ''
    };

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

async function deleteGuestRecord(guestId) {
    if (!confirm('Delete this guest? This cannot be undone.')) {
        return;
    }
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
