const axios = require('axios');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

// Cache for service token validation to reduce auth server calls
const tokenCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Service token authentication middleware
const authenticateServiceToken = async (req, res, next) => {
  try {
    const serviceToken = req.headers['x-service-token'];
    
    if (!serviceToken) {
      return res.status(401).json({
        success: false,
        message: 'Service token required',
        code: 'SERVICE_TOKEN_REQUIRED'
      });
    }

    // Check cache first
    const cacheKey = `service_token:${serviceToken}`;
    const cachedResult = tokenCache.get(cacheKey);
    
    if (cachedResult && (Date.now() - cachedResult.timestamp) < CACHE_TTL) {
      req.service = cachedResult.service;
      req.requestId = uuidv4();
      return next();
    }

    // Validate token with auth server
    const tokenInfo = await validateServiceTokenWithAuthServer(serviceToken);
    
    if (!tokenInfo) {
      Logger.security('Invalid service token', 'high', {
        token: serviceToken.substring(0, 8) + '***',
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        endpoint: req.originalUrl
      });

      return res.status(403).json({
        success: false,
        message: 'Invalid or expired service token',
        code: 'INVALID_SERVICE_TOKEN'
      });
    }

    // Cache the result
    tokenCache.set(cacheKey, {
      service: tokenInfo,
      timestamp: Date.now()
    });

    // Add service info to request
    req.service = tokenInfo;
    req.requestId = uuidv4();

    Logger.debug('Service authenticated', {
      service: tokenInfo.serviceName,
      requestId: req.requestId,
      permissions: tokenInfo.permissions
    });

    next();

  } catch (error) {
    Logger.error('Service authentication failed', {
      error: error.message,
      endpoint: req.originalUrl,
      ip: req.ip
    });

    return res.status(500).json({
      success: false,
      message: 'Authentication error',
      code: 'AUTH_ERROR'
    });
  }
};

// Validate service token with auth server
async function validateServiceTokenWithAuthServer(token) {
  try {
    const response = await axios.post(
      `${config.serviceToken.authServerUrl}/api/auth/validate-service-token`,
      {},
      {
        headers: {
          'X-Service-Token': token,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );

    if (response.data.success) {
      return {
        serviceName: response.data.data.serviceName,
        permissions: response.data.data.permissions,
        allowedIPs: response.data.data.allowedIPs,
        rateLimit: response.data.data.rateLimit
      };
    }

    return null;
  } catch (error) {
    Logger.error('Failed to validate service token with auth server', {
      error: error.message,
      authServerUrl: config.serviceToken.authServerUrl
    });
    return null;
  }
}

// Check if service has specific permission
const requireServicePermission = (permission) => {
  return (req, res, next) => {
    if (!req.service) {
      return res.status(401).json({
        success: false,
        message: 'Service authentication required',
        code: 'SERVICE_AUTH_REQUIRED'
      });
    }

    if (!req.service.permissions.includes(permission) && !req.service.permissions.includes('*')) {
      Logger.security('Service permission denied', 'medium', {
        service: req.service.serviceName,
        requiredPermission: permission,
        servicePermissions: req.service.permissions,
        endpoint: req.originalUrl
      });

      return res.status(403).json({
        success: false,
        message: `Permission '${permission}' required`,
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    next();
  };
};

// Combined middleware that accepts both JWT tokens and service tokens
const authenticateTokenOrService = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const serviceToken = req.headers['x-service-token'];

  // If service token is provided, use service authentication
  if (serviceToken) {
    return authenticateServiceToken(req, res, next);
  }

  // If JWT token is provided, use JWT authentication
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const { authenticateToken } = require('./authMiddleware');
    return authenticateToken(req, res, next);
  }

  // No authentication provided
  return res.status(401).json({
    success: false,
    message: 'Authentication required (JWT token or service token)',
    code: 'AUTH_REQUIRED'
  });
};

// Clear token cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of tokenCache.entries()) {
    if (now - value.timestamp >= CACHE_TTL) {
      tokenCache.delete(key);
    }
  }
}, CACHE_TTL);

module.exports = {
  authenticateServiceToken,
  requireServicePermission,
  authenticateTokenOrService
}; 