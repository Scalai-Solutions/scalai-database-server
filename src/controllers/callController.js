const Logger = require('../utils/logger');
const retellService = require('../services/retellService');
const connectionPoolManager = require('../services/connectionPoolManager');
const Retell = require('../utils/retell');
const { v4: uuidv4 } = require('uuid');
const ActivityService = require('../services/activityService');
const { ACTIVITY_TYPES, ACTIVITY_CATEGORIES } = ActivityService;

class CallController {
  /**
   * Create a web call using an agent
   * POST /api/calls/:subaccountId/web-call
   */
  static async createWebCall(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const { agentId, metadata } = req.body;
      const userId = req.user.id;

      Logger.info('Creating web call', {
        operationId,
        subaccountId,
        userId,
        agentId,
        effectiveRole: req.permission?.effectiveRole
      });

      // Fetch retell account data (with caching)
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      
      if (!retellAccountData.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Retell account is not active',
          code: 'RETELL_ACCOUNT_INACTIVE'
        });
      }

      // Create Retell instance with decrypted API key
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);
      
      Logger.info('Retell instance created for web call', {
        operationId,
        accountName: retellAccountData.accountName,
        accountId: retellAccountData.id
      });

      // Verify agent exists in database
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      
      const agentsCollection = connection.db.collection('agents');
      const agentDocument = await agentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Agent not found',
          code: 'AGENT_NOT_FOUND'
        });
      }

      // Create web call with optional metadata
      const callOptions = metadata ? { metadata } : {};
      const webCallResponse = await retell.createWebCall(agentId, callOptions);

      // Store call information in database
      const callsCollection = connection.db.collection('calls');
      const callDocument = {
        call_id: webCallResponse.call_id,
        agent_id: agentId,
        call_type: 'web_call',
        access_token: webCallResponse.access_token,
        sample_rate: webCallResponse.sample_rate,
        call_status: webCallResponse.call_status || 'registered',
        metadata: metadata || {},
        subaccountId: subaccountId,
        createdBy: userId,
        createdAt: new Date(),
        operationId: operationId,
        retellAccountId: retellAccountData.id
      };

      await callsCollection.insertOne(callDocument);
      
      Logger.info('Web call created and stored in database', {
        operationId,
        subaccountId,
        agentId,
        callId: webCallResponse.call_id
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.WEB_CALL_CREATED,
        category: ACTIVITY_CATEGORIES.CALL,
        userId,
        description: `Web call created for agent ${agentDocument.name || agentId}`,
        metadata: {
          callId: webCallResponse.call_id,
          agentId,
          agentName: agentDocument.name,
          callType: 'web_call',
          metadata: metadata || {}
        },
        resourceId: webCallResponse.call_id,
        resourceName: `Web Call - ${agentDocument.name || agentId}`,
        operationId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Web call created successfully',
        data: {
          agent_id: webCallResponse.agent_id,
          call_id: webCallResponse.call_id,
          access_token: webCallResponse.access_token,
          sample_rate: webCallResponse.sample_rate,
          call_status: webCallResponse.call_status,
          retellAccount: {
            accountName: retellAccountData.accountName,
            accountId: retellAccountData.id
          }
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await CallController.handleError(error, req, operationId, 'createWebCall', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Webhook update call (for webhook server)
   * PATCH /api/calls/:subaccountId/webhook-update
   */
  static async webhookUpdateCall(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const { callId, updateData } = req.body;
      const serviceName = req.service?.serviceName || 'unknown';

      Logger.info('Webhook updating call', {
        operationId,
        subaccountId,
        callId,
        serviceName,
        updateFields: Object.keys(updateData || {})
      });

      if (!callId || !updateData) {
        return res.status(400).json({
          success: false,
          message: 'callId and updateData are required',
          code: 'MISSING_REQUIRED_FIELDS'
        });
      }

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, 'webhook-service');
      const { connection } = connectionInfo;
      
      const callsCollection = connection.db.collection('calls');

      // Upsert the call document
      const result = await callsCollection.updateOne(
        { call_id: callId },
        { 
          $set: {
            ...updateData,
            subaccountId: subaccountId,
            lastUpdatedBy: 'webhook-service',
            lastUpdatedAt: new Date()
          }
        },
        { upsert: true }
      );

      const duration = Date.now() - startTime;

      Logger.info('Call updated via webhook', {
        operationId,
        subaccountId,
        callId,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedCount: result.upsertedCount,
        duration: `${duration}ms`
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CALL_UPDATED,
        category: ACTIVITY_CATEGORIES.CALL,
        userId: 'webhook-service',
        description: `Call ${callId} updated via webhook`,
        metadata: {
          callId,
          updatedFields: Object.keys(updateData || {}),
          serviceName,
          upserted: result.upsertedCount > 0
        },
        resourceId: callId,
        resourceName: `Call ${callId}`,
        operationId
      });

      res.json({
        success: true,
        message: 'Call updated successfully',
        data: {
          callId,
          matchedCount: result.matchedCount,
          modifiedCount: result.modifiedCount,
          upsertedCount: result.upsertedCount,
          upsertedId: result.upsertedId
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await CallController.handleError(error, req, operationId, 'webhookUpdateCall', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Error handling
   */
  static async handleError(error, req, operationId, operation, startTime) {
    const duration = Date.now() - startTime;
    
    Logger.error(`Call operation failed: ${operation}`, {
      operationId,
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      subaccountId: req.params?.subaccountId,
      duration: `${duration}ms`
    });

    let statusCode = 500;
    let errorCode = 'CALL_ERROR';
    let message = 'An internal error occurred while creating the call';

    if (error.message.includes('Failed to fetch retell account')) {
      statusCode = 503;
      errorCode = 'RETELL_FETCH_FAILED';
      message = 'Unable to fetch Retell account details. Please try again later.';
    } else if (error.message.includes('Failed to decrypt API key')) {
      statusCode = 500;
      errorCode = 'API_KEY_DECRYPTION_ERROR';
      message = 'Unable to decrypt Retell API key. Please contact support.';
    } else if (error.message.includes('Failed to create web call')) {
      statusCode = 503;
      errorCode = 'WEB_CALL_CREATION_FAILED';
      message = 'Failed to create web call. Please try again later.';
    } else if (error.message.includes('Failed to create connection pool')) {
      statusCode = 503;
      errorCode = 'CONNECTION_FAILED';
      message = 'Unable to connect to the database.';
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

module.exports = CallController; 