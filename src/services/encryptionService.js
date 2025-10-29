const crypto = require('crypto');
const config = require('../../config/config');
const Logger = require('../utils/logger');

/**
 * Generic Encryption Service for Connectors
 * 
 * Provides encryption/decryption functionality for connector credentials and sensitive config fields.
 * Uses AES-256-GCM for authenticated encryption.
 * 
 * Usage:
 * - encryptConfig(): Encrypts all fields in a connector's config object
 * - decryptConfig(): Decrypts all encrypted fields in a connector's config object
 * - encryptField(): Encrypts a single field value
 * - decryptField(): Decrypts a single encrypted field
 */
class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.encryptionKey = config.encryption.key;
    
    if (!this.encryptionKey) {
      throw new Error('ENCRYPTION_KEY is not configured');
    }
  }

  /**
   * Generate a salt for a specific connector type
   * @param {string} connectorType - The type of connector (e.g., 'twilio', 'sendgrid')
   * @returns {string} Salt string
   */
  generateSalt(connectorType) {
    return `${connectorType}-connector-salt`;
  }

  /**
   * Encrypt a single field value
   * @param {string} value - The value to encrypt
   * @param {string} connectorType - The connector type (used for salt generation)
   * @returns {Object} { encrypted, iv, authTag }
   */
  encryptField(value, connectorType) {
    try {
      if (!value || typeof value !== 'string') {
        throw new Error('Value must be a non-empty string');
      }

      const salt = this.generateSalt(connectorType);
      const secretKey = crypto.scryptSync(this.encryptionKey, salt, 32);
      
      // Generate a random IV for each encryption
      const iv = crypto.randomBytes(16);
      
      const cipher = crypto.createCipheriv(this.algorithm, secretKey, iv);
      
      let encrypted = cipher.update(value, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Get the auth tag for GCM mode
      const authTag = cipher.getAuthTag();
      
      return {
        encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
      };
    } catch (error) {
      Logger.error('Failed to encrypt field', {
        connectorType,
        error: error.message
      });
      throw new Error(`Failed to encrypt field: ${error.message}`);
    }
  }

  /**
   * Decrypt a single field value
   * @param {string} encrypted - The encrypted value
   * @param {string} iv - The initialization vector
   * @param {string} authTag - The authentication tag
   * @param {string} connectorType - The connector type (used for salt generation)
   * @returns {string} Decrypted value
   */
  decryptField(encrypted, iv, authTag, connectorType) {
    try {
      if (!encrypted || !iv || !authTag) {
        throw new Error('Missing required decryption parameters');
      }

      const salt = this.generateSalt(connectorType);
      const secretKey = crypto.scryptSync(this.encryptionKey, salt, 32);
      
      const decipher = crypto.createDecipheriv(
        this.algorithm,
        secretKey,
        Buffer.from(iv, 'hex')
      );
      
      // Set auth tag for GCM mode
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      Logger.error('Failed to decrypt field', {
        connectorType,
        error: error.message
      });
      throw new Error(`Failed to decrypt field: ${error.message}`);
    }
  }

  /**
   * Encrypt all fields in a connector's config object
   * @param {Object} config - The config object to encrypt
   * @param {string} connectorType - The connector type
   * @param {Array<string>} fieldsToEncrypt - Optional: specific fields to encrypt. If not provided, encrypts all string fields.
   * @returns {Object} Config object with encrypted fields and metadata
   */
  encryptConfig(config, connectorType, fieldsToEncrypt = null) {
    try {
      if (!config || typeof config !== 'object') {
        return config;
      }

      const encryptedConfig = { ...config };
      
      // Determine which fields to encrypt
      const fields = fieldsToEncrypt || Object.keys(config).filter(key => {
        const value = config[key];
        // Encrypt all string values that aren't already encryption metadata
        return typeof value === 'string' && 
               !key.endsWith('IV') && 
               !key.endsWith('AuthTag') &&
               !key.endsWith('_encrypted');
      });

      Logger.debug('Encrypting config fields', {
        connectorType,
        fieldCount: fields.length,
        fields
      });

      for (const field of fields) {
        const value = config[field];
        
        if (!value || typeof value !== 'string') {
          continue;
        }

        try {
          const encrypted = this.encryptField(value, connectorType);
          
          // Store encrypted value
          encryptedConfig[field] = encrypted.encrypted;
          
          // Store encryption metadata with field-specific keys
          encryptedConfig[`${field}IV`] = encrypted.iv;
          encryptedConfig[`${field}AuthTag`] = encrypted.authTag;
          
          Logger.debug(`Field '${field}' encrypted successfully`, { connectorType });
        } catch (fieldError) {
          Logger.error(`Failed to encrypt field '${field}'`, {
            connectorType,
            error: fieldError.message
          });
          // Continue with other fields even if one fails
        }
      }

      return encryptedConfig;
    } catch (error) {
      Logger.error('Failed to encrypt config', {
        connectorType,
        error: error.message
      });
      throw new Error(`Failed to encrypt config: ${error.message}`);
    }
  }

  /**
   * Decrypt all encrypted fields in a connector's config object
   * @param {Object} config - The config object with encrypted fields
   * @param {string} connectorType - The connector type
   * @returns {Object} Config object with decrypted fields (metadata removed)
   */
  decryptConfig(config, connectorType) {
    try {
      if (!config || typeof config !== 'object') {
        return config;
      }

      const decryptedConfig = { ...config };
      
      // Find all fields that have encryption metadata
      const encryptedFields = Object.keys(config).filter(key => {
        // Find keys that have corresponding IV and AuthTag
        return config[`${key}IV`] && config[`${key}AuthTag`] && 
               !key.endsWith('IV') && !key.endsWith('AuthTag');
      });

      Logger.debug('Decrypting config fields', {
        connectorType,
        fieldCount: encryptedFields.length,
        fields: encryptedFields
      });

      for (const field of encryptedFields) {
        const encrypted = config[field];
        const iv = config[`${field}IV`];
        const authTag = config[`${field}AuthTag`];

        if (!encrypted || !iv || !authTag) {
          Logger.warn(`Missing encryption metadata for field '${field}'`, { connectorType });
          continue;
        }

        try {
          const decrypted = this.decryptField(encrypted, iv, authTag, connectorType);
          decryptedConfig[field] = decrypted;
          
          // Remove encryption metadata
          delete decryptedConfig[`${field}IV`];
          delete decryptedConfig[`${field}AuthTag`];
          
          Logger.debug(`Field '${field}' decrypted successfully`, { connectorType });
        } catch (fieldError) {
          Logger.error(`Failed to decrypt field '${field}'`, {
            connectorType,
            error: fieldError.message
          });
          // Keep encrypted value if decryption fails
        }
      }

      return decryptedConfig;
    } catch (error) {
      Logger.error('Failed to decrypt config', {
        connectorType,
        error: error.message
      });
      throw new Error(`Failed to decrypt config: ${error.message}`);
    }
  }

  /**
   * Sanitize config by masking sensitive fields for frontend display
   * @param {Object} config - The config object
   * @param {string} connectorType - The connector type
   * @returns {Object} Sanitized config with masked values
   */
  sanitizeConfig(config, connectorType) {
    if (!config || typeof config !== 'object') {
      return config;
    }

    const sanitized = { ...config };
    
    // Mask all fields that have encryption metadata
    const encryptedFields = Object.keys(config).filter(key => {
      return config[`${key}IV`] && config[`${key}AuthTag`] && 
             !key.endsWith('IV') && !key.endsWith('AuthTag');
    });

    for (const field of encryptedFields) {
      // Mask the encrypted value
      sanitized[field] = '********';
      
      // Remove encryption metadata from response
      delete sanitized[`${field}IV`];
      delete sanitized[`${field}AuthTag`];
    }

    Logger.debug('Config sanitized for frontend', {
      connectorType,
      maskedFields: encryptedFields.length
    });

    return sanitized;
  }

  /**
   * Check if a connector requires encryption based on connector metadata
   * @param {Object} connector - The connector object from tenant manager
   * @returns {boolean} True if encryption is required
   */
  requiresEncryption(connector) {
    return connector?.requiresEncryption === true || 
           connector?.encryption === true ||
           connector?.encrypted === true;
  }

  /**
   * Get list of fields that should be encrypted for a specific connector
   * @param {Object} connector - The connector object from tenant manager
   * @returns {Array<string>|null} Array of field names to encrypt, or null to encrypt all string fields
   */
  getEncryptableFields(connector) {
    // If connector specifies which fields to encrypt, use that list
    if (connector?.encryptableFields && Array.isArray(connector.encryptableFields)) {
      return connector.encryptableFields;
    }
    
    // If connector has a config schema, extract string fields
    if (connector?.configSchema && Array.isArray(connector.configSchema)) {
      return connector.configSchema
        .filter(field => field.type === 'password' || field.type === 'secret' || field.sensitive === true)
        .map(field => field.name);
    }
    
    // Default: encrypt all string fields
    return null;
  }
}

// Singleton instance
const encryptionService = new EncryptionService();

module.exports = encryptionService;

