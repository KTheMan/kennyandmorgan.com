# Kenny & Morgan's Wedding Website

A beautiful, responsive wedding website built with vanilla JavaScript, HTML, and CSS.

## Features

### 🏠 Home Page
- Elegant display of wedding date and location
- Live countdown timer to the wedding day
- Beautiful, responsive design with wedding color scheme

### 📬 Address Collection
- Form to collect guest addresses for save the dates and invitations
- Client-side storage using localStorage (can be connected to a backend)
- Email validation and required field handling

### 💌 RSVP System
- Comprehensive RSVP form with attendance confirmation
- Guest count tracking
- Dietary restrictions and allergy notes
- Song requests for the reception
- Special messages for the couple

### 🎨 Theme Information
- Wedding color palette display with interactive swatches
- Dress code information
- Wedding style description

### 🎁 Gift Registry
- Aggregated view of items from multiple stores
- Filter by store (Amazon, Target, Crate & Barrel)
- Mock data with placeholder for real registry integration
- Direct links to purchase items

## Color Palette

- **Tan** (#D4A373) - Warm, inviting primary color
- **Brown** (#8B4513) - Rich, elegant accent
- **Slate Gray** (#2F4F4F) - Sophisticated neutral
- **Antique White** (#FAEBD7) - Soft background
- **Dark Olive Green** (#556B2F) - Natural accent

## Technical Details

### Technologies Used
- **HTML5** - Semantic markup
- **CSS3** - Modern styling with CSS Grid and Flexbox
- **Vanilla JavaScript** - No dependencies, pure JS
- **LocalStorage API** - Client-side data persistence

### File Structure
```
kennyandmorgan.com/
├── index.html          # Main HTML file with all sections
├── styles.css          # Complete styling and responsive design
├── script.js           # All JavaScript functionality
└── README.md           # This file
```

### Responsive Design
- Mobile-first approach
- Breakpoints at 768px and 480px
- Hamburger menu for mobile devices
- Optimized layouts for all screen sizes

## How to Use

### Basic Setup
1. Clone the repository
2. Open `index.html` in a web browser
3. No build process required!

### Customization

#### Update Wedding Details
Edit `index.html` to change:
- Couple names (line 33)
- Wedding date (line 37)
- Location and address (lines 40-43)
- Ceremony time (line 46)

#### Change Countdown Date
Edit `script.js` line 51:
```javascript
const weddingDate = new Date('2026-06-15T16:00:00').getTime();
```

#### Customize Colors
Edit the CSS variables in `styles.css` (lines 8-14):
```css
:root {
    --primary-tan: #D4A373;
    --primary-brown: #8B4513;
    --slate-gray: #2F4F4F;
    --antique-white: #FAEBD7;
    --olive-green: #556B2F;
}
```

#### Connect to Backend
The forms currently use localStorage. To connect to a backend:

1. Update `handleAddressSubmit()` in `script.js`:
```javascript
async function handleAddressSubmit(form) {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    
    const response = await fetch('YOUR_API_ENDPOINT/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    
    // Handle response...
}
```

2. Similar updates for `handleRSVPSubmit()`

#### Implement Real Registry Scraping

The registry section includes placeholder functions for scraping. To implement:

1. **Backend Service Required**: Due to CORS and authentication, you need a backend server
2. **API Integration**: Use official APIs where available:
   - Amazon: Product Advertising API
   - Target: Registry API (if available)
   - Crate & Barrel: May require web scraping

3. Update the scraper functions in `script.js` to call your backend endpoints

Example backend endpoint structure:
```javascript
// GET /api/registry?store=amazon&id=YOUR_REGISTRY_ID
// Returns: [{ name, price, image, url, ... }]
```

## Deployment

### GitHub Pages
This site is ready for GitHub Pages deployment:

1. Go to repository Settings
2. Navigate to Pages section
3. Select source: Deploy from a branch
4. Choose branch: main or master
5. Select folder: / (root)
6. Click Save

Your site will be available at: `https://username.github.io/repository-name/`

### Custom Domain
To use a custom domain:
1. Add a `CNAME` file with your domain
2. Configure DNS settings at your domain registrar
3. Update GitHub Pages settings

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Future Enhancements

Potential additions:
- Photo gallery
- Wedding party introductions
- Accommodation suggestions
- Transportation information
- Wedding schedule/timeline
- Guest book
- Live streaming link
- Real-time RSVP count display

## License

This project is open source and available for anyone to use for their own wedding website.

## Contact

For questions or support, please contact the repository owner.

---

Made with ❤️ for Kenny & Morgan