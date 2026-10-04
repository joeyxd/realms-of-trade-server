const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Import modules
const constants = require('./config/constants');
const Player = require('./routes/players');
const { Projectile, getWeaponConfig } = require('./routes/combat');
const { validatePosition, validateMovement, validateShoot, validateJoin } = require('./utils/validation');
const RateLimiter = require('./middleware/rate-limit');

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Environment configuration
const PORT = process.env.PORT || 3001;
// Allow both production and development domains
const ALLOWED_ORIGINS = [
  'https://tg47t4fjntwk.space.minimax.io',
  'https://v57k4pdcwt38.space.minimax.io',
  'https://aofopcssvyj9.space.minimax.io',
  'https://9h3ls664dw6r.space.minimax.io',
  'https://h598zvb1ixs5.space.minimax.io',
  'http://localhost:3000',
  'http://localhost:5173'
];
const NODE_ENV = process.env.NODE_ENV || 'development';

console.log(`Starting Realms of Trade Server in ${NODE_ENV} mode...`);
console.log(`Allowed Origins: ${ALLOWED_ORIGINS.join(', ')}`);

// Create HTTP server and Socket.io instance
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      if (ALLOWED_ORIGINS.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST"],
    credentials: false
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Game state
const players = new Map();
const projectiles = new Map();
let projectileIdCounter = 0;

// Anti-cheat rate limiter
const rateLimiter = new RateLimiter();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'realms-of-trade-server',
    players: players.size,
    projectiles: projectiles.size,
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

// Server info endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Realms of Trade - Multiplayer Server',
    version: '1.0.0',
    status: 'running',
    players: {
      current: players.size,
      max: constants.MAX_PLAYERS
    },
    features: [
      'Real-time multiplayer',
      'Combat system',
      'Character persistence',
      'Anti-cheat protection'
    ]
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`[${new Date().toISOString()}] Player connected: ${socket.id}`);

  // Handle player join
  socket.on('player:join', (data) => {
    try {
      if (!validateJoin(data)) {
        console.log(`Invalid join data from ${socket.id}`);
        return;
      }

      // Check player limit
      if (players.size >= constants.MAX_PLAYERS) {
        socket.emit('error', { message: 'Server is full' });
        return;
      }

      const player = new Player(socket.id, data);
      players.set(socket.id, player);

      console.log(`[${new Date().toISOString()}] Player ${data.characterName} joined (${socket.id})`);

      // Send current game state to new player
      socket.emit('game:init', {
        playerId: socket.id,
        players: Array.from(players.values()).map(p => p.getState()),
        projectiles: Array.from(projectiles.values()).map(p => p.getState())
      });

      // Notify others about new player
      socket.broadcast.emit('player:joined', player.getState());

    } catch (error) {
      console.error('Error in player:join:', error);
    }
  });

  // Handle player movement
  socket.on('player:move', (data) => {
    try {
      const player = players.get(socket.id);
      if (!player) return;

      if (!validateMovement(data)) {
        console.log(`Invalid movement from ${socket.id}`);
        return;
      }

      // Rate limiting
      if (!rateLimiter.checkLimit(socket.id, 'move', 60)) {
        return; // Too many updates
      }

      // Update player position with validation
      const validated = validatePosition(data.x, data.y);
      player.x = validated.x;
      player.y = validated.y;
      
      if (typeof data.rotation === 'number') {
        player.rotation = data.rotation;
      }
      
      player.lastUpdate = Date.now();

      // Broadcast to all other players
      socket.broadcast.emit('player:moved', {
        id: socket.id,
        x: player.x,
        y: player.y,
        rotation: player.rotation
      });

    } catch (error) {
      console.error('Error in player:move:', error);
    }
  });

  // Handle shooting
  socket.on('player:shoot', (data) => {
    try {
      const player = players.get(socket.id);
      if (!player) return;

      if (!validateShoot(data)) {
        console.log(`Invalid shoot data from ${socket.id}`);
        return;
      }

      // Get weapon configuration
      const weaponConfig = getWeaponConfig(player.weapon);
      
      // Check cooldown (anti-cheat)
      const now = Date.now();
      if (now - player.lastShot < weaponConfig.cooldown) {
        return; // Cooldown not finished
      }

      player.lastShot = now;

      // Create projectile(s)
      const projectileList = [];
      for (let i = 0; i < weaponConfig.projectiles; i++) {
        const projectileId = `proj_${projectileIdCounter++}`;
        let rotation = data.rotation;

        // Apply spread for multi-shot weapons
        if (weaponConfig.projectiles > 1) {
          const offset = (i - (weaponConfig.projectiles - 1) / 2) * weaponConfig.spreadAngle;
          rotation += offset;
        }

        const projectile = new Projectile(
          projectileId,
          socket.id,
          data.x,
          data.y,
          rotation,
          player.attack * weaponConfig.damage
        );

        projectiles.set(projectileId, projectile);
        projectileList.push(projectile.getState());
      }

      // Broadcast projectile creation to all players
      io.emit('projectile:created', {
        playerId: socket.id,
        projectiles: projectileList
      });

    } catch (error) {
      console.error('Error in player:shoot:', error);
    }
  });

  // Handle player hit
  socket.on('player:hit', (data) => {
    try {
      const targetPlayer = players.get(data.targetId);
      const projectile = projectiles.get(data.projectileId);

      if (!targetPlayer || !projectile) return;

      // Verify hit is valid (server-side validation)
      if (!projectile.checkCollision(targetPlayer)) {
        return; // Invalid hit
      }

      // Apply damage
      const result = targetPlayer.takeDamage(projectile.damage);

      // Remove projectile
      projectiles.delete(data.projectileId);

      // Broadcast damage event
      io.emit('player:damaged', {
        targetId: data.targetId,
        damage: result.damage,
        currentHp: result.currentHp,
        projectileId: data.projectileId
      });

      // Handle death
      if (result.isDead) {
        io.emit('player:died', {
          playerId: data.targetId,
          killerId: projectile.playerId
        });

        // Respawn after delay
        setTimeout(() => {
          if (players.has(data.targetId)) {
            targetPlayer.respawn();
            io.emit('player:respawned', targetPlayer.getState());
          }
        }, constants.RESPAWN_DELAY);
      }

    } catch (error) {
      console.error('Error in player:hit:', error);
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    players.delete(socket.id);
    socket.broadcast.emit('player:left', socket.id);
    console.log(`[${new Date().toISOString()}] Player disconnected: ${socket.id}`);
  });
});

// Game loop for projectile updates
setInterval(() => {
  const updatedProjectiles = [];

  for (const [id, projectile] of projectiles.entries()) {
    if (!projectile.update()) {
      // Projectile expired or out of bounds
      projectiles.delete(id);
    } else {
      updatedProjectiles.push(projectile.getState());
    }
  }

  if (updatedProjectiles.length > 0) {
    io.emit('projectiles:update', updatedProjectiles);
  }
}, constants.PROJECTILE_UPDATE_INTERVAL);

// Cleanup rate limiter periodically
setInterval(() => {
  rateLimiter.cleanup();
}, 10000);

// Start server
httpServer.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`Realms of Trade Server`);
  console.log(`========================================`);
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`WebSocket server ready for connections`);
  console.log(`Max players: ${constants.MAX_PLAYERS}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`========================================`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  httpServer.close(() => {
    console.log('HTTP server closed');
  });
});
