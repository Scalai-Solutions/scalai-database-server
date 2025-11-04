const express = require('express');
const router = express.Router();

// Import controllers
const WhatsAppController = require('../controllers/whatsappController');

// Import middleware
const { authenticateToken, requestLogger } = require('../middleware/authMiddleware');
const { userLimiter, subaccountLimiter } = require('../middleware/rateLimiter');
const { requireResourcePermission } = require('../middleware/rbacClient');
const { requireConnector } = require('../middleware/connectorCheckMiddleware');

// Import validators
const { 
  validateSubaccountId
} = require('../validators/databaseValidator');

// Apply common middleware
router.use(requestLogger);
router.use(authenticateToken);
router.use(userLimiter);

// POST /api/database/:subaccountId/chat-agents/:agentId/whatsapp/connect - Initialize WhatsApp and generate QR code
router.post('/:subaccountId/chat-agents/:agentId/whatsapp/connect',
  validateSubaccountId,
  requireConnector('whatsapp'),
  requireResourcePermission(),
  subaccountLimiter(100, 60000), // Increased from 20 to 100 per minute
  WhatsAppController.connect
);

// GET /api/database/:subaccountId/chat-agents/:agentId/whatsapp/status - Get connection status
router.get('/:subaccountId/chat-agents/:agentId/whatsapp/status',
  validateSubaccountId,
  requireConnector('whatsapp'),
  requireResourcePermission(),
  subaccountLimiter(500, 60000), // Increased from 100 to 500 per minute
  WhatsAppController.getStatus
);

// POST /api/database/:subaccountId/chat-agents/:agentId/whatsapp/disconnect - Disconnect WhatsApp
router.post('/:subaccountId/chat-agents/:agentId/whatsapp/disconnect',
  validateSubaccountId,
  requireConnector('whatsapp'),
  requireResourcePermission(),
  subaccountLimiter(100, 60000), // Increased from 20 to 100 per minute
  WhatsAppController.disconnect
);

// POST /api/database/:subaccountId/chat-agents/:agentId/whatsapp/send - Send WhatsApp message
router.post('/:subaccountId/chat-agents/:agentId/whatsapp/send',
  validateSubaccountId,
  requireConnector('whatsapp'),
  requireResourcePermission(),
  subaccountLimiter(1000, 60000), // Increased from 200 to 1000 per minute
  WhatsAppController.sendMessage
);

// GET /api/database/:subaccountId/chat-agents/:agentId/whatsapp/messages - Get message history
router.get('/:subaccountId/chat-agents/:agentId/whatsapp/messages',
  validateSubaccountId,
  requireConnector('whatsapp'),
  requireResourcePermission(),
  subaccountLimiter(500, 60000), // Increased from 100 to 500 per minute
  WhatsAppController.getMessages
);

// GET /api/database/:subaccountId/chat-agents/whatsapp/connections - Get all WhatsApp connections
router.get('/:subaccountId/chat-agents/whatsapp/connections',
  validateSubaccountId,
  requireConnector('whatsapp'),
  requireResourcePermission(),
  subaccountLimiter(200, 60000), // Increased from 50 to 200 per minute
  WhatsAppController.getConnections
);

module.exports = router;

