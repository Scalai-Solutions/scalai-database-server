const Logger = require('../utils/logger');
const instagramService = require('../services/instagramService');
const connectionPoolManager = require('../services/connectionPoolManager');
const { v4: uuidv4 } = require('uuid');
const ActivityService = require('../services/activityService');
const { ACTIVITY_TYPES, ACTIVITY_CATEGORIES } = ActivityService;

class InstagramController {
  /**
   * Initialize Instagram connection and generate QR code
   * POST /api/instagram/:subaccountId/:agentId/connect
   */
  static async connect(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;
      const { accessToken, instagramAccountId, pageId, webhookVerificationToken, webhookSecret } = req.body;

      Logger.info('Initializing Instagram connection', {
        operationId,
        subaccountId,
        agentId,
        userId
      });

      // Verify agent exists
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      
      const agentsCollection = connection.db.collection('chatagents');
      const agentDocument = await agentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Chat agent not found',
          code: 'AGENT_NOT_FOUND'
        });
      }

      // Initialize Instagram connection
      const config = {};
      if (accessToken) config.accessToken = accessToken;
      if (instagramAccountId) config.instagramAccountId = instagramAccountId;
      if (pageId) config.pageId = pageId;
      if (webhookVerificationToken) config.webhookVerificationToken = webhookVerificationToken;
      if (webhookSecret) config.webhookSecret = webhookSecret;

      const result = await instagramService.initializeConnection(subaccountId, agentId, userId, config);

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.INSTAGRAM_CONNECTED,
        category: ACTIVITY_CATEGORIES.CHAT,
        userId,
        description: `Instagram connection initiated for agent ${agentDocument.name || agentId}`,
        metadata: {
          agentId,
          agentName: agentDocument.name,
          qrGenerated: true
        },
        resourceId: agentId,
        resourceName: `Instagram - ${agentDocument.name || agentId}`,
        operationId,
        agentId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Instagram QR code generated. Scan with your mobile app or connect via API.',
        data: result.data,
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await InstagramController.handleError(error, req, operationId, 'connect', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Get Instagram connection status
   * GET /api/instagram/:subaccountId/:agentId/status
   */
  static async getStatus(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;

      Logger.info('Getting Instagram connection status', {
        operationId,
        subaccountId,
        agentId,
        userId
      });

      const result = await instagramService.getConnectionStatus(subaccountId, agentId);

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Instagram connection status retrieved',
        data: result.data || result,
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await InstagramController.handleError(error, req, operationId, 'getStatus', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Disconnect Instagram
   * POST /api/instagram/:subaccountId/:agentId/disconnect
   */
  static async disconnect(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;

      Logger.info('Disconnecting Instagram', {
        operationId,
        subaccountId,
        agentId,
        userId
      });

      const result = await instagramService.disconnect(subaccountId, agentId, userId);

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.INSTAGRAM_DISCONNECTED,
        category: ACTIVITY_CATEGORIES.CHAT,
        userId,
        description: `Instagram disconnected for agent ${agentId}`,
        metadata: {
          agentId
        },
        resourceId: agentId,
        resourceName: `Instagram - ${agentId}`,
        operationId,
        agentId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Instagram disconnected successfully',
        data: result.data || result,
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await InstagramController.handleError(error, req, operationId, 'disconnect', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Send Instagram message
   * POST /api/instagram/:subaccountId/:agentId/send
   */
  static async sendMessage(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const { to, message } = req.body;
      const userId = req.user.id;

      Logger.info('Sending Instagram message', {
        operationId,
        subaccountId,
        agentId,
        to,
        userId
      });

      if (!to || !message) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: to, message',
          code: 'VALIDATION_ERROR'
        });
      }

      const result = await instagramService.sendMessage(subaccountId, agentId, to, message);

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.INSTAGRAM_MESSAGE_SENT,
        category: ACTIVITY_CATEGORIES.CHAT,
        userId,
        description: `Instagram message sent to ${to}`,
        metadata: {
          agentId,
          to,
          messageId: result.data?.messageId
        },
        resourceId: agentId,
        resourceName: `Instagram - ${agentId}`,
        operationId,
        agentId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Instagram message sent successfully',
        data: result.data,
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await InstagramController.handleError(error, req, operationId, 'sendMessage', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Get message history
   * GET /api/instagram/:subaccountId/:agentId/messages
   */
  static async getMessages(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const { limit, skip } = req.query;
      const userId = req.user.id;

      Logger.info('Getting Instagram message history', {
        operationId,
        subaccountId,
        agentId,
        limit,
        skip,
        userId
      });

      const result = await instagramService.getMessageHistory(
        subaccountId, 
        agentId, 
        userId,
        {
          limit: parseInt(limit) || 50,
          skip: parseInt(skip) || 0
        }
      );

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Instagram message history retrieved',
        data: result.data,
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await InstagramController.handleError(error, req, operationId, 'getMessages', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Get all Instagram connections for a subaccount
   * GET /api/instagram/:subaccountId/connections
   */
  static async getConnections(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;

      Logger.info('Getting Instagram connections', {
        operationId,
        subaccountId,
        userId
      });

      const result = await instagramService.getConnections(subaccountId, userId);

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Instagram connections retrieved',
        data: result.data,
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await InstagramController.handleError(error, req, operationId, 'getConnections', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Handle Instagram webhook
   * POST /api/instagram/:subaccountId/:agentId/webhook
   */
  static async webhook(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      // Webhook verification (Instagram/Meta webhook setup)
      if (mode === 'subscribe') {
        // Get verification token from database
        const connectionInfo = await connectionPoolManager.getConnection(subaccountId, 'system');
        const { connection } = connectionInfo;
        const instagramConnectionsCollection = connection.db.collection('instagramconnections');
        const configDoc = await instagramConnectionsCollection.findOne({
          subaccountId,
          agentId
        });

        const expectedToken = configDoc?.webhookVerificationToken || 'default_verification_token';

        if (token === expectedToken) {
          Logger.info('Instagram webhook verified', {
            subaccountId,
            agentId
          });
          return res.status(200).send(challenge);
        } else {
          Logger.warn('Instagram webhook verification failed', {
            subaccountId,
            agentId,
            receivedToken: token
          });
          return res.status(403).send('Forbidden');
        }
      }

      // Handle incoming webhook data
      const webhookData = req.body;
      
      Logger.info('Instagram webhook received', {
        operationId,
        subaccountId,
        agentId
      });

      await instagramService.processWebhook(subaccountId, agentId, webhookData);

      const duration = Date.now() - startTime;

      // Return 200 OK immediately (Meta requires this)
      res.status(200).json({
        success: true,
        message: 'Webhook processed',
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await InstagramController.handleError(error, req, operationId, 'webhook', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Error handling
   */
  static async handleError(error, req, operationId, operation, startTime) {
    const duration = Date.now() - startTime;
    
    Logger.error(`Instagram operation failed: ${operation}`, {
      operationId,
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      subaccountId: req.params?.subaccountId,
      agentId: req.params?.agentId,
      duration: `${duration}ms`
    });

    let statusCode = 500;
    let errorCode = 'INSTAGRAM_ERROR';
    let message = 'An internal error occurred while processing the Instagram operation';

    if (error.message.includes('not connected')) {
      statusCode = 400;
      errorCode = 'NOT_CONNECTED';
      message = error.message;
    } else if (error.message.includes('not found')) {
      statusCode = 404;
      errorCode = 'NOT_FOUND';
      message = error.message;
    } else if (error.message.includes('timeout')) {
      statusCode = 408;
      errorCode = 'TIMEOUT';
      message = 'Instagram operation timed out. Please try again.';
    } else if (error.message.includes('authentication') || error.message.includes('access token')) {
      statusCode = 401;
      errorCode = 'AUTH_FAILED';
      message = 'Instagram authentication failed. Please reconnect.';
    } else if (error.message.includes('API error')) {
      statusCode = 400;
      errorCode = 'API_ERROR';
      message = error.message;
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

module.exports = InstagramController;

