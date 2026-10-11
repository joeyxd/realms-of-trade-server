// Game Constants Configuration
module.exports = {
  // World dimensions
  WORLD_WIDTH: 3200,
  WORLD_HEIGHT: 3200,
  
  // Player settings
  PLAYER_SPEED: 5,
  DEFAULT_HP: 100,
  DEFAULT_MP: 50,
  DEFAULT_ATTACK: 10,
  DEFAULT_DEFENSE: 5,
  DEFAULT_SPEED: 5,
  
  // Projectile settings
  PROJECTILE_SPEED: 10,
  PROJECTILE_LIFETIME: 3000, // milliseconds
  
  // Weapon configurations
  WEAPONS: {
    starter_pistol: {
      cooldown: 500,
      projectiles: 1,
      spreadAngle: 0,
      damage: 1.0
    },
    rapid_fire: {
      cooldown: 200,
      projectiles: 1,
      spreadAngle: 0,
      damage: 0.8
    },
    spread_shot: {
      cooldown: 800,
      projectiles: 3,
      spreadAngle: 0.2,
      damage: 0.7
    },
    heavy_cannon: {
      cooldown: 1000,
      projectiles: 1,
      spreadAngle: 0,
      damage: 2.0
    }
  },
  
  // Class configurations
  CLASSES: {
    warrior: {
      maxHp: 120,
      maxMp: 30,
      attack: 15,
      defense: 10,
      speed: 4
    },
    mage: {
      maxHp: 80,
      maxMp: 100,
      attack: 20,
      defense: 3,
      speed: 5
    },
    ranger: {
      maxHp: 100,
      maxMp: 50,
      attack: 12,
      defense: 5,
      speed: 7
    }
  },
  
  // Network settings
  POSITION_UPDATE_INTERVAL: 50, // milliseconds
  PROJECTILE_UPDATE_INTERVAL: 50, // milliseconds
  
  // Respawn settings
  RESPAWN_DELAY: 3000, // milliseconds
  
  // Performance settings
  MAX_PLAYERS: 50,
  TICK_RATE: 20 // ticks per second
};
