const jwt = require('jsonwebtoken');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const tenantService = require('../services/tenantService');
const { v4: uuidv4 } = require('uuid');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token required',
      code: 'ACCESS_TOKEN_REQUIRED'
    });
  }

  jwt.verify(token, config.jwt.secret, (err, decoded) => {
    if (err) {
      Logger.security('Invalid access token', 'medium', {
        error: err.message,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        endpoint: req.originalUrl
      });

      return res.status(403).json({
        success: false,
        message: 'Invalid or expired token',
        code: 'INVALID_ACCESS_TOKEN'
      });
    }

    req.user = decoded;
    next();
  });
};

// Optional middleware - only authenticate if token is provided
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    // No token provided, continue without authentication
    return next();
  }

  jwt.verify(token, config.jwt.secret, (err, decoded) => {
    if (!err) {
      req.user = decoded;
    }
    // Continue regardless of token validity for optional auth
    next();
  });
};

// Request logging middleware
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  const requestId = uuidv4();
  
  req.requestId = requestId;
  
  // Log request start
  Logger.info('Request started', {
    requestId,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id
  });

  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(...args) {
    const duration = Date.now() - startTime;
    
    Logger.info('Request completed', {
      requestId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      responseTime: duration,
      userId: req.user?.id,
      dataSize: res.get('content-length') || 0
    });
    
    originalEnd.apply(this, args);
  };

  next();
};

// Validate subaccount access middleware
const validateSubaccountAccess = (requiredPermission = 'read') => {
  return async (req, res, next) => {
    try {
      const subaccountId = req.params.subaccountId || req.body.subaccountId;
      
      if (!subaccountId) {
        return res.status(400).json({
          success: false,
          message: 'Subaccount ID required',
          code: 'SUBACCOUNT_ID_REQUIRED'
        });
      }

      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
      
      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'Access token required for subaccount validation',
          code: 'ACCESS_TOKEN_REQUIRED'
        });
      }

      // Validate access using tenant service
      const accessValidation = await tenantService.validateAccess(token, subaccountId, requiredPermission);
      
      if (!accessValidation.success || !accessValidation.hasAccess) {
        Logger.security('Subaccount access denied', 'medium', {
          userId: req.user?.id,
          subaccountId,
          requiredPermission,
          reason: accessValidation.error
        });

        return res.status(403).json({
          success: false,
          message: accessValidation.error || 'Access denied to subaccount',
          code: 'SUBACCOUNT_ACCESS_DENIED'
        });
      }

      // Add subaccount info to request
      req.subaccount = {
        id: subaccountId,
        permissions: accessValidation.permissions
      };

      next();
    } catch (error) {
      Logger.error('Subaccount access validation failed', {
        error: error.message,
        userId: req.user?.id,
        subaccountId: req.params.subaccountId || req.body.subaccountId
      });

      res.status(500).json({
        success: false,
        message: 'Access validation failed',
        code: 'VALIDATION_ERROR'
      });
    }
  };
};

module.exports = {
  authenticateToken,
  optionalAuth,
  requestLogger,
  validateSubaccountAccess
}; 
 