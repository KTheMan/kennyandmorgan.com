const ADMIN_TOKEN_KEY = 'km_admin_token';
const state = {
    token: localStorage.getItem(ADMIN_TOKEN_KEY) || null,
    guests: []
};

document.addEventListener('DOMContentLoaded', () => {
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

    loginForm?.addEventListener('submit', handleLogin);
    logoutButton?.addEventListener('click', handleLogout);
    refreshButton?.addEventListener('click', loadGuests);
    guestForm?.addEventListener('submit', handleGuestSubmit);
    guestResetButton?.addEventListener('click', resetGuestForm);
    csvImportButton?.addEventListener('click', handleCsvImport);
    guestTable?.addEventListener('click', handleTableClick);

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

function getApiBaseUrl() {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:3000';
    }
    return window.location.origin;
}

async function apiRequest(path, options = {}) {
    const headers = options.headers ? { ...options.headers } : {};
    if (options.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    if (state.token) {
        headers.Authorization = `Bearer ${state.token}`;
    }

    const response = await fetch(`${getApiBaseUrl()}${path}`, {
        ...options,
        headers
    });

    let data = {};
    try {
        data = await response.json();
    } catch (error) {
        // no-op
    }

    if (response.status === 401 && state.token) {
        handleUnauthorized();
        throw new Error('Unauthorized');
    }

    if (!response.ok || data.success === false) {
        const message = data.error || data.message || 'Request failed.';
        const error = new Error(message);
        error.status = response.status;
        throw error;
    }

    return data;
}

async function verifySession() {
    return apiRequest('/api/admin/session');
}

function handleUnauthorized() {
    setAuthToken(null);
    toggleConsole(false);
    showMessage('adminLoginMessage', 'Your session expired. Please sign in again.', 'error');
}

function setAuthToken(token) {
    state.token = token;
    if (token) {
        localStorage.setItem(ADMIN_TOKEN_KEY, token);
    } else {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
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
        const result = await apiRequest('/api/admin/login', {
            method: 'POST',
            body: JSON.stringify({ password })
        });
        setAuthToken(result.token);
        toggleConsole(true);
        showMessage('adminLoginMessage', '', 'success');
        await loadGuests();
    } catch (error) {
        console.error('Login failed:', error);
        showMessage('adminLoginMessage', error.message || 'Unable to log in.', 'error');
    } finally {
        submitButton?.removeAttribute('disabled');
        submitButton?.classList.remove('is-loading');
        form.reset();
    }
}

async function handleLogout() {
    try {
        if (state.token) {
            await apiRequest('/api/admin/logout', { method: 'POST' });
        }
    } catch (error) {
        console.warn('Logout error:', error);
    } finally {
        setAuthToken(null);
        toggleConsole(false);
        showMessage('adminLoginMessage', 'You have been signed out.', 'success');
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
    try {
        const data = await apiRequest('/api/admin/guests');
        state.guests = data.guests || [];
        renderGuestTable();
    } catch (error) {
        console.error('Unable to load guests:', error);
        showMessage('guestFormMessage', 'Unable to load guests. Please try again.', 'error');
    }
}

function renderGuestTable() {
    const tbody = document.querySelector('#guestTable tbody');
    if (!tbody) {
        return;
    }

    if (!state.guests.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="table-empty">No guests available.</td></tr>';
        return;
    }

    tbody.innerHTML = state.guests.map(guest => `
        <tr data-guest-id="${guest.id}">
            <td>${escapeHtml(guest.fullName || '')}</td>
            <td>${escapeHtml(guest.groupId || '')}</td>
            <td>${guest.isPrimary ? 'Yes' : 'No'}</td>
            <td>${guest.isPlusOne ? 'Yes' : 'No'}</td>
            <td>${escapeHtml((guest.rsvpStatus || 'pending').toUpperCase())}</td>
            <td>${escapeHtml(guest.mealChoice || '—')}</td>
            <td>${escapeHtml(guest.dietaryNotes || '—')}</td>
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
    document.getElementById('guestId').value = guest.id;
    document.getElementById('guestFullName').value = guest.fullName || '';
    document.getElementById('guestEmail').value = guest.email || '';
    document.getElementById('guestGroupId').value = guest.groupId || '';
    document.getElementById('guestIsPrimary').checked = Boolean(guest.isPrimary);
    document.getElementById('guestIsPlusOne').checked = Boolean(guest.isPlusOne);
    document.getElementById('guestRsvpStatus').value = guest.rsvpStatus || 'pending';
    document.getElementById('guestMealChoice').value = guest.mealChoice || '';
    document.getElementById('guestDietaryNotes').value = guest.dietaryNotes || '';
    document.getElementById('guestNotes').value = guest.notes || '';
}

function resetGuestForm() {
    const form = document.getElementById('guestForm');
    form?.reset();
    document.getElementById('guestId').value = '';
    showMessage('guestFormMessage', '', 'success');
}

async function handleGuestSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const payload = {
        fullName: formData.get('fullName')?.toString().trim(),
        email: formData.get('email')?.toString().trim() || undefined,
        groupId: formData.get('groupId')?.toString().trim(),
        isPrimary: formData.get('isPrimary') === 'on' || document.getElementById('guestIsPrimary').checked,
        isPlusOne: formData.get('isPlusOne') === 'on' || document.getElementById('guestIsPlusOne').checked,
        rsvpStatus: formData.get('rsvpStatus') || 'pending',
        mealChoice: formData.get('mealChoice') || '',
        dietaryNotes: formData.get('dietaryNotes')?.toString().trim() || '',
        notes: formData.get('notes')?.toString().trim() || ''
    };

    if (!payload.fullName || !payload.groupId) {
        showMessage('guestFormMessage', 'Full name and group ID are required.', 'error');
        return;
    }

    const guestId = document.getElementById('guestId').value;
    const submitButton = document.getElementById('guestSaveButton');
    submitButton?.setAttribute('disabled', 'disabled');
    submitButton?.classList.add('is-loading');

    try {
        if (guestId) {
            await apiRequest(`/api/admin/guests/${guestId}`, {
                method: 'PATCH',
                body: JSON.stringify(payload)
            });
            showMessage('guestFormMessage', 'Guest updated.', 'success');
        } else {
            await apiRequest('/api/admin/guests', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            showMessage('guestFormMessage', 'Guest added.', 'success');
        }
        resetGuestForm();
        await loadGuests();
    } catch (error) {
        console.error('Unable to save guest:', error);
        showMessage('guestFormMessage', error.message || 'Unable to save guest.', 'error');
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
        await apiRequest(`/api/admin/guests/${guestId}`, { method: 'DELETE' });
        state.guests = state.guests.filter(guest => guest.id !== guestId);
        renderGuestTable();
        showMessage('guestFormMessage', 'Guest removed.', 'success');
    } catch (error) {
        console.error('Unable to delete guest:', error);
        showMessage('guestFormMessage', error.message || 'Unable to delete guest.', 'error');
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
        const result = await apiRequest('/api/admin/guests/import', {
            method: 'POST',
            body: JSON.stringify({ csv: csvText })
        });
        showMessage('csvImportMessage', `Imported ${result.inserted || 0} guests.`, 'success');
        fileInput.value = '';
        await loadGuests();
    } catch (error) {
        console.error('CSV import failed:', error);
        showMessage('csvImportMessage', error.message || 'Unable to import CSV.', 'error');
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