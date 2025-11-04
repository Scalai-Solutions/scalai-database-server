const express = require('express');
const router = express.Router();

// Import controllers
const InstagramController = require('../controllers/instagramController');

// Import middleware
const { authenticateToken, requestLogger } = require('../middleware/authMiddleware');
const { userLimiter, subaccountLimiter } = require('../middleware/rateLimiter');
const { requireResourcePermission } = require('../middleware/rbacClient');

// Import validators
const { 
  validateSubaccountId
} = require('../validators/databaseValidator');

// Apply common middleware
router.use(requestLogger);
router.use(authenticateToken);
router.use(userLimiter);

// POST /api/database/:subaccountId/chat-agents/:agentId/instagram/connect - Initialize Instagram and generate QR code
router.post('/:subaccountId/chat-agents/:agentId/instagram/connect',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(20, 60000),
  InstagramController.connect
);

// GET /api/database/:subaccountId/chat-agents/:agentId/instagram/status - Get connection status
router.get('/:subaccountId/chat-agents/:agentId/instagram/status',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  InstagramController.getStatus
);

// POST /api/database/:subaccountId/chat-agents/:agentId/instagram/disconnect - Disconnect Instagram
router.post('/:subaccountId/chat-agents/:agentId/instagram/disconnect',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(20, 60000),
  InstagramController.disconnect
);

// POST /api/database/:subaccountId/chat-agents/:agentId/instagram/send - Send Instagram message
router.post('/:subaccountId/chat-agents/:agentId/instagram/send',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(200, 60000),
  InstagramController.sendMessage
);

// GET /api/database/:subaccountId/chat-agents/:agentId/instagram/messages - Get message history
router.get('/:subaccountId/chat-agents/:agentId/instagram/messages',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  InstagramController.getMessages
);

// GET /api/database/:subaccountId/chat-agents/instagram/connections - Get all Instagram connections
router.get('/:subaccountId/chat-agents/instagram/connections',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(50, 60000),
  InstagramController.getConnections
);

// POST /api/database/:subaccountId/chat-agents/:agentId/instagram/webhook - Instagram webhook endpoint
// Note: This endpoint may need to bypass authentication for Meta's webhook verification
router.post('/:subaccountId/chat-agents/:agentId/instagram/webhook',
  validateSubaccountId,
  InstagramController.webhook
);

module.exports = router;

