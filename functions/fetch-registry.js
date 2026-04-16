export const fetchRegistry = async (req, res) => {
    const registryHtml = await fetch('https://myregistrysite.com/registry').then(response => response.text());

    // Parse the HTML to find gift items
    const parser = new DOMParser();
    const doc = parser.parseFromString(registryHtml, 'text/html');
    const giftElements = doc.querySelectorAll('div[giftid]');
    const gifts = Array.from(giftElements).map(el => ({
        giftid: el.getAttribute('giftid'),
        title: el.querySelector('.gift-title')?.innerText || '',
        description: el.querySelector('.gift-description')?.innerText || '',
        price: el.querySelector('.gift-price')?.innerText || '',
    }));

    res.status(200).json(gifts);
};