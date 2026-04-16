function initRegistry() {
    const visibleItems = result.items.filter(item => {
        if (typeof item.quantity_requested === 'number') {
            return item.quantity_purchased < item.quantity_requested;
        } else {
            return !item.is_purchased;
        }
    });

    if (visibleItems.length === 0) {
        gridEl.innerHTML = '<p class="registry-empty">All registry items have been fulfilled. Thank you!</p>';
        return;
    }

    gridEl.replaceChildren(...visibleItems.map(renderRegistryCard));
}

function renderRegistryCard(item) {
    // Existing rendering logic...

    const desired = typeof item.quantity_requested === 'number' ? item.quantity_requested : null;
    const purchasedCount = typeof item.quantity_purchased === 'number' ? item.quantity_purchased : 0;
    const remaining = desired !== null ? Math.max(0, desired - purchasedCount) : null;

    if (desired !== null) {
        const qtyWrap = document.createElement('div');
        qtyWrap.className = 'registry-card-qty-wrap';

        if (remaining > 0) {
            const qty = document.createElement('span');
            qty.className = 'registry-card-qty';
            qty.textContent = `${remaining} still needed`;
            qtyWrap.appendChild(qty);
        }

        const qtyDetail = document.createElement('span');
        qtyDetail.className = 'registry-card-qty-detail';
        qtyDetail.textContent = `${purchasedCount} purchased / ${desired} desired`;
        qtyWrap.appendChild(qtyDetail);

        document.body.appendChild(qtyWrap);
    }

    // Remaining rendering logic...
}