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
   * @returns {Object|Object} For Twilio: { config, metadata }, For others: config object with encrypted fields and metadata
   */
  encryptConfig(config, connectorType, fieldsToEncrypt = null) {
    try {
      if (!config || typeof config !== 'object') {
        return connectorType === 'twilio' ? { config, metadata: {} } : config;
      }

      const encryptedConfig = { ...config };
      const isTwilio = connectorType === 'twilio';
      const encryptionMetadata = {}; // For Twilio, store metadata separately
      
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
          
          // For Twilio connectors, store encryption metadata separately
          // For other connectors, store directly in config (backward compatibility)
          if (isTwilio) {
            encryptionMetadata[`${field}IV`] = encrypted.iv;
            encryptionMetadata[`${field}AuthTag`] = encrypted.authTag;
          } else {
            // Store encryption metadata with field-specific keys (backward compatible)
            encryptedConfig[`${field}IV`] = encrypted.iv;
            encryptedConfig[`${field}AuthTag`] = encrypted.authTag;
          }
          
          Logger.debug(`Field '${field}' encrypted successfully`, { connectorType });
        } catch (fieldError) {
          Logger.error(`Failed to encrypt field '${field}'`, {
            connectorType,
            error: fieldError.message
          });
          // Continue with other fields even if one fails
        }
      }

      // For Twilio, return config and metadata separately
      if (isTwilio) {
        return {
          config: encryptedConfig,
          metadata: encryptionMetadata
        };
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
   * @param {Object} documentMetadata - Optional: document-level metadata (for Twilio connectors)
   * @returns {Object} Config object with decrypted fields (metadata removed)
   */
  decryptConfig(config, connectorType, documentMetadata = null) {
    try {
      if (!config || typeof config !== 'object') {
        return config;
      }

      const decryptedConfig = { ...config };
      const isTwilio = connectorType === 'twilio';
      
      // For Twilio connectors, use document-level metadata if provided, otherwise check config (backward compatibility)
      // For other connectors, check config directly
      const metadataSource = isTwilio && documentMetadata ? documentMetadata : 
                            (isTwilio && config.metadata ? config.metadata : config);
      
      // Find all fields that have encryption metadata
      const encryptedFields = Object.keys(config).filter(key => {
        // Skip metadata object itself and fields ending with IV/AuthTag
        if (key === 'metadata' || key.endsWith('IV') || key.endsWith('AuthTag')) {
          return false;
        }
        
        // For Twilio, check document metadata, config.metadata, or config root (backward compatibility)
        if (isTwilio) {
          return (documentMetadata && documentMetadata[`${key}IV`] && documentMetadata[`${key}AuthTag`]) ||
                 (config.metadata && config.metadata[`${key}IV`] && config.metadata[`${key}AuthTag`]) ||
                 (config[`${key}IV`] && config[`${key}AuthTag`]);
        } else {
          // For other connectors, check config directly
          return config[`${key}IV`] && config[`${key}AuthTag`];
        }
      });

      Logger.debug('Decrypting config fields', {
        connectorType,
        fieldCount: encryptedFields.length,
        fields: encryptedFields,
        isTwilio,
        hasDocumentMetadata: isTwilio && !!documentMetadata,
        hasConfigMetadata: isTwilio && !!config.metadata
      });

      for (const field of encryptedFields) {
        const encrypted = config[field];
        
        // For Twilio, try document metadata first, then config.metadata, then config root (backward compatibility)
        let iv, authTag;
        if (isTwilio) {
          iv = (documentMetadata && documentMetadata[`${field}IV`]) ||
               (config.metadata && config.metadata[`${field}IV`]) ||
               config[`${field}IV`];
          authTag = (documentMetadata && documentMetadata[`${field}AuthTag`]) ||
                    (config.metadata && config.metadata[`${field}AuthTag`]) ||
                    config[`${field}AuthTag`];
        } else {
          iv = config[`${field}IV`];
          authTag = config[`${field}AuthTag`];
        }

        if (!encrypted || !iv || !authTag) {
          Logger.warn(`Missing encryption metadata for field '${field}'`, { connectorType });
          continue;
        }

        try {
          const decrypted = this.decryptField(encrypted, iv, authTag, connectorType);
          decryptedConfig[field] = decrypted;
          
          // Remove encryption metadata from config (if present)
          delete decryptedConfig[`${field}IV`];
          delete decryptedConfig[`${field}AuthTag`];
          
          // For Twilio, also remove from config.metadata if it exists there (backward compatibility)
          if (isTwilio && decryptedConfig.metadata) {
            delete decryptedConfig.metadata[`${field}IV`];
            delete decryptedConfig.metadata[`${field}AuthTag`];
            
            // Remove metadata object if it's empty
            if (Object.keys(decryptedConfig.metadata).length === 0) {
              delete decryptedConfig.metadata;
            }
          }
          
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

