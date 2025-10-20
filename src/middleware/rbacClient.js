const axios = require('axios');
const config = require('../../config/config');
const Logger = require('../utils/logger');

// Enhanced RBAC client with comprehensive caching
class RBACClient {
  constructor() {
    this.authServerURL = config.authServer?.url || 'http://localhost:3001';
    
    // Separate caches for different types of data
    this.permissionCache = new Map(); // User permissions cache
    this.resourceCache = new Map();   // Resource resolution cache
    this.userCache = new Map();       // User info cache
    
    // Cache configuration
    this.cacheConfig = {
      permission: {
        ttl: 10 * 60 * 1000,     // 10 minutes for permissions
        maxSize: 1000             // Max 1000 permission entries
      },
      resource: {
        ttl: 30 * 60 * 1000,     // 30 minutes for resource resolution
        maxSize: 100              // Max 100 resource entries
      },
      user: {
        ttl: 15 * 60 * 1000,     // 15 minutes for user info
        maxSize: 500              // Max 500 user entries
      }
    };

    // Cache statistics for monitoring
    this.cacheStats = {
      permission: { hits: 0, misses: 0, evictions: 0 },
      resource: { hits: 0, misses: 0, evictions: 0 },
      user: { hits: 0, misses: 0, evictions: 0 }
    };

    // Initialize cleanup interval as null - will be started on first use
    this.cleanupInterval = null;
  }

  // Generic cache management methods
  _getCacheKey(type, ...parts) {
    return `${type}:${parts.join(':')}`;
  }

  _getFromCache(cacheType, key) {
    const cache = this[`${cacheType}Cache`];
    const entry = cache.get(key);
    
    if (!entry) {
      this.cacheStats[cacheType].misses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.cacheConfig[cacheType].ttl) {
      cache.delete(key);
      this.cacheStats[cacheType].evictions++;
      this.cacheStats[cacheType].misses++;
      return null;
    }

    this.cacheStats[cacheType].hits++;
    entry.lastAccessed = Date.now();
    return entry.data;
  }

  _setInCache(cacheType, key, data) {
    const cache = this[`${cacheType}Cache`];
    const config = this.cacheConfig[cacheType];

    // Implement LRU eviction if cache is full
    if (cache.size >= config.maxSize) {
      this._evictLRU(cacheType);
    }

    cache.set(key, {
      data,
      timestamp: Date.now(),
      lastAccessed: Date.now()
    });
  }

  _evictLRU(cacheType) {
    const cache = this[`${cacheType}Cache`];
    let oldestKey = null;
    let oldestTime = Date.now();

    for (const [key, entry] of cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      cache.delete(oldestKey);
      this.cacheStats[cacheType].evictions++;
    }
  }

  // Cache cleanup - remove expired entries
  startCacheCleanup() {
    if (!this.cleanupInterval) {
      this.cleanupInterval = setInterval(() => {
        this._cleanupExpiredEntries();
      }, 5 * 60 * 1000); // Run every 5 minutes
    }
  }

  _cleanupExpiredEntries() {
    const now = Date.now();
    let totalCleaned = 0;

    ['permission', 'resource', 'user'].forEach(cacheType => {
      const cache = this[`${cacheType}Cache`];
      const ttl = this.cacheConfig[cacheType].ttl;
      const toDelete = [];

      for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp > ttl) {
          toDelete.push(key);
        }
      }

      toDelete.forEach(key => {
        cache.delete(key);
        this.cacheStats[cacheType].evictions++;
        totalCleaned++;
      });
    });

    if (totalCleaned > 0) {
      Logger.debug('RBAC cache cleanup completed', {
        entriesRemoved: totalCleaned,
        cacheStats: this.cacheStats
      });
    }
  }

  // Enhanced resource resolution with caching
  async resolveResource(method, path, service) {
    // Start cache cleanup on first use
    this.startCacheCleanup();
    
    const cacheKey = this._getCacheKey('resource', method, path, service);
    
    // Try cache first
    const cached = this._getFromCache('resource', cacheKey);
    if (cached) {
      Logger.debug('Resource resolution cache hit', { method, path, service });
      return cached;
    }

    // Cache miss - fetch from auth server
    try {
      const loginResponse = await axios.post(`${this.authServerURL}/api/auth/login`, {
        email: config.super_admin.email,
        password: config.super_admin.password
      });
      const token = loginResponse.data.data.accessToken;

      // console.log("Resolving resource", { method, path, service, token });
      const response = await axios.get(`${this.authServerURL}/api/rbac/resources/resolve`, {
        params: { method, path, service },
        timeout: 100000,
        headers: { 'Authorization': `Bearer ${token}` }
      });
      // console.log("Response", response.data);
      const resourceInfo = response.data.data;
      
      // Cache the result
      this._setInCache('resource', cacheKey, resourceInfo);
      
      Logger.debug('Resource resolution cached', { method, path, service, token, resourceName: resourceInfo.resourceName });
      return resourceInfo;

    } catch (error) {
      Logger.error('Resource resolution failed', {
        error: error.message,
        method,
        path,
        service
      });
      throw error;
    }
  }

  // Enhanced permission check with caching
  async checkPermission(userId, resourceName, requiredPermission, subaccountId = null, token) {
    // Start cache cleanup on first use
    this.startCacheCleanup();
    
    const cacheKey = this._getCacheKey('permission', userId, resourceName, requiredPermission, subaccountId || 'global');
    
    // Try cache first
    const cached = this._getFromCache('permission', cacheKey);
    if (cached) {
      Logger.debug('Permission check cache hit', { userId, resourceName, requiredPermission, subaccountId });
      return cached;
    }

    console.log("Checking permission", { userId, resourceName, requiredPermission, subaccountId, authServerURL: this.authServerURL, token });
    // Cache miss - fetch from auth server
    try {
      const response = await axios.get(`${this.authServerURL}/api/rbac/permissions/check`, {
        params: { userId, resourceName, subaccountId },
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 100000
      });

      const result = response.data.data.permissions[requiredPermission];
      
      // Cache the result
      this._setInCache('permission', cacheKey, result);
      
      Logger.debug('Permission check cached', { userId, resourceName, requiredPermission, hasPermission: result.hasPermission });
      return result;

    } catch (error) {
      Logger.error('RBAC permission check failed', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
        authServerURL: this.authServerURL,
        userId,
        resourceName,
        requiredPermission,
        token: token ? token.substring(0, 20) + '...' : 'none'
      });
      
      return {
        hasPermission: false,
        reason: 'RBAC service unavailable',
        effectiveRole: 'unknown'
      };
    }
  }

  // Cache invalidation methods
  invalidateUserPermissions(userId, subaccountId = null) {
    const keysToDelete = [];
    const searchPattern = subaccountId ? `permission:${userId}:` : `permission:${userId}:`;

    for (const key of this.permissionCache.keys()) {
      if (key.startsWith(searchPattern)) {
        if (!subaccountId || key.includes(`:${subaccountId}`) || key.endsWith(':global')) {
          keysToDelete.push(key);
        }
      }
    }

    keysToDelete.forEach(key => this.permissionCache.delete(key));
    
    Logger.info('User permissions cache invalidated', { 
      userId, 
      subaccountId, 
      keysInvalidated: keysToDelete.length 
    });
  }

  invalidateResourceCache(resourceName = null) {
    if (resourceName) {
      // Invalidate specific resource
      const keysToDelete = [];
      for (const key of this.resourceCache.keys()) {
        const cached = this.resourceCache.get(key);
        if (cached && cached.data && cached.data.resourceName === resourceName) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(key => this.resourceCache.delete(key));
      
      Logger.info('Resource cache invalidated', { resourceName, keysInvalidated: keysToDelete.length });
    } else {
      // Clear all resource cache
      const count = this.resourceCache.size;
      this.resourceCache.clear();
      Logger.info('All resource cache cleared', { keysInvalidated: count });
    }
  }

  clearAllCache() {
    const totalKeys = this.permissionCache.size + this.resourceCache.size + this.userCache.size;
    
    this.permissionCache.clear();
    this.resourceCache.clear();
    this.userCache.clear();
    
    // Reset stats
    Object.keys(this.cacheStats).forEach(type => {
      this.cacheStats[type] = { hits: 0, misses: 0, evictions: 0 };
    });
    
    Logger.info('All RBAC caches cleared', { keysInvalidated: totalKeys });
  }

  // Cache statistics and monitoring
  getCacheStats() {
    return {
      stats: this.cacheStats,
      sizes: {
        permission: this.permissionCache.size,
        resource: this.resourceCache.size,
        user: this.userCache.size
      },
      config: this.cacheConfig
    };
  }

  // Cache warming - preload frequently accessed resources
  async warmCache(commonResources = []) {
    Logger.info('Starting RBAC cache warming', { resources: commonResources.length });
    
    for (const { method, path, service } of commonResources) {
      try {
        await this.resolveResource(method, path, service);
      } catch (error) {
        Logger.warn('Failed to warm cache for resource', { method, path, service, error: error.message });
      }
    }
    
    Logger.info('RBAC cache warming completed');
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

// Dynamic resource permission middleware that maps endpoints to permissions
const requireResourcePermission = () => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      const method = req.method;
      // Determine the base path from the original URL
      const originalUrl = req.originalUrl || req.url;
      let basePrefix = '/api/database';
      
      if (originalUrl.startsWith('/api/calls')) {
        basePrefix = '/api/calls';
      } else if (originalUrl.startsWith('/api/chats')) {
        basePrefix = '/api/chats';
      } else if (originalUrl.startsWith('/api/cache')) {
        basePrefix = '/api/cache';
      } else if (originalUrl.startsWith('/api/connectors')) {
        basePrefix = '/api/connectors';
      } else if (originalUrl.startsWith('/api/knowledge-base')) {
        basePrefix = '/api/knowledge-base';
      } else if (originalUrl.startsWith('/api/activities')) {
        basePrefix = '/api/activities';
      } else if (originalUrl.startsWith('/api/ai-insights')) {
        basePrefix = '/api/ai-insights';
      } else if (originalUrl.startsWith('/api/home')) {
        basePrefix = '/api/home';
      } else if (originalUrl.startsWith('/api/health')) {
        basePrefix = '/api/health';
      }
      
      const routePath = `${basePrefix}${req.route?.path}`;
      const token = req.headers.authorization?.split(' ')[1];

      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'Access token required',
          code: 'TOKEN_REQUIRED'
        });
      }

      // Resolve resource and required permissions using cached method
      let resourceInfo;
      try {
        resourceInfo = await rbacClient.resolveResource(method, routePath, 'database-server');
      } catch (error) {
        Logger.error('Failed to resolve resource from auth server', {
          error: error.message,
          method,
          path: routePath,
          userId: req.user.id
        });

        // Fallback: use appropriate resource based on route path
        Logger.warn('Falling back to default resource', {
          method,
          path: routePath,
          userId: req.user.id
        });

        let fallbackResourceName = 'test_database_operations';
        let fallbackPermission = 'read';

        // Determine appropriate fallback based on endpoint
        if (routePath.includes('/api/calls')) {
          // Call endpoints - treat as agent operations
          fallbackResourceName = 'agent_operations';
          fallbackPermission = method === 'GET' ? 'read' : 'write';
        } else if (routePath.includes('/api/chats')) {
          // Chat endpoints - treat as agent operations
          fallbackResourceName = 'agent_operations';
          fallbackPermission = method === 'GET' ? 'read' : 'write';
        } else if (routePath.includes('/api/cache')) {
          // Cache endpoints
          fallbackResourceName = 'database_operations';
          fallbackPermission = method === 'GET' ? 'read' : 'delete';
        } else if (routePath.includes('/api/connectors')) {
          // Connector endpoints
          fallbackResourceName = 'connection';
          fallbackPermission = method === 'GET' ? 'read' : 'delete';
        } else {
          // Database endpoints
          fallbackPermission = method === 'GET' ? 'read' : 
                              method === 'POST' && routePath.includes('find') ? 'read' :
                              method === 'POST' && (routePath.includes('insert') || routePath.includes('update')) ? 'write' :
                              method === 'POST' && routePath.includes('delete') ? 'delete' :
                              method === 'POST' && routePath.includes('agents') ? 'write' : 'read';
        }

        const fallbackMiddleware = requirePermission(fallbackResourceName, fallbackPermission);
        return fallbackMiddleware(req, res, next);
      }

      // Validate resourceInfo
      if (!resourceInfo || !resourceInfo.resourceName || !resourceInfo.requiredPermissions) {
        Logger.error('Invalid resource info received from auth server', {
          resourceInfo,
          method,
          path: routePath
        });
        
        return res.status(503).json({
          success: false,
          message: 'Invalid resource configuration',
          code: 'INVALID_RESOURCE_CONFIG'
        });
      }

      // Get the first required permission (most endpoints have one primary permission)
      const requiredPermission = resourceInfo.requiredPermissions[0] || 'read';
      const resourceName = resourceInfo.resourceName;

      Logger.debug('Resolved resource information', {
        method,
        path: routePath,
        resourceName,
        requiredPermission,
        userId: req.user.id
      });

      // Use the resolved resource with the determined permission
      const permissionMiddleware = requirePermission(resourceName, requiredPermission);
      return permissionMiddleware(req, res, next);

    } catch (error) {
      Logger.error('Resource permission middleware error', {
        error: error.message,
        userId: req.user?.id,
        endpoint: req.originalUrl
      });

      res.status(500).json({
        success: false,
        message: 'Resource permission check failed',
        code: 'RESOURCE_PERMISSION_ERROR'
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
  requireResourcePermission,
  databasePermissions
}; 