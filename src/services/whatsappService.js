const WhatsAppConnector = require('../connectors/WhatsAppConnector');
const Logger = require('../utils/logger');
const connectionPoolManager = require('./connectionPoolManager');
const redisService = require('./redisService');

/**
 * WhatsApp Service
 * Manages WhatsApp connections and sessions
 */
class WhatsAppService {
  constructor() {
    // Store active WhatsApp connectors by sessionId
    this.activeConnectors = new Map();
  }

  /**
   * Get or create WhatsApp connector for a subaccount/agent
   */
  async getConnector(subaccountId, agentId, userId) {
    try {
      const sessionId = `${subaccountId}_${agentId}`;

      // Check if connector already exists
      if (this.activeConnectors.has(sessionId)) {
        const connector = this.activeConnectors.get(sessionId);
        Logger.debug('Using existing WhatsApp connector', {
          sessionId,
          subaccountId,
          agentId
        });
        return connector;
      }

      // Create new connector
      const connector = new WhatsAppConnector({
        subaccountId,
        agentId,
        sessionId
      });

      // Store in active connectors
      this.activeConnectors.set(sessionId, connector);

      Logger.info('Created new WhatsApp connector', {
        sessionId,
        subaccountId,
        agentId
      });

      return connector;
    } catch (error) {
      Logger.error('Error getting WhatsApp connector', {
        error: error.message,
        subaccountId,
        agentId
      });
      throw error;
    }
  }

  /**
   * Initialize WhatsApp connection and generate QR code
   */
  async initializeConnection(subaccountId, agentId, userId) {
    try {
      Logger.info('Initializing WhatsApp connection', {
        subaccountId,
        agentId,
        userId
      });

      const connector = await this.getConnector(subaccountId, agentId, userId);

      // Setup callbacks to update database
      connector.onReady(async () => {
        await this.updateConnectionStatus(subaccountId, agentId, userId, 'connected');
      });

      connector.onDisconnect(async (reason) => {
        await this.updateConnectionStatus(subaccountId, agentId, userId, 'disconnected', { reason });
      });

      // Setup message handler
      connector.onMessage(async (message) => {
        await this.handleIncomingMessage(subaccountId, agentId, message);
      });

      // Initialize connector (this will trigger QR generation)
      await connector.initialize();

      // Generate QR code
      const qrResult = await connector.generateQR();

      // Store connection info in database
      await this.storeConnectionInfo(subaccountId, agentId, userId, {
        status: 'pending',
        qrGenerated: true
      });

      return qrResult;
    } catch (error) {
      Logger.error('Error initializing WhatsApp connection', {
        error: error.message,
        subaccountId,
        agentId
      });
      throw error;
    }
  }

  /**
   * Get connection status
   */
  async getConnectionStatus(subaccountId, agentId) {
    try {
      const sessionId = `${subaccountId}_${agentId}`;

      // Check if connector exists
      if (!this.activeConnectors.has(sessionId)) {
        return {
          success: true,
          data: {
            isConnected: false,
            status: 'not_initialized'
          }
        };
      }

      const connector = this.activeConnectors.get(sessionId);
      return await connector.getConnectionStatus();
    } catch (error) {
      Logger.error('Error getting WhatsApp connection status', {
        error: error.message,
        subaccountId,
        agentId
      });
      throw error;
    }
  }

  /**
   * Disconnect WhatsApp
   */
  async disconnect(subaccountId, agentId, userId) {
    try {
      const sessionId = `${subaccountId}_${agentId}`;

      if (!this.activeConnectors.has(sessionId)) {
        return {
          success: true,
          message: 'WhatsApp not connected'
        };
      }

      const connector = this.activeConnectors.get(sessionId);
      const result = await connector.disconnect();

      // Remove from active connectors
      this.activeConnectors.delete(sessionId);

      // Update database
      await this.updateConnectionStatus(subaccountId, agentId, userId, 'disconnected');

      Logger.info('WhatsApp disconnected', {
        subaccountId,
        agentId
      });

      return result;
    } catch (error) {
      Logger.error('Error disconnecting WhatsApp', {
        error: error.message,
        subaccountId,
        agentId
      });
      throw error;
    }
  }

  /**
   * Send WhatsApp message
   */
  async sendMessage(subaccountId, agentId, to, message, options = {}) {
    try {
      const sessionId = `${subaccountId}_${agentId}`;

      if (!this.activeConnectors.has(sessionId)) {
        throw new Error('WhatsApp not connected. Please connect first.');
      }

      const connector = this.activeConnectors.get(sessionId);
      
      if (!connector.isConnected) {
        throw new Error('WhatsApp is not connected');
      }

      const result = await connector.sendMessage(to, message, options);

      return result;
    } catch (error) {
      Logger.error('Error sending WhatsApp message', {
        error: error.message,
        subaccountId,
        agentId,
        to
      });
      throw error;
    }
  }

  /**
   * Handle incoming WhatsApp message and forward to chat agent
   */
  async handleIncomingMessage(subaccountId, agentId, message) {
    try {
      Logger.info('Handling incoming WhatsApp message', {
        subaccountId,
        agentId,
        from: message.from,
        messageId: message.id._serialized
      });

      // Get sender's phone number (without @c.us suffix)
      const phoneNumber = message.from.replace('@c.us', '');

      // Forward message to chat agent and get response
      const agentResponse = await this.forwardToChageAgent(
        subaccountId, 
        agentId, 
        phoneNumber,
        message.body
      );

      // Send agent's response back via WhatsApp
      if (agentResponse && agentResponse.reply) {
        await this.sendMessage(subaccountId, agentId, message.from, agentResponse.reply);
        
        Logger.info('Chat agent response sent via WhatsApp', {
          subaccountId,
          agentId,
          to: message.from
        });
      }
      
    } catch (error) {
      Logger.error('Error handling incoming message', {
        error: error.message,
        subaccountId,
        agentId
      });
      
      // Send error message to user
      const sessionId = `${subaccountId}_${agentId}`;
      if (this.activeConnectors.has(sessionId)) {
        const connector = this.activeConnectors.get(sessionId);
        try {
          await connector.sendMessage(
            message.from, 
            "Sorry, I'm having trouble processing your message right now. Please try again later."
          );
        } catch (sendError) {
          Logger.error('Failed to send error message', { error: sendError.message });
        }
      }
    }
  }

  /**
   * Forward message to chat agent and get response
   */
  async forwardToChageAgent(subaccountId, agentId, phoneNumber, messageContent) {
    try {
      const retellService = require('./retellService');
      const Retell = require('../utils/retell');
      
      // Get or create chat session for this WhatsApp contact
      const chatId = await this.getOrCreateChatSession(subaccountId, agentId, phoneNumber);
      
      // Get retell account data
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      
      if (!retellAccountData.isActive) {
        throw new Error('Retell account is not active');
      }

      // Create Retell instance
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);
      
      // Send message to chat agent and get completion
      const response = await retell.createChatCompletion(chatId, messageContent);
      
      // Update chat in database
      await this.updateChatSession(subaccountId, chatId, response);
      
      // Extract the agent's reply from the response
      const agentReply = this.extractAgentReply(response);
      
      Logger.info('Chat agent processed WhatsApp message', {
        subaccountId,
        agentId,
        chatId,
        phoneNumber,
        hasReply: !!agentReply
      });
      
      return {
        chatId,
        reply: agentReply
      };
      
    } catch (error) {
      Logger.error('Error forwarding to chat agent', {
        error: error.message,
        subaccountId,
        agentId,
        phoneNumber
      });
      throw error;
    }
  }

  /**
   * Get or create chat session for WhatsApp contact
   */
  async getOrCreateChatSession(subaccountId, agentId, phoneNumber) {
    try {
      const systemUserId = 'whatsapp-service';
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, systemUserId);
      const { connection } = connectionInfo;
      
      const chatsCollection = connection.db.collection('chats');
      
      // Look for existing active chat for this WhatsApp contact
      let chatDocument = await chatsCollection.findOne({
        subaccountId,
        agent_id: agentId,
        'metadata.whatsapp_phone': phoneNumber,
        chat_status: 'ongoing'
      });
      
      if (chatDocument) {
        Logger.debug('Using existing chat session for WhatsApp contact', {
          chatId: chatDocument.chat_id,
          phoneNumber
        });
        return chatDocument.chat_id;
      }
      
      // Create new chat session
      const retellService = require('./retellService');
      const Retell = require('../utils/retell');
      
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);
      
      const chatResponse = await retell.createChat(agentId);
      
      // Store chat with WhatsApp metadata
      const newChatDocument = {
        chat_id: chatResponse.chat_id,
        agent_id: agentId,
        chat_status: 'ongoing',
        start_timestamp: chatResponse.start_timestamp || Date.now(),
        end_timestamp: null,
        transcript: '',
        message_count: 0,
        messages: [],
        metadata: {
          whatsapp_phone: phoneNumber,
          channel: 'whatsapp'
        },
        retell_llm_dynamic_variables: {},
        collected_dynamic_variables: {},
        subaccountId,
        createdBy: 'whatsapp-service',
        createdAt: new Date(),
        updatedAt: new Date(),
        retellAccountId: retellAccountData.id
      };
      
      await chatsCollection.insertOne(newChatDocument);
      
      Logger.info('Created new chat session for WhatsApp contact', {
        chatId: chatResponse.chat_id,
        phoneNumber,
        agentId
      });
      
      return chatResponse.chat_id;
      
    } catch (error) {
      Logger.error('Error getting/creating chat session', {
        error: error.message,
        subaccountId,
        agentId,
        phoneNumber
      });
      throw error;
    }
  }

  /**
   * Update chat session with new messages
   */
  async updateChatSession(subaccountId, chatId, response) {
    try {
      const systemUserId = 'whatsapp-service';
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, systemUserId);
      const { connection } = connectionInfo;
      
      const chatsCollection = connection.db.collection('chats');
      
      const updateData = {
        messages: response.messages || [],
        message_count: response.messages?.length || 0,
        updatedAt: new Date(),
        lastMessageAt: new Date()
      };
      
      await chatsCollection.updateOne(
        { chat_id: chatId, subaccountId },
        { $set: updateData }
      );
      
      Logger.debug('Updated chat session', { chatId, subaccountId });
      
    } catch (error) {
      Logger.error('Error updating chat session', {
        error: error.message,
        chatId,
        subaccountId
      });
    }
  }

  /**
   * Extract agent's reply from chat completion response
   */
  extractAgentReply(response) {
    try {
      // Get the last message from the agent (not from user)
      const messages = response.messages || [];
      
      if (messages.length === 0) {
        return null;
      }
      
      // Find the last assistant message
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'assistant' && msg.content) {
          return msg.content;
        }
      }
      
      // Fallback: return the last message content
      const lastMessage = messages[messages.length - 1];
      return lastMessage.content || null;
      
    } catch (error) {
      Logger.error('Error extracting agent reply', {
        error: error.message
      });
      return null;
    }
  }

  /**
   * Store connection info in database
   */
  async storeConnectionInfo(subaccountId, agentId, userId, data) {
    try {
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      const whatsappConnectionsCollection = connection.db.collection('whatsappconnections');

      const document = {
        subaccountId,
        agentId,
        status: data.status,
        qrGenerated: data.qrGenerated,
        connectedAt: data.connectedAt || null,
        phoneNumber: data.phoneNumber || null,
        platform: data.platform || null,
        pushname: data.pushname || null,
        createdBy: userId,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await whatsappConnectionsCollection.updateOne(
        { subaccountId, agentId },
        { $set: document },
        { upsert: true }
      );

      Logger.info('WhatsApp connection info stored', {
        subaccountId,
        agentId
      });
    } catch (error) {
      Logger.error('Error storing connection info', {
        error: error.message,
        subaccountId,
        agentId
      });
    }
  }

  /**
   * Update connection status in database
   */
  async updateConnectionStatus(subaccountId, agentId, userId, status, additionalData = {}) {
    try {
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      const whatsappConnectionsCollection = connection.db.collection('whatsappconnections');

      const updateData = {
        status,
        updatedAt: new Date(),
        ...additionalData
      };

      if (status === 'connected') {
        updateData.connectedAt = new Date();
      } else if (status === 'disconnected') {
        updateData.disconnectedAt = new Date();
      }

      await whatsappConnectionsCollection.updateOne(
        { subaccountId, agentId },
        { $set: updateData }
      );

      Logger.info('WhatsApp connection status updated', {
        subaccountId,
        agentId,
        status
      });
    } catch (error) {
      Logger.error('Error updating connection status', {
        error: error.message,
        subaccountId,
        agentId
      });
    }
  }

  /**
   * Get chat sessions for WhatsApp contacts (uses existing chat storage)
   */
  async getMessageHistory(subaccountId, agentId, userId, options = {}) {
    try {
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      const chatsCollection = connection.db.collection('chats');

      const limit = options.limit || 50;
      const skip = options.skip || 0;

      // Get chats that originated from WhatsApp
      const chats = await chatsCollection
        .find({ 
          subaccountId, 
          agent_id: agentId,
          'metadata.channel': 'whatsapp'
        })
        .sort({ start_timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .project({
          chat_id: 1,
          agent_id: 1,
          chat_status: 1,
          start_timestamp: 1,
          end_timestamp: 1,
          message_count: 1,
          messages: 1,
          metadata: 1,
          createdAt: 1,
          _id: 0
        })
        .toArray();

      return {
        success: true,
        data: {
          chats,
          count: chats.length
        }
      };
    } catch (error) {
      Logger.error('Error getting WhatsApp chat history', {
        error: error.message,
        subaccountId,
        agentId
      });
      throw error;
    }
  }

  /**
   * Get all WhatsApp connections for a subaccount
   */
  async getConnections(subaccountId, userId) {
    try {
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      const whatsappConnectionsCollection = connection.db.collection('whatsappconnections');

      const connections = await whatsappConnectionsCollection
        .find({ subaccountId })
        .toArray();

      return {
        success: true,
        data: {
          connections,
          count: connections.length
        }
      };
    } catch (error) {
      Logger.error('Error getting WhatsApp connections', {
        error: error.message,
        subaccountId
      });
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new WhatsAppService();

