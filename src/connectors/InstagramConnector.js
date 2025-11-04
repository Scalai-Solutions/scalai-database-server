const BaseChatConnector = require('./BaseChatConnector');
const QRCode = require('qrcode');
const Logger = require('../utils/logger');
const axios = require('axios');
const redisService = require('../services/redisService');

/**
 * Instagram Connector
 * Implements chat operations for Instagram using Instagram Graph API
 */
class InstagramConnector extends BaseChatConnector {
  constructor(config = {}) {
    super(config);
    this.type = 'instagram';
    this.name = 'Instagram';
    this.accessToken = config.accessToken || null;
    this.instagramAccountId = config.instagramAccountId || null;
    this.pageId = config.pageId || null;
    this.messageHandlers = [];
    this.webhookVerificationToken = config.webhookVerificationToken || null;
    this.webhookSecret = config.webhookSecret || null;
  }

  /**
   * Initialize the Instagram connector
   */
  async initialize() {
    try {
      if (!this.accessToken) {
        throw new Error('Instagram access token is required');
      }

      if (!this.instagramAccountId) {
        throw new Error('Instagram account ID is required');
      }

      Logger.info('Initializing Instagram connector', {
        subaccountId: this.config.subaccountId,
        agentId: this.config.agentId,
        sessionId: this.config.sessionId,
        instagramAccountId: this.instagramAccountId
      });

      // Verify access token and get account info
      await this.verifyConnection();

      this.isConnected = true;
      this.isActive = true;

      Logger.info('Instagram connector initialized successfully', {
        sessionId: this.config.sessionId
      });

      return true;
    } catch (error) {
      this.isActive = false;
      this.isConnected = false;
      Logger.error('Failed to initialize Instagram connector', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Verify Instagram connection by fetching account info
   */
  async verifyConnection() {
    try {
      const response = await axios.get(
        `https://graph.instagram.com/${this.instagramAccountId}`,
        {
          params: {
            fields: 'id,username,account_type',
            access_token: this.accessToken
          }
        }
      );

      Logger.info('Instagram connection verified', {
        accountId: response.data.id,
        username: response.data.username,
        accountType: response.data.account_type
      });

      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(`Instagram API error: ${error.response.data.error?.message || error.message}`);
      }
      throw error;
    }
  }

  /**
   * Generate QR code for Instagram profile/DM link
   */
  async generateQR() {
    try {
      if (!this.isConnected) {
        // If not connected, generate QR that links to Instagram profile
        // Users can scan and send DM manually, or we generate OAuth link
        const instagramUrl = `https://www.instagram.com/direct/inbox/`;
        
        const qrCode = await QRCode.toString(instagramUrl, { type: 'utf8' });
        const qrDataUrl = await QRCode.toDataURL(instagramUrl);

        return this.formatSuccess({
          qrCode: qrCode,
          qrCodeDataUrl: qrDataUrl,
          instagramUrl: instagramUrl,
          message: 'Scan QR code to open Instagram Direct Messages',
          setupRequired: true
        }, 'generateQR');
      }

      // If connected, generate QR linking to Instagram profile
      const accountInfo = await this.verifyConnection();
      const instagramUrl = accountInfo.username 
        ? `https://www.instagram.com/${accountInfo.username}/`
        : `https://www.instagram.com/direct/inbox/`;

      const qrCode = await QRCode.toString(instagramUrl, { type: 'utf8' });
      const qrDataUrl = await QRCode.toDataURL(instagramUrl);

      return this.formatSuccess({
        qrCode: qrCode,
        qrCodeDataUrl: qrDataUrl,
        instagramUrl: instagramUrl,
        username: accountInfo.username,
        message: 'Scan QR code to open Instagram profile',
        alreadyConnected: true
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
      let accountInfo = null;
      
      if (this.isConnected && this.accessToken) {
        try {
          accountInfo = await this.verifyConnection();
        } catch (error) {
          this.isConnected = false;
          this.isActive = false;
        }
      }

      const status = {
        isConnected: this.isConnected && !!accountInfo,
        isActive: this.isActive && !!accountInfo,
        hasQR: false,
        qrCodeDataUrl: null,
        accountInfo: accountInfo ? {
          id: accountInfo.id,
          username: accountInfo.username,
          accountType: accountInfo.account_type
        } : null
      };

      return this.formatSuccess(status, 'getConnectionStatus');
    } catch (error) {
      return this.handleError(error, 'getConnectionStatus');
    }
  }

  /**
   * Disconnect from Instagram
   */
  async disconnect() {
    try {
      this.isConnected = false;
      this.isActive = false;
      this.accessToken = null;
      this.instagramAccountId = null;
      this.messageHandlers = [];

      Logger.info('Instagram connector disconnected', {
        sessionId: this.config.sessionId
      });

      return this.formatSuccess({
        message: 'Instagram disconnected successfully'
      }, 'disconnect');
    } catch (error) {
      return this.handleError(error, 'disconnect');
    }
  }

  /**
   * Send a message via Instagram Direct Message
   */
  async sendMessage(to, message, options = {}) {
    try {
      if (!this.isConnected) {
        throw new Error('Instagram is not connected');
      }

      if (!this.pageId) {
        throw new Error('Facebook Page ID is required for sending messages');
      }

      // Instagram Graph API endpoint for sending messages
      // 'to' should be the Instagram user ID (scoped ID)
      const response = await axios.post(
        `https://graph.facebook.com/v18.0/${this.pageId}/messages`,
        {
          recipient: {
            id: to
          },
          message: {
            text: message
          }
        },
        {
          params: {
            access_token: this.accessToken
          }
        }
      );

      Logger.info('Instagram message sent', {
        sessionId: this.config.sessionId,
        to: to,
        messageId: response.data.message_id
      });

      return this.formatSuccess({
        messageId: response.data.message_id,
        to: to,
        message: message,
        timestamp: Date.now()
      }, 'sendMessage');
    } catch (error) {
      if (error.response) {
        const errorMsg = error.response.data.error?.message || error.message;
        Logger.error('Instagram API error sending message', {
          error: errorMsg,
          status: error.response.status,
          data: error.response.data
        });
        throw new Error(`Instagram API error: ${errorMsg}`);
      }
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
   * Process incoming webhook message
   * This should be called from the webhook endpoint
   */
  async processWebhookMessage(webhookData) {
    try {
      // Extract message data from Instagram webhook format
      const entry = webhookData.entry?.[0];
      const messaging = entry?.messaging?.[0];

      if (!messaging || !messaging.message) {
        return;
      }

      const message = {
        id: messaging.message.mid,
        from: messaging.sender.id,
        text: messaging.message.text || '',
        timestamp: messaging.timestamp,
        isFromMe: false, // Instagram webhooks only send incoming messages
        hasMedia: !!messaging.message.attachments,
        attachments: messaging.message.attachments || []
      };

      // Check for duplicate message
      const dedupeKey = `instagram:msg:${message.id}`;
      try {
        if (redisService.isConnected) {
          const alreadyProcessed = await redisService.exists(dedupeKey);
          if (alreadyProcessed) {
            Logger.debug('Duplicate Instagram message ignored', {
              sessionId: this.config.sessionId,
              messageId: message.id,
              from: message.from
            });
            return;
          }

          // Mark message as processed (expire after 24 hours)
          await redisService.set(dedupeKey, '1', 86400);
        }
      } catch (redisError) {
        Logger.warn('Redis deduplication check failed, continuing anyway', {
          error: redisError.message
        });
      }

      Logger.debug('Instagram message received via webhook', {
        sessionId: this.config.sessionId,
        from: message.from,
        messageId: message.id
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
      Logger.error('Error processing Instagram webhook message', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Verify webhook signature (for security)
   */
  verifyWebhookSignature(payload, signature) {
    // Implement HMAC signature verification if webhook secret is provided
    if (!this.webhookSecret) {
      return true; // Skip verification if no secret configured
    }

    // TODO: Implement HMAC verification
    // For now, return true
    return true;
  }

  /**
   * Get chat history
   */
  async getChatHistory(chatId, options = {}) {
    try {
      if (!this.isConnected) {
        throw new Error('Instagram is not connected');
      }

      // Instagram Graph API endpoint for getting conversation
      const response = await axios.get(
        `https://graph.facebook.com/v18.0/${chatId}`,
        {
          params: {
            fields: 'messages{id,from,to,message,created_time}',
            access_token: this.accessToken,
            limit: options.limit || 50
          }
        }
      );

      const messages = (response.data.messages?.data || []).map(msg => ({
        id: msg.id,
        from: msg.from.id,
        to: msg.to?.data?.[0]?.id,
        body: msg.message,
        timestamp: new Date(msg.created_time).getTime(),
        isFromMe: msg.from.id === this.instagramAccountId,
        type: 'text'
      }));

      return this.formatSuccess({
        chatId,
        messages: messages,
        count: messages.length
      }, 'getChatHistory');
    } catch (error) {
      return this.handleError(error, 'getChatHistory');
    }
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
}

module.exports = InstagramConnector;

