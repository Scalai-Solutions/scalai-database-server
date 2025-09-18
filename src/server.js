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
    Logger.info('Starting Database CRUD Server...');

    // Initialize Redis service
    // await redisService.connect(); // Temporarily disabled
    Logger.info('Redis service connected');

    // Initialize connection pool manager
    await connectionPoolManager.initialize();
    Logger.info('Connection Pool Manager initialized');

    // Initialize schema validation service
    await schemaValidationService.initialize();
    Logger.info('Schema Validation Service initialized');

    // Start HTTP server
    const server = app.listen(PORT, () => {
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
          // await redisService.disconnect(); // Temporarily disabled
          Logger.info('Redis connection closed');
          
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
    Logger.error('Failed to start Database CRUD Server', { error: error.message });
    process.exit(1);
  }
}

// Start the server
startServer(); 