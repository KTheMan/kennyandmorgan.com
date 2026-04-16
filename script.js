function initRegistry(result) {
    const visibleItems = result.items.filter(item => {
        const { quantity_requested, quantity_purchased, is_purchased } = item;
        return (typeof quantity_requested === 'number' && quantity_purchased < quantity_requested) || (!is_purchased);
    });

    if (visibleItems.length === 0) {
        gridEl.innerHTML = '<p class="registry-empty">All registry items have been fulfilled. Thank you!</p>';
        return;
    }

    renderRegistry(visibleItems);
}

function renderRegistryCard(item) {
    const desired = item.quantity_requested;
    const purchasedCount = item.quantity_purchased || 0;
    const remaining = Math.max(desired - purchasedCount, 0);
    
    if (desired !== null) {
        const qtyInfo = document.createElement('div');
        qtyInfo.classList.add('registry-card-qty-wrap');
        if (remaining > 0) {
            qtyInfo.innerHTML = `<span class="registry-card-qty">${remaining} still needed</span>`;
        }
        qtyInfo.innerHTML += `<span class="registry-card-qty-detail">${purchasedCount} purchased / ${desired} desired</span>`;
        cardElement.appendChild(qtyInfo);
    }
    // Preserve other existing card rendering logic...
}