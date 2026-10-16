# Render Deployment Guide - Realms of Trade Server

## Prerequisites

- GitHub account
- Render account (free: https://render.com)

## Step-by-Step Deployment (5 minutes)

### Step 1: Push to GitHub (2 minutes)

1. **Initialize Git repository**:
   ```bash
   cd /workspace/realms-of-trade-server
   git init
   git add .
   git commit -m "Initial commit: Realms of Trade multiplayer server"
   ```

2. **Create GitHub repository**:
   - Go to https://github.com/new
   - Name: `realms-of-trade-server`
   - Click "Create repository"

3. **Push code**:
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/realms-of-trade-server.git
   git branch -M main
   git push -u origin main
   ```

### Step 2: Deploy on Render (3 minutes)

1. **Go to Render**: https://dashboard.render.com

2. **Create New Web Service**:
   - Click "New +" → "Web Service"
   - Click "Connect" next to your GitHub repository
   - Or use "Public Git Repository" and paste your repo URL

3. **Configure Service**:
   ```
   Name: realms-of-trade-server
   Region: Choose closest to your users
   Branch: main
   Root Directory: (leave blank)
   Runtime: Node
   Build Command: npm install
   Start Command: npm start
   Instance Type: Free (for testing) or Starter ($7/mo)
   ```

4. **Environment Variables** (click "Advanced"):
   - Add `NODE_ENV` = `production`
   - Add `ALLOWED_ORIGINS` = `https://your-frontend-domain.com`
   - (PORT is automatically set by Render)

5. **Create Web Service**:
   - Click "Create Web Service"
   - Wait 2-3 minutes for deployment
   - Note your service URL (e.g., `https://realms-of-trade-server.onrender.com`)

### Step 3: Verify Deployment (1 minute)

1. **Test health endpoint**:
   ```bash
   curl https://your-render-url.onrender.com/health
   ```

   Should return:
   ```json
   {
     "status": "ok",
     "service": "realms-of-trade-server",
     "players": 0,
     "projectiles": 0,
     "uptime": 1.23
   }
   ```

2. **Check server info**:
   ```bash
   curl https://your-render-url.onrender.com/
   ```

### Step 4: Connect Frontend

Update your React frontend to use the deployed server:

```bash
cd /path/to/your/frontend
echo "VITE_SOCKET_URL=https://your-render-url.onrender.com" > .env.production
npm run build
# Deploy your frontend
```

Or in your React code:
```javascript
const socket = io('https://your-render-url.onrender.com');
```

## Troubleshooting

### Deployment Fails

**Check Build Logs**:
- Go to Render dashboard → Your service → "Logs"
- Look for error messages
- Common issues:
  - Node version mismatch (requires 18+)
  - Missing dependencies
  - Port binding issues

**Solutions**:
- Ensure `package.json` has correct Node version
- Verify all dependencies are in `package.json`
- Don't hardcode PORT (use `process.env.PORT`)

### Cannot Connect from Frontend

**CORS Issues**:
- Update `ALLOWED_ORIGINS` environment variable on Render
- Set to your frontend domain (e.g., `https://your-game.vercel.app`)
- Or use `*` for testing (not recommended for production)

**How to update environment variables**:
1. Go to Render dashboard
2. Click your service
3. Go to "Environment" tab
4. Add/edit variable
5. Click "Save Changes"
6. Service will redeploy automatically

### Server Sleeps (Free Tier)

Render free tier spins down after 15 minutes of inactivity:
- First request takes 30-60 seconds to wake up
- Upgrade to Starter plan ($7/mo) for always-on
- Or implement keep-alive ping from frontend

## Performance Optimization

### For Production (Paid Tier)

1. **Upgrade Instance**:
   - Starter: $7/mo (512MB RAM, always-on)
   - Standard: $25/mo (2GB RAM)

2. **Enable Auto-Deploy**:
   - Render auto-deploys on git push
   - Great for CI/CD workflow

3. **Add Health Checks**:
   - Render monitors `/health` endpoint
   - Auto-restarts if unhealthy

4. **Monitor Logs**:
   - Check for errors regularly
   - Set up alerts for crashes

### Scaling

**Vertical Scaling** (Single Server):
- Upgrade instance type in Render dashboard
- Good for 50-100 concurrent players

**Horizontal Scaling** (Multiple Servers):
- Deploy multiple instances
- Use load balancer
- Implement Redis for shared state
- Good for 100+ concurrent players

## Cost Estimates

| Tier | Price | RAM | Always-On | Players |
|------|-------|-----|-----------|---------|
| Free | $0 | 512MB | No (spins down) | 10-15 |
| Starter | $7/mo | 512MB | Yes | 25-30 |
| Standard | $25/mo | 2GB | Yes | 50-75 |
| Pro | $85/mo | 4GB | Yes | 100+ |

## Monitoring

### Built-in Render Features

1. **Logs**: Real-time and historical
2. **Metrics**: CPU, Memory, Network
3. **Events**: Deploys, crashes, restarts
4. **Alerts**: Email notifications for issues

### Custom Monitoring

Add logging service:
```javascript
// In server.js
const logger = require('winston'); // Add to package.json

logger.info('Player connected', { playerId: socket.id });
```

## Security Checklist

- [ ] Set NODE_ENV to production
- [ ] Configure ALLOWED_ORIGINS (not *)
- [ ] Enable HTTPS (automatic on Render)
- [ ] Review rate limiting settings
- [ ] Monitor for suspicious activity
- [ ] Keep dependencies updated
- [ ] Use environment variables for secrets

## Next Steps

1. Deploy server to Render
2. Get deployment URL
3. Update frontend configuration
4. Test with multiple clients
5. Monitor performance
6. Scale as needed

## Support

**Render Documentation**: https://render.com/docs
**Render Community**: https://community.render.com
**Socket.io Docs**: https://socket.io/docs/v4/

---

**Quick Reference**:
- Dashboard: https://dashboard.render.com
- Status: https://status.render.com
- Pricing: https://render.com/pricing
