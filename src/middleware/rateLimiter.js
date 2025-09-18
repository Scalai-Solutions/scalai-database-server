// Simple in-memory rate limiter for LLM server
// In production, consider using Redis-based rate limiting
const rateLimitMap = new Map();

const rateLimiter = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxRequests = 50; // Max 50 requests per window (stricter for LLM server)

  // Clean up old entries
  for (const [ip, data] of rateLimitMap.entries()) {
    if (now - data.windowStart > windowMs) {
      rateLimitMap.delete(ip);
    }
  }

  // Check current client
  const clientData = rateLimitMap.get(clientIP);
  
  if (!clientData) {
    // First request from this IP
    rateLimitMap.set(clientIP, {
      count: 1,
      windowStart: now
    });
    return next();
  }

  // Check if window has expired
  if (now - clientData.windowStart > windowMs) {
    // Reset window
    rateLimitMap.set(clientIP, {
      count: 1,
      windowStart: now
    });
    return next();
  }

  // Check if limit exceeded
  if (clientData.count >= maxRequests) {
    return res.status(429).json({
      success: false,
      message: 'Too many requests, please try again later'
    });
  }

  // Increment count
  clientData.count++;
  next();
};

module.exports = rateLimiter; 