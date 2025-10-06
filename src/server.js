// console.log('Starting ScalAI CRUD Server...');
const app = require('./app');
const config = require('../config/config');
const Logger = require('./utils/logger');
const connectionPoolManager = require('./services/connectionPoolManager');
const schemaValidationService = require('./services/schemaValidationService');
const redisService = require("./services/redisService");

const PORT = config.server.port;

async function startServer() {
  try {
    console.log('[DEBUG] Starting ScalAI CRUD Server...');
    console.log('[DEBUG] About to initialize Logger...');
    Logger.info('Starting ScalAI CRUD Server...');
    console.log('[DEBUG] Logger initialized successfully');

    // Initialize Redis service (optional - continue if fails)
    console.log('[DEBUG] Initializing Redis...');
    try {
      console.log('[DEBUG] About to connect to Redis...');
      await redisService.connect();
      console.log('[DEBUG] Redis connected successfully');
      Logger.info('Redis service connected');
    } catch (error) {
      console.log('[DEBUG] Redis connection failed:', error.message);
      Logger.warn('Redis connection failed, continuing without Redis', { error: error.message });
    }

    // Initialize connection pool manager
    console.log('[DEBUG] Initializing connection pool manager...');
    console.log('[DEBUG] About to initialize connection pool manager...');
    await connectionPoolManager.initialize();
    console.log('[DEBUG] Connection pool manager initialized');
    Logger.info('Connection Pool Manager initialized');

    // Initialize schema validation service
    console.log('[DEBUG] Initializing schema validation service...');
    console.log('[DEBUG] About to initialize schema validation service...');
    await schemaValidationService.initialize();
    console.log('[DEBUG] Schema validation service initialized');
    Logger.info('Schema Validation Service initialized');

    // Start HTTP server
    console.log('[DEBUG] Starting HTTP server on port', PORT);
    console.log('[DEBUG] About to start HTTP server...');
    const server = app.listen(PORT, () => {
      console.log('[DEBUG] HTTP server started successfully');
      Logger.info(`🤖 ScalAI CRUD Server running on port ${PORT} in ${config.server.nodeEnv} mode`);
      Logger.info('Server ready to handle agent database operations');
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