const Logger = require('../utils/logger');
const retellService = require('../services/retellService');
const connectionPoolManager = require('../services/connectionPoolManager');
const redisService = require('../services/redisService');
const Retell = require('../utils/retell');
const { v4: uuidv4 } = require('uuid');
const ActivityService = require('../services/activityService');
const { ACTIVITY_TYPES, ACTIVITY_CATEGORIES } = ActivityService;

class ChatController {
  /**
   * Create a new chat with an agent
   * POST /api/chats/:subaccountId/create
   */
  static async createChat(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const { agentId } = req.body;
      const userId = req.user.id;

      Logger.info('Creating chat', {
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
      
      Logger.info('Retell instance created for chat', {
        operationId,
        accountName: retellAccountData.accountName,
        accountId: retellAccountData.id
      });

      // Verify agent exists in database
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
          message: 'Agent not found',
          code: 'AGENT_NOT_FOUND'
        });
      }

      // Create chat with Retell
      const chatResponse = await retell.createChat(agentId);

      // Store chat information in database
      const chatsCollection = connection.db.collection('chats');
      const chatDocument = {
        chat_id: chatResponse.chat_id,
        agent_id: agentId,
        chat_status: chatResponse.chat_status || 'ongoing',
        start_timestamp: chatResponse.start_timestamp || Date.now(),
        end_timestamp: chatResponse.end_timestamp || null,
        transcript: chatResponse.transcript || '',
        message_count: chatResponse.message_with_tool_calls?.length || 0,
        messages: chatResponse.message_with_tool_calls || [],
        metadata: chatResponse.metadata || {},
        retell_llm_dynamic_variables: chatResponse.retell_llm_dynamic_variables || {},
        collected_dynamic_variables: chatResponse.collected_dynamic_variables || {},
        chat_cost: chatResponse.chat_cost || null,
        chat_analysis: chatResponse.chat_analysis || null,
        subaccountId: subaccountId,
        createdBy: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        operationId: operationId,
        retellAccountId: retellAccountData.id
      };

      await chatsCollection.insertOne(chatDocument);
      
      // Cache the chat data
      await redisService.cacheChat(subaccountId, chatResponse.chat_id, chatDocument, 300);
      
      // Invalidate chat list cache
      await redisService.invalidateChatList(subaccountId);
      
      Logger.info('Chat created and stored in database', {
        operationId,
        subaccountId,
        agentId,
        chatId: chatResponse.chat_id
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CHAT_CREATED,
        category: ACTIVITY_CATEGORIES.CHAT,
        userId,
        description: `Chat created with agent ${agentDocument.name || agentId}`,
        metadata: {
          chatId: chatResponse.chat_id,
          agentId,
          agentName: agentDocument.name,
          chatStatus: chatResponse.chat_status
        },
        resourceId: chatResponse.chat_id,
        resourceName: `Chat - ${agentDocument.name || agentId}`,
        operationId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Chat created successfully',
        data: {
          chat_id: chatResponse.chat_id,
          agent_id: chatResponse.agent_id,
          chat_status: chatResponse.chat_status,
          start_timestamp: chatResponse.start_timestamp,
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
      const errorInfo = await ChatController.handleError(error, req, operationId, 'createChat', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Send a message in a chat (create chat completion)
   * POST /api/chats/:subaccountId/:chatId/message
   */
  static async sendMessage(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, chatId } = req.params;
      const { content } = req.body;
      const userId = req.user.id;

      Logger.info('Sending chat message', {
        operationId,
        subaccountId,
        userId,
        chatId
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

      // Create Retell instance
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);

      // Verify chat exists in database
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      
      const chatsCollection = connection.db.collection('chats');
      const chatDocument = await chatsCollection.findOne({ 
        chat_id: chatId,
        subaccountId: subaccountId 
      });

      if (!chatDocument) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found',
          code: 'CHAT_NOT_FOUND'
        });
      }

      // Send message using Retell
      const response = await retell.createChatCompletion(chatId, content);

      // Update chat in database with new messages
      const updateData = {
        messages: response.messages || [],
        message_count: response.messages?.length || 0,
        updatedAt: new Date(),
        lastMessageAt: new Date()
      };

      await chatsCollection.updateOne(
        { chat_id: chatId, subaccountId: subaccountId },
        { $set: updateData }
      );

      // Update cache
      await redisService.invalidateChat(subaccountId, chatId);
      
      Logger.info('Chat message sent and stored', {
        operationId,
        subaccountId,
        chatId,
        messageCount: response.messages?.length || 0
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CHAT_MESSAGE_SENT,
        category: ACTIVITY_CATEGORIES.CHAT,
        userId,
        description: `Message sent in chat ${chatId}`,
        metadata: {
          chatId,
          agentId: chatDocument.agent_id,
          messageCount: response.messages?.length || 0
        },
        resourceId: chatId,
        resourceName: `Chat ${chatId}`,
        operationId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Message sent successfully',
        data: {
          chat_id: chatId,
          messages: response.messages
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await ChatController.handleError(error, req, operationId, 'sendMessage', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * End a chat
   * POST /api/chats/:subaccountId/:chatId/end
   */
  static async endChat(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, chatId } = req.params;
      const userId = req.user.id;

      Logger.info('Ending chat', {
        operationId,
        subaccountId,
        userId,
        chatId
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

      // Create Retell instance
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);

      // Verify chat exists in database
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      
      const chatsCollection = connection.db.collection('chats');
      const chatDocument = await chatsCollection.findOne({ 
        chat_id: chatId,
        subaccountId: subaccountId 
      });

      if (!chatDocument) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found',
          code: 'CHAT_NOT_FOUND'
        });
      }

      // End chat using Retell
      await retell.endChat(chatId);

      // Retrieve final chat state from Retell to get complete transcript and analysis
      const finalChatState = await retell.retrieveChat(chatId);

      // Update chat in database
      const updateData = {
        chat_status: 'ended',
        end_timestamp: finalChatState.end_timestamp || Date.now(),
        transcript: finalChatState.transcript || chatDocument.transcript,
        messages: finalChatState.message_with_tool_calls || chatDocument.messages,
        message_count: finalChatState.message_with_tool_calls?.length || chatDocument.message_count,
        chat_cost: finalChatState.chat_cost || chatDocument.chat_cost,
        chat_analysis: finalChatState.chat_analysis || chatDocument.chat_analysis,
        collected_dynamic_variables: finalChatState.collected_dynamic_variables || chatDocument.collected_dynamic_variables,
        updatedAt: new Date(),
        endedAt: new Date()
      };

      await chatsCollection.updateOne(
        { chat_id: chatId, subaccountId: subaccountId },
        { $set: updateData }
      );

      // Update cache
      await redisService.invalidateChat(subaccountId, chatId);
      await redisService.invalidateChatList(subaccountId);
      
      Logger.info('Chat ended and updated in database', {
        operationId,
        subaccountId,
        chatId
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CHAT_ENDED,
        category: ACTIVITY_CATEGORIES.CHAT,
        userId,
        description: `Chat ${chatId} ended`,
        metadata: {
          chatId,
          agentId: chatDocument.agent_id,
          messageCount: updateData.message_count,
          duration: updateData.end_timestamp - chatDocument.start_timestamp
        },
        resourceId: chatId,
        resourceName: `Chat ${chatId}`,
        operationId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Chat ended successfully',
        data: {
          chat_id: chatId,
          chat_status: 'ended',
          end_timestamp: updateData.end_timestamp
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await ChatController.handleError(error, req, operationId, 'endChat', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * List all chats (with minimal data - start time and message count only)
   * GET /api/chats/:subaccountId/list
   */
  static async listChats(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;

      Logger.info('Listing chats', {
        operationId,
        subaccountId,
        userId
      });

      // Check cache first
      const cachedList = await redisService.getCachedChatList(subaccountId);
      if (cachedList) {
        Logger.debug('Using cached chat list', { subaccountId });
        
        const duration = Date.now() - startTime;
        return res.json({
          success: true,
          message: 'Chats retrieved successfully (cached)',
          data: cachedList,
          meta: {
            operationId,
            duration: `${duration}ms`,
            cached: true
          }
        });
      }

      // Get connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      
      const chatsCollection = connection.db.collection('chats');
      
      // Retrieve chats with only minimal fields
      const chats = await chatsCollection
        .find({ subaccountId: subaccountId })
        .project({
          chat_id: 1,
          agent_id: 1,
          chat_status: 1,
          start_timestamp: 1,
          end_timestamp: 1,
          message_count: 1,
          createdAt: 1,
          _id: 0
        })
        .sort({ start_timestamp: -1 })
        .toArray();

      // Cache the result
      await redisService.cacheChatList(subaccountId, chats, 60);

      Logger.info('Chats listed successfully', {
        operationId,
        subaccountId,
        count: chats.length
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Chats retrieved successfully',
        data: chats,
        meta: {
          operationId,
          duration: `${duration}ms`,
          count: chats.length,
          cached: false
        }
      });

    } catch (error) {
      const errorInfo = await ChatController.handleError(error, req, operationId, 'listChats', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Get full transcript of a chat
   * GET /api/chats/:subaccountId/:chatId/transcript
   */
  static async getChatTranscript(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, chatId } = req.params;
      const userId = req.user.id;

      Logger.info('Getting chat transcript', {
        operationId,
        subaccountId,
        userId,
        chatId
      });

      // Check cache first
      const cachedChat = await redisService.getCachedChat(subaccountId, chatId);
      if (cachedChat) {
        Logger.debug('Using cached chat data', { subaccountId, chatId });
        
        const duration = Date.now() - startTime;
        return res.json({
          success: true,
          message: 'Chat transcript retrieved successfully (cached)',
          data: {
            chat_id: cachedChat.chat_id,
            agent_id: cachedChat.agent_id,
            chat_status: cachedChat.chat_status,
            start_timestamp: cachedChat.start_timestamp,
            end_timestamp: cachedChat.end_timestamp,
            transcript: cachedChat.transcript,
            messages: cachedChat.messages,
            message_count: cachedChat.message_count,
            chat_cost: cachedChat.chat_cost,
            chat_analysis: cachedChat.chat_analysis,
            metadata: cachedChat.metadata,
            retell_llm_dynamic_variables: cachedChat.retell_llm_dynamic_variables,
            collected_dynamic_variables: cachedChat.collected_dynamic_variables
          },
          meta: {
            operationId,
            duration: `${duration}ms`,
            cached: true
          }
        });
      }

      // Get from database
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      
      const chatsCollection = connection.db.collection('chats');
      const chatDocument = await chatsCollection.findOne({ 
        chat_id: chatId,
        subaccountId: subaccountId 
      });

      if (!chatDocument) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found',
          code: 'CHAT_NOT_FOUND'
        });
      }

      // If chat is still ongoing, fetch latest from Retell
      if (chatDocument.chat_status === 'ongoing') {
        const retellAccountData = await retellService.getRetellAccount(subaccountId);
        const retell = new Retell(retellAccountData.apiKey, retellAccountData);
        
        try {
          const latestChatData = await retell.retrieveChat(chatId);
          
          // Update database with latest data
          const updateData = {
            transcript: latestChatData.transcript || chatDocument.transcript,
            messages: latestChatData.message_with_tool_calls || chatDocument.messages,
            message_count: latestChatData.message_with_tool_calls?.length || chatDocument.message_count,
            chat_status: latestChatData.chat_status || chatDocument.chat_status,
            end_timestamp: latestChatData.end_timestamp || chatDocument.end_timestamp,
            chat_cost: latestChatData.chat_cost || chatDocument.chat_cost,
            chat_analysis: latestChatData.chat_analysis || chatDocument.chat_analysis,
            collected_dynamic_variables: latestChatData.collected_dynamic_variables || chatDocument.collected_dynamic_variables,
            updatedAt: new Date()
          };

          await chatsCollection.updateOne(
            { chat_id: chatId, subaccountId: subaccountId },
            { $set: updateData }
          );

          // Update chatDocument with latest data
          Object.assign(chatDocument, updateData);
        } catch (retellError) {
          Logger.warn('Failed to fetch latest chat data from Retell, using cached data', {
            chatId,
            error: retellError.message
          });
        }
      }

      // Cache the result
      await redisService.cacheChat(subaccountId, chatId, chatDocument, 300);

      Logger.info('Chat transcript retrieved successfully', {
        operationId,
        subaccountId,
        chatId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Chat transcript retrieved successfully',
        data: {
          chat_id: chatDocument.chat_id,
          agent_id: chatDocument.agent_id,
          chat_status: chatDocument.chat_status,
          start_timestamp: chatDocument.start_timestamp,
          end_timestamp: chatDocument.end_timestamp,
          transcript: chatDocument.transcript,
          messages: chatDocument.messages,
          message_count: chatDocument.message_count,
          chat_cost: chatDocument.chat_cost,
          chat_analysis: chatDocument.chat_analysis,
          metadata: chatDocument.metadata,
          retell_llm_dynamic_variables: chatDocument.retell_llm_dynamic_variables,
          collected_dynamic_variables: chatDocument.collected_dynamic_variables
        },
        meta: {
          operationId,
          duration: `${duration}ms`,
          cached: false
        }
      });

    } catch (error) {
      const errorInfo = await ChatController.handleError(error, req, operationId, 'getChatTranscript', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Error handling
   */
  static async handleError(error, req, operationId, operation, startTime) {
    const duration = Date.now() - startTime;
    
    Logger.error(`Chat operation failed: ${operation}`, {
      operationId,
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      subaccountId: req.params?.subaccountId,
      chatId: req.params?.chatId,
      duration: `${duration}ms`
    });

    let statusCode = 500;
    let errorCode = 'CHAT_ERROR';
    let message = 'An internal error occurred while processing the chat operation';

    if (error.message.includes('Failed to fetch retell account')) {
      statusCode = 503;
      errorCode = 'RETELL_FETCH_FAILED';
      message = 'Unable to fetch Retell account details. Please try again later.';
    } else if (error.message.includes('Failed to decrypt API key')) {
      statusCode = 500;
      errorCode = 'API_KEY_DECRYPTION_ERROR';
      message = 'Unable to decrypt Retell API key. Please contact support.';
    } else if (error.message.includes('Failed to create chat')) {
      statusCode = 503;
      errorCode = 'CHAT_CREATION_FAILED';
      message = 'Failed to create chat. Please try again later.';
    } else if (error.message.includes('Failed to end chat')) {
      statusCode = 503;
      errorCode = 'CHAT_END_FAILED';
      message = 'Failed to end chat. Please try again later.';
    } else if (error.message.includes('Failed to create chat completion')) {
      statusCode = 503;
      errorCode = 'MESSAGE_SEND_FAILED';
      message = 'Failed to send message. Please try again later.';
    } else if (error.message.includes('Failed to retrieve chat')) {
      statusCode = 503;
      errorCode = 'CHAT_RETRIEVE_FAILED';
      message = 'Failed to retrieve chat. Please try again later.';
    } else if (error.message.includes('Failed to list chats')) {
      statusCode = 503;
      errorCode = 'CHAT_LIST_FAILED';
      message = 'Failed to list chats. Please try again later.';
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

module.exports = ChatController; 