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

      // FIRST: Check if there's already an active connector that's connected
      const sessionId = `${subaccountId}_${agentId}`;
      if (this.activeConnectors.has(sessionId)) {
        const existingConnector = this.activeConnectors.get(sessionId);
        const existingStatus = await existingConnector.getConnectionStatus();
        
        // If already connected, return connection details without recreating connector
        if (existingStatus.data && existingStatus.data.isConnected) {
          Logger.info('WhatsApp already connected, returning existing connection details', {
            subaccountId,
            agentId,
            phoneNumber: existingStatus.data.phoneNumber
          });
          
          // Ensure message handler is still registered (in case it was lost)
          // IMPORTANT: Capture connector reference in closure
          const messageHandler = async (message) => {
            Logger.info('Message handler called (existing connector)', {
              subaccountId,
              agentId,
              from: message.from,
              hasBody: !!message.body,
              connectorInMap: this.activeConnectors.has(`${subaccountId}_${agentId}`)
            });
            await this.handleIncomingMessage(subaccountId, agentId, message, existingConnector);
          };
          
          await existingConnector.onMessage(messageHandler);
          
          Logger.info('Message handler re-registered for existing connector', {
            subaccountId,
            agentId
          });
          
          return {
            success: true,
            connector: 'whatsapp',
            operation: 'generateQR',
            data: {
              alreadyConnected: true,
              message: 'WhatsApp is already connected',
              phoneNumber: existingStatus.data.phoneNumber,
              platform: existingStatus.data.platform,
              pushname: existingStatus.data.pushname,
              isConnected: true,
              isActive: true
            },
            timestamp: new Date()
          };
        }
        
        // If connector exists but is disconnected, clean it up
        Logger.info('Existing connector found but disconnected, cleaning up', {
          subaccountId,
          agentId
        });
        try {
          await existingConnector.disconnect();
        } catch (error) {
          Logger.warn('Error disconnecting existing connector', {
            error: error.message
          });
        }
        this.activeConnectors.delete(sessionId);
      }

      // Get connector (reuse existing if available, don't force new)
      const connector = await this.getConnector(subaccountId, agentId, userId, false);

      // IMPORTANT: Always setup callbacks/handlers, even if connector already exists
      // This ensures handlers are registered even if connector was reused
      connector.onReady(async () => {
        Logger.info('WhatsApp ready callback triggered', {
          subaccountId,
          agentId,
          userId
        });
        
        // CRITICAL: Re-register message handler after connection is ready
        // This ensures messages are processed even if handler was lost during reconnection
        // IMPORTANT: Capture connector reference in closure
        const messageHandler = async (message) => {
          Logger.info('Message handler called (ready callback)', {
            subaccountId,
            agentId,
            from: message.from,
            hasBody: !!message.body,
            connectorInMap: this.activeConnectors.has(`${subaccountId}_${agentId}`)
          });
          await this.handleIncomingMessage(subaccountId, agentId, message, connector);
        };
        
        await connector.onMessage(messageHandler);
        
        Logger.info('Message handler re-registered after connection ready', {
          subaccountId,
          agentId,
          handlerRegistered: true
        });
        
        // Get connection details including phone number, platform, pushname
        try {
          const status = await connector.getConnectionStatus();
          const connectionData = status.data || {};
          
          // Update connection status
          await this.updateConnectionStatus(subaccountId, agentId, userId, 'connected');
          
          // Store connection info with phone number, platform, and pushname
          await this.storeConnectionInfo(subaccountId, agentId, userId, {
            status: 'connected',
            phoneNumber: connectionData.phoneNumber,
            platform: connectionData.platform,
            pushname: connectionData.pushname,
            qrGenerated: false,
            connectedAt: new Date()
          });
          
          Logger.info('WhatsApp connection details stored', {
            subaccountId,
            agentId,
            phoneNumber: connectionData.phoneNumber,
            platform: connectionData.platform
          });
        } catch (error) {
          Logger.error('Error storing connection details in ready callback', {
            error: error.message,
            subaccountId,
            agentId
          });
          // Still update status even if storing details fails
          await this.updateConnectionStatus(subaccountId, agentId, userId, 'connected');
        }
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

      // CRITICAL: Always setup message handler - this ensures messages are processed
      // even if connector was reused or reinitialized
      // Register handler BEFORE initialization to ensure it's ready when messages arrive
      // IMPORTANT: Capture connector reference in closure so it's available even if removed from activeConnectors
      const messageHandler = async (message) => {
        Logger.info('Message handler called', {
          subaccountId,
          agentId,
          from: message.from,
          hasBody: !!message.body,
          connectorInMap: this.activeConnectors.has(`${subaccountId}_${agentId}`)
        });
        await this.handleIncomingMessage(subaccountId, agentId, message, connector);
      };
      
      // Register and verify handler
      const handlerResult = await connector.onMessage(messageHandler);
      if (!handlerResult || !handlerResult.success) {
        Logger.error('Failed to register message handler', {
          subaccountId,
          agentId,
          result: handlerResult
        });
        throw new Error('Failed to register WhatsApp message handler');
      } else {
        Logger.info('Message handler registered and verified', {
          subaccountId,
          agentId,
          handlerCount: handlerResult.data?.handlerCount || 0,
          sessionId: `${subaccountId}_${agentId}`
        });
      }

      // Check if connector is already initialized and connected
      const existingStatus = await connector.getConnectionStatus();
      const isAlreadyInitialized = connector.client && existingStatus.data && existingStatus.data.isConnected;
      
      if (!isAlreadyInitialized) {
        // Only initialize if not already connected
        // Initialize connector (this will trigger QR generation or auto-connect if session exists)
        // Wrap in timeout to prevent hanging indefinitely
        try {
          await Promise.race([
            connector.initialize(false), // Don't force new - reuse existing client if available
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
      }

      // Check connection status (either after initialization or if already initialized)
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
        
        // If connector shows as connected, return full details
        if (status.data && status.data.isConnected === true) {
          return status;
        }
        
        // If connector shows as disconnected, verify before removing
        // Don't remove if messages are still being received (connector might be in transition)
        if (status.data && status.data.isConnected === false) {
          Logger.warn('Connector shows as disconnected, but keeping in activeConnectors in case messages still arrive', {
            sessionId,
            subaccountId,
            agentId,
            note: 'Will be cleaned up on explicit disconnect or when connection is re-established'
          });
          // Don't remove - let it stay in case messages are still being received
          // It will be cleaned up properly on explicit disconnect
        }
        
        // If connector exists but not connected yet, return its status (might have QR)
        return status;
      }

      // If no active connector, check database for connection record
      // This handles the case where connector was connected but server restarted
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
          // Return connection details from database
          Logger.info('Found connection record in database', {
            subaccountId,
            agentId,
            phoneNumber: connectionRecord.phoneNumber
          });
          
          return {
            success: true,
            data: {
              isConnected: true,
              isActive: false, // Connector not in memory, but connection exists
              hasQR: false,
              qrCodeDataUrl: null,
              phoneNumber: connectionRecord.phoneNumber,
              platform: connectionRecord.platform,
              pushname: connectionRecord.pushname,
              status: 'connected',
              connectedAt: connectionRecord.connectedAt,
              note: 'Connection exists but connector not in memory (may need to reconnect)'
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
   * @param {string} subaccountId - Subaccount ID
   * @param {string} agentId - Agent ID
   * @param {Object} message - WhatsApp message object
   * @param {Object} connector - WhatsApp connector instance (optional, will be looked up if not provided)
   */
  async handleIncomingMessage(subaccountId, agentId, message, connector = null) {
    try {
      Logger.info('Handling incoming WhatsApp message', {
        subaccountId,
        agentId,
        from: message.from,
        messageId: message.id._serialized,
        hasBody: !!message.body,
        bodyLength: message.body ? message.body.length : 0,
        hasMedia: message.hasMedia,
        type: message.type
      });

      // Skip if message has no body and no media (system messages, etc.)
      if (!message.body && !message.hasMedia) {
        Logger.debug('Skipping message with no body or media', {
          subaccountId,
          agentId,
          from: message.from,
          type: message.type
        });
        return;
      }

      // Get sender's phone number (without @c.us suffix)
      const phoneNumber = message.from.replace('@c.us', '');

      // Extract contact information from WhatsApp message
      // WhatsApp messages may have pushName, notifyName, or contact name
      const contactInfo = {};
      if (message.pushName) {
        contactInfo.name = message.pushName;
      } else if (message.notifyName) {
        contactInfo.name = message.notifyName;
      } else if (message.contact && message.contact.pushname) {
        contactInfo.name = message.contact.pushname;
      }
      
      // Extract message content - use body if available, otherwise describe media
      let messageContent = message.body || '';
      if (message.hasMedia && !messageContent) {
        // For media messages without caption, describe the media type
        messageContent = `[${message.type || 'media'} message]`;
      }

      // Skip empty messages
      if (!messageContent || messageContent.trim().length === 0) {
        Logger.debug('Skipping empty message', {
          subaccountId,
          agentId,
          from: message.from
        });
        return;
      }

      Logger.debug('Forwarding message to chat agent', {
        subaccountId,
        agentId,
        phoneNumber,
        contactName: contactInfo.name,
        messageLength: messageContent.length
      });

      // Forward message to chat agent and get response
      const agentResponse = await this.forwardToChageAgent(
        subaccountId, 
        agentId, 
        phoneNumber,
        messageContent,
        contactInfo
      );

      Logger.debug('Received response from chat agent', {
        subaccountId,
        agentId,
        hasReply: !!(agentResponse && agentResponse.reply),
        replyLength: agentResponse && agentResponse.reply ? agentResponse.reply.length : 0
      });

      // Send agent's response back via WhatsApp
      // Use provided connector or look it up from activeConnectors
      const sessionId = `${subaccountId}_${agentId}`;
      
      // If connector not provided, try to get it from activeConnectors
      if (!connector) {
        connector = this.activeConnectors.get(sessionId);
      }
      
      if (!connector) {
        Logger.error('Connector not found when trying to send reply', {
          subaccountId,
          agentId,
          sessionId,
          activeConnectorKeys: Array.from(this.activeConnectors.keys()),
          connectorProvided: !!connector
        });
        throw new Error('WhatsApp connector not found');
      }
      
      Logger.debug('Using connector for sending reply', {
        subaccountId,
        agentId,
        connectorExists: !!connector,
        connectorConnected: connector.isConnected,
        connectorInMap: this.activeConnectors.has(sessionId)
      });
      
      if (!connector.isConnected) {
        Logger.error('Connector exists but isConnected is false when trying to send reply', {
          subaccountId,
          agentId,
          sessionId,
          isConnected: connector.isConnected,
          isActive: connector.isActive
        });
        // Try to get actual connection status
        try {
          const status = await connector.getConnectionStatus();
          Logger.info('Actual connector status', {
            subaccountId,
            agentId,
            status: status.data
          });
          // If actually connected, update the flag
          if (status.data && status.data.isConnected) {
            connector.isConnected = true;
            connector.isActive = true;
            Logger.info('Updated connector connection status from actual status check', {
              subaccountId,
              agentId
            });
          } else {
            throw new Error('WhatsApp connector is not actually connected');
          }
        } catch (statusError) {
          Logger.error('Failed to check connector status', {
            error: statusError.message,
            subaccountId,
            agentId
          });
          throw new Error('WhatsApp connector is not connected');
        }
      }
      
      if (agentResponse && agentResponse.reply && agentResponse.reply.trim().length > 0) {
        Logger.debug('Sending reply via connector', {
          subaccountId,
          agentId,
          to: message.from,
          replyLength: agentResponse.reply.length,
          connectorConnected: connector.isConnected
        });
        
        // Use connector directly instead of sendMessage method
        const sendResult = await connector.sendMessage(message.from, agentResponse.reply);
        
        Logger.info('Chat agent response sent via WhatsApp', {
          subaccountId,
          agentId,
          to: message.from,
          replyLength: agentResponse.reply.length,
          messageId: sendResult.data?.messageId
        });
      } else {
        Logger.warn('No reply from chat agent or reply is empty', {
          subaccountId,
          agentId,
          agentResponse: agentResponse ? 'exists' : 'null',
          hasReply: !!(agentResponse && agentResponse.reply)
        });
      }
      
    } catch (error) {
      Logger.error('Error handling incoming message', {
        error: error.message,
        stack: error.stack,
        subaccountId,
        agentId,
        from: message.from
      });
      
      // Send error message to user using connector directly
      const sessionId = `${subaccountId}_${agentId}`;
      if (this.activeConnectors.has(sessionId)) {
        const connector = this.activeConnectors.get(sessionId);
        try {
          // Check if connector is actually connected before sending error
          const status = await connector.getConnectionStatus();
          if (status.data && status.data.isConnected) {
            await connector.sendMessage(
              message.from, 
              "Sorry, I'm having trouble processing your message right now. Please try again later."
            );
          } else {
            Logger.warn('Cannot send error message - connector not connected', {
              subaccountId,
              agentId,
              status: status.data
            });
          }
        } catch (sendError) {
          Logger.error('Failed to send error message', { 
            error: sendError.message,
            subaccountId,
            agentId
          });
        }
      } else {
        Logger.error('Cannot send error message - connector not in activeConnectors', {
          subaccountId,
          agentId,
          sessionId,
          activeConnectorKeys: Array.from(this.activeConnectors.keys())
        });
      }
    }
  }

  /**
   * Forward message to chat agent and get response
   */
  async forwardToChageAgent(subaccountId, agentId, phoneNumber, messageContent, contactInfo = {}) {
    try {
      const retellService = require('./retellService');
      const Retell = require('../utils/retell');
      
      // Get or create chat session for this WhatsApp contact
      const chatId = await this.getOrCreateChatSession(subaccountId, agentId, phoneNumber, contactInfo);
      
      // Get retell account data
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      
      if (!retellAccountData.isActive) {
        throw new Error('Retell account is not active');
      }

      // Create Retell instance
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);
      
      // Send message to chat agent and get completion
      Logger.debug('Sending message to Retell chat agent', {
        subaccountId,
        agentId,
        chatId,
        messageLength: messageContent.length
      });
      
      const response = await retell.createChatCompletion(chatId, messageContent);
      
      Logger.info('Received response from Retell', {
        subaccountId,
        agentId,
        chatId,
        hasMessages: !!(response && response.messages),
        messageCount: response && response.messages ? response.messages.length : 0,
        responseKeys: response ? Object.keys(response) : [],
        response: JSON.stringify(response, null, 2)
      });
      
      // Update chat in database
      await this.updateChatSession(subaccountId, chatId, response);
      
      // Extract the agent's reply from the response
      const agentReply = this.extractAgentReply(response);
      
      Logger.info('Chat agent processed WhatsApp message', {
        subaccountId,
        agentId,
        chatId,
        phoneNumber,
        hasReply: !!agentReply,
        replyLength: agentReply ? agentReply.length : 0,
        replyPreview: agentReply ? agentReply.substring(0, 100) : null
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
   * @param {string} subaccountId - Subaccount ID
   * @param {string} agentId - Agent ID
   * @param {string} phoneNumber - WhatsApp phone number
   * @param {Object} contactInfo - Optional contact information (name, etc.)
   */
  async getOrCreateChatSession(subaccountId, agentId, phoneNumber, contactInfo = {}) {
    // Use Redis lock to prevent race condition when creating chats
    const lockKey = `whatsapp:chat:lock:${subaccountId}:${agentId}:${phoneNumber}`;
    let lockAcquired = false;
    
    try {
      const systemUserId = 'whatsapp-service';
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, systemUserId);
      const { connection } = connectionInfo;
      
      const chatsCollection = connection.db.collection('chats');
      
      // First check without lock (most common case - chat already exists)
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
      
      // Try to acquire lock before creating new chat
      if (redisService.isConnected) {
        try {
          // Try to set lock with NX (only if not exists) and 10 second expiration
          lockAcquired = await redisService.set(lockKey, '1', 10, 'NX');
          
          if (!lockAcquired) {
            // Another request is creating the chat, wait and retry
            Logger.debug('Another request is creating chat, waiting...', {
              phoneNumber,
              agentId
            });
            
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms
            
            // Check again if chat was created by the other request
            chatDocument = await chatsCollection.findOne({
              subaccountId,
              agent_id: agentId,
              'metadata.whatsapp_phone': phoneNumber,
              chat_status: 'ongoing'
            });
            
            if (chatDocument) {
              Logger.debug('Chat created by another request, using it', {
                chatId: chatDocument.chat_id,
                phoneNumber
              });
              return chatDocument.chat_id;
            }
            
            // Still no chat, try to acquire lock again
            lockAcquired = await redisService.set(lockKey, '1', 10, 'NX');
            if (!lockAcquired) {
              Logger.warn('Could not acquire lock after retry, proceeding anyway', {
                phoneNumber,
                agentId
              });
            }
          }
        } catch (lockError) {
          Logger.warn('Failed to acquire Redis lock, proceeding anyway', {
            error: lockError.message,
            phoneNumber
          });
        }
      }
      
      // Double-check one more time before creating (in case of race condition)
      chatDocument = await chatsCollection.findOne({
        subaccountId,
        agent_id: agentId,
        'metadata.whatsapp_phone': phoneNumber,
        chat_status: 'ongoing'
      });
      
      if (chatDocument) {
        Logger.debug('Chat created by concurrent request, using it', {
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
      
      // Prepare dynamic variables with WhatsApp contact information
      // Always include standard dynamic variables: phone_number, agent_id, subaccount_id
      const retell_llm_dynamic_variables = {
        phone_number: phoneNumber,
        agent_id: agentId,
        subaccount_id: subaccountId,
        customer_phone: phoneNumber,  // Keep for backward compatibility
        channel: 'whatsapp'
      };
      
      // Add contact name if available
      if (contactInfo.name) {
        retell_llm_dynamic_variables.customer_name = contactInfo.name;
      }
      
      // Add any other contact info
      if (contactInfo.email) {
        retell_llm_dynamic_variables.customer_email = contactInfo.email;
      }
      
      Logger.info('Creating WhatsApp chat with dynamic variables', {
        subaccountId,
        agentId,
        phoneNumber,
        dynamicVariables: retell_llm_dynamic_variables
      });
      
      const chatResponse = await retell.createChat(agentId, {
        retell_llm_dynamic_variables,
        metadata: {
          whatsapp_phone: phoneNumber,
          channel: 'whatsapp',
          ...(contactInfo.name && { contact_name: contactInfo.name }),
          ...(contactInfo.email && { contact_email: contactInfo.email })
        }
      });
      
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
          channel: 'whatsapp',
          ...(contactInfo.name && { contact_name: contactInfo.name }),
          ...(contactInfo.email && { contact_email: contactInfo.email })
        },
        retell_llm_dynamic_variables: chatResponse.retell_llm_dynamic_variables || {},
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
    } finally {
      // Release the lock
      if (lockAcquired && redisService.isConnected) {
        try {
          await redisService.del(lockKey);
          Logger.debug('Chat creation lock released', { phoneNumber });
        } catch (unlockError) {
          Logger.warn('Failed to release chat creation lock', {
            error: unlockError.message,
            phoneNumber
          });
        }
      }
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
      if (!response) {
        Logger.warn('No response provided to extractAgentReply');
        return null;
      }
      
      // Get the last message from the agent (not from user)
      const messages = response.messages || [];
      
      Logger.info('Extracting agent reply from response', {
        messageCount: messages.length,
        messageRoles: messages.map(m => m.role),
        messages: JSON.stringify(messages, null, 2)
      });
      
      if (messages.length === 0) {
        Logger.warn('No messages in response', {
          responseKeys: Object.keys(response)
        });
        return null;
      }
      
      // Find the last agent message (Retell uses 'agent' role, not 'assistant')
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        // Check for both 'agent' (Retell format) and 'assistant' (OpenAI format) for compatibility
        if ((msg.role === 'agent' || msg.role === 'assistant') && msg.content) {
          Logger.debug('Found agent message', {
            index: i,
            role: msg.role,
            contentLength: msg.content.length,
            contentPreview: msg.content.substring(0, 100)
          });
          return msg.content;
        }
      }
      
      // Fallback: return the last message content if it exists
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.content) {
        Logger.debug('Using last message as fallback', {
          role: lastMessage.role,
          contentLength: lastMessage.content.length
        });
        return lastMessage.content;
      }
      
      Logger.warn('No valid reply found in response', {
        messageCount: messages.length,
        lastMessage: lastMessage ? { role: lastMessage.role, hasContent: !!lastMessage.content } : null
      });
      
      return null;
      
    } catch (error) {
      Logger.error('Error extracting agent reply', {
        error: error.message,
        stack: error.stack
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

