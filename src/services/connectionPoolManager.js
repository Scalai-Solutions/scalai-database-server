const mongoose = require('mongoose');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const redisService = require('./redisService');
const axios = require('axios');
const crypto = require('crypto');

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

  // Decrypt MongoDB connection string
  decryptConnectionString(encrypted, iv, authTag) {
    try {
      const algorithm = 'aes-256-cbc';
      const secretKey = crypto.scryptSync(config.encryption.key, 'subaccount-salt', 32);
      
      const decipher = crypto.createDecipheriv(algorithm, secretKey, Buffer.from(iv, 'hex'));
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      throw new Error('Failed to decrypt connection string: ' + error.message);
    }
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
        databaseName: pool.databaseName,
        activatedConnectors: pool.activatedConnectors || [
         
        ],
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

      // Create mongoose connection with retry logic
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
        maxPoolSize: this.maxConnectionsPerSubaccount,
        mongodbUrl: subaccountDetails.mongodbUrl ? '[REDACTED]' : 'undefined'
      });
      
      if (!subaccountDetails.mongodbUrl) {
        throw new Error('MongoDB URL is missing from subaccount details');
      }
      
      console.log("Connection options", {
        ...subaccountDetails,
        mongodbUrl: '[REDACTED]' // Don't log the actual URL
      });
      
      // Retry logic for connection creation
      let connection = null;
      let lastError = null;
      
      for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
        try {
          Logger.debug('Connection attempt', { subaccountId, attempt, maxAttempts: this.retryAttempts });
          
          connection = mongoose.createConnection(
            subaccountDetails.mongodbUrl,
            connectionOptions
          );

          // Wait for the connection to be ready
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Connection timeout'));
            }, this.connectionTimeout);

            connection.once('connected', () => {
              clearTimeout(timeout);
              resolve();
            });

            connection.once('error', (error) => {
              clearTimeout(timeout);
              reject(error);
            });
          });
          
          // If we got here, connection succeeded
          Logger.info('Connection established successfully', { 
            subaccountId, 
            attempt,
            totalAttempts: attempt
          });
          break;
          
        } catch (error) {
          lastError = error;
          
          // Check if this is a DNS or network error that we should retry
          const isDNSError = error.message.includes('querySrv') || 
                            error.message.includes('ECONNREFUSED') ||
                            error.message.includes('ETIMEDOUT') ||
                            error.message.includes('ENOTFOUND') ||
                            error.message.includes('EAI_AGAIN');
          
          Logger.warn('Connection attempt failed', {
            subaccountId,
            attempt,
            maxAttempts: this.retryAttempts,
            error: error.message,
            isDNSError,
            willRetry: attempt < this.retryAttempts
          });
          
          // Close the failed connection
          if (connection) {
            try {
              await connection.close();
            } catch (closeError) {
              Logger.debug('Failed to close connection after error', {
                error: closeError.message
              });
            }
            connection = null;
          }
          
          // If this was the last attempt, throw the error
          if (attempt >= this.retryAttempts) {
            throw new Error(`Failed to create connection after ${this.retryAttempts} attempts: ${error.message}`);
          }
          
          // Wait before retrying (exponential backoff)
          const backoffDelay = this.retryDelay * Math.pow(2, attempt - 1);
          Logger.debug('Waiting before retry', { 
            subaccountId, 
            delayMs: backoffDelay,
            nextAttempt: attempt + 1
          });
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
      }
      
      if (!connection) {
        throw lastError || new Error('Failed to create connection');
      }

      // Test the connection
      try {
        await connection.db.admin().ping();
        Logger.debug('MongoDB connection ping successful', { subaccountId });
      } catch (pingError) {
        Logger.error('MongoDB connection ping failed', {
          subaccountId,
          error: pingError.message
        });
        
        // Check if database exists by trying to list collections
        try {
          const collections = await connection.db.listCollections().toArray();
          Logger.info('Database exists but ping failed, continuing anyway', {
            subaccountId,
            collectionsCount: collections.length
          });
        } catch (listError) {
          Logger.warn('Database might not exist', {
            subaccountId,
            databaseName: subaccountDetails.databaseName,
            error: listError.message
          });
          
          // Create the database by inserting a temporary document
          try {
            const tempCollection = connection.db.collection('_temp_init');
            await tempCollection.insertOne({ _init: true, createdAt: new Date() });
            await tempCollection.deleteOne({ _init: true });
            Logger.info('Database initialized successfully', { subaccountId });
          } catch (initError) {
            throw new Error(`Failed to initialize database: ${initError.message}`);
          }
        }
      }

      // Create pool object
      const pool = {
        subaccountId,
        connection,
        databaseName: subaccountDetails.databaseName,
        activatedConnectors: subaccountDetails.activatedConnectors,
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
      console.log("Getting subaccount details", { subaccountId, userId });
      // First check Redis cache
      const cacheKey = `${config.redis.prefixes.connectionPool}${subaccountId}`;
      const cachedDetails = await redisService.get(cacheKey);
      
      if (cachedDetails) {
        
        Logger.debug('Using cached subaccount details', { subaccountId, cacheKey });
        return cachedDetails;
      }
      const token = await this.getServiceToken();

      console.log("Token", token);
      // Get from tenant manager using service token
      const response = await axios.get(
        `${config.tenantManager.url}/api/subaccounts/${subaccountId}`,
        {
          headers: {
            'X-Service-Token': token,
            'X-User-ID': userId,
            'X-Service-Name': 'database-server',
            'Content-Type': 'application/json'
          },
          timeout: config.tenantManager.timeout
        }
      );

      console.log("Response", response.data);

      if (!response.data.success) {
        throw new Error(response.data.message || 'Failed to get subaccount details');
      }

      let mongodbUrl = response.data.data.mongodbUrl;
      
      // If the MongoDB URL is encrypted, decrypt it
      if (response.data.data.encryptionIV && response.data.data.encryptionAuthTag) {
        try {
          mongodbUrl = this.decryptConnectionString(
            response.data.data.mongodbUrl,
            response.data.data.encryptionIV,
            response.data.data.encryptionAuthTag
          );
          Logger.debug('MongoDB URL decrypted successfully', { subaccountId });
        } catch (error) {
          Logger.error('Failed to decrypt MongoDB URL', {
            subaccountId,
            error: error.message
          });
          throw new Error('Failed to decrypt database connection');
        }
      }

      const subaccountDetails = {
        mongodbUrl: mongodbUrl,
        subaccountId: subaccountId,
        activatedConnectors: response.data.data.activatedConnectors || [
          // Default to google_calendar if not specified (backward compatibility)
        
        ],
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
  async getServiceToken() {
    // Use the service token from environment variables
    const serviceToken = config.serviceToken.token;
    
    if (!serviceToken) {
      throw new Error('DATABASE_SERVER_SERVICE_TOKEN environment variable is not set');
    }
    
    // Validate the service token with auth server to ensure it's still active
    try {
      const validationResponse = await axios.post(
        `${config.serviceToken.authServerUrl}/api/auth/validate-service-token`,
        {},
        {
          headers: {
            'X-Service-Token': serviceToken,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );
      
      if (validationResponse.data.success) {
        Logger.debug('Service token validated successfully');
        return serviceToken;
      } else {
        throw new Error('Service token validation failed');
      }
    } catch (error) {
      Logger.error('Failed to validate service token', {
        error: error.message
      });
      throw new Error('Service token validation failed: ' + error.message);
    }
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