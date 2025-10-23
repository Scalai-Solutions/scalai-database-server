const connectionPoolManager = require('../services/connectionPoolManager');
const connectorService = require('../services/connectorService');
const twilioService = require('../services/twilioService');
const Logger = require('../utils/logger');
const ActivityService = require('../services/activityService');
const { ACTIVITY_TYPES, ACTIVITY_CATEGORIES } = ActivityService;

/**
 * Helper function to mask sensitive Twilio credentials before sending to frontend
 */
function sanitizeTwilioConfig(config, connectorType) {
  if (connectorType !== 'twilio' || !config) return config;
  
  const sanitized = { ...config };
  
  // Mask credential values
  if (sanitized.SID) sanitized.SID = '********';
  if (sanitized.accountSid) sanitized.accountSid = '********';
  if (sanitized.AuthToken) sanitized.AuthToken = '********';
  if (sanitized.authToken) sanitized.authToken = '********';
  
  // Remove encryption metadata from response
  delete sanitized.sidIV;
  delete sanitized.sidAuthTag;
  delete sanitized.tokenIV;
  delete sanitized.tokenAuthTag;
  
  return sanitized;
}

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

      // Encrypt Twilio credentials if this is a Twilio connector
      let finalConfig = connectorConfig || {};
      
      Logger.debug('Checking if Twilio encryption needed for new connector', { 
        connectorType: connectorResult.data.type, 
        hasConfig: !!connectorConfig,
        hasSID: !!(connectorConfig && connectorConfig.SID),
        hasAuthToken: !!(connectorConfig && connectorConfig.AuthToken)
      });
      
      if (connectorResult.data.type === 'twilio' && connectorConfig) {
        // Check if credentials are provided (supporting both naming conventions)
        const sid = connectorConfig.SID || connectorConfig.accountSid;
        const authToken = connectorConfig.AuthToken || connectorConfig.authToken;
        
        if (sid || authToken) {
          Logger.info('Encrypting Twilio credentials before storage', { 
            subaccountId, 
            connectorId,
            hasSID: !!sid,
            hasAuthToken: !!authToken
          });
          
          finalConfig = { ...connectorConfig };
          
          // Encrypt SID if provided
          if (sid) {
            const encryptedSid = twilioService.encryptCredential(sid);
            finalConfig.SID = encryptedSid.encrypted;
            finalConfig.sidIV = encryptedSid.iv;
            finalConfig.sidAuthTag = encryptedSid.authTag;
            // Remove old field names if they exist
            delete finalConfig.accountSid;
            Logger.debug('SID encrypted', { subaccountId });
          }
          
          // Encrypt AuthToken if provided
          if (authToken) {
            const encryptedToken = twilioService.encryptCredential(authToken);
            finalConfig.AuthToken = encryptedToken.encrypted;
            finalConfig.tokenIV = encryptedToken.iv;
            finalConfig.tokenAuthTag = encryptedToken.authTag;
            // Remove old field names if they exist
            delete finalConfig.authToken;
            Logger.debug('AuthToken encrypted', { subaccountId });
          }
          
          Logger.info('Twilio credentials encrypted successfully', { subaccountId });
        }
      }

      // Create connector-subaccount relationship
      const connectorSubaccount = {
        subaccountId,
        connectorId,
        connectorType: connectorResult.data.type,
        connectorCategory: connectorResult.data.category,
        config: finalConfig,
        isActive: isActive !== undefined ? isActive : true,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {}
      };

      const result = await connection.db.collection('connectorsubaccount').insertOne(connectorSubaccount);

      // Invalidate cache
      await connectorService.invalidateSubaccountConnectorsCache(subaccountId);
      
      // Invalidate Twilio cache if this is a Twilio connector
      if (connectorResult.data.type === 'twilio') {
        await twilioService.invalidateCache(subaccountId);
      }

      // Return the created connector relationship with connector details
      const createdConnector = {
        ...connectorSubaccount,
        config: sanitizeTwilioConfig(connectorSubaccount.config, connectorResult.data.type),
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

      // Fetch connector details for each and sanitize credentials
      const connectorsWithDetails = await Promise.all(
        connectors.map(async (conn) => {
          const connectorResult = await connectorService.getConnectorById(conn.connectorId, accessToken);
          return {
            ...conn,
            config: sanitizeTwilioConfig(conn.config, conn.connectorType),
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

      // Encrypt Twilio credentials if this is a Twilio connector and credentials are being updated
      let finalConfig = connectorConfig;
      
      Logger.debug('Checking if Twilio encryption needed', { 
        connectorType: existingConnector.connectorType, 
        hasConfig: !!connectorConfig,
        configKeys: connectorConfig ? Object.keys(connectorConfig) : [],
        hasSID: !!(connectorConfig && connectorConfig.SID),
        hasAuthToken: !!(connectorConfig && connectorConfig.AuthToken)
      });
      
      if (existingConnector.connectorType === 'twilio' && connectorConfig) {
        // Check if credentials are provided and need encryption (supporting both naming conventions)
        const sid = connectorConfig.SID || connectorConfig.accountSid;
        const authToken = connectorConfig.AuthToken || connectorConfig.authToken;
        
        if (sid || authToken) {
          Logger.info('Encrypting Twilio credentials before update', { 
            subaccountId, 
            connectorId,
            hasSID: !!sid,
            hasAuthToken: !!authToken
          });
          
          // Start with existing config to preserve fields not being updated
          finalConfig = { ...existingConnector.config };
          
          // Merge in the new config (non-credential fields)
          Object.keys(connectorConfig).forEach(key => {
            if (!['SID', 'accountSid', 'AuthToken', 'authToken', 'sidIV', 'sidAuthTag', 'tokenIV', 'tokenAuthTag'].includes(key)) {
              finalConfig[key] = connectorConfig[key];
            }
          });
          
          // Encrypt SID if provided (partial update support)
          if (sid) {
            const encryptedSid = twilioService.encryptCredential(sid);
            finalConfig.SID = encryptedSid.encrypted;
            finalConfig.sidIV = encryptedSid.iv;
            finalConfig.sidAuthTag = encryptedSid.authTag;
            // Remove old field names if they exist
            delete finalConfig.accountSid;
            Logger.debug('SID encrypted', { subaccountId });
          }
          
          // Encrypt AuthToken if provided (partial update support)
          if (authToken) {
            const encryptedToken = twilioService.encryptCredential(authToken);
            finalConfig.AuthToken = encryptedToken.encrypted;
            finalConfig.tokenIV = encryptedToken.iv;
            finalConfig.tokenAuthTag = encryptedToken.authTag;
            // Remove old field names if they exist
            delete finalConfig.authToken;
            Logger.debug('AuthToken encrypted', { subaccountId });
          }
          
          Logger.info('Twilio credentials encrypted successfully', { subaccountId });
        }
      }

      // Update the connector config
      const updateData = {
        config: finalConfig,
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
      
      // Invalidate Twilio cache if this is a Twilio connector
      if (existingConnector.connectorType === 'twilio') {
        await twilioService.invalidateCache(subaccountId);
      }

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
        config: sanitizeTwilioConfig(updatedConnector.config, updatedConnector.connectorType),
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
        config: sanitizeTwilioConfig(connector.config, connector.connectorType),
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

  /**
   * Get all emergency address resources from Twilio
   */
  async getEmergencyAddress(req, res) {
    try {
      const { subaccountId } = req.params;

      Logger.info('Getting Twilio emergency addresses', {
        subaccountId,
        requestId: req.requestId
      });

      // Get Twilio client
      const client = await twilioService.getTwilioClient(subaccountId);

      // Fetch all address resources from Twilio
      const addresses = await client.addresses.list();

      Logger.info('Twilio addresses retrieved successfully', {
        subaccountId,
        count: addresses.length
      });

      return res.status(200).json({
        success: true,
        message: 'Twilio addresses retrieved successfully',
        data: {
          addresses: addresses.map(address => ({
            sid: address.sid,
            accountSid: address.accountSid,
            customerName: address.customerName,
            friendlyName: address.friendlyName,
            street: address.street,
            streetSecondary: address.streetSecondary,
            city: address.city,
            region: address.region,
            postalCode: address.postalCode,
            isoCountry: address.isoCountry,
            emergencyEnabled: address.emergencyEnabled,
            validated: address.validated,
            verified: address.verified,
            dateCreated: address.dateCreated,
            dateUpdated: address.dateUpdated
          })),
          total: addresses.length
        }
      });

    } catch (error) {
      Logger.error('Failed to get Twilio emergency addresses', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId
      });

      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to get Twilio addresses',
        code: 'TWILIO_ADDRESS_FETCH_ERROR'
      });
    }
  }

  /**
   * Set an address resource as emergency address
   */
  async setEmergencyAddress(req, res) {
    try {
      const { subaccountId } = req.params;
      const { addressSid, phoneNumberSid, sipTrunkSid } = req.body;

      if (!addressSid) {
        return res.status(400).json({
          success: false,
          message: 'addressSid is required',
          code: 'VALIDATION_ERROR'
        });
      }

      Logger.info('Setting Twilio emergency address', {
        subaccountId,
        addressSid,
        phoneNumberSid,
        sipTrunkSid,
        requestId: req.requestId
      });

      // Get Twilio client
      const client = await twilioService.getTwilioClient(subaccountId);

      let result;

      // If phoneNumberSid is provided, update the phone number's emergency address
      if (phoneNumberSid) {
        result = await client.incomingPhoneNumbers(phoneNumberSid).update({
          emergencyAddressSid: addressSid
        });

        Logger.info('Emergency address set for phone number', {
          subaccountId,
          phoneNumberSid,
          addressSid
        });
      } 
      // If sipTrunkSid is provided, update the SIP trunk's emergency address
      else if (sipTrunkSid) {
        // For SIP trunks, we need to use the trunking API
        result = await client.trunking.v1.trunks(sipTrunkSid).update({
          emergencyCallingEnabled: true
        });

        Logger.info('Emergency calling enabled for SIP trunk', {
          subaccountId,
          sipTrunkSid,
          addressSid
        });
      } else {
        return res.status(400).json({
          success: false,
          message: 'Either phoneNumberSid or sipTrunkSid is required',
          code: 'VALIDATION_ERROR'
        });
      }

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CONNECTOR_UPDATED,
        category: ACTIVITY_CATEGORIES.CONNECTOR,
        userId: req.user?.id || 'system',
        description: `Emergency address ${addressSid} set for ${phoneNumberSid ? 'phone number' : 'SIP trunk'}`,
        metadata: {
          addressSid,
          phoneNumberSid,
          sipTrunkSid
        },
        resourceId: addressSid,
        resourceName: 'Emergency Address',
        operationId: req.requestId
      });

      return res.status(200).json({
        success: true,
        message: 'Emergency address set successfully',
        data: {
          addressSid,
          phoneNumberSid,
          sipTrunkSid,
          result
        }
      });

    } catch (error) {
      Logger.error('Failed to set Twilio emergency address', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId
      });

      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to set emergency address',
        code: 'TWILIO_SET_EMERGENCY_ADDRESS_ERROR'
      });
    }
  }

  /**
   * Create emergency address resource in Twilio
   */
  async createEmergencyAddress(req, res) {
    try {
      const { subaccountId } = req.params;
      const { 
        customerName, 
        street, 
        city, 
        region, 
        postalCode, 
        isoCountry,
        friendlyName,
        streetSecondary,
        emergencyEnabled,
        autoCorrectAddress
      } = req.body;

      // Validate required fields
      if (!customerName || !street || !city || !region || !postalCode || !isoCountry) {
        return res.status(400).json({
          success: false,
          message: 'customerName, street, city, region, postalCode, and isoCountry are required',
          code: 'VALIDATION_ERROR'
        });
      }

      Logger.info('Creating Twilio emergency address', {
        subaccountId,
        customerName,
        city,
        region,
        isoCountry,
        requestId: req.requestId
      });

      // Get Twilio client
      const client = await twilioService.getTwilioClient(subaccountId);

      // Create address in Twilio
      const addressData = {
        customerName,
        street,
        city,
        region,
        postalCode,
        isoCountry
      };

      if (friendlyName) addressData.friendlyName = friendlyName;
      if (streetSecondary) addressData.streetSecondary = streetSecondary;
      if (emergencyEnabled !== undefined) addressData.emergencyEnabled = emergencyEnabled;
      if (autoCorrectAddress !== undefined) addressData.autoCorrectAddress = autoCorrectAddress;

      const address = await client.addresses.create(addressData);

      Logger.info('Twilio emergency address created successfully', {
        subaccountId,
        addressSid: address.sid
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CONNECTOR_UPDATED,
        category: ACTIVITY_CATEGORIES.CONNECTOR,
        userId: req.user?.id || 'system',
        description: `Emergency address created: ${customerName} - ${city}, ${region}`,
        metadata: {
          addressSid: address.sid,
          customerName,
          city,
          region,
          isoCountry
        },
        resourceId: address.sid,
        resourceName: 'Emergency Address',
        operationId: req.requestId
      });

      return res.status(201).json({
        success: true,
        message: 'Emergency address created successfully',
        data: {
          address: {
            sid: address.sid,
            accountSid: address.accountSid,
            customerName: address.customerName,
            friendlyName: address.friendlyName,
            street: address.street,
            streetSecondary: address.streetSecondary,
            city: address.city,
            region: address.region,
            postalCode: address.postalCode,
            isoCountry: address.isoCountry,
            emergencyEnabled: address.emergencyEnabled,
            validated: address.validated,
            verified: address.verified,
            dateCreated: address.dateCreated,
            dateUpdated: address.dateUpdated
          }
        }
      });

    } catch (error) {
      Logger.error('Failed to create Twilio emergency address', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId
      });

      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to create emergency address',
        code: 'TWILIO_CREATE_ADDRESS_ERROR'
      });
    }
  }

  /**
   * Get Twilio client for subaccount
   */
  async getTwilioClient(req, res) {
    try {
      const { subaccountId } = req.params;

      Logger.info('Getting Twilio client', {
        subaccountId,
        requestId: req.requestId
      });

      const accountData = await twilioService.getTwilioAccount(subaccountId);

      return res.status(200).json({
        success: true,
        message: 'Twilio account retrieved successfully',
        data: {
          subaccountId: accountData.subaccountId,
          accountSid: '********', // Mask the actual SID
          isActive: accountData.isActive,
          metadata: accountData.metadata
        }
      });

    } catch (error) {
      Logger.error('Failed to get Twilio client', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId
      });

      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to get Twilio account',
        code: 'TWILIO_CLIENT_ERROR'
      });
    }
  }

  /**
   * Verify Twilio credentials
   */
  async verifyTwilioCredentials(req, res) {
    try {
      const { accountSid, authToken } = req.body;

      if (!accountSid || !authToken) {
        return res.status(400).json({
          success: false,
          message: 'accountSid and authToken are required',
          code: 'VALIDATION_ERROR'
        });
      }

      Logger.info('Verifying Twilio credentials', {
        requestId: req.requestId
      });

      const result = await twilioService.verifyCredentials(accountSid, authToken);

      if (!result.success) {
        return res.status(401).json({
          success: false,
          message: 'Invalid Twilio credentials',
          code: 'INVALID_CREDENTIALS',
          error: result.error
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Twilio credentials verified successfully',
        data: {
          verified: true
        }
      });

    } catch (error) {
      Logger.error('Failed to verify Twilio credentials', {
        error: error.message,
        stack: error.stack
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to verify credentials',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Setup Twilio SIP trunk for Retell AI integration
   */
  async setupTwilioForRetell(req, res) {
    try {
      const { subaccountId, emergencyAddressId } = req.params;

      if (!emergencyAddressId) {
        return res.status(400).json({
          success: false,
          message: 'emergencyAddressId is required',
          code: 'VALIDATION_ERROR'
        });
      }

      Logger.info('Setting up Twilio for Retell AI', {
        subaccountId,
        emergencyAddressId,
        requestId: req.requestId
      });

      const result = await twilioService.setupTwilioForRetell(subaccountId, emergencyAddressId);

      Logger.info('Twilio setup for Retell completed', {
        subaccountId,
        trunkSid: result.trunk.sid
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CONNECTOR_UPDATED,
        category: ACTIVITY_CATEGORIES.CONNECTOR,
        userId: req.user?.id || 'system',
        description: 'Twilio SIP trunk configured for Retell AI integration',
        metadata: {
          trunkSid: result.trunk.sid,
          trunkFriendlyName: result.trunk.friendlyName,
          emergencyAddressId,
          originationSipUri: result.originationSipUri
        },
        resourceId: result.trunk.sid,
        resourceName: 'Twilio SIP Trunk',
        operationId: req.requestId
      });

      return res.status(200).json({
        success: true,
        message: 'Twilio configured for Retell AI successfully',
        data: result
      });

    } catch (error) {
      Logger.error('Failed to setup Twilio for Retell', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId,
        emergencyAddressId: req.params.emergencyAddressId
      });

      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to setup Twilio for Retell',
        code: 'TWILIO_SETUP_ERROR'
      });
    }
  }

  /**
   * Get purchased Twilio phone numbers (excluding trunk-linked ones)
   */
  async getTwilioPhoneNumbers(req, res) {
    try {
      const { subaccountId } = req.params;

      Logger.info('Getting Twilio phone numbers', {
        subaccountId,
        requestId: req.requestId
      });

      const result = await twilioService.getPhoneNumbers(subaccountId);

      return res.status(200).json({
        success: true,
        message: 'Phone numbers retrieved successfully',
        data: result
      });

    } catch (error) {
      Logger.error('Failed to get Twilio phone numbers', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId
      });

      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to get phone numbers',
        code: 'TWILIO_PHONE_NUMBERS_ERROR'
      });
    }
  }

  /**
   * Search for available phone numbers to purchase
   */
  async searchAvailablePhoneNumbers(req, res) {
    try {
      const { subaccountId } = req.params;
      const { 
        countryCode, 
        areaCode, 
        contains, 
        smsEnabled, 
        voiceEnabled, 
        mmsEnabled, 
        limit 
      } = req.query;

      Logger.info('Searching available phone numbers', {
        subaccountId,
        countryCode,
        areaCode,
        requestId: req.requestId
      });

      const options = {};
      if (countryCode) options.countryCode = countryCode;
      if (areaCode) options.areaCode = areaCode;
      if (contains) options.contains = contains;
      if (smsEnabled !== undefined) options.smsEnabled = smsEnabled === 'true';
      if (voiceEnabled !== undefined) options.voiceEnabled = voiceEnabled === 'true';
      if (mmsEnabled !== undefined) options.mmsEnabled = mmsEnabled === 'true';
      if (limit) options.limit = parseInt(limit, 10);

      const result = await twilioService.searchAvailablePhoneNumbers(subaccountId, options);

      return res.status(200).json({
        success: true,
        message: 'Available phone numbers retrieved successfully',
        data: result
      });

    } catch (error) {
      Logger.error('Failed to search available phone numbers', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId
      });

      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to search available phone numbers',
        code: 'TWILIO_SEARCH_ERROR'
      });
    }
  }

  /**
   * Purchase a Twilio phone number with full integration
   */
  async purchaseTwilioPhoneNumber(req, res) {
    try {
      const { subaccountId } = req.params;
      const { phoneNumber } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          message: 'phoneNumber is required',
          code: 'VALIDATION_ERROR'
        });
      }

      Logger.info('Purchasing Twilio phone number with full integration', {
        subaccountId,
        phoneNumber,
        requestId: req.requestId
      });

      const result = await twilioService.purchasePhoneNumber(subaccountId, phoneNumber);

      Logger.info('Phone number purchased and integrated successfully', {
        subaccountId,
        phoneNumber,
        sid: result.twilioNumber.sid,
        retellImported: result.retellNumber?.phone_number ? true : false
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CONNECTOR_UPDATED,
        category: ACTIVITY_CATEGORIES.CONNECTOR,
        userId: req.user?.id || 'system',
        description: `Twilio phone number purchased and integrated: ${phoneNumber}`,
        metadata: {
          phoneNumber,
          sid: result.twilioNumber.sid,
          friendlyName: result.twilioNumber.friendlyName,
          emergencyAddressIntegrated: true,
          trunkRegistered: true,
          retellImported: result.retellNumber?.phone_number ? true : false
        },
        resourceId: result.twilioNumber.sid,
        resourceName: phoneNumber,
        operationId: req.requestId
      });

      return res.status(201).json({
        success: true,
        message: 'Phone number purchased and integrated successfully',
        data: result
      });

    } catch (error) {
      Logger.error('Failed to purchase phone number', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId
      });

      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to purchase phone number',
        code: 'TWILIO_PURCHASE_ERROR'
      });
    }
  }

  /**
   * Invalidate Twilio cache for subaccount
   */
  async invalidateTwilioCache(req, res) {
    try {
      const { subaccountId } = req.params;

      Logger.info('Invalidating Twilio cache', {
        subaccountId,
        requestId: req.requestId
      });

      await twilioService.invalidateCache(subaccountId);

      return res.status(200).json({
        success: true,
        message: 'Twilio cache invalidated successfully'
      });

    } catch (error) {
      Logger.error('Failed to invalidate Twilio cache', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to invalidate cache',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Get all phone numbers for a subaccount
   * GET /api/subaccounts/:subaccountId/phone-numbers
   */
  async getAllPhoneNumbers(req, res) {
    try {
      const { subaccountId } = req.params;
      const userId = req.user?.id || 'system';

      Logger.info('Getting all phone numbers', {
        requestId: req.requestId,
        subaccountId,
        userId
      });

      const phoneNumbers = await twilioService.getAllPhoneNumbers(subaccountId, userId);

      return res.status(200).json({
        success: true,
        data: phoneNumbers,
        count: phoneNumbers.length
      });
    } catch (error) {
      Logger.error('Failed to get phone numbers', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve phone numbers',
        error: error.message,
        code: 'INTERNAL_ERROR'
      });
    }
  }

  /**
   * Update phone number agent assignment
   * PUT /api/subaccounts/:subaccountId/phone-numbers/:phoneNumber
   */
  async updatePhoneNumber(req, res) {
    try {
      const { subaccountId, phoneNumber } = req.params;
      const updateData = req.body;
      const userId = req.user?.id || 'system';

      Logger.info('Updating phone number', {
        requestId: req.requestId,
        subaccountId,
        phoneNumber,
        updateData,
        userId
      });

      const result = await twilioService.updatePhoneNumber(
        subaccountId,
        phoneNumber,
        updateData,
        userId
      );

      // Log activity
      const changes = [];
      if (updateData.inbound_agent_id !== undefined) changes.push('inbound agent');
      if (updateData.outbound_agent_id !== undefined) changes.push('outbound agent');
      if (updateData.nickname !== undefined) changes.push('nickname');

      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CONNECTOR_UPDATE_PHONE_NUMBER,
        category: ACTIVITY_CATEGORIES.CONNECTOR,
        userId,
        description: `Updated phone number ${phoneNumber}: ${changes.join(', ')}`,
        metadata: {
          phoneNumber,
          changes: updateData
        },
        resourceId: phoneNumber,
        resourceName: phoneNumber
      });

      return res.status(200).json({
        success: true,
        data: result,
        message: 'Phone number updated successfully'
      });
    } catch (error) {
      Logger.error('Failed to update phone number', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId,
        phoneNumber: req.params.phoneNumber,
        response: error.response?.data,
        errorCode: error.code
      });

      // Use custom error codes and status codes if available
      const statusCode = error.statusCode || error.response?.status || 500;
      const errorCode = error.code || 'UPDATE_FAILED';
      
      return res.status(statusCode).json({
        success: false,
        message: error.message || 'Failed to update phone number',
        error: error.message,
        details: error.response?.data,
        code: errorCode
      });
    }
  }

  /**
   * Delete phone number from all systems
   * DELETE /api/subaccounts/:subaccountId/phone-numbers/:phoneNumber
   */
  async deletePhoneNumber(req, res) {
    try {
      const { subaccountId, phoneNumber } = req.params;
      const userId = req.user?.id || 'system';

      Logger.info('Deleting phone number', {
        requestId: req.requestId,
        subaccountId,
        phoneNumber,
        userId
      });

      const result = await twilioService.deletePhoneNumber(
        subaccountId,
        phoneNumber,
        userId
      );

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CONNECTOR_DELETE_PHONE_NUMBER,
        category: ACTIVITY_CATEGORIES.CONNECTOR,
        userId,
        description: `Deleted phone number ${phoneNumber}`,
        metadata: {
          phoneNumber,
          deletionResults: result.results
        },
        resourceId: phoneNumber,
        resourceName: phoneNumber
      });

      return res.status(200).json({
        success: true,
        data: result,
        message: 'Phone number deletion completed'
      });
    } catch (error) {
      Logger.error('Failed to delete phone number', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId,
        phoneNumber: req.params.phoneNumber
      });

      return res.status(500).json({
        success: false,
        message: 'Failed to delete phone number',
        error: error.message,
        code: 'DELETE_FAILED'
      });
    }
  }
}

// Export singleton instance
module.exports = new ConnectorController();

