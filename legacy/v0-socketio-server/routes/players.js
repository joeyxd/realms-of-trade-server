const constants = require('../config/constants');

// Player class for game state management
class Player {
  constructor(id, data) {
    this.id = id;
    this.x = data.x || 100 + Math.random() * 200;
    this.y = data.y || 100 + Math.random() * 200;
    this.rotation = 0;
    this.characterName = data.characterName || 'Unknown';
    this.maxHp = data.maxHp || constants.DEFAULT_HP;
    this.currentHp = data.currentHp || constants.DEFAULT_HP;
    this.maxMp = data.maxMp || constants.DEFAULT_MP;
    this.currentMp = data.currentMp || constants.DEFAULT_MP;
    this.attack = data.attack || constants.DEFAULT_ATTACK;
    this.defense = data.defense || constants.DEFAULT_DEFENSE;
    this.speed = data.speed || constants.DEFAULT_SPEED;
    this.class = data.class || 'warrior';
    this.weapon = data.weapon || 'starter_pistol';
    this.lastShot = 0;
    this.lastUpdate = Date.now();
  }

  getState() {
    return {
      id: this.id,
      x: this.x,
      y: this.y,
      rotation: this.rotation,
      characterName: this.characterName,
      maxHp: this.maxHp,
      currentHp: this.currentHp,
      maxMp: this.maxMp,
      currentMp: this.currentMp,
      attack: this.attack,
      defense: this.defense,
      speed: this.speed,
      class: this.class,
      weapon: this.weapon
    };
  }

  takeDamage(damage) {
    const actualDamage = Math.max(1, damage - this.defense);
    this.currentHp = Math.max(0, this.currentHp - actualDamage);
    return {
      damage: actualDamage,
      currentHp: this.currentHp,
      isDead: this.currentHp <= 0
    };
  }

  respawn() {
    this.currentHp = this.maxHp;
    this.currentMp = this.maxMp;
    this.x = Math.random() * constants.WORLD_WIDTH;
    this.y = Math.random() * constants.WORLD_HEIGHT;
  }
}

module.exports = Player;
