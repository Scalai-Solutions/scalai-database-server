const axios = require('axios');
const config = require('../../config/config');
const Logger = require('../utils/logger');

class TenantService {
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
        Logger.debug('Tenant Manager API Request', {
          method: request.method,
          url: request.url,
          headers: request.headers
        });
        return request;
      },
      (error) => {
        Logger.error('Tenant Manager API Request Error', { error: error.message });
        return Promise.reject(error);
      }
    );

    // Add response interceptor for logging
    this.axiosInstance.interceptors.response.use(
      (response) => {
        Logger.debug('Tenant Manager API Response', {
          status: response.status,
          url: response.config.url
        });
        return response;
      },
      (error) => {
        Logger.error('Tenant Manager API Response Error', {
          status: error.response?.status,
          message: error.message,
          url: error.config?.url
        });
        return Promise.reject(error);
      }
    );
  }

  // Get user's subaccounts
  async getUserSubaccounts(accessToken) {
    try {
      const response = await this.axiosInstance.get('/api/subaccounts', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      return {
        success: true,
        data: response.data.data
      };
    } catch (error) {
      Logger.error('Failed to get user subaccounts', {
        error: error.message,
        status: error.response?.status
      });

      return {
        success: false,
        error: error.response?.data?.message || 'Failed to fetch subaccounts'
      };
    }
  }

  // Execute database query through tenant manager
  async executeQuery(accessToken, subaccountId, queryData) {
    try {
      const response = await this.axiosInstance.post(
        `/api/database/${subaccountId}/query`,
        queryData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );

      return {
        success: true,
        data: response.data.data
      };
    } catch (error) {
      Logger.error('Database query failed', {
        subaccountId,
        error: error.message,
        status: error.response?.status
      });

      return {
        success: false,
        error: error.response?.data?.message || 'Database query failed'
      };
    }
  }

  // Execute aggregation query
  async executeAggregation(accessToken, subaccountId, aggregationData) {
    try {
      const response = await this.axiosInstance.post(
        `/api/database/${subaccountId}/aggregate`,
        aggregationData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );

      return {
        success: true,
        data: response.data.data
      };
    } catch (error) {
      Logger.error('Aggregation query failed', {
        subaccountId,
        error: error.message,
        status: error.response?.status
      });

      return {
        success: false,
        error: error.response?.data?.message || 'Aggregation query failed'
      };
    }
  }

  // Get database collections
  async getCollections(accessToken, subaccountId) {
    try {
      const response = await this.axiosInstance.get(
        `/api/database/${subaccountId}/collections`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );

      return {
        success: true,
        data: response.data.data
      };
    } catch (error) {
      Logger.error('Failed to get collections', {
        subaccountId,
        error: error.message,
        status: error.response?.status
      });

      return {
        success: false,
        error: error.response?.data?.message || 'Failed to get collections'
      };
    }
  }

  // Get database statistics
  async getDatabaseStats(accessToken, subaccountId) {
    try {
      const response = await this.axiosInstance.get(
        `/api/database/${subaccountId}/stats`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );

      return {
        success: true,
        data: response.data.data
      };
    } catch (error) {
      Logger.error('Failed to get database stats', {
        subaccountId,
        error: error.message,
        status: error.response?.status
      });

      return {
        success: false,
        error: error.response?.data?.message || 'Failed to get database stats'
      };
    }
  }

  // Test database connection
  async testConnection(accessToken, subaccountId) {
    try {
      const response = await this.axiosInstance.get(
        `/api/database/${subaccountId}/connection/test`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );

      return {
        success: true,
        data: response.data.data
      };
    } catch (error) {
      Logger.error('Connection test failed', {
        subaccountId,
        error: error.message,
        status: error.response?.status
      });

      return {
        success: false,
        error: error.response?.data?.message || 'Connection test failed'
      };
    }
  }

  // Health check for tenant manager
  async healthCheck() {
    try {
      const response = await this.axiosInstance.get('/api/health');
      
      return {
        success: true,
        status: 'healthy',
        data: response.data
      };
    } catch (error) {
      Logger.error('Tenant Manager health check failed', {
        error: error.message
      });

      return {
        success: false,
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  // Validate subaccount access
  async validateAccess(accessToken, subaccountId, action = 'read') {
    try {
      // This is a lightweight check - just try to get subaccount details
      const response = await this.axiosInstance.get(
        `/api/subaccounts/${subaccountId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );

      const permissions = response.data.data.permissions;
      
      // Check if user has required permission
      let hasPermission = false;
      if (action === 'read' && permissions.read) hasPermission = true;
      if (action === 'write' && permissions.write) hasPermission = true;
      if (action === 'admin' && permissions.admin) hasPermission = true;

      return {
        success: true,
        hasAccess: hasPermission,
        permissions
      };
    } catch (error) {
      Logger.error('Access validation failed', {
        subaccountId,
        action,
        error: error.message,
        status: error.response?.status
      });

      return {
        success: false,
        hasAccess: false,
        error: error.response?.data?.message || 'Access validation failed'
      };
    }
  }
}

// Singleton instance
const tenantService = new TenantService();

module.exports = tenantService;
