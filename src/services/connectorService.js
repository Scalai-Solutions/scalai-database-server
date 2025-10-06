const axios = require('axios');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const redisService = require('./redisService');

class ConnectorService {
  constructor() {
    this.baseURL = config.tenantManager.url;
    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Add request interceptor for logging
    this.axiosInstance.interceptors.request.use(
      (request) => {
        Logger.debug('Connector Service API Request', {
          method: request.method,
          url: request.url,
          headers: request.headers
        });
        return request;
      },
      (error) => {
        Logger.error('Connector Service API Request Error', { error: error.message });
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging
    this.axiosInstance.interceptors.response.use(
      (response) => {
        Logger.debug('Connector Service API Response', {
          status: response.status,
          url: response.config.url
        });
        return response;
      },
      (error) => {
        Logger.error('Connector Service API Response Error', {
          status: error.response?.status,
          message: error.message,
          url: error.config?.url
        });
        return Promise.reject(error);
      }
    );
  }

  // Get list of available connectors
  async getAvailableConnectors(accessToken = null, includeServiceAuth = true) {
    try {
      const headers = {
        'Content-Type': 'application/json'
      };

      // Add access token if provided
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      // Add service token if available and requested (for service-to-service auth)
      if (includeServiceAuth && config.serviceToken.token) {
        headers['X-Service-Token'] = config.serviceToken.token;
        headers['X-Service-Name'] = config.server.serviceName;
      }

      const response = await this.axiosInstance.get('/api/connectors', { headers });

      return {
        success: true,
        data: response.data.data
      };
    } catch (error) {
      Logger.error('Failed to get available connectors', {
        error: error.message,
        status: error.response?.status
      });

      return {
        success: false,
        error: error.response?.data?.message || 'Failed to fetch available connectors'
      };
    }
  }

  // Get connector by ID
  async getConnectorById(connectorId, accessToken = null, includeServiceAuth = true) {
    try {
      const headers = {
        'Content-Type': 'application/json'
      };

      // Add access token if provided
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      // Add service token if available and requested (for service-to-service auth)
      if (includeServiceAuth && config.serviceToken.token) {
        headers['X-Service-Token'] = config.serviceToken.token;
        headers['X-Service-Name'] = config.server.serviceName;
      }

      const response = await this.axiosInstance.get(`/api/connectors/${connectorId}`, { headers });

      return {
        success: true,
        data: response.data.data
      };
    } catch (error) {
      Logger.error('Failed to get connector by ID', {
        connectorId,
        error: error.message,
        status: error.response?.status
      });

      return {
        success: false,
        error: error.response?.data?.message || 'Failed to fetch connector'
      };
    }
  }

  // Cache connector list
  async cacheConnectorList(data, ttl = 3600) {
    const key = 'connectors:list';
    return await redisService.set(key, data, ttl);
  }

  async getCachedConnectorList() {
    const key = 'connectors:list';
    return await redisService.get(key);
  }

  async invalidateConnectorListCache() {
    const key = 'connectors:list';
    return await redisService.del(key);
  }

  // Cache individual connector
  async cacheConnector(connectorId, data, ttl = 3600) {
    const key = `connector:${connectorId}`;
    return await redisService.set(key, data, ttl);
  }

  async getCachedConnector(connectorId) {
    const key = `connector:${connectorId}`;
    return await redisService.get(key);
  }

  async invalidateConnectorCache(connectorId) {
    const key = `connector:${connectorId}`;
    return await redisService.del(key);
  }

  // Cache subaccount connectors
  async cacheSubaccountConnectors(subaccountId, data, ttl = 1800) {
    const key = `subaccount:${subaccountId}:connectors`;
    return await redisService.set(key, data, ttl);
  }

  async getCachedSubaccountConnectors(subaccountId) {
    const key = `subaccount:${subaccountId}:connectors`;
    return await redisService.get(key);
  }

  async invalidateSubaccountConnectorsCache(subaccountId) {
    const key = `subaccount:${subaccountId}:connectors`;
    return await redisService.del(key);
  }

  // Cache specific subaccount connector config
  async cacheSubaccountConnectorConfig(subaccountId, connectorId, data, ttl = 1800) {
    const key = `subaccount:${subaccountId}:connector:${connectorId}`;
    return await redisService.set(key, data, ttl);
  }

  async getCachedSubaccountConnectorConfig(subaccountId, connectorId) {
    const key = `subaccount:${subaccountId}:connector:${connectorId}`;
    return await redisService.get(key);
  }

  async invalidateSubaccountConnectorConfigCache(subaccountId, connectorId) {
    const key = `subaccount:${subaccountId}:connector:${connectorId}`;
    return await redisService.del(key);
  }

  // Initiate Google Calendar OAuth flow
  async initiateGoogleCalendarOAuth(subaccountId, userEmail) {
    try {
      const webhookServerUrl = config.webhookServer?.url || 'http://localhost:3004';
      const webhookServerToken = config.webhookServer?.serviceToken || config.serviceToken.token;

      const headers = {
        'Content-Type': 'application/json',
        'X-Service-Token': webhookServerToken,
        'X-Service-Name': config.server.serviceName
      };

      Logger.info('Proxying Google Calendar OAuth to webhook server', {
        subaccountId,
        userEmail,
        webhookServerUrl
      });

      const response = await axios.post(
        `${webhookServerUrl}/api/google/${subaccountId}/connect`,
        { userEmail },
        { 
          headers,
          timeout: config.webhookServer?.timeout || 10000
        }
      );

      Logger.info('Google Calendar OAuth initiated successfully', {
        subaccountId,
        userEmail,
        success: response.data.success
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      Logger.error('Failed to initiate Google Calendar OAuth', {
        subaccountId,
        userEmail,
        error: error.message,
        status: error.response?.status,
        responseData: error.response?.data
      });

      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Failed to connect to webhook server'
      };
    }
  }

  // Update connector metadata in database
  async updateConnectorMetadata(subaccountId, connectorId, metadata, connection) {
    try {
      Logger.info('Updating connector metadata in database', {
        subaccountId,
        connectorId
      });

      // Check if connector exists
      const existingConnector = await connection.db.collection('connectorsubaccount').findOne({
        subaccountId,
        connectorId
      });

      if (!existingConnector) {
        throw new Error('Connector not found for this subaccount');
      }

      // Update metadata
      const updateData = {
        metadata: {
          ...(existingConnector.metadata || {}),
          ...metadata
        },
        updatedAt: new Date()
      };

      await connection.db.collection('connectorsubaccount').updateOne(
        { subaccountId, connectorId },
        { $set: updateData }
      );

      // Invalidate caches
      await this.invalidateSubaccountConnectorsCache(subaccountId);
      await this.invalidateSubaccountConnectorConfigCache(subaccountId, connectorId);

      Logger.info('Connector metadata updated successfully', {
        subaccountId,
        connectorId
      });

      return {
        success: true,
        metadata: updateData.metadata
      };
    } catch (error) {
      Logger.error('Failed to update connector metadata', {
        subaccountId,
        connectorId,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Singleton instance
const connectorService = new ConnectorService();

module.exports = connectorService;

