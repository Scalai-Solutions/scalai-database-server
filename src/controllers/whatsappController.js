const Logger = require('../utils/logger');
const whatsappService = require('../services/whatsappService');
const connectionPoolManager = require('../services/connectionPoolManager');
const { v4: uuidv4 } = require('uuid');
const ActivityService = require('../services/activityService');
const { ACTIVITY_TYPES, ACTIVITY_CATEGORIES } = ActivityService;

class WhatsAppController {
  /**
   * Initialize WhatsApp connection and generate QR code
   * POST /api/whatsapp/:subaccountId/:agentId/connect
   */
  static async connect(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;

      Logger.info('Initializing WhatsApp connection', {
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

      // Initialize WhatsApp connection
      const result = await whatsappService.initializeConnection(subaccountId, agentId, userId);

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.WHATSAPP_CONNECTED,
        category: ACTIVITY_CATEGORIES.CHAT,
        userId,
        description: `WhatsApp connection initiated for agent ${agentDocument.name || agentId}`,
        metadata: {
          agentId,
          agentName: agentDocument.name,
          qrGenerated: true
        },
        resourceId: agentId,
        resourceName: `WhatsApp - ${agentDocument.name || agentId}`,
        operationId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'WhatsApp QR code generated. Scan with your mobile app.',
        data: result.data,
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await WhatsAppController.handleError(error, req, operationId, 'connect', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Get WhatsApp connection status
   * GET /api/whatsapp/:subaccountId/:agentId/status
   */
  static async getStatus(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;

      Logger.info('Getting WhatsApp connection status', {
        operationId,
        subaccountId,
        agentId,
        userId
      });

      const result = await whatsappService.getConnectionStatus(subaccountId, agentId);

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'WhatsApp connection status retrieved',
        data: result.data || result,
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await WhatsAppController.handleError(error, req, operationId, 'getStatus', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Disconnect WhatsApp
   * POST /api/whatsapp/:subaccountId/:agentId/disconnect
   */
  static async disconnect(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;

      Logger.info('Disconnecting WhatsApp', {
        operationId,
        subaccountId,
        agentId,
        userId
      });

      const result = await whatsappService.disconnect(subaccountId, agentId, userId);

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.WHATSAPP_DISCONNECTED,
        category: ACTIVITY_CATEGORIES.CHAT,
        userId,
        description: `WhatsApp disconnected for agent ${agentId}`,
        metadata: {
          agentId
        },
        resourceId: agentId,
        resourceName: `WhatsApp - ${agentId}`,
        operationId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'WhatsApp disconnected successfully',
        data: result.data || result,
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await WhatsAppController.handleError(error, req, operationId, 'disconnect', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Send WhatsApp message
   * POST /api/whatsapp/:subaccountId/:agentId/send
   */
  static async sendMessage(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const { to, message } = req.body;
      const userId = req.user.id;

      Logger.info('Sending WhatsApp message', {
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

      const result = await whatsappService.sendMessage(subaccountId, agentId, to, message);

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.WHATSAPP_MESSAGE_SENT,
        category: ACTIVITY_CATEGORIES.CHAT,
        userId,
        description: `WhatsApp message sent to ${to}`,
        metadata: {
          agentId,
          to,
          messageId: result.data?.messageId
        },
        resourceId: agentId,
        resourceName: `WhatsApp - ${agentId}`,
        operationId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'WhatsApp message sent successfully',
        data: result.data,
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await WhatsAppController.handleError(error, req, operationId, 'sendMessage', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Get message history
   * GET /api/whatsapp/:subaccountId/:agentId/messages
   */
  static async getMessages(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const { limit, skip } = req.query;
      const userId = req.user.id;

      Logger.info('Getting WhatsApp message history', {
        operationId,
        subaccountId,
        agentId,
        limit,
        skip,
        userId
      });

      const result = await whatsappService.getMessageHistory(
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
        message: 'WhatsApp message history retrieved',
        data: result.data,
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await WhatsAppController.handleError(error, req, operationId, 'getMessages', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Get all WhatsApp connections for a subaccount
   * GET /api/whatsapp/:subaccountId/connections
   */
  static async getConnections(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;

      Logger.info('Getting WhatsApp connections', {
        operationId,
        subaccountId,
        userId
      });

      const result = await whatsappService.getConnections(subaccountId, userId);

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'WhatsApp connections retrieved',
        data: result.data,
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await WhatsAppController.handleError(error, req, operationId, 'getConnections', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Error handling
   */
  static async handleError(error, req, operationId, operation, startTime) {
    const duration = Date.now() - startTime;
    
    Logger.error(`WhatsApp operation failed: ${operation}`, {
      operationId,
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      subaccountId: req.params?.subaccountId,
      agentId: req.params?.agentId,
      duration: `${duration}ms`
    });

    let statusCode = 500;
    let errorCode = 'WHATSAPP_ERROR';
    let message = 'An internal error occurred while processing the WhatsApp operation';

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
      message = 'WhatsApp operation timed out. Please try again.';
    } else if (error.message.includes('authentication')) {
      statusCode = 401;
      errorCode = 'AUTH_FAILED';
      message = 'WhatsApp authentication failed. Please reconnect.';
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

module.exports = WhatsAppController;

