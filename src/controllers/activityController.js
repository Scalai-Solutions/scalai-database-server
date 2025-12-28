const Logger = require('../utils/logger');
const ActivityService = require('../services/activityService');
const { v4: uuidv4 } = require('uuid');

class ActivityController {
  /**
   * Get activities for last 24 hours (or custom time range)
   * GET /api/activities/:subaccountId
   */
  static async getActivities(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();
    
    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;
      
      // Get query parameters
      const {
        hours = 24,
        category,
        activityType,
        limit = 100,
        skip = 0,
        startDate: startDateParam,
        endDate: endDateParam
      } = req.query;
      
      Logger.info('Getting activities', {
        operationId,
        subaccountId,
        userId,
        hours,
        category,
        activityType,
        limit,
        skip
      });
      
      // Calculate date range
      let startDate, endDate;
      
      if (startDateParam && endDateParam) {
        // Use custom date range if provided
        startDate = new Date(startDateParam);
        endDate = new Date(endDateParam);
        
        // Validate dates
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid date format. Use ISO 8601 format.',
            code: 'INVALID_DATE_FORMAT'
          });
        }
      } else {
        // Default to last N hours
        endDate = new Date();
        startDate = new Date(endDate.getTime() - (hours * 60 * 60 * 1000));
      }
      
      // Validate limit
      const parsedLimit = Math.min(parseInt(limit) || 100, 500); // Max 500
      const parsedSkip = Math.max(parseInt(skip) || 0, 0);
      
      // Get activities
      const result = await ActivityService.getActivities(subaccountId, userId, {
        startDate,
        endDate,
        category,
        activityType,
        limit: parsedLimit,
        skip: parsedSkip
      });
      
      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: 'Failed to retrieve activities',
          code: 'ACTIVITY_RETRIEVAL_FAILED'
        });
      }
      
      const duration = Date.now() - startTime;
      
      Logger.info('Activities retrieved successfully', {
        operationId,
        subaccountId,
        count: result.data.activities.length,
        total: result.data.total,
        duration: `${duration}ms`
      });
      
      res.json({
        success: true,
        message: 'Activities retrieved successfully',
        data: {
          activities: result.data.activities,
          pagination: {
            total: result.data.total,
            count: result.data.count,
            limit: result.data.limit,
            skip: result.data.skip,
            hasMore: (result.data.skip + result.data.count) < result.data.total
          },
          filters: {
            startDate,
            endDate,
            category: category || null,
            activityType: activityType || null,
            hoursRange: hours
          }
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });
      
    } catch (error) {
      const errorInfo = await ActivityController.handleError(error, req, operationId, 'getActivities', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }
  
  /**
   * Get activity statistics
   * GET /api/activities/:subaccountId/stats
   */
  static async getActivityStats(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();
    
    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;
      
      // Get query parameters
      const {
        hours = 24,
        startDate: startDateParam,
        endDate: endDateParam
      } = req.query;
      
      Logger.info('Getting activity statistics', {
        operationId,
        subaccountId,
        userId,
        hours
      });
      
      // Calculate date range
      let startDate, endDate;
      
      if (startDateParam && endDateParam) {
        startDate = new Date(startDateParam);
        endDate = new Date(endDateParam);
        
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid date format. Use ISO 8601 format.',
            code: 'INVALID_DATE_FORMAT'
          });
        }
      } else {
        endDate = new Date();
        startDate = new Date(endDate.getTime() - (hours * 60 * 60 * 1000));
      }
      
      // Get statistics
      const result = await ActivityService.getActivityStats(subaccountId, userId, startDate, endDate);
      
      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: 'Failed to retrieve activity statistics',
          code: 'STATS_RETRIEVAL_FAILED'
        });
      }
      
      const duration = Date.now() - startTime;
      
      Logger.info('Activity statistics retrieved successfully', {
        operationId,
        subaccountId,
        total: result.data.total,
        duration: `${duration}ms`
      });
      
      res.json({
        success: true,
        message: 'Activity statistics retrieved successfully',
        data: {
          total: result.data.total,
          byCategory: result.data.byCategory,
          byType: result.data.byType,
          timeRange: {
            startDate,
            endDate,
            hours: (endDate - startDate) / (60 * 60 * 1000)
          }
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });
      
    } catch (error) {
      const errorInfo = await ActivityController.handleError(error, req, operationId, 'getActivityStats', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }
  
  /**
   * Log activity (service-to-service endpoint)
   * POST /api/activities/:subaccountId/log
   */
  static async logActivity(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();
    
    try {
      const { subaccountId } = req.params;
      const {
        activityType,
        category,
        userId,
        description,
        metadata = {},
        resourceId = null,
        resourceName = null,
        agentId = null
      } = req.body;
      
      // Validate required fields
      if (!activityType || !category || !description) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: activityType, category, description',
          code: 'MISSING_REQUIRED_FIELDS'
        });
      }
      
      Logger.info('Logging activity via service endpoint', {
        operationId,
        subaccountId,
        activityType,
        category,
        serviceName: req.service?.serviceName || 'unknown'
      });
      
      // Log the activity
      const result = await ActivityService.logActivity({
        subaccountId,
        activityType,
        category,
        userId: userId || req.service?.serviceName || 'system',
        description,
        metadata,
        resourceId,
        resourceName,
        operationId,
        agentId
      });
      
      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: 'Failed to log activity',
          code: 'ACTIVITY_LOG_FAILED',
          error: result.error
        });
      }
      
      const duration = Date.now() - startTime;
      
      Logger.info('Activity logged successfully via service', {
        operationId,
        subaccountId,
        activityType,
        duration: `${duration}ms`
      });
      
      res.json({
        success: true,
        message: 'Activity logged successfully',
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });
      
    } catch (error) {
      const errorInfo = await ActivityController.handleError(error, req, operationId, 'logActivity', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }
  
  /**
   * Error handling
   */
  static async handleError(error, req, operationId, operation, startTime) {
    const duration = Date.now() - startTime;
    
    Logger.error(`Activity operation failed: ${operation}`, {
      operationId,
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      subaccountId: req.params?.subaccountId,
      duration: `${duration}ms`
    });
    
    let statusCode = 500;
    let errorCode = 'ACTIVITY_ERROR';
    let message = 'An internal error occurred while processing activity request';
    
    if (error.message.includes('Failed to create connection pool')) {
      statusCode = 503;
      errorCode = 'CONNECTION_FAILED';
      message = 'Unable to connect to the database.';
    } else if (error.message.includes('not authorized')) {
      statusCode = 403;
      errorCode = 'UNAUTHORIZED';
      message = 'You are not authorized to access these activities.';
    }
    
    return {
      statusCode,
      response: {
        success: false,
        message,
        code: errorCode,
        meta: {
          operationId,
          operation,
          duration: `${duration}ms`
        }
      }
    };
  }
}

module.exports = ActivityController;
