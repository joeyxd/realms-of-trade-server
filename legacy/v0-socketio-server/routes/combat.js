const constants = require('../config/constants');

// Projectile class for combat system
class Projectile {
  constructor(id, playerId, x, y, rotation, damage) {
    this.id = id;
    this.playerId = playerId;
    this.x = x;
    this.y = y;
    this.rotation = rotation;
    this.damage = damage;
    this.createdAt = Date.now();
    this.speed = constants.PROJECTILE_SPEED;
  }

  update() {
    // Move projectile based on rotation and speed
    this.x += Math.cos(this.rotation) * this.speed;
    this.y += Math.sin(this.rotation) * this.speed;
    
    // Check if out of bounds or expired
    const isOutOfBounds = this.x < 0 || this.x > constants.WORLD_WIDTH || 
                          this.y < 0 || this.y > constants.WORLD_HEIGHT;
    const isExpired = Date.now() - this.createdAt > constants.PROJECTILE_LIFETIME;
    
    return !(isOutOfBounds || isExpired); // Return false if should be removed
  }

  getState() {
    return {
      id: this.id,
      playerId: this.playerId,
      x: this.x,
      y: this.y,
      rotation: this.rotation,
      damage: this.damage
    };
  }

  // Check collision with a player
  checkCollision(player) {
    const dx = this.x - player.x;
    const dy = this.y - player.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance < 16; // Collision radius
  }
}

// Get weapon configuration
function getWeaponConfig(weaponName) {
  return constants.WEAPONS[weaponName] || constants.WEAPONS.starter_pistol;
}

module.exports = { Projectile, getWeaponConfig };
