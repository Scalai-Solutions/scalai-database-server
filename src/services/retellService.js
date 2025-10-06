const axios = require('axios');
const crypto = require('crypto');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const redisService = require('./redisService');

class RetellService {
  constructor() {
    this.tenantManagerUrl = config.tenantManager.url;
    this.serviceToken = config.serviceToken.tenantManagerToken;
  }

  // Decrypt API key using the same method as MongoDB URL
  decryptApiKey(encrypted, iv, authTag) {
    try {
      const algorithm = 'aes-256-cbc';
      const secretKey = crypto.scryptSync(config.encryption.key, 'retell-salt', 32);
      
      const decipher = crypto.createDecipheriv(algorithm, secretKey, Buffer.from(iv, 'hex'));
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      throw new Error('Failed to decrypt API key: ' + error.message);
    }
  }

  // Fetch retell account data from tenant manager
  async getRetellAccount(subaccountId) {
    try {
      Logger.info('Fetching retell account', { subaccountId });

      // Check cache first
      const cachedData = await redisService.getCachedRetellAccount(subaccountId);
      if (cachedData) {
        Logger.debug('Using cached retell account data', { subaccountId });
        return cachedData;
      }

      // Fetch from tenant manager
      const response = await axios.get(
        `${this.tenantManagerUrl}/api/subaccounts/${subaccountId}/retell`,
        {
          headers: {
            'x-service-name': 'database-server',
            'x-service-token': this.serviceToken
          },
          timeout: config.tenantManager.timeout
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.message || 'Failed to fetch retell account');
      }

      const retellData = response.data.data;
      
      // Decrypt the API key
      let decryptedApiKey = retellData.apiKey;
      
      if (retellData.encryptionIV && retellData.encryptionAuthTag) {
        try {
          decryptedApiKey = this.decryptApiKey(
            retellData.apiKey,
            retellData.encryptionIV,
            retellData.encryptionAuthTag
          );
          Logger.debug('Retell API key decrypted successfully', { subaccountId });
        } catch (error) {
          Logger.error('Failed to decrypt retell API key', {
            subaccountId,
            error: error.message
          });
          throw new Error('Failed to decrypt retell API key');
        }
      }

      const retellAccountData = {
        id: retellData.id,
        accountName: retellData.accountName,
        isActive: retellData.isActive,
        subaccountId: retellData.subaccountId,
        verificationStatus: retellData.verificationStatus,
        apiKey: decryptedApiKey,
        createdAt: retellData.createdAt,
        updatedAt: retellData.updatedAt
      };

      // Cache for 1 hour
      await redisService.cacheRetellAccount(subaccountId, retellAccountData, 3600);

      Logger.info('Retell account fetched and cached', { subaccountId });

      return retellAccountData;

    } catch (error) {
      Logger.error('Failed to fetch retell account', {
        subaccountId,
        error: error.message
      });
      throw error;
    }
  }

  // Invalidate cache for a retell account
  async invalidateCache(subaccountId) {
    try {
      await redisService.invalidateRetellAccount(subaccountId);
      Logger.info('Retell account cache invalidated', { subaccountId });
    } catch (error) {
      Logger.error('Failed to invalidate retell account cache', {
        subaccountId,
        error: error.message
      });
    }
  }
}

// Singleton instance
const retellService = new RetellService();

module.exports = retellService; 