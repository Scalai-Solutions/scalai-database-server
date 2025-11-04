const BaseChatConnector = require('./BaseChatConnector');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const Logger = require('../utils/logger');
const path = require('path');
const fs = require('fs').promises;
const redisService = require('../services/redisService');

/**
 * WhatsApp Connector
 * Implements chat operations for WhatsApp using whatsapp-web.js
 */
class WhatsAppConnector extends BaseChatConnector {
  constructor(config = {}) {
    super(config);
    this.type = 'whatsapp';
    this.name = 'WhatsApp';
    this.client = null;
    this.qrCode = null;
    this.sessionPath = path.join(__dirname, '../../.wwebjs_auth', config.sessionId || 'default');
    this.messageHandlers = [];
    this.connectionPromise = null;
  }

  /**
   * Initialize the WhatsApp connector
   */
  async initialize() {
    try {
      if (this.client) {
        Logger.warn('WhatsApp client already initialized', {
          sessionId: this.config.sessionId
        });
        return true;
      }

      Logger.info('Initializing WhatsApp connector', {
        subaccountId: this.config.subaccountId,
        agentId: this.config.agentId,
        sessionId: this.config.sessionId
      });

      // Create client with session persistence
      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: this.config.sessionId,
          dataPath: path.join(__dirname, '../../.wwebjs_auth')
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
          ]
        }
      });

      // Setup event listeners
      this.setupEventListeners();

      // Create a promise that resolves when client is ready or rejects on auth failure
      this.connectionPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WhatsApp connection timeout'));
        }, 120000); // 2 minutes timeout

        this.client.once('ready', () => {
          clearTimeout(timeout);
          this.isConnected = true;
          this.isActive = true;
          resolve(true);
        });

        this.client.once('auth_failure', (msg) => {
          clearTimeout(timeout);
          reject(new Error(`WhatsApp authentication failed: ${msg}`));
        });
      });

      // Initialize the client
      await this.client.initialize();

      Logger.info('WhatsApp client initialization started', {
        sessionId: this.config.sessionId
      });

      return true;
    } catch (error) {
      this.isActive = false;
      this.isConnected = false;
      Logger.error('Failed to initialize WhatsApp connector', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Setup event listeners for WhatsApp client
   */
  setupEventListeners() {
    // QR Code generation
    this.client.on('qr', async (qr) => {
      try {
        this.qrCode = qr;
        // Generate QR code as data URL for frontend display
        const qrDataUrl = await QRCode.toDataURL(qr);
        this.qrCodeDataUrl = qrDataUrl;
        
        Logger.info('WhatsApp QR code generated', {
          sessionId: this.config.sessionId
        });

        // Call QR callback if registered
        if (this.qrCallback) {
          this.qrCallback(qr, qrDataUrl);
        }
      } catch (error) {
        Logger.error('Error generating QR code', {
          error: error.message
        });
      }
    });

    // Authentication success
    this.client.on('authenticated', () => {
      Logger.info('WhatsApp authenticated successfully', {
        sessionId: this.config.sessionId
      });
      this.qrCode = null;
      this.qrCodeDataUrl = null;
    });

    // Client ready
    this.client.on('ready', () => {
      Logger.info('WhatsApp client ready', {
        sessionId: this.config.sessionId
      });
      this.isConnected = true;
      this.isActive = true;

      // Call ready callback if registered
      if (this.readyCallback) {
        this.readyCallback();
      }
    });

    // Authentication failure
    this.client.on('auth_failure', (msg) => {
      Logger.error('WhatsApp authentication failed', {
        sessionId: this.config.sessionId,
        message: msg
      });
      this.isConnected = false;
      this.isActive = false;
    });

    // Disconnected
    this.client.on('disconnected', (reason) => {
      Logger.warn('WhatsApp client disconnected', {
        sessionId: this.config.sessionId,
        reason
      });
      this.isConnected = false;
      this.isActive = false;

      // Call disconnect callback if registered
      if (this.disconnectCallback) {
        this.disconnectCallback(reason);
      }
    });

    // Incoming messages
    this.client.on('message', async (message) => {
      try {
        // Skip messages sent by the bot itself
        if (message.fromMe) {
          return;
        }

        const messageId = message.id._serialized;
        const dedupeKey = `whatsapp:msg:${messageId}`;

        // Check if this message was already processed (deduplication)
        try {
          if (redisService.isConnected) {
            const alreadyProcessed = await redisService.exists(dedupeKey);
            if (alreadyProcessed) {
              Logger.debug('Duplicate WhatsApp message ignored', {
                sessionId: this.config.sessionId,
                messageId,
                from: message.from
              });
              return;
            }

            // Mark message as processed (expire after 24 hours)
            await redisService.set(dedupeKey, '1', 86400);
          }
        } catch (redisError) {
          // If Redis fails, log but continue processing (fail-open)
          Logger.warn('Redis deduplication check failed, continuing anyway', {
            error: redisError.message
          });
        }

        Logger.debug('WhatsApp message received', {
          sessionId: this.config.sessionId,
          from: message.from,
          messageId,
          hasMedia: message.hasMedia
        });

        // Call all registered message handlers
        for (const handler of this.messageHandlers) {
          try {
            await handler(message);
          } catch (error) {
            Logger.error('Error in message handler', {
              error: error.message
            });
          }
        }
      } catch (error) {
        Logger.error('Error processing incoming message', {
          error: error.message
        });
      }
    });
  }

  /**
   * Generate QR code for authentication
   */
  async generateQR() {
    try {
      // If already connected, no QR needed
      if (this.isConnected) {
        return this.formatSuccess({
          alreadyConnected: true,
          message: 'WhatsApp is already connected'
        }, 'generateQR');
      }

      // If client not initialized, initialize it
      if (!this.client) {
        await this.initialize();
      }

      // Wait for QR code generation (with timeout)
      const qrPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('QR code generation timeout'));
        }, 30000); // 30 seconds

        const checkQR = setInterval(() => {
          if (this.qrCodeDataUrl) {
            clearTimeout(timeout);
            clearInterval(checkQR);
            resolve();
          }
        }, 500);
      });

      await qrPromise;

      return this.formatSuccess({
        qrCode: this.qrCode,
        qrCodeDataUrl: this.qrCodeDataUrl,
        message: 'Scan this QR code with WhatsApp mobile app'
      }, 'generateQR');
    } catch (error) {
      return this.handleError(error, 'generateQR');
    }
  }

  /**
   * Get connection status
   */
  async getConnectionStatus() {
    try {
      const status = {
        isConnected: this.isConnected,
        isActive: this.isActive,
        hasQR: !!this.qrCodeDataUrl,
        qrCodeDataUrl: this.qrCodeDataUrl || null
      };

      // If connected, get additional info
      if (this.isConnected && this.client) {
        try {
          const info = await this.client.info;
          status.phoneNumber = info.wid.user;
          status.platform = info.platform;
          status.pushname = info.pushname;
        } catch (error) {
          Logger.warn('Could not fetch WhatsApp client info', {
            error: error.message
          });
        }
      }

      return this.formatSuccess(status, 'getConnectionStatus');
    } catch (error) {
      return this.handleError(error, 'getConnectionStatus');
    }
  }

  /**
   * Disconnect from WhatsApp
   */
  async disconnect() {
    try {
      if (!this.client) {
        return this.formatSuccess({
          message: 'Client not initialized'
        }, 'disconnect');
      }

      await this.client.destroy();
      this.client = null;
      this.isConnected = false;
      this.isActive = false;
      this.qrCode = null;
      this.qrCodeDataUrl = null;

      Logger.info('WhatsApp client disconnected', {
        sessionId: this.config.sessionId
      });

      return this.formatSuccess({
        message: 'WhatsApp disconnected successfully'
      }, 'disconnect');
    } catch (error) {
      return this.handleError(error, 'disconnect');
    }
  }

  /**
   * Send a message via WhatsApp
   */
  async sendMessage(to, message, options = {}) {
    try {
      if (!this.isConnected) {
        throw new Error('WhatsApp is not connected');
      }

      // Format phone number (add @c.us if not present)
      let chatId = to;
      if (!to.includes('@')) {
        chatId = `${to}@c.us`;
      }

      const sentMessage = await this.client.sendMessage(chatId, message);

      Logger.info('WhatsApp message sent', {
        sessionId: this.config.sessionId,
        to: chatId,
        messageId: sentMessage.id._serialized
      });

      return this.formatSuccess({
        messageId: sentMessage.id._serialized,
        to: chatId,
        message,
        timestamp: sentMessage.timestamp
      }, 'sendMessage');
    } catch (error) {
      return this.handleError(error, 'sendMessage');
    }
  }

  /**
   * Register a message handler
   * Only one handler can be registered at a time - new handler replaces old ones
   */
  async onMessage(callback) {
    try {
      if (typeof callback !== 'function') {
        throw new Error('Callback must be a function');
      }

      // Clear existing handlers and register new one (prevent duplicates)
      this.messageHandlers = [callback];

      Logger.info('Message handler registered', {
        sessionId: this.config.sessionId,
        handlerCount: this.messageHandlers.length
      });

      return this.formatSuccess({
        message: 'Message handler registered successfully',
        handlerCount: this.messageHandlers.length
      }, 'onMessage');
    } catch (error) {
      return this.handleError(error, 'onMessage');
    }
  }

  /**
   * Get chat history
   */
  async getChatHistory(chatId, options = {}) {
    try {
      if (!this.isConnected) {
        throw new Error('WhatsApp is not connected');
      }

      // Format chat ID
      if (!chatId.includes('@')) {
        chatId = `${chatId}@c.us`;
      }

      const chat = await this.client.getChatById(chatId);
      const messages = await chat.fetchMessages({
        limit: options.limit || 50
      });

      const formattedMessages = messages.map(msg => ({
        id: msg.id._serialized,
        from: msg.from,
        to: msg.to,
        body: msg.body,
        timestamp: msg.timestamp,
        isFromMe: msg.fromMe,
        hasMedia: msg.hasMedia,
        type: msg.type
      }));

      return this.formatSuccess({
        chatId,
        messages: formattedMessages,
        count: formattedMessages.length
      }, 'getChatHistory');
    } catch (error) {
      return this.handleError(error, 'getChatHistory');
    }
  }

  /**
   * Register callback for QR code generation
   */
  onQR(callback) {
    this.qrCallback = callback;
  }

  /**
   * Register callback for ready event
   */
  onReady(callback) {
    this.readyCallback = callback;
  }

  /**
   * Register callback for disconnect event
   */
  onDisconnect(callback) {
    this.disconnectCallback = callback;
  }

  /**
   * Wait for connection to be established
   */
  async waitForConnection() {
    if (this.isConnected) {
      return true;
    }

    if (this.connectionPromise) {
      return await this.connectionPromise;
    }

    throw new Error('No connection in progress. Call initialize() first.');
  }
}

module.exports = WhatsAppConnector;

