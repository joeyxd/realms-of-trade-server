// Rate limiting middleware for anti-cheat
class RateLimiter {
  constructor() {
    this.limits = new Map();
  }

  checkLimit(playerId, action, maxPerSecond = 20) {
    const now = Date.now();
    const key = `${playerId}:${action}`;
    
    if (!this.limits.has(key)) {
      this.limits.set(key, { count: 1, resetTime: now + 1000 });
      return true;
    }
    
    const limit = this.limits.get(key);
    
    if (now > limit.resetTime) {
      limit.count = 1;
      limit.resetTime = now + 1000;
      return true;
    }
    
    if (limit.count >= maxPerSecond) {
      return false; // Rate limit exceeded
    }
    
    limit.count++;
    return true;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, limit] of this.limits.entries()) {
      if (now > limit.resetTime + 5000) {
        this.limits.delete(key);
      }
    }
  }
}

module.exports = RateLimiter;
