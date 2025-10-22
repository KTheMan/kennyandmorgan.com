# Deployment Guide

This guide explains how to deploy the wedding website with the registry API backend.

## Architecture Overview

The project consists of two parts:
1. **Frontend**: Static HTML/CSS/JS (index.html, script.js, styles.css)
2. **Backend API**: Node.js/Express server (server.js, scrapers/)

## Deployment Options

### Option 1: GitHub Pages (Frontend) + Heroku (Backend)

**Frontend (GitHub Pages):**
1. Frontend is already deployed via GitHub Pages
2. No additional setup needed for frontend deployment

**Backend (Heroku):**

1. Install Heroku CLI and login:
```bash
heroku login
```

2. Create a new Heroku app:
```bash
heroku create your-app-name
```

3. Set environment variables:
```bash
heroku config:set PORT=3000
heroku config:set NODE_ENV=production
heroku config:set AMAZON_REGISTRY_ID=your-amazon-id
heroku config:set TARGET_REGISTRY_ID=your-target-id
heroku config:set CRATE_AND_BARREL_REGISTRY_ID=your-cb-id
heroku config:set ALLOWED_ORIGINS=https://ktheman.github.io
```

4. Deploy to Heroku:
```bash
git push heroku main
```

5. Update frontend to use Heroku URL:
   - Edit `script.js` and update the `getApiUrl()` function:
   ```javascript
   function getApiUrl() {
       if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
           return 'http://localhost:3000';
       }
       return 'https://your-app-name.herokuapp.com';
   }
   ```

### Option 2: Vercel (Frontend + Backend)

Vercel supports both static sites and serverless functions.

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Create `api/` directory and move server code:
```bash
mkdir api
mv server.js api/registry.js
```

3. Adapt Express app to Vercel serverless format in `api/registry.js`:
```javascript
const app = require('../server');
module.exports = app;
```

4. Create `vercel.json`:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "index.html",
      "use": "@vercel/static"
    },
    {
      "src": "api/registry.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/api/registry.js"
    },
    {
      "src": "/(.*)",
      "dest": "/$1"
    }
  ]
}
```

5. Deploy:
```bash
vercel --prod
```

6. Set environment variables in Vercel dashboard

### Option 3: AWS (EC2 or Elastic Beanstalk)

**Using EC2:**

1. Launch an EC2 instance (Ubuntu recommended)

2. Install Node.js:
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

3. Clone repository and install dependencies:
```bash
git clone your-repo-url
cd kennyandmorgan.com
npm install
```

4. Create `.env` file with your configuration

5. Install PM2 for process management:
```bash
sudo npm install -g pm2
pm2 start server.js --name "registry-api"
pm2 startup
pm2 save
```

6. Configure nginx as reverse proxy:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location / {
        root /var/www/wedding;
        try_files $uri $uri/ =404;
    }
}
```

7. Frontend deployment:
```bash
sudo mkdir -p /var/www/wedding
sudo cp index.html styles.css script.js /var/www/wedding/
```

### Option 4: DigitalOcean App Platform

1. Connect your GitHub repository to DigitalOcean

2. Configure build settings:
   - Build Command: `npm install`
   - Run Command: `node server.js`

3. Set environment variables in DigitalOcean dashboard

4. Deploy frontend as a static site component

## Environment Variables

Required environment variables for production:

```
PORT=3000
NODE_ENV=production
AMAZON_REGISTRY_ID=your-actual-registry-id
TARGET_REGISTRY_ID=your-actual-registry-id
CRATE_AND_BARREL_REGISTRY_ID=your-actual-registry-id
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

Optional (if using official APIs):
```
AMAZON_API_KEY=your-key
AMAZON_API_SECRET=your-secret
AMAZON_ASSOCIATE_TAG=your-tag
```

## Security Checklist

Before deploying to production:

- [ ] Update all registry IDs in `.env`
- [ ] Set `NODE_ENV=production`
- [ ] Configure `ALLOWED_ORIGINS` with actual frontend URL
- [ ] Ensure `.env` file is NOT committed to repository
- [ ] Update axios and other dependencies to latest secure versions
- [ ] Configure HTTPS/SSL for API endpoint
- [ ] Set up monitoring and logging
- [ ] Configure rate limiting (consider using nginx or API gateway)
- [ ] Review and accept terms of service for registry sites

## DNS Configuration

If using a custom domain:

1. Add A record pointing to your server IP
2. Add CNAME for www subdomain
3. Configure SSL certificate (Let's Encrypt recommended)

Example DNS records:
```
A    @      your-server-ip
CNAME www    your-domain.com
```

## Monitoring

Set up monitoring to track:
- API uptime
- Response times
- Error rates
- Registry scraping failures

Recommended tools:
- Heroku: Built-in metrics
- AWS: CloudWatch
- DigitalOcean: Built-in monitoring
- External: UptimeRobot, Pingdom

## Troubleshooting

**CORS errors:**
- Verify `ALLOWED_ORIGINS` includes your frontend URL
- Check that protocol (http/https) matches
- Ensure no trailing slashes in URLs

**Registry not loading:**
- Check server logs for errors
- Verify registry IDs are correct
- Ensure network connectivity from server
- Registry sites may be blocking server IP

**Server crashes:**
- Check logs: `pm2 logs` or `heroku logs --tail`
- Verify environment variables are set
- Ensure port is not already in use
- Check for unhandled promise rejections

## Cost Estimates

**Heroku:**
- Hobby dyno: $7/month
- Free tier available (sleeps after 30 min)

**Vercel:**
- Free tier: Unlimited static sites, limited serverless
- Pro: $20/month

**DigitalOcean:**
- Basic droplet: $5/month
- App Platform: Starting at $5/month

**AWS:**
- EC2 t2.micro: Free tier eligible
- Elastic Beanstalk: Pay for underlying resources

## Support

For issues or questions:
1. Check API_README.md for detailed documentation
2. Review server logs
3. Test API endpoints with curl
4. Contact repository maintainer
