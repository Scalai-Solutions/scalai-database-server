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
   * @param {boolean} forceNew - If true, will destroy existing client and create a new one
   */
  async initialize(forceNew = false) {
    try {
      // If forceNew is true, destroy existing client first
      if (forceNew && this.client) {
        try {
          Logger.info('Force new: destroying existing client', {
            sessionId: this.config.sessionId
          });
          await this.client.destroy();
        } catch (error) {
          Logger.warn('Error destroying existing client', {
            error: error.message,
            sessionId: this.config.sessionId
          });
        }
        this.client = null;
        this.isConnected = false;
        this.isActive = false;
        this.qrCode = null;
        this.qrCodeDataUrl = null;
        this.connectionPromise = null;
      }

      if (this.client && !forceNew) {
        Logger.warn('WhatsApp client already initialized', {
          sessionId: this.config.sessionId
        });
        return true;
      }

      Logger.info('Initializing WhatsApp connector', {
        subaccountId: this.config.subaccountId,
        agentId: this.config.agentId,
        sessionId: this.config.sessionId,
        forceNew
      });

      // If forceNew, also clean up session files here as a double-check
      if (forceNew) {
        try {
          const fs = require('fs').promises;
          const sessionPath = path.join(__dirname, '../../.wwebjs_auth', this.config.sessionId);
          
          try {
            await fs.rm(sessionPath, { recursive: true, force: true });
            Logger.info('Session files deleted during connector initialization', {
              sessionId: this.config.sessionId,
              sessionPath
            });
          } catch (error) {
            if (error.code !== 'ENOENT') {
              Logger.warn('Could not delete session files during initialization', {
                error: error.message,
                sessionId: this.config.sessionId,
                sessionPath
              });
            }
          }
        } catch (error) {
          Logger.warn('Error during session cleanup in initialize', {
            error: error.message,
            sessionId: this.config.sessionId
          });
        }
      }

      // Create client with session persistence
      // Configure Puppeteer for Heroku (uses CHROME_BIN from buildpacks)
      const puppeteerConfig = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process'
        ]
      };

      // Use Chrome binary from Heroku buildpack
      // CHROME_BIN is set by puppeteer-heroku-buildpack
      const chromePath = process.env.CHROME_BIN;
      
      if (chromePath) {
        puppeteerConfig.executablePath = chromePath;
        Logger.info('Using Chrome binary from puppeteer-heroku-buildpack', {
          chromeBin: chromePath,
          sessionId: this.config.sessionId
        });
      } else {
        Logger.warn('CHROME_BIN environment variable not set. Puppeteer may fail to launch.', {
          sessionId: this.config.sessionId,
          nodeEnv: process.env.NODE_ENV
        });
      }

      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: this.config.sessionId,
          dataPath: path.join(__dirname, '../../.wwebjs_auth')
        }),
        puppeteer: puppeteerConfig
      });

      // Setup event listeners FIRST, before initializing
      // This ensures callbacks are registered before any events fire
      this.setupEventListeners();

      // Create a promise that resolves when client is ready or rejects on auth failure
      let timeoutHandle = null;
      let readyHandler = null;
      let authFailureHandler = null;
      
      this.connectionPromise = new Promise((resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          // Clean up event listeners to prevent memory leaks
          try {
            if (this.client && readyHandler) {
              this.client.removeListener('ready', readyHandler);
            }
            if (this.client && authFailureHandler) {
              this.client.removeListener('auth_failure', authFailureHandler);
            }
          } catch (cleanupError) {
            Logger.warn('Error cleaning up event listeners on timeout', {
              error: cleanupError.message,
              sessionId: this.config.sessionId
            });
          }
          
          // Update state
          this.isConnected = false;
          this.isActive = false;
          
          // Log the timeout
          Logger.warn('WhatsApp connection timeout', {
            sessionId: this.config.sessionId,
            timeoutMs: 120000
          });
          
          // Reject with error
          reject(new Error('WhatsApp connection timeout'));
        }, 120000); // 2 minutes timeout

        readyHandler = () => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }
          this.isConnected = true;
          this.isActive = true;
          resolve(true);
        };

        authFailureHandler = (msg) => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }
          this.isConnected = false;
          this.isActive = false;
          reject(new Error(`WhatsApp authentication failed: ${msg}`));
        };

        this.client.once('ready', readyHandler);
        this.client.once('auth_failure', authFailureHandler);
      });

      // Add error handler to prevent unhandled promise rejections
      this.connectionPromise.catch((error) => {
        // This catch prevents unhandled promise rejection crashes
        Logger.error('WhatsApp connection promise rejected', {
          error: error.message,
          sessionId: this.config.sessionId,
          stack: error.stack
        });
        // Update state
        this.isConnected = false;
        this.isActive = false;
        // Clear the promise reference so a new one can be created
        this.connectionPromise = null;
      });

      // Initialize the client (this may trigger immediate ready event if session exists)
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
      // First check if client is actually destroyed or null
      if (!this.client) {
        return this.formatSuccess({
          isConnected: false,
          isActive: false,
          hasQR: false,
          qrCodeDataUrl: null,
          status: 'not_initialized'
        }, 'getConnectionStatus');
      }

      // Check if client is actually ready and connected
      let isActuallyConnected = false;
      try {
        // Try to get client info - if this fails, client is not connected
        const info = await this.client.info;
        isActuallyConnected = !!info && !!info.wid;
      } catch (error) {
        // Client info unavailable - not connected
        Logger.debug('Client info unavailable, marking as disconnected', {
          sessionId: this.config.sessionId,
          error: error.message
        });
        this.isConnected = false;
        this.isActive = false;
        return this.formatSuccess({
          isConnected: false,
          isActive: false,
          hasQR: false,
          qrCodeDataUrl: null,
          status: 'disconnected'
        }, 'getConnectionStatus');
      }

      // Update internal state based on actual connection status
      if (!isActuallyConnected) {
        this.isConnected = false;
        this.isActive = false;
      }

      const status = {
        isConnected: this.isConnected && isActuallyConnected,
        isActive: this.isActive && isActuallyConnected,
        hasQR: !!this.qrCodeDataUrl,
        qrCodeDataUrl: this.qrCodeDataUrl || null
      };

      // If connected, get additional info
      if (status.isConnected && this.client) {
        try {
          const info = await this.client.info;
          status.phoneNumber = info.wid.user;
          status.platform = info.platform;
          status.pushname = info.pushname;
        } catch (error) {
          Logger.warn('Could not fetch WhatsApp client info', {
            error: error.message
          });
          // If we can't get info, assume not connected
          status.isConnected = false;
          status.isActive = false;
        }
      }

      return this.formatSuccess(status, 'getConnectionStatus');
    } catch (error) {
      // If there's an error, assume disconnected
      this.isConnected = false;
      this.isActive = false;
      return this.formatSuccess({
        isConnected: false,
        isActive: false,
        hasQR: false,
        qrCodeDataUrl: null,
        status: 'error'
      }, 'getConnectionStatus');
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

      Logger.info('Destroying WhatsApp client', {
        sessionId: this.config.sessionId
      });

      // Destroy the client
      try {
        await this.client.destroy();
      } catch (error) {
        Logger.warn('Error destroying client, forcing cleanup', {
          error: error.message,
          sessionId: this.config.sessionId
        });
      }

      // Clear all references
      this.client = null;
      this.isConnected = false;
      this.isActive = false;
      this.qrCode = null;
      this.qrCodeDataUrl = null;
      this.connectionPromise = null;

      Logger.info('WhatsApp client disconnected and cleaned up', {
        sessionId: this.config.sessionId
      });

      return this.formatSuccess({
        message: 'WhatsApp disconnected successfully'
      }, 'disconnect');
    } catch (error) {
      // Even if disconnect fails, clear state
      this.client = null;
      this.isConnected = false;
      this.isActive = false;
      this.qrCode = null;
      this.qrCodeDataUrl = null;
      
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
      try {
        return await this.connectionPromise;
      } catch (error) {
        // Connection failed - log and rethrow
        Logger.error('Failed to wait for WhatsApp connection', {
          error: error.message,
          sessionId: this.config.sessionId
        });
        throw error;
      }
    }

    throw new Error('No connection in progress. Call initialize() first.');
  }
}

module.exports = WhatsAppConnector;

