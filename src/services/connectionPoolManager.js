const mongoose = require('mongoose');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const redisService = require('./redisService');
const axios = require('axios');

class ConnectionPoolManager {
  constructor() {
    this.pools = new Map(); // subaccountId -> connection pool
    this.poolStats = new Map(); // subaccountId -> stats
    this.healthCheckInterval = null;
    this.maxConnectionsPerSubaccount = config.connectionPool.maxConnectionsPerSubaccount;
    this.connectionTimeout = config.connectionPool.connectionTimeout;
    this.idleTimeout = config.connectionPool.idleTimeout;
    this.retryAttempts = config.connectionPool.retryAttempts;
    this.retryDelay = config.connectionPool.retryDelay;
  }

  async initialize() {
    try {
      Logger.info('Initializing Connection Pool Manager');
      
      // Start health check interval
      this.startHealthCheck();
      
      // Setup cleanup on process exit
      this.setupGracefulShutdown();
      
      Logger.info('Connection Pool Manager initialized successfully');
      return true;
    } catch (error) {
      Logger.error('Failed to initialize Connection Pool Manager', {
        error: error.message
      });
      throw error;
    }
  }

  // Get connection for a subaccount
  async getConnection(subaccountId, userId) {
    try {
      Logger.debug('Getting connection for subaccount', { subaccountId, userId });

      // Check if pool exists
      let pool = this.pools.get(subaccountId);
      
      if (!pool) {
        // Create new pool
        pool = await this.createPool(subaccountId, userId);
        if (!pool) {
          throw new Error('Failed to create connection pool');
        }
      }

      // Check pool health
      if (!pool.isHealthy) {
        Logger.warn('Pool is unhealthy, recreating', { subaccountId });
        await this.removePool(subaccountId);
        pool = await this.createPool(subaccountId, userId);
      }

      // Update pool stats
      this.updatePoolStats(subaccountId, 'connection_requested');

      // Return a connection from the pool
      const connection = pool.connection;
      
      Logger.debug('Connection retrieved successfully', {
        subaccountId,
        userId,
        readyState: connection.readyState
      });

      return {
        connection,
        subaccountId,
        userId,
        release: () => this.releaseConnection(subaccountId)
      };

    } catch (error) {
      Logger.error('Failed to get connection', {
        subaccountId,
        userId,
        error: error.message
      });
      throw error;
    }
  }

  // Create a new connection pool for a subaccount
  async createPool(subaccountId, userId) {
    try {
      Logger.info('Creating connection pool', { subaccountId, userId });

      // Get subaccount connection details from tenant manager
      const subaccountDetails = await this.getSubaccountDetails(subaccountId, userId);
      
      if (!subaccountDetails) {
        throw new Error('Failed to get subaccount details');
      }

      // Create mongoose connection
      const connectionOptions = {
        maxPoolSize: this.maxConnectionsPerSubaccount,
        minPoolSize: 2, // Keep minimum 2 connections ready
        serverSelectionTimeoutMS: this.connectionTimeout,
        socketTimeoutMS: 45000,
        connectTimeoutMS: this.connectionTimeout,
                 heartbeatFrequencyMS: 10000,
         maxIdleTimeMS: this.idleTimeout,
         retryWrites: true,
        retryReads: true,
        readPreference: 'primary',
        
        // Use the specific database name
        dbName: subaccountDetails.databaseName
      };

      Logger.debug('Creating mongoose connection', {
        subaccountId,
        databaseName: subaccountDetails.databaseName,
        maxPoolSize: this.maxConnectionsPerSubaccount
      });

      const connection = await mongoose.createConnection(
        subaccountDetails.mongodbUrl,
        connectionOptions
      );

      // Test the connection
      await connection.db.admin().ping();

      // Create pool object
      const pool = {
        subaccountId,
        connection,
        databaseName: subaccountDetails.databaseName,
        createdAt: new Date(),
        lastUsed: new Date(),
        isHealthy: true,
        connectionCount: this.maxConnectionsPerSubaccount,
        activeQueries: 0,
        totalQueries: 0,
        errors: 0,
        
        // Subaccount configuration
        enforceSchema: subaccountDetails.enforceSchema,
        allowedCollections: subaccountDetails.allowedCollections,
        rateLimits: subaccountDetails.rateLimits
      };

      // Setup connection event handlers
      this.setupConnectionEventHandlers(pool);

      // Store pool
      this.pools.set(subaccountId, pool);
      
      // Initialize pool stats
      this.poolStats.set(subaccountId, {
        created: new Date(),
        connectionsRequested: 0,
        queriesExecuted: 0,
        errors: 0,
        lastActivity: new Date()
      });

      // Cache pool info in Redis
      await this.cachePoolInfo(subaccountId, pool);

      Logger.info('Connection pool created successfully', {
        subaccountId,
        databaseName: subaccountDetails.databaseName,
        maxConnections: this.maxConnectionsPerSubaccount
      });

      return pool;

    } catch (error) {
      Logger.error('Failed to create connection pool', {
        subaccountId,
        userId,
        error: error.message,
        stack: error.stack
      });
      return null;
    }
  }

  // Get subaccount details from tenant manager
  async getSubaccountDetails(subaccountId, userId) {
    try {
      // First check Redis cache
      const cacheKey = `${config.redis.prefixes.connectionPool}${subaccountId}`;
      const cachedDetails = await redisService.get(cacheKey);
      
      if (cachedDetails) {
        Logger.debug('Using cached subaccount details', { subaccountId });
        return cachedDetails;
      }

      // Get from tenant manager
      const response = await axios.get(
        `${config.tenantManager.url}/api/subaccounts/${subaccountId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.getServiceToken()}`,
            'X-User-ID': userId
          },
          timeout: config.tenantManager.timeout
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.message || 'Failed to get subaccount details');
      }

      const subaccountDetails = {
        mongodbUrl: response.data.data.mongodbUrl, // This will be decrypted by tenant manager
        databaseName: response.data.data.databaseName,
        enforceSchema: response.data.data.enforceSchema,
        allowedCollections: response.data.data.allowedCollections,
        rateLimits: response.data.data.rateLimits,
        maxConnections: response.data.data.maxConnections || this.maxConnectionsPerSubaccount
      };

      // Cache for 1 hour
      await redisService.set(cacheKey, subaccountDetails, 3600);

      return subaccountDetails;

    } catch (error) {
      Logger.error('Failed to get subaccount details', {
        subaccountId,
        userId,
        error: error.message
      });
      return null;
    }
  }

  // Setup connection event handlers
  setupConnectionEventHandlers(pool) {
    const { connection, subaccountId } = pool;

    connection.on('connected', () => {
      Logger.debug('Pool connection established', { subaccountId });
      pool.isHealthy = true;
    });

    connection.on('error', (error) => {
      Logger.error('Pool connection error', {
        subaccountId,
        error: error.message
      });
      pool.isHealthy = false;
      pool.errors++;
      this.updatePoolStats(subaccountId, 'error');
    });

    connection.on('disconnected', () => {
      Logger.warn('Pool connection disconnected', { subaccountId });
      pool.isHealthy = false;
    });

    connection.on('reconnected', () => {
      Logger.info('Pool connection reconnected', { subaccountId });
      pool.isHealthy = true;
    });

    connection.on('close', () => {
      Logger.info('Pool connection closed', { subaccountId });
      pool.isHealthy = false;
    });
  }

  // Release connection (in our case, just update stats)
  releaseConnection(subaccountId) {
    const pool = this.pools.get(subaccountId);
    if (pool) {
      pool.lastUsed = new Date();
      pool.activeQueries = Math.max(0, pool.activeQueries - 1);
      this.updatePoolStats(subaccountId, 'connection_released');
    }
  }

  // Execute query with connection
  async executeQuery(subaccountId, userId, operation, collection, query, options = {}) {
    const startTime = Date.now();
    let connection;

    try {
      // Get connection
      const connectionInfo = await this.getConnection(subaccountId, userId);
      connection = connectionInfo.connection;

      const pool = this.pools.get(subaccountId);
      if (pool) {
        pool.activeQueries++;
        pool.totalQueries++;
      }

      // Validate operation
      if (!config.queryLimits.allowedOperations.includes(operation)) {
        throw new Error(`Operation '${operation}' is not allowed`);
      }

      // Apply query limits
      if (options.limit && options.limit > config.queryLimits.maxDocuments) {
        options.limit = config.queryLimits.maxDocuments;
      }

      // Set execution timeout
      options.maxTimeMS = Math.min(
        options.maxTimeMS || config.queryLimits.maxExecutionTime,
        config.queryLimits.maxExecutionTime
      );

      // Get collection
      const db = connection.db();
      const mongoCollection = db.collection(collection);

      let result;
      let documentsAffected = 0;

      // Execute operation
      switch (operation) {
        case 'find':
          result = await mongoCollection.find(query, options).toArray();
          documentsAffected = result.length;
          break;

        case 'findOne':
          result = await mongoCollection.findOne(query, options);
          documentsAffected = result ? 1 : 0;
          break;

        case 'insertOne':
          result = await mongoCollection.insertOne(query, options);
          documentsAffected = result.insertedId ? 1 : 0;
          break;

        case 'insertMany':
          result = await mongoCollection.insertMany(query, options);
          documentsAffected = result.insertedCount || 0;
          break;

        case 'updateOne':
          result = await mongoCollection.updateOne(query.filter, query.update, options);
          documentsAffected = result.modifiedCount || 0;
          break;

        case 'updateMany':
          result = await mongoCollection.updateMany(query.filter, query.update, options);
          documentsAffected = result.modifiedCount || 0;
          break;

        case 'deleteOne':
          result = await mongoCollection.deleteOne(query, options);
          documentsAffected = result.deletedCount || 0;
          break;

        case 'deleteMany':
          result = await mongoCollection.deleteMany(query, options);
          documentsAffected = result.deletedCount || 0;
          break;

        case 'aggregate':
          result = await mongoCollection.aggregate(query, options).toArray();
          documentsAffected = result.length;
          break;

        case 'count':
          result = await mongoCollection.countDocuments(query, options);
          documentsAffected = 0;
          break;

        case 'distinct':
          result = await mongoCollection.distinct(query.field, query.filter, options);
          documentsAffected = result.length;
          break;

        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }

      const executionTime = Date.now() - startTime;

      // Update stats
      this.updatePoolStats(subaccountId, 'query_executed', {
        executionTime,
        documentsAffected
      });

      Logger.debug('Query executed successfully', {
        subaccountId,
        userId,
        operation,
        collection,
        executionTime,
        documentsAffected
      });

      return {
        success: true,
        data: result,
        metadata: {
          operation,
          collection,
          documentsAffected,
          executionTime
        }
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      Logger.error('Query execution failed', {
        subaccountId,
        userId,
        operation,
        collection,
        executionTime,
        error: error.message
      });

      this.updatePoolStats(subaccountId, 'query_failed', {
        executionTime,
        error: error.message
      });

      return {
        success: false,
        error: error.message,
        metadata: {
          operation,
          collection,
          executionTime
        }
      };
    } finally {
      // Release connection
      if (connection) {
        this.releaseConnection(subaccountId);
      }
    }
  }

  // Update pool statistics
  updatePoolStats(subaccountId, event, data = {}) {
    const stats = this.poolStats.get(subaccountId);
    if (stats) {
      stats.lastActivity = new Date();
      
      switch (event) {
        case 'connection_requested':
          stats.connectionsRequested++;
          break;
        case 'query_executed':
          stats.queriesExecuted++;
          break;
        case 'query_failed':
        case 'error':
          stats.errors++;
          break;
      }
    }
  }

  // Cache pool info in Redis
  async cachePoolInfo(subaccountId, pool) {
    try {
      const poolInfo = {
        subaccountId,
        databaseName: pool.databaseName,
        createdAt: pool.createdAt,
        isHealthy: pool.isHealthy,
        connectionCount: pool.connectionCount
      };

      const cacheKey = `${config.redis.prefixes.connectionPool}info:${subaccountId}`;
      await redisService.set(cacheKey, poolInfo, 3600);
    } catch (error) {
      Logger.error('Failed to cache pool info', {
        subaccountId,
        error: error.message
      });
    }
  }

  // Remove pool
  async removePool(subaccountId) {
    try {
      const pool = this.pools.get(subaccountId);
      
      if (pool) {
        Logger.info('Removing connection pool', { subaccountId });
        
        // Close connection
        if (pool.connection && pool.connection.readyState === 1) {
          await pool.connection.close();
        }
        
        // Remove from maps
        this.pools.delete(subaccountId);
        this.poolStats.delete(subaccountId);
        
        // Remove from Redis cache
        const cacheKeys = [
          `${config.redis.prefixes.connectionPool}${subaccountId}`,
          `${config.redis.prefixes.connectionPool}info:${subaccountId}`
        ];
        
        for (const key of cacheKeys) {
          await redisService.del(key);
        }
        
        Logger.info('Connection pool removed successfully', { subaccountId });
      }
    } catch (error) {
      Logger.error('Failed to remove connection pool', {
        subaccountId,
        error: error.message
      });
    }
  }

  // Health check for all pools
  startHealthCheck() {
    this.healthCheckInterval = setInterval(async () => {
      try {
        Logger.debug('Running connection pool health check');
        
        for (const [subaccountId, pool] of this.pools.entries()) {
          await this.checkPoolHealth(subaccountId, pool);
        }
        
        // Clean up idle pools
        await this.cleanupIdlePools();
        
      } catch (error) {
        Logger.error('Health check failed', { error: error.message });
      }
    }, config.connectionPool.healthCheckInterval);
  }

  // Check individual pool health
  async checkPoolHealth(subaccountId, pool) {
    try {
      if (!pool.connection || pool.connection.readyState !== 1) {
        Logger.warn('Pool connection is not ready', {
          subaccountId,
          readyState: pool.connection?.readyState
        });
        pool.isHealthy = false;
        return;
      }

      // Ping the database
      await pool.connection.db.admin().ping();
      
      if (!pool.isHealthy) {
        Logger.info('Pool health restored', { subaccountId });
        pool.isHealthy = true;
      }
      
    } catch (error) {
      Logger.error('Pool health check failed', {
        subaccountId,
        error: error.message
      });
      pool.isHealthy = false;
    }
  }

  // Clean up idle pools
  async cleanupIdlePools() {
    const now = Date.now();
    const idleThreshold = now - this.idleTimeout;
    
    for (const [subaccountId, pool] of this.pools.entries()) {
      if (pool.lastUsed.getTime() < idleThreshold && pool.activeQueries === 0) {
        Logger.info('Cleaning up idle pool', {
          subaccountId,
          idleTime: now - pool.lastUsed.getTime()
        });
        await this.removePool(subaccountId);
      }
    }
  }

  // Get pool statistics
  getPoolStats(subaccountId = null) {
    if (subaccountId) {
      const pool = this.pools.get(subaccountId);
      const stats = this.poolStats.get(subaccountId);
      
      if (pool && stats) {
        return {
          subaccountId,
          pool: {
            isHealthy: pool.isHealthy,
            createdAt: pool.createdAt,
            lastUsed: pool.lastUsed,
            activeQueries: pool.activeQueries,
            totalQueries: pool.totalQueries,
            errors: pool.errors,
            connectionCount: pool.connectionCount
          },
          stats
        };
      }
      return null;
    }

    // Return all pool stats
    const allStats = {};
    for (const [subaccountId] of this.pools.entries()) {
      allStats[subaccountId] = this.getPoolStats(subaccountId);
    }
    return allStats;
  }

  // Get service token for tenant manager communication
  getServiceToken() {
    // This should be a service-to-service token
    // For now, we'll use a placeholder - in production, implement proper service authentication
    return process.env.DATABASE_SERVICE_TOKEN || 'service-token-placeholder';
  }

  // Graceful shutdown
  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      Logger.info(`${signal} received, shutting down connection pools`);
      
      // Clear health check interval
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }
      
      // Close all pools
      const closePromises = [];
      for (const [subaccountId] of this.pools.entries()) {
        closePromises.push(this.removePool(subaccountId));
      }
      
      await Promise.all(closePromises);
      Logger.info('All connection pools closed');
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }
}

// Singleton instance
const connectionPoolManager = new ConnectionPoolManager();

module.exports = connectionPoolManager; 