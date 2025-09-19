const app = require('./app');
const config = require('../config/config');
const Logger = require('./utils/logger');
const connectionPoolManager = require('./services/connectionPoolManager');
const schemaValidationService = require('./services/schemaValidationService');
const RedisService = require("./services/redisService");
const redisService = new RedisService();

const PORT = config.server.port;

async function startServer() {
  try {
    console.log('[DEBUG] Starting Database CRUD Server...');
    Logger.info('Starting Database CRUD Server...');

    // Initialize Redis service (optional - continue if fails)
    console.log('[DEBUG] Initializing Redis...');
    try {
      await redisService.connect();
      console.log('[DEBUG] Redis connected successfully');
      Logger.info('Redis service connected');
    } catch (error) {
      console.log('[DEBUG] Redis connection failed:', error.message);
      Logger.warn('Redis connection failed, continuing without Redis', { error: error.message });
    }

    // Initialize connection pool manager
    console.log('[DEBUG] Initializing connection pool manager...');
    await connectionPoolManager.initialize();
    console.log('[DEBUG] Connection pool manager initialized');
    Logger.info('Connection Pool Manager initialized');

    // Initialize schema validation service
    console.log('[DEBUG] Initializing schema validation service...');
    await schemaValidationService.initialize();
    console.log('[DEBUG] Schema validation service initialized');
    Logger.info('Schema Validation Service initialized');

    // Start HTTP server
    console.log('[DEBUG] Starting HTTP server on port', PORT);
    const server = app.listen(PORT, () => {
      console.log('[DEBUG] HTTP server started successfully');
      Logger.info(`🗄️  Database CRUD Server running on port ${PORT} in ${config.server.nodeEnv} mode`);
      Logger.info('Server ready to handle database operations');
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal) => {
      Logger.info(`${signal} received, shutting down gracefully`);
      
      server.close(async () => {
        try {
          Logger.info('HTTP server closed');
          
          // Close Redis connection
          try {
            await redisService.disconnect();
            Logger.info('Redis connection closed');
          } catch (error) {
            Logger.warn('Error closing Redis connection', { error: error.message });
          }
          
          Logger.info('Database CRUD Server shutdown complete');
          process.exit(0);
        } catch (error) {
          Logger.error('Error during graceful shutdown', { error: error.message });
          process.exit(1);
        }
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return server;
  } catch (error) {
    console.log('[DEBUG] Server startup failed:', error.message);
    Logger.error('Failed to start Database CRUD Server', { error: error.message });
    process.exit(1);
  }
}

// Start the server
startServer(); 