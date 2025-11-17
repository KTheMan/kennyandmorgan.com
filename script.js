// Navigation functionality
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initCountdown();
    initForms();
    initRegistry();
});

// Navigation
function initNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    const burger = document.querySelector('.burger');
    const nav = document.querySelector('.nav-links');

    // Handle navigation clicks
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').substring(1);
            
            // Update active nav link
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            // Show target page
            document.querySelectorAll('.page').forEach(page => {
                page.classList.remove('active');
            });
            document.getElementById(targetId).classList.add('active');
            
            // Close mobile menu
            nav.classList.remove('active');
            burger.classList.remove('toggle');
            
            // Scroll to top
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });

    // Mobile menu toggle
    burger.addEventListener('click', () => {
        nav.classList.toggle('active');
        burger.classList.toggle('toggle');
    });
}

// Countdown Timer
function initCountdown() {
    const weddingDate = new Date('2026-06-15T16:00:00').getTime();
    
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

function handleRSVPSubmit(form) {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    
    // In a real application, this would send data to a backend
    console.log('RSVP submitted:', data);
    
    // Store in localStorage for demo purposes
    const rsvps = JSON.parse(localStorage.getItem('rsvps') || '[]');
    rsvps.push({
        ...data,
        submittedAt: new Date().toISOString()
    });
    localStorage.setItem('rsvps', JSON.stringify(rsvps));
    
    const message = data.attending === 'yes' 
        ? 'Thank you for your RSVP! We can\'t wait to celebrate with you!' 
        : 'Thank you for letting us know. You will be missed!';
    
    showMessage('rsvpMessage', message, 'success');
    form.reset();
    document.getElementById('guestCountGroup').style.display = 'none';
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
    const registryBtns = document.querySelectorAll('.registry-btn');
    
    registryBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            registryBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const registry = btn.getAttribute('data-registry');
            loadRegistryItems(registry);
        });
    });
    
    // Load all items initially
    loadRegistryItems('all');
}

async function loadRegistryItems(filter) {
    const registryContainer = document.getElementById('registryItems');
    const loadingEl = document.getElementById('registryLoading');
    
    // Show loading
    loadingEl.style.display = 'block';
    registryContainer.innerHTML = '';
    
    try {
        // Get API URL from environment or use default
        const apiUrl = getApiUrl();
        const endpoint = filter === 'all' 
            ? `${apiUrl}/api/registry` 
            : `${apiUrl}/api/registry/${filter}`;
        
        const response = await fetch(endpoint);
        
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success && data.items) {
            displayRegistryItems(data.items);
        } else {
            throw new Error('Invalid response format');
        }
    } catch (error) {
        console.error('Error loading registry items:', error);
        // Show error message - no fallback to mock data
        displayRegistryItems([]);
        showRegistryError('Unable to load registry items. Please ensure valid registry IDs are configured.');
    } finally {
        loadingEl.style.display = 'none';
    }
}

function getApiUrl() {
    // In production, this should be configured based on environment
    // For local development, use localhost
    // For GitHub Pages, use your deployed backend URL
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:3000';
    }
    // Replace with your actual backend URL when deployed
    return process.env.API_URL || 'http://localhost:3000';
}

function showRegistryError(message) {
    const registryContainer = document.getElementById('registryItems');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'registry-error';
    errorDiv.style.cssText = 'grid-column: 1/-1; text-align: center; padding: 20px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; color: #856404;';
    errorDiv.textContent = message;
    registryContainer.insertBefore(errorDiv, registryContainer.firstChild);
}

function getRegistryItems(filter) {
    // In a real application, this would fetch from actual registry APIs
    // For now, we'll use mock data
    const allItems = [
        {
            id: 1,
            name: 'KitchenAid Stand Mixer',
            store: 'amazon',
            price: 379.99,
            image: 'https://via.placeholder.com/300x300/D4A373/FFFFFF?text=Stand+Mixer',
            url: 'https://amazon.com'
        },
        {
            id: 2,
            name: 'Nespresso Coffee Machine',
            store: 'target',
            price: 199.99,
            image: 'https://via.placeholder.com/300x300/8B4513/FFFFFF?text=Coffee+Machine',
            url: 'https://target.com'
        },
        {
            id: 3,
            name: 'Cast Iron Skillet Set',
            store: 'crateandbarrel',
            price: 129.99,
            image: 'https://via.placeholder.com/300x300/2F4F4F/FFFFFF?text=Skillet+Set',
            url: 'https://crateandbarrel.com'
        },
        {
            id: 4,
            name: 'Egyptian Cotton Sheet Set',
            store: 'amazon',
            price: 149.99,
            image: 'https://via.placeholder.com/300x300/FAEBD7/333333?text=Sheet+Set',
            url: 'https://amazon.com'
        },
        {
            id: 5,
            name: 'Stainless Steel Cookware Set',
            store: 'target',
            price: 299.99,
            image: 'https://via.placeholder.com/300x300/556B2F/FFFFFF?text=Cookware+Set',
            url: 'https://target.com'
        },
        {
            id: 6,
            name: 'Wine Glass Set',
            store: 'crateandbarrel',
            price: 79.99,
            image: 'https://via.placeholder.com/300x300/D4A373/FFFFFF?text=Wine+Glasses',
            url: 'https://crateandbarrel.com'
        },
        {
            id: 7,
            name: 'Instant Pot Duo',
            store: 'amazon',
            price: 89.99,
            image: 'https://via.placeholder.com/300x300/8B4513/FFFFFF?text=Instant+Pot',
            url: 'https://amazon.com'
        },
        {
            id: 8,
            name: 'Bamboo Cutting Board Set',
            store: 'target',
            price: 49.99,
            image: 'https://via.placeholder.com/300x300/2F4F4F/FFFFFF?text=Cutting+Boards',
            url: 'https://target.com'
        },
        {
            id: 9,
            name: 'Dinner Plate Set',
            store: 'crateandbarrel',
            price: 159.99,
            image: 'https://via.placeholder.com/300x300/FAEBD7/333333?text=Dinner+Plates',
            url: 'https://crateandbarrel.com'
        },
        {
            id: 10,
            name: 'Cuisinart Food Processor',
            store: 'amazon',
            price: 199.99,
            image: 'https://via.placeholder.com/300x300/556B2F/FFFFFF?text=Food+Processor',
            url: 'https://amazon.com'
        },
        {
            id: 11,
            name: 'Dutch Oven',
            store: 'target',
            price: 119.99,
            image: 'https://via.placeholder.com/300x300/D4A373/FFFFFF?text=Dutch+Oven',
            url: 'https://target.com'
        },
        {
            id: 12,
            name: 'Flatware Set',
            store: 'crateandbarrel',
            price: 99.99,
            image: 'https://via.placeholder.com/300x300/8B4513/FFFFFF?text=Flatware+Set',
            url: 'https://crateandbarrel.com'
        }
    ];
    
    if (filter === 'all') {
        return allItems;
    }
    
    return allItems.filter(item => item.store === filter);
}

function displayRegistryItems(items) {
    const registryContainer = document.getElementById('registryItems');
    
    if (items.length === 0) {
        registryContainer.innerHTML = '<p style="text-align: center; grid-column: 1/-1; padding: 40px 20px; color: var(--slate-gray);">No registry items available. Registry IDs must be configured to display items.</p>';
        return;
    }
    
    registryContainer.innerHTML = items.map(item => `
        <div class="registry-item">
            <img src="${item.image}" alt="${item.name}" class="registry-item-image">
            <div class="registry-item-details">
                <div class="registry-item-name">${item.name}</div>
                <div class="registry-item-store">${capitalizeStore(item.store)}</div>
                <div class="registry-item-price">$${item.price.toFixed(2)}</div>
                <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="registry-item-link">
                    View on ${capitalizeStore(item.store)}
                </a>
            </div>
        </div>
    `).join('');
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
