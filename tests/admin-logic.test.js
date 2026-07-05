const assert = require('assert');

// Mock localStorage
const localStorageMock = (() => {
    let store = {};
    return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = value.toString(); },
        removeItem: (key) => { delete store[key]; },
        clear: () => { store = {}; }
    };
})();

global.localStorage = localStorageMock;

// Setup state and mock data
const DEFAULT_GUEST_FIELDS = ['fullName', 'groupId', 'isPrimary', 'rsvpStatus', 'updatedAt'];
const GUEST_FIELDS_KEY = 'km_admin_guest_fields';

let state = {
    guests: [
        { id: 1, fullName: 'Alice Smith', groupId: 'A', rsvpStatus: 'accepted', isPrimary: true, isChild: false, isPlusOne: false, isInvitedToRehearsalLunch: true, isHmuEligible: true },
        { id: 2, fullName: 'Bob Jones', groupId: 'A', rsvpStatus: 'pending', isPrimary: false, isChild: false, isPlusOne: true, isInvitedToRehearsalLunch: false, isHmuEligible: false },
        { id: 3, fullName: 'Charlie Brown', groupId: 'B', rsvpStatus: 'declined', isPrimary: true, isChild: true, isPlusOne: false, isInvitedToRehearsalLunch: false, isHmuEligible: false },
    ],
    guestFilter: '',
    filters: {
        rsvpStatus: ['pending', 'accepted', 'declined'],
        isPrimary: null,
        isPlusOne: null,
        isChild: null,
        isInvitedToRehearsalLunch: null,
        isHmuEligible: null
    },
    filteredGuests: []
};

function applyGuestFilter() {
    const query = (state.guestFilter || '').trim().toLowerCase();
    
    return state.guests.filter(guest => {
        // 1. Search Query
        if (query) {
            const haystack = [
                guest.fullName,
                guest.groupId,
            ].filter(Boolean).join(' ').toLowerCase();
            if (!haystack.includes(query)) return false;
        }

        // 2. RSVP Status Filter (MUST match one of the selected statuses)
        if (state.filters.rsvpStatus && state.filters.rsvpStatus.length > 0) {
            const status = guest.rsvpStatus || 'pending';
            if (!state.filters.rsvpStatus.includes(status)) return false;
        }

        // 3. Boolean Filters (If not null, must match the value)
        const booleanFilters = ['isPrimary', 'isPlusOne', 'isChild', 'isInvitedToRehearsalLunch', 'isHmuEligible'];
        for (const field of booleanFilters) {
            if (state.filters[field] !== null) {
                if (guest[field] !== state.filters[field]) return false;
            }
        }

        return true;
    });
}

// Tests
console.log('Running tests for applyGuestFilter...');

// Test 1: No filters - all guests
state.guestFilter = '';
state.filters.rsvpStatus = ['pending', 'accepted', 'declined'];
state.filters.isPrimary = null;
assert.strictEqual(applyGuestFilter().length, 3, 'Should return all guests when no filters applied');
console.log('✅ Test 1 passed');

// Test 2: Search query
state.guestFilter = 'Alice';
assert.strictEqual(applyGuestFilter().length, 1, 'Should filter by name');
assert.strictEqual(applyGuestFilter()[0].fullName, 'Alice Smith');
console.log('✅ Test 2 passed');

// Test 3: Status filter (Accepted only)
state.guestFilter = '';
state.filters.rsvpStatus = ['accepted'];
assert.strictEqual(applyGuestFilter().length, 1, 'Should filter by accepted status');
assert.strictEqual(applyGuestFilter()[0].fullName, 'Alice Smith');
console.log('✅ Test 3 passed');

// Test 4: Boolean filter (isChild: true)
state.filters.rsvpStatus = ['pending', 'accepted', 'declined'];
state.filters.isChild = true;
assert.strictEqual(applyGuestFilter().length, 1, 'Should filter by isChild=true');
assert.strictEqual(applyGuestFilter()[0].fullName, 'Charlie Brown');
console.log('✅ Test 4 passed');

// Test 5: Combined filters (accepted AND isPrimary: true)
state.filters.isChild = null;
state.filters.rsvpStatus = ['accepted'];
state.filters.isPrimary = true;
assert.strictEqual(applyGuestFilter().length, 1, 'Should filter by combined status and boolean');
assert.strictEqual(applyGuestFilter()[0].fullName, 'Alice Smith');
console.log('✅ Test 5 passed');

console.log('\nAll filter tests passed!');
