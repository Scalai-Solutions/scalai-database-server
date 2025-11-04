const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('../config/config');

// Import middleware
const errorHandler = require('./middleware/errorHandler');
const { generalLimiter } = require('./middleware/rateLimiter');
const mockSessionMiddleware = require('./middleware/mockSessionMiddleware');
// console.log("Importing healthRoutes");
// Import routes
const healthRoutes = require('./routes/healthRoutes');
const databaseRoutes = require('./routes/databaseRoutes');
const cacheRoutes = require('./routes/cacheRoutes');
const callRoutes = require('./routes/callRoutes');
const chatRoutes = require('./routes/chatRoutes');
const connectorRoutes = require('./routes/connectorRoutes');
const homeRoutes = require('./routes/homeRoutes');
const activityRoutes = require('./routes/activityRoutes');
const aiInsightsRoutes = require('./routes/aiInsightsRoutes');
const knowledgeBaseRoutes = require('./routes/knowledgeBaseRoutes');
const mockSessionRoutes = require('./routes/mockSessionRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const instagramRoutes = require('./routes/instagramRoutes');

const app = express();

// Trust proxy for accurate IP addresses (required for Heroku)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// Configure CORS to handle multiple origins
const corsOrigins = config.cors.origin.includes(',') 
  ? config.cors.origin.split(',').map(origin => origin.trim())
  : config.cors.origin;

app.use(cors({
  origin: corsOrigins,
  credentials: true
}));

// Logging middleware
if (config.server.nodeEnv !== 'test') {
  app.use(morgan('combined'));
}

// Rate limiting
app.use(generalLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Mock session detection middleware
app.use(mockSessionMiddleware);

// Routes
app.use('/api/health', healthRoutes);
// Temporarily disable database routes to test
app.use('/api/database', databaseRoutes);
// Temporarily disable cache routes to test
app.use('/api/cache', cacheRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/connectors', connectorRoutes);
app.use('/api/home', homeRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/ai-insights', aiInsightsRoutes);
app.use('/api/knowledge-base', knowledgeBaseRoutes);
app.use('/api/mock-sessions', mockSessionRoutes);
app.use('/api/database', whatsappRoutes);
app.use('/api/database', instagramRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'ScalAI Database CRUD Server',
    version: '1.0.0',
    timestamp: new Date(),
    endpoints: {
      health: '/api/health',
      database: '/api/database',
      cache: '/api/cache',
      calls: '/api/calls',
      chats: '/api/chats',
      connectors: '/api/connectors',
      home: '/api/home',
      activities: '/api/activities',
      aiInsights: '/api/ai-insights',
      knowledgeBase: '/api/knowledge-base',
      mockSessions: '/api/mock-sessions',
      whatsapp: '/api/database/:subaccountId/chat-agents/:agentId/whatsapp',
      instagram: '/api/database/:subaccountId/chat-agents/:agentId/instagram'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Global error handler
app.use(errorHandler);

module.exports = app;
