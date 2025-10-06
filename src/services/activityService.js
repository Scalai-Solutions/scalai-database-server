const Logger = require('../utils/logger');
const connectionPoolManager = require('./connectionPoolManager');

/**
 * Activity types enum
 */
const ACTIVITY_TYPES = {
  // Agent activities
  AGENT_CREATED: 'agent_created',
  AGENT_DELETED: 'agent_deleted',
  AGENT_UPDATED: 'agent_updated',
  
  // Chat Agent activities
  CHAT_AGENT_CREATED: 'chat_agent_created',
  CHAT_AGENT_ACTIVATED: 'chat_agent_activated',
  CHAT_AGENT_DEACTIVATED: 'chat_agent_deactivated',
  CHAT_AGENT_UPDATED: 'chat_agent_updated',
  
  // Call activities
  WEB_CALL_CREATED: 'web_call_created',
  CALL_UPDATED: 'call_updated',
  
  // Chat activities
  CHAT_CREATED: 'chat_created',
  CHAT_MESSAGE_SENT: 'chat_message_sent',
  CHAT_ENDED: 'chat_ended',
  
  // Connector activities
  CONNECTOR_ADDED: 'connector_added',
  CONNECTOR_UPDATED: 'connector_updated',
  CONNECTOR_DELETED: 'connector_deleted',
  CONNECTOR_GOOGLE_CALENDAR_CONNECTED: 'connector_google_calendar_connected',
  CONNECTOR_METADATA_UPDATED: 'connector_metadata_updated'
};

/**
 * Activity categories
 */
const ACTIVITY_CATEGORIES = {
  AGENT: 'agent',
  CHAT_AGENT: 'chat_agent',
  CALL: 'call',
  CHAT: 'chat',
  CONNECTOR: 'connector'
};

class ActivityService {
  /**
   * Ensure TTL index exists on activities collection
   * This automatically deletes activities older than 60 days (2 months)
   * @param {Object} activitiesCollection - MongoDB collection
   */
  static async ensureTTLIndex(activitiesCollection) {
    try {
      // Check if index already exists
      const indexes = await activitiesCollection.indexes();
      const ttlIndexExists = indexes.some(index => 
        index.key && index.key.createdAt && index.expireAfterSeconds
      );
      
      if (!ttlIndexExists) {
        // Create TTL index - documents will be automatically deleted after 60 days (5184000 seconds)
        await activitiesCollection.createIndex(
          { createdAt: 1 },
          { expireAfterSeconds: 5184000 } // 60 days = 60 * 24 * 60 * 60 = 5184000 seconds
        );
        
        Logger.info('TTL index created on activities collection', {
          expireAfterSeconds: 5184000,
          expireAfterDays: 60
        });
      }
    } catch (error) {
      Logger.warn('Failed to create TTL index on activities collection', {
        error: error.message
      });
    }
  }

  /**
   * Log an activity
   * @param {Object} params - Activity parameters
   * @param {string} params.subaccountId - Subaccount ID
   * @param {string} params.activityType - Type of activity (from ACTIVITY_TYPES)
   * @param {string} params.category - Category of activity (from ACTIVITY_CATEGORIES)
   * @param {string} params.userId - User ID who performed the action
   * @param {string} params.description - Human-readable description
   * @param {Object} params.metadata - Additional metadata
   * @param {string} params.resourceId - ID of the resource affected (optional)
   * @param {string} params.resourceName - Name of the resource affected (optional)
   * @param {string} params.operationId - Operation ID for tracking (optional)
   */
  static async logActivity({
    subaccountId,
    activityType,
    category,
    userId,
    description,
    metadata = {},
    resourceId = null,
    resourceName = null,
    operationId = null
  }) {
    try {
      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId || 'system');
      const { connection } = connectionInfo;
      
      const activitiesCollection = connection.db.collection('activities');
      
      // Ensure TTL index exists (only runs once per collection)
      await ActivityService.ensureTTLIndex(activitiesCollection);
      
      // Create activity document
      const activityDocument = {
        subaccountId,
        activityType,
        category,
        userId,
        description,
        metadata,
        resourceId,
        resourceName,
        operationId,
        timestamp: new Date(),
        createdAt: new Date()
      };
      
      // Insert activity
      await activitiesCollection.insertOne(activityDocument);
      
      Logger.debug('Activity logged', {
        subaccountId,
        activityType,
        category,
        userId,
        operationId
      });
      
      return { success: true };
    } catch (error) {
      Logger.error('Failed to log activity', {
        error: error.message,
        stack: error.stack,
        subaccountId,
        activityType
      });
      
      // Don't throw error - activity logging should not break the main flow
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Get activities for a subaccount within a time range
   * @param {string} subaccountId - Subaccount ID
   * @param {string} userId - User ID making the request
   * @param {Object} options - Query options
   * @param {Date} options.startDate - Start date
   * @param {Date} options.endDate - End date
   * @param {string} options.category - Filter by category (optional)
   * @param {string} options.activityType - Filter by activity type (optional)
   * @param {number} options.limit - Limit number of results (default: 100)
   * @param {number} options.skip - Skip number of results (default: 0)
   * @returns {Promise<Object>} Activities and metadata
   */
  static async getActivities(subaccountId, userId, options = {}) {
    try {
      const {
        startDate,
        endDate,
        category,
        activityType,
        limit = 100,
        skip = 0
      } = options;
      
      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      
      const activitiesCollection = connection.db.collection('activities');
      
      // Build query
      const query = {
        subaccountId
      };
      
      // Add date filter
      if (startDate || endDate) {
        query.timestamp = {};
        if (startDate) {
          query.timestamp.$gte = startDate;
        }
        if (endDate) {
          query.timestamp.$lte = endDate;
        }
      }
      
      // Add category filter
      if (category) {
        query.category = category;
      }
      
      // Add activity type filter
      if (activityType) {
        query.activityType = activityType;
      }
      
      // Get total count
      const totalCount = await activitiesCollection.countDocuments(query);
      
      // Get activities
      const activities = await activitiesCollection
        .find(query)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
      
      Logger.info('Activities retrieved', {
        subaccountId,
        count: activities.length,
        totalCount,
        filters: { category, activityType, startDate, endDate }
      });
      
      return {
        success: true,
        data: {
          activities,
          total: totalCount,
          count: activities.length,
          limit,
          skip
        }
      };
    } catch (error) {
      Logger.error('Failed to get activities', {
        error: error.message,
        stack: error.stack,
        subaccountId
      });
      
      throw error;
    }
  }
  
  /**
   * Get activity statistics for a subaccount
   * @param {string} subaccountId - Subaccount ID
   * @param {string} userId - User ID making the request
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Object>} Activity statistics
   */
  static async getActivityStats(subaccountId, userId, startDate, endDate) {
    try {
      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      
      const activitiesCollection = connection.db.collection('activities');
      
      // Build query
      const query = {
        subaccountId,
        timestamp: {
          $gte: startDate,
          $lte: endDate
        }
      };
      
      // Get statistics by category
      const categoryStats = await activitiesCollection.aggregate([
        { $match: query },
        { $group: {
          _id: '$category',
          count: { $sum: 1 }
        }},
        { $sort: { count: -1 } }
      ]).toArray();
      
      // Get statistics by activity type
      const typeStats = await activitiesCollection.aggregate([
        { $match: query },
        { $group: {
          _id: '$activityType',
          count: { $sum: 1 }
        }},
        { $sort: { count: -1 } }
      ]).toArray();
      
      // Get total count
      const totalCount = await activitiesCollection.countDocuments(query);
      
      Logger.info('Activity statistics retrieved', {
        subaccountId,
        totalCount,
        categoriesCount: categoryStats.length,
        typesCount: typeStats.length
      });
      
      return {
        success: true,
        data: {
          total: totalCount,
          byCategory: categoryStats,
          byType: typeStats
        }
      };
    } catch (error) {
      Logger.error('Failed to get activity statistics', {
        error: error.message,
        stack: error.stack,
        subaccountId
      });
      
      throw error;
    }
  }
}

// Export class and constants
module.exports = ActivityService;
module.exports.ACTIVITY_TYPES = ACTIVITY_TYPES;
module.exports.ACTIVITY_CATEGORIES = ACTIVITY_CATEGORIES;
