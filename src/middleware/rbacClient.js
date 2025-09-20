const axios = require('axios');
const config = require('../../config/config');
const Logger = require('../utils/logger');

// RBAC client for database server
class RBACClient {
  constructor() {
    this.authServerURL = config.authServer?.url || 'https://scalai-auth-server.herokuapp.com';
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  async checkPermission(userId, resourceName, requiredPermission, subaccountId = null, token) {
    try {
      const cacheKey = `${userId}:${resourceName}:${requiredPermission}:${subaccountId || 'global'}`;
      
      // Check cache first
      const cached = this.cache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
        return cached.result;
      }

      // Make request to auth server
      const response = await axios.get(`${this.authServerURL}/api/rbac/permissions/check`, {
        params: { userId, resourceName, subaccountId },
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 5000
      });

      const result = response.data.data.permissions[requiredPermission];
      
      // Cache the result
      this.cache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      Logger.error('RBAC permission check failed', {
        error: error.message,
        userId,
        resourceName,
        requiredPermission
      });
      
      return {
        hasPermission: false,
        reason: 'RBAC service unavailable',
        effectiveRole: 'unknown'
      };
    }
  }
}

const rbacClient = new RBACClient();

// RBAC middleware for database server
const requirePermission = (resourceName, requiredPermission = 'read') => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      const userId = req.user.id;
      const subaccountId = req.params.subaccountId || req.body.subaccountId || null;
      const token = req.headers.authorization?.split(' ')[1];

      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'Access token required',
          code: 'TOKEN_REQUIRED'
        });
      }

      // Check permission via RBAC service
      const permissionResult = await rbacClient.checkPermission(
        userId,
        resourceName,
        requiredPermission,
        subaccountId,
        token
      );

      if (!permissionResult.hasPermission) {
        Logger.security('Database permission denied', 'medium', {
          userId,
          resourceName,
          requiredPermission,
          subaccountId,
          reason: permissionResult.reason,
          endpoint: req.originalUrl
        });

        return res.status(403).json({
          success: false,
          message: permissionResult.reason || 'Permission denied',
          code: 'PERMISSION_DENIED',
          details: {
            resource: resourceName,
            requiredPermission,
            effectiveRole: permissionResult.effectiveRole
          }
        });
      }

      req.permission = permissionResult;
      next();
    } catch (error) {
      Logger.error('Database RBAC middleware error', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        message: 'Permission check failed',
        code: 'RBAC_ERROR'
      });
    }
  };
};

// Pre-built permission checks for database server
const databasePermissions = {
  read: requirePermission('database_operations', 'read'),
  write: requirePermission('database_operations', 'write'),
  delete: requirePermission('database_operations', 'delete'),
  llm: requirePermission('llm_operations', 'write')
};

module.exports = {
  rbacClient,
  requirePermission,
  databasePermissions
}; 