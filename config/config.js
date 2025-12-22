require('dotenv').config();

const config = {
  server: {
    port: process.env.PORT || process.env.DATABASE_PORT || 3002,
    nodeEnv: process.env.NODE_ENV || 'development',
    serviceName: 'crud-server'
  },
  
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
  },
  
  // Encryption settings for decrypting subaccount connection strings
  encryption: {
    key: process.env.ENCRYPTION_KEY,
    algorithm: 'aes-256-cbc'
  },
  
  // Tenant Manager configuration
  tenantManager: {
    url: process.env.TENANT_MANAGER_URL || 'http://localhost:3003',
    timeout: 100000
  },
  
  // Auth Server configuration  
  authServer: {
    url: process.env.AUTH_SERVER_URL || 'http://localhost:3001',
    timeout: 100000
  },

  // Retell configuration
  retell: {
    webhookUrl: process.env.RETELL_WEBHOOK_URL,
    deployedWebhookServerUrl: process.env.DEPLOYED_WEBHOOK_SERVER_URL,
    schedulerMcpUrl: process.env.SCHEDULER_MCP_URL
  },

  // Webhook Server configuration
  webhookServer: {
    url: process.env.WEBHOOK_SERVER_URL || 'http://localhost:3004',
    deployedUrl: process.env.DEPLOYED_WEBHOOK_SERVER_URL,
    timeout: 10000,
    serviceToken: process.env.WEBHOOK_SERVER_SERVICE_TOKEN
  },
  
  // Redis configuration for connection pooling and caching
  redis: {
    url: process.env.REDIS_URL || `redis://${process.env.REDIS_PASSWORD ? ":" + process.env.REDIS_PASSWORD + "@" : ""}${process.env.REDIS_HOST || "localhost"}:${process.env.REDIS_PORT || 6379}`,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB) || 1, // Different DB from tenant-manager
    ttl: parseInt(process.env.REDIS_TTL) || 3600,
    
    // Cache prefixes
    prefixes: {
      connectionPool: 'db_pool:',
      schema: 'schema:',
      stats: 'stats:',
      rateLimit: 'db_rate:',
      retell: 'retell:',
      connector: 'connector:',
      connectorList: 'connectors:list',
      subaccountConnectors: 'subaccount:connectors:'
    }
  },
  
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true
  },
  
  // Connection pool settings
  connectionPool: {
    maxConnectionsPerSubaccount: 5,
    connectionTimeout: 10000,
    idleTimeout: 300000, // 5 minutes
    healthCheckInterval: 30000, // 30 seconds
    retryAttempts: 3,
    retryDelay: 1000
  },
  
  // Rate limiting configuration
  rateLimiting: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
    
    // Per-user limits
    perUser: {
      windowMs: 60 * 1000, // 1 minute
      max: 500 // Increased from 100 to 500 requests per minute per user
    },
    
    // Per-subaccount limits
    perSubaccount: {
      windowMs: 60 * 1000,
      max: 1000 // Increased from 200 to 1000 requests per minute per subaccount
    }
  },
  
  // Query execution limits
  queryLimits: {
    maxExecutionTime: 30000, // 30 seconds
    maxDocuments: 10000,
    maxAggregationStages: 20,
    maxSortMemory: 100 * 1024 * 1024, // 100MB
    allowedOperations: [
      'find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete',
      'insertOne', 'insertMany', 'updateOne', 'updateMany',
      'deleteOne', 'deleteMany', 'aggregate', 'count',
      'distinct', 'createIndex', 'dropIndex'
    ]
  },
  
  // Security settings
  security: {
    enableSchemaValidation: true,
    enableQuerySanitization: true,
    enableAuditLogging: true,
    maxQueryComplexity: 100,
    
    // Dangerous operations that require special permissions
    dangerousOperations: [
      'deleteMany', 'dropCollection', 'dropIndex', 'createIndex'
    ]
  },
  
  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'combined',
    
    // File logging
    file: {
      enabled: process.env.FILE_LOGGING === 'true',
      filename: 'logs/database-server.log',
      maxSize: '20m',
      maxFiles: '14d'
    }
  },

  super_admin: {
    email: process.env.SUPER_ADMIN_EMAIL,
    password: process.env.SUPER_ADMIN_PASS
  },

  // Service token for service-to-service communication
  serviceToken: {
    token: process.env.DATABASE_SERVER_SERVICE_TOKEN,
    authServerUrl: process.env.AUTH_SERVER_URL || 'http://localhost:3001',
    tenantManagerToken: process.env.TENANT_MANAGER_SERVICE_TOKEN
  },

  // OpenAI configuration for AI insights
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 2000,
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7
  }
};

// Validate required config
const requiredConfig = [
  'JWT_SECRET',
  'ENCRYPTION_KEY'
];

const optionalButRecommended = [
  'REDIS_PASSWORD',
  'TENANT_MANAGER_URL'
];

// Check required configuration
requiredConfig.forEach(key => {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
});

// Warn about missing optional configuration
if (config.server.nodeEnv === 'production') {
  optionalButRecommended.forEach(key => {
    if (!process.env[key]) {
      console.warn(`Missing recommended environment variable for production: ${key}`);
    }
  });
}

// Environment-specific overrides
if (config.server.nodeEnv === 'production') {
  config.logging.level = 'warn';
  config.rateLimiting.max = 500; // Stricter rate limiting in production
  config.queryLimits.maxExecutionTime = 15000; // Shorter timeout in production
}

if (config.server.nodeEnv === 'development') {
  config.logging.level = 'debug';
  config.connectionPool.healthCheckInterval = 60000; // Less frequent in development
}

module.exports = config; 