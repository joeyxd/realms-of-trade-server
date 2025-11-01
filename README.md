# Realms of Trade - Multiplayer Server

Real-time Socket.io server for Realms of Trade MMORPG. Supports 25-50 concurrent players with low-latency combat and movement synchronization.

## Features

- Real-time multiplayer using Socket.io
- Server-authoritative game state (anti-cheat)
- Combat system with projectiles and hit detection
- Player movement and position synchronization
- Rate limiting and input validation
- Character stats and equipment support
- Support for 25-50 concurrent players
- Production-ready with environment configuration

## Tech Stack

- Node.js 18+
- Socket.io 4.8.1
- Express.js 5.1.0
- CORS support

## Project Structure

```
realms-of-trade-server/
├── server.js              # Main server file
├── package.json           # Dependencies
├── config/
│   └── constants.js       # Game constants and configuration
├── routes/
│   ├── players.js         # Player management
│   └── combat.js          # Combat and projectile system
├── utils/
│   └── validation.js      # Input validation
├── middleware/
│   └── rate-limit.js      # Rate limiting (anti-cheat)
├── .env.example           # Environment template
├── .gitignore            # Git ignore rules
└── README.md             # This file
```

## Quick Start

### Local Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start server**:
   ```bash
   npm start
   ```

Server will run on `http://localhost:3001` by default.

### Test Server

Check if server is running:
```bash
curl http://localhost:3001/health
```

Response:
```json
{
  "status": "ok",
  "service": "realms-of-trade-server",
  "players": 0,
  "projectiles": 0,
  "uptime": 123.45,
  "timestamp": 1730464799000
}
```

## Deployment to Render

### Prerequisites

- GitHub account
- Render account (https://render.com)

### Deployment Steps

1. **Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/realms-of-trade-server.git
   git push -u origin main
   ```

2. **Deploy on Render**:
   - Go to https://dashboard.render.com
   - Click "New" → "Web Service"
   - Connect your GitHub repository
   - Configure:
     - **Name**: realms-of-trade-server
     - **Environment**: Node
     - **Build Command**: `npm install`
     - **Start Command**: `npm start`
     - **Instance Type**: Free (for testing) or Starter ($7/mo for production)

3. **Set Environment Variables** (in Render dashboard):
   - `NODE_ENV` = `production`
   - `ALLOWED_ORIGINS` = `https://your-frontend-domain.com`
   - `PORT` is automatically set by Render

4. **Deploy**:
   - Click "Create Web Service"
   - Wait for deployment (2-3 minutes)
   - Note your service URL (e.g., `https://realms-of-trade-server.onrender.com`)

### Verify Deployment

```bash
curl https://your-render-url.onrender.com/health
```

## Configuration

### Environment Variables

Create a `.env` file based on `.env.example`:

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| PORT | Server port | 3001 | No (Render sets automatically) |
| NODE_ENV | Environment (development/production) | development | No |
| ALLOWED_ORIGINS | Comma-separated list of allowed frontend URLs | * | Yes for production |

### Game Constants

Edit `config/constants.js` to customize:

- World dimensions
- Player stats
- Weapon configurations
- Class configurations
- Network update rates
- Performance limits

## API Endpoints

### HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Server information |
| `/health` | GET | Health check |

### Socket.io Events

#### Client → Server

| Event | Data | Description |
|-------|------|-------------|
| `player:join` | `{ characterName, x, y, maxHp, attack, defense, speed, class, weapon }` | Player joins game |
| `player:move` | `{ x, y, rotation }` | Player movement update |
| `player:shoot` | `{ x, y, rotation }` | Player shoots projectile |
| `player:hit` | `{ targetId, projectileId }` | Projectile hits player |

#### Server → Client

| Event | Data | Description |
|-------|------|-------------|
| `game:init` | `{ playerId, players[], projectiles[] }` | Initial game state |
| `player:joined` | `Player` | New player joined |
| `player:left` | `playerId` | Player disconnected |
| `player:moved` | `{ id, x, y, rotation }` | Player position update |
| `projectile:created` | `{ playerId, projectiles[] }` | New projectiles created |
| `projectiles:update` | `Projectile[]` | Projectile positions |
| `player:damaged` | `{ targetId, damage, currentHp, projectileId }` | Player took damage |
| `player:died` | `{ playerId, killerId }` | Player died |
| `player:respawned` | `Player` | Player respawned |

## Frontend Integration

### React Example

```javascript
import io from 'socket.io-client';

// Connect to server
const socket = io('https://your-render-url.onrender.com');

// Listen for connection
socket.on('connect', () => {
  console.log('Connected to game server');
  
  // Join game
  socket.emit('player:join', {
    characterName: 'Player1',
    x: 100,
    y: 100,
    maxHp: 100,
    attack: 10,
    defense: 5,
    speed: 5,
    class: 'warrior',
    weapon: 'starter_pistol'
  });
});

// Listen for game state
socket.on('game:init', (data) => {
  console.log('Game initialized', data);
});

// Send movement
socket.emit('player:move', {
  x: 150,
  y: 200,
  rotation: 1.5
});

// Shoot projectile
socket.emit('player:shoot', {
  x: 150,
  y: 200,
  rotation: 1.5
});
```

## Performance

### Capacity

- Recommended: 25-30 concurrent players (Free tier)
- Maximum: 50 concurrent players (Paid tier with higher resources)

### Network

- Position updates: 50ms interval
- Projectile updates: 50ms interval
- Tick rate: 20 TPS
- Typical latency: <100ms

### Optimization

- Client-side prediction recommended
- Rate limiting prevents spam
- Delta compression for network efficiency
- Memory-efficient projectile cleanup

## Security

### Implemented

- Server-authoritative game state
- Input validation on all events
- Rate limiting on actions
- Position bounds checking
- Cooldown enforcement
- CORS configuration

### Production Recommendations

1. Set `ALLOWED_ORIGINS` to your specific frontend domain
2. Enable HTTPS (automatic on Render)
3. Monitor server logs for suspicious activity
4. Set up error tracking (e.g., Sentry)
5. Implement authentication if needed

## Monitoring

### Health Check

```bash
# Check server status
curl https://your-server.onrender.com/health
```

### Logs

On Render:
- Go to your service dashboard
- Click "Logs" tab
- View real-time logs

### Metrics

Monitor:
- Connected players count
- Active projectiles
- Server uptime
- Memory usage
- CPU usage

## Troubleshooting

### Common Issues

**Players can't connect**
- Verify server is running: Check `/health` endpoint
- Check CORS settings in environment variables
- Verify frontend is using correct server URL

**High latency**
- Check server resources (upgrade instance type)
- Monitor network usage
- Reduce update intervals in `config/constants.js`

**Server crashes**
- Check logs for errors
- Verify Node.js version (18+)
- Ensure dependencies are installed

**Players out of sync**
- Implement client-side prediction
- Check network latency
- Verify event handlers are working

## Development

### Running Tests

```bash
npm test
```

### Local Development with Hot Reload

```bash
# Install nodemon
npm install -g nodemon

# Run with auto-restart
nodemon server.js
```

### Debugging

Enable debug logs:
```bash
NODE_ENV=development npm start
```

## Scaling

### Horizontal Scaling

For 100+ players:
1. Deploy multiple server instances
2. Use load balancer
3. Implement sticky sessions
4. Consider Redis for shared state

### Vertical Scaling

Upgrade Render instance:
- Starter: $7/mo (512MB RAM)
- Standard: $25/mo (2GB RAM)
- Pro: $85/mo (4GB RAM)

## License

MIT

## Support

For issues or questions:
- Check logs in Render dashboard
- Verify environment variables
- Test health endpoint
- Review Socket.io connection events

## Credits

Built for Realms of Trade MMORPG
Socket.io for real-time multiplayer
Express.js for HTTP server
