const connectionPoolManager = require('../services/connectionPoolManager');
const connectorService = require('../services/connectorService');
const Logger = require('../utils/logger');
const ActivityService = require('../services/activityService');
const { ACTIVITY_TYPES, ACTIVITY_CATEGORIES } = ActivityService;

class ConnectorController {
  /**
   * Get list of available connectors
   */
  async getAvailableConnectors(req, res) {
    try {
      Logger.info('Getting available connectors', {
        requestId: req.requestId,
        userId: req.user?.id
      });

      // Extract access token from Authorization header
      const authHeader = req.headers['authorization'];
      const accessToken = authHeader && authHeader.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : null;

      // Try to get from cache first
      const cached = await connectorService.getCachedConnectorList();
      if (cached) {
        Logger.debug('Returning cached connector list');
        return res.status(200).json({
          success: true,
          message: 'Connectors retrieved successfully',
          data: cached,
          cached: true
        });
      }

      // Fetch from tenant manager with access token
      const result = await connectorService.getAvailableConnectors(accessToken);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: result.error,
          code: 'CONNECTOR_FETCH_FAILED'
        });
      }

      // Cache the result
      await connectorService.cacheConnectorList(result.data);

      return res.status(200).json({
        success: true,
        message: 'Connectors retrieved successfully',
        data: result.data,
        cached: false
      });

    } catch (error) {
      Logger.error('Failed to get available connectors', {
        error: error.message,
        stack: error.stack
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to get available connectors',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Add a connector to a subaccount
   */
  async addConnectorToSubaccount(req, res) {
    try {
      const { subaccountId } = req.params;
      const { connectorId, config: connectorConfig, isActive } = req.body;

      Logger.info('Adding connector to subaccount', {
        subaccountId,
        connectorId,
        requestId: req.requestId
      });

      // Extract access token from Authorization header
      const authHeader = req.headers['authorization'];
      const accessToken = authHeader && authHeader.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : null;

      // Verify connector exists
      const connectorResult = await connectorService.getConnectorById(connectorId, accessToken);
      if (!connectorResult.success) {
        return res.status(404).json({
          success: false,
          message: 'Connector not found',
          code: 'CONNECTOR_NOT_FOUND'
        });
      }

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
      
      const {connection} = connectionInfo

      // Check if connector already exists for this subaccount
      const existingConnector = await connection.db.collection('connectorsubaccount').findOne({
        subaccountId,
        connectorId
      });

      if (existingConnector) {
        return res.status(409).json({
          success: false,
          message: 'Connector already added to this subaccount',
          code: 'CONNECTOR_ALREADY_EXISTS'
        });
      }

      // Create connector-subaccount relationship
      const connectorSubaccount = {
        subaccountId,
        connectorId,
        connectorType: connectorResult.data.category,
        config: connectorConfig || {},
        isActive: isActive !== undefined ? isActive : true,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {}
      };

      const result = await connection.db.collection('connectorsubaccount').insertOne(connectorSubaccount);

      // Invalidate cache
      await connectorService.invalidateSubaccountConnectorsCache(subaccountId);

      // Return the created connector relationship with connector details
      const createdConnector = {
        ...connectorSubaccount,
        _id: result.insertedId,
        connector: connectorResult.data.connector
      };

      Logger.info('Connector added to subaccount successfully', {
        subaccountId,
        connectorId,
        id: result.insertedId
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CONNECTOR_ADDED,
        category: ACTIVITY_CATEGORIES.CONNECTOR,
        userId: req.user?.id || 'system',
        description: `Connector ${connectorResult.data.connector?.name || connectorId} added to subaccount`,
        metadata: {
          connectorId,
          connectorName: connectorResult.data.connector?.name,
          connectorType: connectorResult.data.category,
          isActive: connectorSubaccount.isActive
        },
        resourceId: connectorId,
        resourceName: connectorResult.data.connector?.name || connectorId,
        operationId: req.requestId
      });

      return res.status(201).json({
        success: true,
        message: 'Connector added successfully',
        data: {
          connector: createdConnector
        }
      });

    } catch (error) {
      Logger.error('Failed to add connector to subaccount', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to add connector',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Get all connectors for a subaccount
   */
  async getSubaccountConnectors(req, res) {
    try {
      const { subaccountId } = req.params;

      Logger.info('Getting connectors for subaccount', {
        subaccountId,
        requestId: req.requestId
      });

      // Try to get from cache first
      const cached = await connectorService.getCachedSubaccountConnectors(subaccountId);
      if (cached) {
        Logger.debug('Returning cached subaccount connectors');
        return res.status(200).json({
          success: true,
          message: 'Connectors retrieved successfully',
          data: cached,
          cached: true
        });
      }

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
      // if (!dbConnection || !dbConnection.client) {
      //   Logger.error('Failed to get database connection', { subaccountId });
      //   return res.status(500).json({
      //     success: false,
      //     message: 'Database connection not available for this subaccount',
      //     code: 'DB_CONNECTION_FAILED'
      //   });
      // }
      
      // const db = dbConnection.client.db();

      const { connection } = connectionInfo;

      // Get all connectors for this subaccount
      const connectors = await connection.db.collection('connectorsubaccount')
        .find({ subaccountId })
        .toArray();

      // Extract access token from Authorization header
      const authHeader = req.headers['authorization'];
      const accessToken = authHeader && authHeader.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : null;

      // Fetch connector details for each
      const connectorsWithDetails = await Promise.all(
        connectors.map(async (conn) => {
          const connectorResult = await connectorService.getConnectorById(conn.connectorId, accessToken);
          return {
            ...conn,
            connector: connectorResult.success ? connectorResult.data.connector : null
          };
        })
      );

      const responseData = {
        connectors: connectorsWithDetails,
        total: connectorsWithDetails.length
      };

      // Cache the result
      await connectorService.cacheSubaccountConnectors(subaccountId, responseData);

      return res.status(200).json({
        success: true,
        message: 'Connectors retrieved successfully',
        data: responseData,
        cached: false
      });

    } catch (error) {
      Logger.error('Failed to get subaccount connectors', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to get connectors',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Update connector configuration for a subaccount
   */
  async updateConnectorConfig(req, res) {
    try {
      const { subaccountId, connectorId } = req.params;
      const { config: connectorConfig, isActive } = req.body;

      Logger.info('Updating connector config for subaccount', {
        subaccountId,
        connectorId,
        requestId: req.requestId
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
      
      const {connection} = connectionInfo

      // Check if connector exists for this subaccount
      const existingConnector = await connection.db.collection('connectorsubaccount').findOne({
        subaccountId,
        connectorId
      });

      if (!existingConnector) {
        return res.status(404).json({
          success: false,
          message: 'Connector not found for this subaccount',
          code: 'CONNECTOR_NOT_FOUND'
        });
      }

      // Update the connector config
      const updateData = {
        config: connectorConfig,
        updatedAt: new Date()
      };

      if (isActive !== undefined) {
        updateData.isActive = isActive;
      }

      const result = await connection.db.collection('connectorsubaccount').updateOne(
        { subaccountId, connectorId },
        { $set: updateData }
      );

      // Invalidate caches
      await connectorService.invalidateSubaccountConnectorsCache(subaccountId);
      await connectorService.invalidateSubaccountConnectorConfigCache(subaccountId, connectorId);

      // Extract access token from Authorization header
      const authHeader = req.headers['authorization'];
      const accessToken = authHeader && authHeader.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : null;

      // Get updated connector with details
      const updatedConnector = await connection.db.collection('connectorsubaccount').findOne({
        subaccountId,
        connectorId
      });

      const connectorResult = await connectorService.getConnectorById(connectorId, accessToken);
      const connectorWithDetails = {
        ...updatedConnector,
        connector: connectorResult.success ? connectorResult.data.connector : null
      };

      Logger.info('Connector config updated successfully', {
        subaccountId,
        connectorId
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CONNECTOR_UPDATED,
        category: ACTIVITY_CATEGORIES.CONNECTOR,
        userId: req.user?.id || 'system',
        description: `Connector ${connectorResult.data.connector?.name || connectorId} configuration updated`,
        metadata: {
          connectorId,
          connectorName: connectorResult.data.connector?.name,
          isActive: updatedConnector.isActive,
          updatedFields: Object.keys(updateData)
        },
        resourceId: connectorId,
        resourceName: connectorResult.data.connector?.name || connectorId,
        operationId: req.requestId
      });

      return res.status(200).json({
        success: true,
        message: 'Connector configuration updated successfully',
        data: {
          connector: connectorWithDetails
        }
      });

    } catch (error) {
      Logger.error('Failed to update connector config', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId,
        connectorId: req.params.connectorId
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to update connector configuration',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Delete a connector from a subaccount
   */
  async deleteConnectorFromSubaccount(req, res) {
    try {
      const { subaccountId, connectorId } = req.params;

      Logger.info('Deleting connector from subaccount', {
        subaccountId,
        connectorId,
        requestId: req.requestId
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
      
      const {connection} = connectionInfo

      // Check if connector exists for this subaccount
      const existingConnector = await connection.db.collection('connectorsubaccount').findOne({
        subaccountId,
        connectorId
      });

      if (!existingConnector) {
        return res.status(404).json({
          success: false,
          message: 'Connector not found for this subaccount',
          code: 'CONNECTOR_NOT_FOUND'
        });
      }

      // Delete the connector
      await connection.db.collection('connectorsubaccount').deleteOne({
        subaccountId,
        connectorId
      });

      // Invalidate caches
      await connectorService.invalidateSubaccountConnectorsCache(subaccountId);
      await connectorService.invalidateSubaccountConnectorConfigCache(subaccountId, connectorId);

      Logger.info('Connector deleted from subaccount successfully', {
        subaccountId,
        connectorId
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CONNECTOR_DELETED,
        category: ACTIVITY_CATEGORIES.CONNECTOR,
        userId: req.user?.id || 'system',
        description: `Connector ${connectorId} removed from subaccount`,
        metadata: {
          connectorId,
          deletedConnectorType: existingConnector.connectorType
        },
        resourceId: connectorId,
        resourceName: connectorId,
        operationId: req.requestId
      });

      return res.status(200).json({
        success: true,
        message: 'Connector deleted successfully',
        data: {
          deletedConnectorId: connectorId
        }
      });

    } catch (error) {
      Logger.error('Failed to delete connector from subaccount', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId,
        connectorId: req.params.connectorId
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to delete connector',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Get a specific connector for a subaccount
   */
  async getSubaccountConnector(req, res) {
    try {
      const { subaccountId, connectorId } = req.params;

      Logger.info('Getting connector for subaccount', {
        subaccountId,
        connectorId,
        requestId: req.requestId
      });

      // Try to get from cache first
      const cached = await connectorService.getCachedSubaccountConnectorConfig(subaccountId, connectorId);
      if (cached) {
        Logger.debug('Returning cached subaccount connector');
        return res.status(200).json({
          success: true,
          message: 'Connector retrieved successfully',
          data: cached,
          cached: true
        });
      }

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId);

      const {connection} = connectionInfo

      // Get connector for this subaccount
      const connector = await connection.db.collection('connectorsubaccount').findOne({
        subaccountId,
        connectorId
      });

      if (!connector) {
        return res.status(404).json({
          success: false,
          message: 'Connector not found for this subaccount',
          code: 'CONNECTOR_NOT_FOUND'
        });
      }

      // Extract access token from Authorization header
      const authHeader = req.headers['authorization'];
      const accessToken = authHeader && authHeader.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : null;

      // Fetch connector details
      const connectorResult = await connectorService.getConnectorById(connectorId, accessToken);
      const connectorWithDetails = {
        ...connector,
        connector: connectorResult.success ? connectorResult.data.connector : null
      };

      const responseData = {
        connector: connectorWithDetails
      };

      // Cache the result
      await connectorService.cacheSubaccountConnectorConfig(subaccountId, connectorId, responseData);

      return res.status(200).json({
        success: true,
        message: 'Connector retrieved successfully',
        data: responseData,
        cached: false
      });

    } catch (error) {
      Logger.error('Failed to get subaccount connector', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId,
        connectorId: req.params.connectorId
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to get connector',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Handle Google Calendar connection - Proxy to webhook server
   */
  async handleGoogleCalendarConnect(req, res) {
    try {
      const { subaccountId } = req.params;
      const { userEmail } = req.body;

      if (!userEmail) {
        return res.status(400).json({
          success: false,
          message: 'userEmail is required',
          code: 'VALIDATION_ERROR'
        });
      }

      Logger.info('Initiating Google Calendar connection', {
        subaccountId,
        userEmail,
        requestId: req.requestId
      });

      // Proxy to webhook server
      const result = await connectorService.initiateGoogleCalendarOAuth(subaccountId, userEmail);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          message: result.error || 'Failed to initiate Google Calendar connection',
          code: 'GOOGLE_CALENDAR_CONNECT_FAILED'
        });
      }

      Logger.info('Google Calendar OAuth initiated successfully', {
        subaccountId,
        userEmail,
        authUrl: result.data.authUrl
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CONNECTOR_GOOGLE_CALENDAR_CONNECTED,
        category: ACTIVITY_CATEGORIES.CONNECTOR,
        userId: req.user?.id || 'system',
        description: `Google Calendar connection initiated for ${userEmail}`,
        metadata: {
          userEmail,
          emailSent: result.data.emailSent
        },
        resourceId: 'google-calendar',
        resourceName: 'Google Calendar',
        operationId: req.requestId
      });

      return res.status(200).json({
        success: true,
        message: result.data.message || 'Google Calendar authorization initiated',
        data: {
          authUrl: result.data.authUrl,
          userEmail: result.data.userEmail,
          subaccountId: result.data.subaccountId,
          emailSent: result.data.emailSent
        }
      });

    } catch (error) {
      Logger.error('Failed to handle Google Calendar connection', {
        error: error.message,
        stack: error.stack
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to initiate Google Calendar connection',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Update connector metadata (called by webhook server after successful OAuth)
   */
  async updateConnectorMetadata(req, res) {
    try {
      const { subaccountId } = req.params;
      const { connectorId, metadata } = req.body;

      if (!connectorId || !metadata) {
        return res.status(400).json({
          success: false,
          message: 'connectorId and metadata are required',
          code: 'VALIDATION_ERROR'
        });
      }

      Logger.info('Updating connector metadata', {
        subaccountId,
        connectorId,
        requestId: req.requestId,
        service: req.service?.serviceName
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
      const { connection } = connectionInfo;

      // Check if connector exists for this subaccount
      const existingConnector = await connection.db.collection('connectorsubaccount').findOne({
        subaccountId,
        connectorId
      });

      if (!existingConnector) {
        return res.status(404).json({
          success: false,
          message: 'Connector not found for this subaccount',
          code: 'CONNECTOR_NOT_FOUND'
        });
      }

      // Update the connector metadata
      const updateData = {
        metadata: {
          ...(existingConnector.metadata || {}),
          ...metadata
        },
        updatedAt: new Date()
      };

      await connection.db.collection('connectorsubaccount').updateOne(
        { subaccountId, connectorId },
        { $set: updateData }
      );

      // Invalidate caches
      await connectorService.invalidateSubaccountConnectorsCache(subaccountId);
      await connectorService.invalidateSubaccountConnectorConfigCache(subaccountId, connectorId);

      Logger.info('Connector metadata updated successfully', {
        subaccountId,
        connectorId
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CONNECTOR_METADATA_UPDATED,
        category: ACTIVITY_CATEGORIES.CONNECTOR,
        userId: req.service?.serviceName || 'system',
        description: `Connector ${connectorId} metadata updated`,
        metadata: {
          connectorId,
          metadataKeys: Object.keys(metadata),
          serviceName: req.service?.serviceName
        },
        resourceId: connectorId,
        resourceName: connectorId,
        operationId: req.requestId
      });

      return res.status(200).json({
        success: true,
        message: 'Connector metadata updated successfully',
        data: {
          subaccountId,
          connectorId,
          metadata: updateData.metadata
        }
      });

    } catch (error) {
      Logger.error('Failed to update connector metadata', {
        error: error.message,
        stack: error.stack,
        body: req.body
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to update connector metadata',
        code: 'INTERNAL_ERROR'
      });
    }
  }
}

// Export singleton instance
module.exports = new ConnectorController();

