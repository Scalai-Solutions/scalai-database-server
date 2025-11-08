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
   * If forceNew is true, it will clean up any existing connector and session files first
   */
  async getConnector(subaccountId, agentId, userId, forceNew = false) {
    try {
      const sessionId = `${subaccountId}_${agentId}`;

      // If forceNew is true, clean up existing connector and session files
      if (forceNew) {
        Logger.info('Force new connector requested, cleaning up existing session', {
          sessionId,
          subaccountId,
          agentId
        });

        if (this.activeConnectors.has(sessionId)) {
          const existingConnector = this.activeConnectors.get(sessionId);
          try {
            Logger.info('Disconnecting existing connector', { sessionId });
            await existingConnector.disconnect();
          } catch (error) {
            Logger.warn('Error disconnecting existing connector', {
              error: error.message,
              sessionId
            });
          }
          this.activeConnectors.delete(sessionId);
          Logger.info('Existing connector removed from active connectors', { sessionId });
        }

        // Clean up session files BEFORE creating new connector
        Logger.info('Cleaning up session files before creating new connector', { sessionId });
        const cleanupResult = await this.cleanupSessionFiles(sessionId);
        
        Logger.info('Session cleanup completed', {
          sessionId,
          cleanupResult,
          subaccountId,
          agentId
        });

        // Wait a moment to ensure file system operations are complete
        await new Promise(resolve => setTimeout(resolve, 500));
      }

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
        agentId,
        forceNew
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

      // Always get a fresh connector - clean up any existing session first
      const connector = await this.getConnector(subaccountId, agentId, userId, true);

      // IMPORTANT: Setup callbacks BEFORE initializing to ensure they're registered
      // before any events fire (especially if client auto-connects from cached session)
      connector.onReady(async () => {
        Logger.info('WhatsApp ready callback triggered', {
          subaccountId,
          agentId,
          userId
        });
        await this.updateConnectionStatus(subaccountId, agentId, userId, 'connected');
      });

      connector.onDisconnect(async (reason) => {
        Logger.info('WhatsApp disconnect callback triggered', {
          subaccountId,
          agentId,
          userId,
          reason
        });
        await this.updateConnectionStatus(subaccountId, agentId, userId, 'disconnected', { reason });
      });

      // Setup message handler
      connector.onMessage(async (message) => {
        await this.handleIncomingMessage(subaccountId, agentId, message);
      });

      // Initialize connector (this will trigger QR generation or auto-connect if session exists)
      // Pass forceNew=true to ensure we don't reuse existing client
      // Wrap in timeout to prevent hanging indefinitely
      try {
        await Promise.race([
          connector.initialize(true),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('WhatsApp initialization timeout after 60 seconds')), 60000)
          )
        ]);
      } catch (initError) {
        Logger.error('WhatsApp initialization failed or timed out', {
          subaccountId,
          agentId,
          error: initError.message,
          errorType: initError.constructor.name
        });
        
        // If initialization fails, we can still try to generate QR if client exists
        // But if it's a timeout, we should fail fast
        if (initError.message.includes('timeout')) {
          throw new Error('WhatsApp initialization timed out. Please try again.');
        }
        // For other errors, log but continue - might still be able to generate QR
        Logger.warn('Continuing despite initialization error', {
          error: initError.message
        });
      }

      // Check if client was created successfully
      if (!connector.client) {
        Logger.error('WhatsApp client was not created after initialization', {
          subaccountId,
          agentId
        });
        throw new Error('Failed to initialize WhatsApp client. Please try again.');
      }

      // Wait a moment for client to potentially auto-connect (if session exists)
      // Then check actual connection status
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check if already connected (auto-connected from cached session)
      const currentStatus = await connector.getConnectionStatus();
      const isAlreadyConnected = currentStatus.data && currentStatus.data.isConnected;

      if (isAlreadyConnected) {
        Logger.info('WhatsApp auto-connected from cached session', {
          subaccountId,
          agentId,
          status: currentStatus.data
        });
        
        // Update database with connection info
        await this.updateConnectionStatus(subaccountId, agentId, userId, 'connected');
        
        await this.storeConnectionInfo(subaccountId, agentId, userId, {
          status: 'connected',
          phoneNumber: currentStatus.data.phoneNumber,
          platform: currentStatus.data.platform,
          pushname: currentStatus.data.pushname,
          qrGenerated: false
        });
        
        return {
          success: true,
          connector: 'whatsapp',
          operation: 'generateQR',
          data: {
            alreadyConnected: true,
            message: 'WhatsApp is already connected',
            phoneNumber: currentStatus.data.phoneNumber,
            platform: currentStatus.data.platform,
            pushname: currentStatus.data.pushname
          },
          timestamp: new Date()
        };
      }

      // Generate QR code (if not already connected)
      // Wrap in timeout to prevent hanging
      let qrResult;
      try {
        qrResult = await Promise.race([
          connector.generateQR(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('QR code generation timeout after 45 seconds')), 45000)
          )
        ]);
      } catch (qrError) {
        Logger.error('QR code generation failed or timed out', {
          subaccountId,
          agentId,
          error: qrError.message
        });
        
        // Return a more helpful error message
        throw new Error('QR code generation timed out. The WhatsApp client may be taking longer than expected. Please try again in a moment.');
      }

      // Check if QR generation was successful
      if (!qrResult || !qrResult.success) {
        const errorMessage = qrResult?.error || 'QR code generation failed';
        Logger.error('QR code generation failed', {
          subaccountId,
          agentId,
          error: errorMessage,
          qrResult
        });
        throw new Error(errorMessage);
      }

      // Store connection info in database
      await this.storeConnectionInfo(subaccountId, agentId, userId, {
        status: qrResult.data?.alreadyConnected ? 'connected' : 'pending',
        qrGenerated: !!(qrResult.data && qrResult.data.qrCodeDataUrl)
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

      // First check if connector exists in active connectors
      if (this.activeConnectors.has(sessionId)) {
        const connector = this.activeConnectors.get(sessionId);
        const status = await connector.getConnectionStatus();
        
        // If connector shows as disconnected, remove it from active connectors
        if (status.data && status.data.isConnected === false) {
          Logger.info('Removing disconnected connector from active connectors', {
            sessionId,
            subaccountId,
            agentId
          });
          this.activeConnectors.delete(sessionId);
        }
        
        return status;
      }

      // If no active connector, check database for connection record
      // Note: After disconnect, the database record is deleted, so this should return not_initialized
      try {
        const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
        const { connection } = connectionInfo;
        const whatsappConnectionsCollection = connection.db.collection('whatsappconnections');
        
        const connectionRecord = await whatsappConnectionsCollection.findOne({
          subaccountId,
          agentId
        });

        if (connectionRecord && connectionRecord.status === 'connected') {
          // Connection record exists and shows as connected
          // But connector is not in activeConnectors, so it's a stale record
          Logger.warn('Found stale connection record in database', {
            subaccountId,
            agentId,
            status: connectionRecord.status
          });
          
          // Return disconnected status since connector is not active
          return {
            success: true,
            data: {
              isConnected: false,
              isActive: false,
              hasQR: false,
              qrCodeDataUrl: null,
              status: 'disconnected',
              note: 'Connection record exists but connector is not active'
            }
          };
        }
      } catch (dbError) {
        Logger.warn('Error checking database for connection status', {
          error: dbError.message,
          subaccountId,
          agentId
        });
      }

      // No connector and no database record - not connected
      return {
        success: true,
        data: {
          isConnected: false,
          isActive: false,
          hasQR: false,
          qrCodeDataUrl: null,
          status: 'not_initialized'
        }
      };
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
   * Disconnect WhatsApp and clean up all related data
   */
  async disconnect(subaccountId, agentId, userId) {
    try {
      const sessionId = `${subaccountId}_${agentId}`;
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      let clientDisconnected = false;

      // Disconnect the WhatsApp client if it exists
      if (this.activeConnectors.has(sessionId)) {
        const connector = this.activeConnectors.get(sessionId);
        try {
          await connector.disconnect();
          clientDisconnected = true;
        } catch (error) {
          Logger.warn('Error disconnecting WhatsApp client', {
            error: error.message,
            subaccountId,
            agentId
          });
        }

        // Always remove from active connectors, even if disconnect failed
        this.activeConnectors.delete(sessionId);
        
        Logger.info('Connector removed from active connectors', {
          sessionId,
          subaccountId,
          agentId
        });
      }

      // Always clean up database data (even if client wasn't active)
      const cleanupResult = await this.cleanupWhatsAppData(connection, subaccountId, agentId, userId);

      // Clean up session files - MUST happen after client is disconnected
      Logger.info('Cleaning up session files after disconnect', { sessionId });
      const sessionCleanupResult = await this.cleanupSessionFiles(sessionId);
      
      Logger.info('Session file cleanup completed', {
        sessionId,
        sessionCleanupResult,
        subaccountId,
        agentId
      });

      // Wait a moment to ensure file system operations are complete
      await new Promise(resolve => setTimeout(resolve, 500));

      Logger.info('WhatsApp disconnected and data cleaned up', {
        subaccountId,
        agentId,
        userId,
        clientDisconnected,
        cleanupResult,
        sessionFilesCleaned: sessionCleanupResult
      });

      return {
        success: true,
        message: 'WhatsApp disconnected successfully and all related data has been cleaned up',
        clientDisconnected,
        ...cleanupResult
      };
    } catch (error) {
      Logger.error('Error disconnecting WhatsApp', {
        error: error.message,
        stack: error.stack,
        subaccountId,
        agentId
      });
      throw error;
    }
  }

  /**
   * Clean up WhatsApp-related data from database
   */
  async cleanupWhatsAppData(connection, subaccountId, agentId, userId) {
    try {
      // Delete WhatsApp connection record
      const whatsappConnectionsCollection = connection.db.collection('whatsappconnections');
      const deleteResult = await whatsappConnectionsCollection.deleteOne({
        subaccountId,
        agentId
      });

      Logger.info('WhatsApp connection record deleted', {
        subaccountId,
        agentId,
        deletedCount: deleteResult.deletedCount
      });

      // Update active chat sessions to ended status
      const chatsCollection = connection.db.collection('chats');
      const updateResult = await chatsCollection.updateMany(
        {
          subaccountId,
          agent_id: agentId,
          'metadata.channel': 'whatsapp',
          chat_status: 'ongoing'
        },
        {
          $set: {
            chat_status: 'ended',
            end_timestamp: Date.now(),
            updatedAt: new Date(),
            endedBy: 'whatsapp-disconnect',
            endedReason: 'WhatsApp connection disconnected'
          }
        }
      );

      Logger.info('WhatsApp chat sessions updated', {
        subaccountId,
        agentId,
        updatedCount: updateResult.modifiedCount
      });

      return {
        connectionDeleted: deleteResult.deletedCount > 0,
        chatsUpdated: updateResult.modifiedCount
      };
    } catch (error) {
      Logger.error('Error cleaning up WhatsApp data', {
        error: error.message,
        subaccountId,
        agentId
      });
      throw error;
    }
  }

  /**
   * Clean up WhatsApp session files from .wwebjs_auth directory
   */
  async cleanupSessionFiles(sessionId) {
    try {
      const path = require('path');
      const fs = require('fs').promises;
      const basePath = path.join(__dirname, '../../.wwebjs_auth');
      
      Logger.info('Starting session file cleanup', {
        sessionId,
        basePath
      });

      // Ensure base directory exists (if not, nothing to clean)
      try {
        await fs.access(basePath);
      } catch (error) {
        if (error.code === 'ENOENT') {
          Logger.info('Session base directory does not exist, nothing to clean', {
            basePath
          });
          return false;
        }
        throw error;
      }

      // Clean up session directory (whatsapp-web.js uses clientId as directory name)
      const sessionPath = path.join(basePath, sessionId);
      
      // Also check for any directories that might match (case-insensitive or with variations)
      const possiblePaths = [
        sessionPath,
        path.join(basePath, sessionId.toLowerCase()),
        path.join(basePath, sessionId.toUpperCase())
      ];

      let cleanedUp = false;

      for (const sessionPathToCheck of possiblePaths) {
        try {
          // Check if session directory exists
          const stats = await fs.stat(sessionPathToCheck);
          
          if (stats.isDirectory()) {
            Logger.info('Found session directory, deleting', {
              sessionId,
              sessionPath: sessionPathToCheck
            });
            
            // Remove session directory recursively
            await fs.rm(sessionPathToCheck, { recursive: true, force: true });
            cleanedUp = true;
            
            Logger.info('WhatsApp session files cleaned up successfully', {
              sessionId,
              sessionPath: sessionPathToCheck
            });
          }
        } catch (error) {
          // Session directory doesn't exist or already deleted - that's okay
          if (error.code !== 'ENOENT') {
            Logger.warn('Error checking/cleaning up session files', {
              error: error.message,
              sessionId,
              sessionPath: sessionPathToCheck
            });
          }
        }
      }

      // Also clean up any lock files or temp files
      try {
        const lockFile = path.join(basePath, `${sessionId}.lock`);
        try {
          await fs.unlink(lockFile);
          Logger.debug('Removed session lock file', { sessionId, lockFile });
        } catch (error) {
          if (error.code !== 'ENOENT') {
            Logger.warn('Error removing lock file', { error: error.message, lockFile });
          }
        }
      } catch (error) {
        // Ignore errors for lock file cleanup
      }

      // List all directories in base path to check for any remaining session files
      try {
        const entries = await fs.readdir(basePath, { withFileTypes: true });
        const sessionDirs = entries
          .filter(entry => entry.isDirectory() && entry.name.includes(sessionId))
          .map(entry => entry.name);
        
        if (sessionDirs.length > 0) {
          Logger.warn('Found additional session directories matching sessionId', {
            sessionId,
            directories: sessionDirs
          });
          
          // Try to remove any matching directories
          for (const dirName of sessionDirs) {
            try {
              const dirPath = path.join(basePath, dirName);
              await fs.rm(dirPath, { recursive: true, force: true });
              Logger.info('Removed additional session directory', {
                sessionId,
                directory: dirName
              });
            } catch (error) {
              Logger.warn('Failed to remove additional session directory', {
                sessionId,
                directory: dirName,
                error: error.message
              });
            }
          }
        }
      } catch (error) {
        Logger.warn('Error listing session directories', {
          error: error.message,
          basePath
        });
      }

      if (!cleanedUp) {
        Logger.warn('No session files found to clean up', {
          sessionId,
          basePath
        });
      }

      return cleanedUp;
    } catch (error) {
      Logger.error('Error cleaning up session files', {
        error: error.message,
        stack: error.stack,
        sessionId
      });
      // Don't throw - session cleanup failure shouldn't fail the disconnect
      return false;
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

