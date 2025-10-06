const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');
const { authenticateServiceToken } = require('../middleware/serviceAuthMiddleware');
const Logger = require('../utils/logger');
const connectorService = require('../services/connectorService');

// Lazy load rbacClient to avoid circular dependencies or initialization issues
const getRbacClient = () => {
  const { rbacClient } = require('../middleware/rbacClient');
  return rbacClient;
};

// Get cache statistics
router.get('/stats', authenticateToken, (req, res) => {
  try {
    const rbacClient = getRbacClient();
    const stats = rbacClient.getCacheStats();
    
    res.json({
      success: true,
      data: {
        ...stats,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    Logger.error('Failed to get cache stats', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve cache statistics'
    });
  }
});

// Clear all caches (admin only)
router.delete('/clear', authenticateToken, (req, res) => {
  try {
    // Check if user has admin role
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required to clear cache'
      });
    }

    const rbacClient = getRbacClient();
    rbacClient.clearAllCache();
    
    Logger.info('All RBAC caches cleared by admin', { 
      adminUserId: req.user.id,
      adminEmail: req.user.email 
    });

    res.json({
      success: true,
      message: 'All caches cleared successfully'
    });
  } catch (error) {
    Logger.error('Failed to clear cache', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to clear cache'
    });
  }
});

// Invalidate user permissions cache
router.delete('/permissions/user/:userId', authenticateToken, (req, res) => {
  try {
    const { userId } = req.params;
    const { subaccountId } = req.query;

    // Check if user has admin role or is invalidating their own cache
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient privileges to invalidate user permissions'
      });
    }

    const rbacClient = getRbacClient();
    rbacClient.invalidateUserPermissions(userId, subaccountId);
    
    Logger.info('User permissions cache invalidated', { 
      userId,
      subaccountId,
      requestedBy: req.user.id 
    });

    res.json({
      success: true,
      message: 'User permissions cache invalidated successfully'
    });
  } catch (error) {
    Logger.error('Failed to invalidate user permissions cache', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to invalidate user permissions cache'
    });
  }
});

// Invalidate resource cache
router.delete('/resources/:resourceName', authenticateToken, (req, res) => {
  try {
    const { resourceName } = req.params;

    // Check if user has admin role
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required to invalidate resource cache'
      });
    }

    const rbacClient = getRbacClient();
    rbacClient.invalidateResourceCache(resourceName);
    
    Logger.info('Resource cache invalidated', { 
      resourceName: resourceName || 'all',
      requestedBy: req.user.id 
    });

    res.json({
      success: true,
      message: resourceName ? 
        `Resource cache for ${resourceName} invalidated successfully` :
        'All resource caches invalidated successfully'
    });
  } catch (error) {
    Logger.error('Failed to invalidate resource cache', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to invalidate resource cache'
    });
  }
});

// Warm cache with common resources
router.post('/warm', authenticateToken, async (req, res) => {
  try {
    // Check if user has admin role
    if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required to warm cache'
      });
    }

    // Default common resources for database server
    const commonResources = req.body.resources || [
      { method: 'GET', path: '/:subaccountId/collections', service: 'database-server' },
      { method: 'POST', path: '/:subaccountId/collections/:collection/find', service: 'database-server' },
      { method: 'POST', path: '/:subaccountId/collections/:collection/insertOne', service: 'database-server' },
      { method: 'POST', path: '/:subaccountId/collections/:collection/updateOne', service: 'database-server' },
      { method: 'POST', path: '/:subaccountId/collections/:collection/deleteOne', service: 'database-server' }
    ];

    const rbacClient = getRbacClient();
    await rbacClient.warmCache(commonResources);
    
    Logger.info('RBAC cache warmed by admin', { 
      resourceCount: commonResources.length,
      requestedBy: req.user.id 
    });

    res.json({
      success: true,
      message: `Cache warmed with ${commonResources.length} resources`,
      data: { resourcesWarmed: commonResources.length }
    });
  } catch (error) {
    Logger.error('Failed to warm cache', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to warm cache'
    });
  }
});

// Webhook endpoint for cache invalidation from auth server
router.post('/invalidate', (req, res) => {
  try {
    const { type, userId, resourceName, subaccountId, secret } = req.body;

    // Verify webhook secret (should match between services)
    const expectedSecret = process.env.CACHE_WEBHOOK_SECRET || 'default-secret';
    if (secret !== expectedSecret) {
      Logger.security('Invalid cache invalidation webhook secret', 'high', {
        sourceIP: req.ip,
        userAgent: req.headers['user-agent']
      });
      
      return res.status(401).json({
        success: false,
        message: 'Invalid webhook secret'
      });
    }

    const rbacClient = getRbacClient();

    switch (type) {
      case 'user_permissions':
        if (userId) {
          rbacClient.invalidateUserPermissions(userId, subaccountId);
          Logger.info('User permissions invalidated via webhook', { userId, subaccountId });
        }
        break;
        
      case 'resource':
        rbacClient.invalidateResourceCache(resourceName);
        Logger.info('Resource cache invalidated via webhook', { resourceName });
        break;
        
      case 'clear_all':
        rbacClient.clearAllCache();
        Logger.info('All caches cleared via webhook');
        break;
        
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid invalidation type'
        });
    }

    res.json({
      success: true,
      message: 'Cache invalidation completed'
    });
  } catch (error) {
    Logger.error('Cache invalidation webhook failed', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Cache invalidation failed'
    });
  }
});

// Connector cache management endpoints (service-to-service authentication)

// Invalidate connector list cache (called when connectors are updated in tenant-manager)
router.delete('/connectors/list', authenticateServiceToken, async (req, res) => {
  try {
    await connectorService.invalidateConnectorListCache();
    
    Logger.info('Connector list cache invalidated', { 
      service: req.service.serviceName,
      requestId: req.requestId
    });

    res.json({
      success: true,
      message: 'Connector list cache invalidated successfully'
    });
  } catch (error) {
    Logger.error('Failed to invalidate connector list cache', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to invalidate connector list cache'
    });
  }
});

// Invalidate specific connector cache
router.delete('/connectors/:connectorId', authenticateServiceToken, async (req, res) => {
  try {
    const { connectorId } = req.params;
    await connectorService.invalidateConnectorCache(connectorId);
    
    Logger.info('Connector cache invalidated', { 
      connectorId,
      service: req.service.serviceName,
      requestId: req.requestId
    });

    res.json({
      success: true,
      message: 'Connector cache invalidated successfully'
    });
  } catch (error) {
    Logger.error('Failed to invalidate connector cache', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to invalidate connector cache'
    });
  }
});

// Invalidate subaccount connectors cache
router.delete('/connectors/subaccount/:subaccountId', authenticateServiceToken, async (req, res) => {
  try {
    const { subaccountId } = req.params;
    await connectorService.invalidateSubaccountConnectorsCache(subaccountId);
    
    Logger.info('Subaccount connectors cache invalidated', { 
      subaccountId,
      service: req.service.serviceName,
      requestId: req.requestId
    });

    res.json({
      success: true,
      message: 'Subaccount connectors cache invalidated successfully'
    });
  } catch (error) {
    Logger.error('Failed to invalidate subaccount connectors cache', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to invalidate subaccount connectors cache'
    });
  }
});

// Invalidate specific subaccount connector config cache
router.delete('/connectors/subaccount/:subaccountId/:connectorId', authenticateServiceToken, async (req, res) => {
  try {
    const { subaccountId, connectorId } = req.params;
    await connectorService.invalidateSubaccountConnectorConfigCache(subaccountId, connectorId);
    
    Logger.info('Subaccount connector config cache invalidated', { 
      subaccountId,
      connectorId,
      service: req.service.serviceName,
      requestId: req.requestId
    });

    res.json({
      success: true,
      message: 'Subaccount connector config cache invalidated successfully'
    });
  } catch (error) {
    Logger.error('Failed to invalidate subaccount connector config cache', { error: error.message });
    res.status(500).json({
      success: false,
      message: 'Failed to invalidate subaccount connector config cache'
    });
  }
});

module.exports = router; 