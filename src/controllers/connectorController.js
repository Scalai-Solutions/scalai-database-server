const connectionPoolManager = require('../services/connectionPoolManager');
const connectorService = require('../services/connectorService');
const twilioService = require('../services/twilioService');
const encryptionService = require('../services/encryptionService');
const Logger = require('../utils/logger');
const ActivityService = require('../services/activityService');
const { ACTIVITY_TYPES, ACTIVITY_CATEGORIES } = ActivityService;

/**
 * Helper function to mask sensitive credentials before sending to frontend
 * Works generically for any connector that uses encryption
 */
function sanitizeConnectorConfig(config, connectorType, connector = null) {
  if (!config) return config;
  
  // Use generic encryption service for sanitization
  return encryptionService.sanitizeConfig(config, connectorType);
}

/**
 * DEPRECATED: Legacy function for backward compatibility
 * Use sanitizeConnectorConfig instead
 */
function sanitizeTwilioConfig(config, connectorType) {
  return sanitizeConnectorConfig(config, connectorType);
}

/**
 * Helper function to filter config based on connector's schema
 * Only keeps fields that are defined in the connector's configSchema
 */
function filterConfigBySchema(config, connector) {
  if (!config || typeof config !== 'object') {
    return config;
  }
  
  // If connector has no schema, return config as-is
  if (!connector || !connector.configSchema || !Array.isArray(connector.configSchema)) {
    Logger.debug('No config schema found for connector, allowing all fields');
    return config;
  }
  
  // Get list of allowed field names from schema
  const allowedFields = connector.configSchema.map(field => field.name);
  
  Logger.debug('Filtering config by schema', {
    allowedFields,
    providedFields: Object.keys(config),
    connectorType: connector.type
  });
  
  // Filter config to only include allowed fields
  const filteredConfig = {};
  allowedFields.forEach(fieldName => {
    if (config.hasOwnProperty(fieldName)) {
      filteredConfig[fieldName] = config[fieldName];
    }
  });
  
  // Log removed fields for debugging
  const removedFields = Object.keys(config).filter(key => !allowedFields.includes(key));
  if (removedFields.length > 0) {
    Logger.info('Removed invalid config fields', {
      removedFields,
      connectorType: connector.type
    });
  }
  
  return filteredConfig;
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
      // const cached = await connectorService.getCachedConnectorList();
      // if (cached) {
      //   Logger.debug('Returning cached connector list');
      //   return res.status(200).json({
      //     success: true,
      //     message: 'Connectors retrieved successfully',
      //     data: cached,
      //     cached: true
      //   });
      // }

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

      // Filter config to only include fields defined in connector schema
      let validatedConfig = connectorConfig ? filterConfigBySchema(connectorConfig, connectorResult.data.connector) : {};
      
      // Encrypt connector credentials if connector requires encryption
      let finalConfig = validatedConfig;
      
      Logger.debug('Checking if encryption needed for new connector', { 
        connectorType: connectorResult.data.type, 
        hasConfig: !!validatedConfig,
        requiresEncryption: encryptionService.requiresEncryption(connectorResult.data.connector)
      });
      
      // Generic encryption for all connectors that require it
      let encryptionMetadata = {};
      if (validatedConfig && Object.keys(validatedConfig).length > 0 && encryptionService.requiresEncryption(connectorResult.data.connector)) {
        Logger.info('Encrypting connector credentials before storage', { 
          subaccountId, 
          connectorId,
          connectorType: connectorResult.data.type
        });
        
        // Get list of fields that should be encrypted for this connector
        const fieldsToEncrypt = encryptionService.getEncryptableFields(connectorResult.data.connector);
        
        // Encrypt the config using generic encryption service
        const encryptionResult = encryptionService.encryptConfig(
          validatedConfig, 
          connectorResult.data.type,
          fieldsToEncrypt
        );
        
        // For Twilio connectors, encryptionResult is { config, metadata }
        // For other connectors, encryptionResult is the config object
        if (connectorResult.data.type === 'twilio' && encryptionResult.config && encryptionResult.metadata) {
          finalConfig = encryptionResult.config;
          encryptionMetadata = encryptionResult.metadata;
        } else {
          finalConfig = encryptionResult;
        }
        
        Logger.info('Connector credentials encrypted successfully', { 
          subaccountId,
          connectorType: connectorResult.data.type,
          fieldsEncrypted: fieldsToEncrypt || 'all'
        });
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
        metadata: encryptionMetadata // For Twilio, this contains encryption metadata
      };

      const result = await connection.db.collection('connectorsubaccount').insertOne(connectorSubaccount);
      
      // Invalidate Twilio cache if this is a Twilio connector
      if (connectorResult.data.type === 'twilio') {
        await twilioService.invalidateCache(subaccountId);
      }

      // Return the created connector relationship with connector details
      const createdConnector = {
        ...connectorSubaccount,
        config: sanitizeConnectorConfig(connectorSubaccount.config, connectorResult.data.type, connectorResult.data.connector),
        _id: result.insertedId,
        connector: connectorResult.data.connector
      };

      // Get connector name for activity logging
      const connectorName = connectorResult.data?.connector?.name || connectorId;

      Logger.info('Connector added to subaccount successfully', {
        subaccountId,
        connectorId,
        connectorName,
        id: result.insertedId
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CONNECTOR_ADDED,
        category: ACTIVITY_CATEGORIES.CONNECTOR,
        userId: req.user?.id || 'system',
        description: `Connector ${connectorName} added to subaccount`,
        metadata: {
          connectorId,
          connectorName: connectorName !== connectorId ? connectorName : undefined,
          connectorType: connectorResult.data.category,
          isActive: connectorSubaccount.isActive
        },
        resourceId: connectorId,
        resourceName: connectorName,
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
            config: sanitizeConnectorConfig(conn.config, conn.connectorType, connectorResult.success ? connectorResult.data.connector : null),
            connector: connectorResult.success ? connectorResult.data.connector : null
          };
        })
      );

      const responseData = {
        connectors: connectorsWithDetails,
        total: connectorsWithDetails.length
      };

      return res.status(200).json({
        success: true,
        message: 'Connectors retrieved successfully',
        data: responseData
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

      // Extract access token from Authorization header for connector details
      const authHeader = req.headers['authorization'];
      const accessToken = authHeader && authHeader.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : null;

      // Get connector details to check if encryption is required
      const connectorResult = await connectorService.getConnectorById(connectorId, accessToken);
      
      // Filter config to only include fields defined in connector schema
      const validatedConfig = connectorConfig ? filterConfigBySchema(connectorConfig, connectorResult.data.connector) : {};
      
      // Encrypt connector credentials if connector requires encryption
      let finalConfig = validatedConfig;
      let encryptionMetadata = null; // Initialize for Twilio connectors
      
      Logger.debug('Checking if encryption needed for connector update', { 
        connectorType: existingConnector.connectorType, 
        hasConfig: !!validatedConfig,
        configKeys: validatedConfig ? Object.keys(validatedConfig) : [],
        requiresEncryption: connectorResult.success && encryptionService.requiresEncryption(connectorResult.data.connector)
      });
      
      // Generic encryption for all connectors that require it
      if (validatedConfig && Object.keys(validatedConfig).length > 0 && connectorResult.success && encryptionService.requiresEncryption(connectorResult.data.connector)) {
        Logger.info('Encrypting connector credentials before update', { 
          subaccountId, 
          connectorId,
          connectorType: existingConnector.connectorType
        });
        
        // Start with existing config to preserve fields not being updated
        const baseConfig = { ...existingConnector.config };
        
        // Merge in the new validated config (non-encrypted fields from user input)
        Object.keys(validatedConfig).forEach(key => {
          // Skip encryption metadata fields
          if (!key.endsWith('IV') && !key.endsWith('AuthTag') && !key.endsWith('_encrypted')) {
            baseConfig[key] = validatedConfig[key];
          }
        });
        
        // Get list of fields that should be encrypted for this connector
        const fieldsToEncrypt = encryptionService.getEncryptableFields(connectorResult.data.connector);
        
        // Encrypt only the fields that are being updated
        const fieldsToEncryptNow = fieldsToEncrypt 
          ? fieldsToEncrypt.filter(field => validatedConfig.hasOwnProperty(field))
          : Object.keys(validatedConfig).filter(key => 
              typeof validatedConfig[key] === 'string' && 
              !key.endsWith('IV') && 
              !key.endsWith('AuthTag')
            );
        
        if (fieldsToEncryptNow.length > 0) {
          // Encrypt the updated fields
          const encryptionResult = encryptionService.encryptConfig(
            validatedConfig, 
            existingConnector.connectorType,
            fieldsToEncryptNow
          );
          
          // For Twilio connectors, encryptionResult is { config, metadata }
          // For other connectors, encryptionResult is the config object
          if (existingConnector.connectorType === 'twilio' && encryptionResult.config && encryptionResult.metadata) {
            // Merge encrypted fields into the base config
            Object.keys(encryptionResult.config).forEach(key => {
              baseConfig[key] = encryptionResult.config[key];
            });
            
            // Remove old IV/AuthTag fields from config root if they exist
            fieldsToEncryptNow.forEach(field => {
              delete baseConfig[`${field}IV`];
              delete baseConfig[`${field}AuthTag`];
            });
            
            // Store encryption metadata separately (will be merged with document metadata below)
            finalConfig = baseConfig;
            encryptionMetadata = encryptionResult.metadata;
          } else {
            // Merge encrypted fields into the base config
            Object.keys(encryptionResult).forEach(key => {
              baseConfig[key] = encryptionResult[key];
            });
            finalConfig = baseConfig;
          }
        } else {
          finalConfig = baseConfig;
        }
        
        Logger.info('Connector credentials encrypted successfully', { 
          subaccountId,
          connectorType: existingConnector.connectorType,
          fieldsEncrypted: fieldsToEncryptNow.length
        });
      } else if (validatedConfig && Object.keys(validatedConfig).length > 0) {
        // If no encryption needed, just merge the validated config with existing config
        finalConfig = { ...existingConnector.config, ...validatedConfig };
      }

      // Update the connector config
      const updateData = {
        config: finalConfig,
        updatedAt: new Date()
      };

      // For Twilio connectors, merge encryption metadata into document-level metadata
      if (existingConnector.connectorType === 'twilio' && encryptionMetadata) {
        // Merge encryption metadata with existing document metadata
        const existingMetadata = existingConnector.metadata || {};
        updateData.metadata = {
          ...existingMetadata,
          ...encryptionMetadata
        };
      }

      if (isActive !== undefined) {
        updateData.isActive = isActive;
      }

      const result = await connection.db.collection('connectorsubaccount').updateOne(
        { subaccountId, connectorId },
        { $set: updateData }
      );

      // Invalidate connector config cache
      await connectorService.invalidateSubaccountConnectorConfigCache(subaccountId, connectorId);
      
      // Invalidate Twilio cache if this is a Twilio connector
      if (existingConnector.connectorType === 'twilio') {
        await twilioService.invalidateCache(subaccountId);
      }

      // Get updated connector with details
      const updatedConnector = await connection.db.collection('connectorsubaccount').findOne({
        subaccountId,
        connectorId
      });

      const connectorWithDetails = {
        ...updatedConnector,
        config: sanitizeConnectorConfig(updatedConnector.config, updatedConnector.connectorType, connectorResult.success ? connectorResult.data.connector : null),
        connector: connectorResult.success ? connectorResult.data.connector : null
      };

      // Get connector name for activity logging
      const connectorName = (connectorResult.success && connectorResult.data?.connector?.name) 
        ? connectorResult.data.connector.name 
        : connectorId;

      Logger.info('Connector config updated successfully', {
        subaccountId,
        connectorId,
        connectorName,
        connectorFetchSuccess: connectorResult.success,
        hasConnectorData: !!connectorResult.data?.connector,
        actualConnectorName: connectorResult.data?.connector?.name
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CONNECTOR_UPDATED,
        category: ACTIVITY_CATEGORIES.CONNECTOR,
        userId: req.user?.id || 'system',
        description: `Connector ${connectorName} configuration updated`,
        metadata: {
          connectorId,
          connectorName: connectorName !== connectorId ? connectorName : undefined,
          isActive: updatedConnector.isActive,
          updatedFields: Object.keys(updateData)
        },
        resourceId: connectorId,
        resourceName: connectorName,
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

      // Get connector details from connectors collection for the name
      const connectorResult = await connectorService.getConnectorById(connectorId);
      const connectorName = connectorResult.success && connectorResult.data.connector?.name 
        ? connectorResult.data.connector.name 
        : connectorId;

      // Delete the connector
      await connection.db.collection('connectorsubaccount').deleteOne({
        subaccountId,
        connectorId
      });

      // Invalidate connector config cache
      await connectorService.invalidateSubaccountConnectorConfigCache(subaccountId, connectorId);

      Logger.info('Connector deleted from subaccount successfully', {
        subaccountId,
        connectorId,
        connectorName
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CONNECTOR_DELETED,
        category: ACTIVITY_CATEGORIES.CONNECTOR,
        userId: req.user?.id || 'system',
        description: `Connector ${connectorName} removed from subaccount`,
        metadata: {
          connectorId,
          connectorName,
          deletedConnectorType: existingConnector.connectorType
        },
        resourceId: connectorId,
        resourceName: connectorName,
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

      // Invalidate connector config cache
      await connectorService.invalidateSubaccountConnectorConfigCache(subaccountId, connectorId);

      // Get connector details from connectors collection for the name
      const connectorResult = await connectorService.getConnectorById(connectorId);
      const connectorName = connectorResult.success && connectorResult.data.connector?.name 
        ? connectorResult.data.connector.name 
        : connectorId;

      Logger.info('Connector metadata updated successfully', {
        subaccountId,
        connectorId,
        connectorName
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CONNECTOR_METADATA_UPDATED,
        category: ACTIVITY_CATEGORIES.CONNECTOR,
        userId: req.service?.serviceName || 'system',
        description: `Connector ${connectorName} metadata updated`,
        metadata: {
          connectorId,
          connectorName,
          metadataKeys: Object.keys(metadata),
          serviceName: req.service?.serviceName
        },
        resourceId: connectorId,
        resourceName: connectorName,
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

      // Automatically configure default GB regulatory bundle
      const config = require('../../config/config');
      const defaultBundleSid = process.env.TWILIO_DEFAULT_BUNDLE_SID || 'BU3d5be36ba71da67b804b80c766250783';
      
      if (defaultBundleSid) {
        try {
          Logger.info('Auto-configuring Twilio regulatory bundle', {
            subaccountId,
            bundleSid: defaultBundleSid
          });
          
          // Get database connection
          const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
          const { connection } = connectionInfo;
          
          // Update the bundleSid in retellIntegration metadata
          await connection.db.collection('connectorsubaccount').updateOne(
            {
              subaccountId,
              connectorType: 'twilio'
            },
            {
              $set: {
                'metadata.retellIntegration.bundleSid': defaultBundleSid,
                updatedAt: new Date()
              }
            }
          );
          
          Logger.info('Twilio bundle configured automatically', {
            subaccountId,
            bundleSid: defaultBundleSid
          });
        } catch (bundleError) {
          // Don't fail the setup if bundle configuration fails
          Logger.warn('Failed to auto-configure Twilio bundle (non-critical)', {
            subaccountId,
            bundleSid: defaultBundleSid,
            error: bundleError.message
          });
        }
      }

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
   * Fix Retell phone numbers that are missing SIP authentication credentials
   */
  async fixRetellNumberCredentials(req, res) {
    try {
      const { subaccountId } = req.params;
      const { phoneNumber } = req.body; // Optional: fix specific number or all

      Logger.info('Fixing Retell number credentials', {
        subaccountId,
        phoneNumber: phoneNumber || 'all numbers',
        requestId: req.requestId
      });

      const result = await twilioService.fixRetellNumberCredentials(subaccountId, phoneNumber);

      Logger.info('Retell credentials fix completed', {
        subaccountId,
        successCount: result.successCount,
        failCount: result.failCount
      });

      return res.status(200).json({
        success: true,
        message: `Fixed credentials for ${result.successCount} of ${result.total} phone numbers`,
        data: result
      });

    } catch (error) {
      Logger.error('Failed to fix Retell credentials', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId
      });

      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to fix Retell credentials',
        code: 'RETELL_FIX_ERROR'
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
        limit,
        type // 'local', 'mobile', 'tollFree', or 'all'
      } = req.query;

      Logger.info('Searching available phone numbers', {
        subaccountId,
        countryCode,
        areaCode,
        type,
        requestId: req.requestId
      });

      const options = {};
      if (countryCode) options.countryCode = countryCode;
      if (areaCode) options.areaCode = areaCode;
      if (contains) options.contains = contains;
      // Only set capability filters if explicitly provided in query params
      // This allows the service to search without capability restrictions (matching Twilio UI behavior)
      if (smsEnabled !== undefined) {
        options.smsEnabled = smsEnabled === 'true' || smsEnabled === true;
      }
      if (voiceEnabled !== undefined) {
        options.voiceEnabled = voiceEnabled === 'true' || voiceEnabled === true;
      }
      if (mmsEnabled !== undefined) {
        options.mmsEnabled = mmsEnabled === 'true' || mmsEnabled === true;
      }
      if (limit) options.limit = parseInt(limit, 10);
      if (type) options.type = type; // 'local', 'mobile', 'tollFree', or 'all'

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
   * Update Twilio emergency address ID in connector metadata
   */
  async updateTwilioEmergencyAddress(req, res) {
    try {
      const { subaccountId } = req.params;
      const { emergencyAddressId } = req.body;

      if (!emergencyAddressId) {
        return res.status(400).json({
          success: false,
          message: 'emergencyAddressId is required',
          code: 'VALIDATION_ERROR'
        });
      }

      Logger.info('Updating Twilio emergency address ID', {
        subaccountId,
        emergencyAddressId,
        requestId: req.requestId
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
      const { connection } = connectionInfo;

      // Find the Twilio connector
      const twilioConnector = await connection.db.collection('connectorsubaccount').findOne({
        subaccountId,
        connectorType: 'twilio'
      });

      if (!twilioConnector) {
        return res.status(404).json({
          success: false,
          message: 'Twilio connector not found for this subaccount',
          code: 'CONNECTOR_NOT_FOUND'
        });
      }

      // Update the emergencyAddressId in retellIntegration metadata
      const updateResult = await connection.db.collection('connectorsubaccount').updateOne(
        {
          subaccountId,
          connectorType: 'twilio'
        },
        {
          $set: {
            'metadata.retellIntegration.emergencyAddressId': emergencyAddressId,
            updatedAt: new Date()
          }
        }
      );

      if (updateResult.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: 'Twilio connector not found',
          code: 'CONNECTOR_NOT_FOUND'
        });
      }

      Logger.info('Twilio emergency address ID updated successfully', {
        subaccountId,
        emergencyAddressId
      });

      return res.status(200).json({
        success: true,
        message: 'Emergency address ID updated successfully',
        data: {
          emergencyAddressId
        }
      });

    } catch (error) {
      Logger.error('Failed to update Twilio emergency address ID', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId
      });

      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to update emergency address ID',
        code: 'TWILIO_EMERGENCY_ADDRESS_UPDATE_ERROR'
      });
    }
  }

  /**
   * Update Twilio bundle SID in connector metadata
   */
  async updateTwilioBundle(req, res) {
    try {
      const { subaccountId } = req.params;
      const { bundleSid } = req.body;

      if (!bundleSid) {
        return res.status(400).json({
          success: false,
          message: 'bundleSid is required',
          code: 'VALIDATION_ERROR'
        });
      }

      Logger.info('Updating Twilio bundle SID', {
        subaccountId,
        bundleSid,
        requestId: req.requestId
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
      const { connection } = connectionInfo;

      // Find the Twilio connector
      const twilioConnector = await connection.db.collection('connectorsubaccount').findOne({
        subaccountId,
        connectorType: 'twilio'
      });

      if (!twilioConnector) {
        return res.status(404).json({
          success: false,
          message: 'Twilio connector not found for this subaccount',
          code: 'CONNECTOR_NOT_FOUND'
        });
      }

      // Update the bundleSid in retellIntegration metadata
      const updateResult = await connection.db.collection('connectorsubaccount').updateOne(
        {
          subaccountId,
          connectorType: 'twilio'
        },
        {
          $set: {
            'metadata.retellIntegration.bundleSid': bundleSid,
            updatedAt: new Date()
          }
        }
      );

      if (updateResult.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: 'Twilio connector not found',
          code: 'CONNECTOR_NOT_FOUND'
        });
      }

      Logger.info('Twilio bundle SID updated successfully', {
        subaccountId,
        bundleSid
      });

      return res.status(200).json({
        success: true,
        message: 'Bundle SID updated successfully',
        data: {
          bundleSid
        }
      });

    } catch (error) {
      Logger.error('Failed to update Twilio bundle SID', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId
      });

      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to update bundle SID',
        code: 'TWILIO_BUNDLE_UPDATE_ERROR'
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

      // Check if we purchased a different number (due to retry logic)
      const purchasedNumber = result.twilioNumber.phoneNumber;
      const wasAlternativeNumber = purchasedNumber !== phoneNumber;

      Logger.info('Phone number purchased and integrated successfully', {
        subaccountId,
        requestedNumber: phoneNumber,
        purchasedNumber,
        wasAlternativeNumber,
        sid: result.twilioNumber.sid,
        retellImported: result.retellNumber?.phone_number ? true : false
      });

      // Log activity
      const description = wasAlternativeNumber 
        ? `Phone number purchased (alternative): ${purchasedNumber} (requested: ${phoneNumber} was unavailable)`
        : `Twilio phone number purchased and integrated: ${purchasedNumber}`;

      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CONNECTOR_UPDATED,
        category: ACTIVITY_CATEGORIES.CONNECTOR,
        userId: req.user?.id || 'system',
        description,
        metadata: {
          requestedNumber: phoneNumber,
          purchasedNumber,
          wasAlternativeNumber,
          sid: result.twilioNumber.sid,
          friendlyName: result.twilioNumber.friendlyName,
          emergencyAddressIntegrated: true,
          trunkRegistered: true,
          retellImported: result.retellNumber?.phone_number ? true : false
        },
        resourceId: result.twilioNumber.sid,
        resourceName: purchasedNumber,
        operationId: req.requestId
      });

      const responseMessage = wasAlternativeNumber
        ? `Original number was unavailable. Successfully purchased alternative number: ${purchasedNumber}`
        : 'Phone number purchased and integrated successfully';

      return res.status(201).json({
        success: true,
        message: responseMessage,
        data: result,
        info: wasAlternativeNumber ? {
          requestedNumber: phoneNumber,
          purchasedNumber,
          note: 'The requested number was no longer available, so an alternative was purchased automatically'
        } : null
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

  /**
   * Delete Twilio trunk for a subaccount
   * DELETE /api/connectors/:subaccountId/twilio-trunk
   * Service-to-service endpoint (requires service auth)
   */
  async deleteTwilioTrunk(req, res) {
    try {
      const { subaccountId } = req.params;
      const userId = req.user?.id || req.service?.serviceName || 'system';

      Logger.info('Delete Twilio trunk request received', {
        subaccountId,
        userId,
        service: req.service?.serviceName,
        requestId: req.requestId
      });

      // Delete the trunk
      const result = await twilioService.deleteTrunkForSubaccount(subaccountId, userId);

      if (result.success || result.skipped) {
        Logger.info('Twilio trunk deletion completed', {
          subaccountId,
          userId,
          trunkSid: result.trunkSid,
          trunkDeleted: result.trunkDeleted,
          skipped: result.skipped,
          reason: result.reason
        });

        return res.status(200).json({
          success: true,
          message: result.skipped 
            ? `Trunk deletion skipped: ${result.reason}` 
            : 'Twilio trunk deleted successfully',
          data: result
        });
      } else {
        Logger.warn('Twilio trunk deletion failed', {
          subaccountId,
          userId,
          error: result.error,
          trunkSid: result.trunkSid
        });

        return res.status(500).json({
          success: false,
          message: 'Failed to delete Twilio trunk',
          error: result.error,
          data: result
        });
      }
    } catch (error) {
      Logger.error('Error in deleteTwilioTrunk controller', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId,
        userId: req.user?.id
      });

      return res.status(500).json({
        success: false,
        message: 'Internal server error while deleting Twilio trunk',
        error: error.message
      });
    }
  }

  /**
   * Release phone numbers from Twilio
   * POST /api/connectors/:subaccountId/twilio/release-phone-numbers
   * Service-to-service endpoint (requires service auth)
   */
  async releasePhoneNumbersFromTwilio(req, res) {
    try {
      const { subaccountId } = req.params;
      const { phoneNumbersToRelease } = req.body;
      const userId = req.user?.id || req.service?.serviceName || 'system';

      Logger.info('Release phone numbers from Twilio request received', {
        subaccountId,
        userId,
        phoneNumberCount: phoneNumbersToRelease?.length || 0,
        service: req.service?.serviceName,
        requestId: req.requestId
      });

      if (!phoneNumbersToRelease || !Array.isArray(phoneNumbersToRelease)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid request: phoneNumbersToRelease must be an array'
        });
      }

      // Release the phone numbers
      const result = await twilioService.releasePhoneNumbersFromTwilio(subaccountId, phoneNumbersToRelease);

      if (result.success) {
        Logger.info('Phone numbers release completed', {
          subaccountId,
          userId,
          phoneNumbersReleased: result.phoneNumbersReleased?.length || 0,
          phoneNumbersFailed: result.phoneNumbersFailed?.length || 0
        });

        return res.status(200).json({
          success: true,
          message: 'Phone numbers released from Twilio',
          data: result
        });
      } else {
        Logger.warn('Phone numbers release failed', {
          subaccountId,
          userId,
          error: result.error
        });

        return res.status(500).json({
          success: false,
          message: 'Failed to release phone numbers from Twilio',
          error: result.error,
          data: result
        });
      }
    } catch (error) {
      Logger.error('Error in releasePhoneNumbersFromTwilio controller', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params.subaccountId,
        userId: req.user?.id
      });

      return res.status(500).json({
        success: false,
        message: 'Internal server error while releasing phone numbers from Twilio',
        error: error.message
      });
    }
  }
}

// Export singleton instance
module.exports = new ConnectorController();

