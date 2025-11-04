const Logger = require('../utils/logger');

/**
 * Base Chat Connector Class
 * All chat connectors must extend this class and implement its methods
 */
class BaseChatConnector {
  constructor(config = {}) {
    this.type = 'base';
    this.name = 'Base Chat Connector';
    this.config = config;
    this.isActive = false;
    this.isConnected = false;
  }

  /**
   * Initialize the connector (setup auth, connections, etc.)
   */
  async initialize() {
    throw new Error('initialize() must be implemented by connector');
  }

  /**
   * Generate QR code for authentication
   * @returns {Object} QR code data
   */
  async generateQR() {
    throw new Error('generateQR() must be implemented by connector');
  }

  /**
   * Check connection status
   * @returns {Object} Connection status
   */
  async getConnectionStatus() {
    throw new Error('getConnectionStatus() must be implemented by connector');
  }

  /**
   * Disconnect from the service
   * @returns {Object} Disconnection result
   */
  async disconnect() {
    throw new Error('disconnect() must be implemented by connector');
  }

  /**
   * Send a message
   * @param {string} to - Recipient identifier
   * @param {string} message - Message content
   * @param {Object} options - Additional options
   * @returns {Object} Sent message result
   */
  async sendMessage(to, message, options = {}) {
    throw new Error('sendMessage() must be implemented by connector');
  }

  /**
   * Receive messages (setup webhook/listener)
   * @param {Function} callback - Callback function for incoming messages
   * @returns {Object} Listener setup result
   */
  async onMessage(callback) {
    throw new Error('onMessage() must be implemented by connector');
  }

  /**
   * Get chat history
   * @param {string} chatId - Chat identifier
   * @param {Object} options - Query options
   * @returns {Array} Array of messages
   */
  async getChatHistory(chatId, options = {}) {
    throw new Error('getChatHistory() must be implemented by connector');
  }

  /**
   * Check if the connector is properly configured and ready to use
   * @returns {boolean} True if ready
   */
  async isReady() {
    return this.isActive && this.isConnected && this.config !== null;
  }

  /**
   * Get connector metadata
   * @returns {Object} Metadata about the connector
   */
  getMetadata() {
    return {
      type: this.type,
      name: this.name,
      isActive: this.isActive,
      isConnected: this.isConnected,
      hasConfig: !!this.config
    };
  }

  /**
   * Handle connector-specific errors
   * @param {Error} error - The error object
   * @param {string} operation - The operation that failed
   * @returns {Object} Formatted error response
   */
  handleError(error, operation) {
    Logger.error(`${this.name} error during ${operation}`, {
      error: error.message,
      type: this.type,
      stack: error.stack
    });

    return {
      success: false,
      connector: this.type,
      operation,
      error: error.message,
      timestamp: new Date()
    };
  }

  /**
   * Format success response
   * @param {Object} data - Response data
   * @param {string} operation - The operation that succeeded
   * @returns {Object} Formatted success response
   */
  formatSuccess(data, operation) {
    return {
      success: true,
      connector: this.type,
      operation,
      data,
      timestamp: new Date()
    };
  }
}

module.exports = BaseChatConnector;

