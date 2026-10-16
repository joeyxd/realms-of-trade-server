const constants = require('../config/constants');

// Validate player position
function validatePosition(x, y) {
  return {
    x: Math.max(0, Math.min(constants.WORLD_WIDTH, x)),
    y: Math.max(0, Math.min(constants.WORLD_HEIGHT, y))
  };
}

// Validate player movement input
function validateMovement(data) {
  if (!data || typeof data !== 'object') {
    return false;
  }
  
  const { x, y, rotation } = data;
  
  if (typeof x !== 'number' || typeof y !== 'number') {
    return false;
  }
  
  if (isNaN(x) || isNaN(y)) {
    return false;
  }
  
  if (x < -100 || x > constants.WORLD_WIDTH + 100) {
    return false;
  }
  
  if (y < -100 || y > constants.WORLD_HEIGHT + 100) {
    return false;
  }
  
  return true;
}

// Validate shooting input
function validateShoot(data) {
  if (!data || typeof data !== 'object') {
    return false;
  }
  
  const { x, y, rotation } = data;
  
  if (typeof x !== 'number' || typeof y !== 'number' || typeof rotation !== 'number') {
    return false;
  }
  
  if (isNaN(x) || isNaN(y) || isNaN(rotation)) {
    return false;
  }
  
  return true;
}

// Validate character join data
function validateJoin(data) {
  if (!data || typeof data !== 'object') {
    return false;
  }
  
  const { characterName } = data;
  
  if (!characterName || typeof characterName !== 'string') {
    return false;
  }
  
  if (characterName.length < 1 || characterName.length > 50) {
    return false;
  }
  
  return true;
}

module.exports = {
  validatePosition,
  validateMovement,
  validateShoot,
  validateJoin
};
