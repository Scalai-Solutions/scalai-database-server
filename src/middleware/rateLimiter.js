const config = require('../../config/config');
const Logger = require('../utils/logger');

// Simple in-memory rate limiter for Database server
class MemoryRateLimitStore {
  constructor() {
    this.store = new Map();
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, data] of this.store.entries()) {
        if (now - data.windowStart > data.windowMs) {
          this.store.delete(key);
        }
      }
    }, 60000); // Clean up every minute
  }

  incr(key, windowMs, maxRequests) {
    const now = Date.now();
    let entry = this.store.get(key);

    if (!entry || (now - entry.windowStart) > windowMs) {
      // Create new window
      entry = {
        count: 1,
        windowStart: now,
        windowMs,
        maxRequests
      };
      this.store.set(key, entry);
      return { count: 1, resetTime: now + windowMs };
    }

    // Increment existing window
    entry.count++;
    return { 
      count: entry.count, 
      resetTime: entry.windowStart + windowMs,
      exceeded: entry.count > maxRequests
    };
  }

  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// Singleton store
const rateLimitStore = new MemoryRateLimitStore();

// Create rate limiter factory
const createRateLimiter = (maxRequests, windowMs, keyGenerator) => {
  return (req, res, next) => {
    const key = keyGenerator ? keyGenerator(req) : req.ip;
    const result = rateLimitStore.incr(key, windowMs, maxRequests);
    
    if (result.exceeded) {
      Logger.warn('Rate limit exceeded', {
        key,
        count: result.count,
        limit: maxRequests,
        windowMs,
        resetTime: new Date(result.resetTime)
      });
      
      return res.status(429).json({
        success: false,
        message: 'Too many requests, please try again later',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
      });
    }

    next();
  };
};

// General rate limiter
const generalLimiter = createRateLimiter(
  config.rateLimiting.max,
  config.rateLimiting.windowMs,
  (req) => req.ip
);

// Per-user rate limiter
const userLimiter = createRateLimiter(
  config.rateLimiting.perUser.max,
  config.rateLimiting.perUser.windowMs,
  (req) => req.user ? `user:${req.user.id}` : `ip:${req.ip}`
);

// Per-subaccount rate limiter factory
const subaccountLimiter = (maxRequests, windowMs) => {
  return createRateLimiter(
    maxRequests || config.rateLimiting.perSubaccount.max,
    windowMs || config.rateLimiting.perSubaccount.windowMs,
    (req) => {
      const subaccountId = req.params.subaccountId || req.body.subaccountId;
      const userId = req.user?.id || req.ip;
      return `subaccount:${subaccountId}:${userId}`;
    }
  );
};

// Burst protection for sensitive operations
const burstProtection = createRateLimiter(
  5, // Only 5 requests per 10 seconds
  10 * 1000, // 10 seconds
  (req) => {
    const subaccountId = req.params.subaccountId || req.body.subaccountId;
    const userId = req.user?.id || req.ip;
    return `burst:${subaccountId}:${userId}`;
  }
);

module.exports = {
  generalLimiter,
  userLimiter,
  subaccountLimiter,
  burstProtection,
  rateLimitStore
}; 