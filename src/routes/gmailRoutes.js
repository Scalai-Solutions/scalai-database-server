const express = require('express');
const router = express.Router();

// Import controllers
const ConnectorController = require('../controllers/connectorController');

// Import middleware
const { authenticateToken, requestLogger } = require('../middleware/authMiddleware');
const { userLimiter, subaccountLimiter } = require('../middleware/rateLimiter');
const { requireResourcePermission } = require('../middleware/rbacClient');

// Import validators
const { validateSubaccountId } = require('../validators/connectorValidator');

// Apply request logger to all routes
router.use(requestLogger);

// Apply JWT authentication middleware
router.use(authenticateToken);
router.use(userLimiter);

// GET /api/gmail/:subaccountId/status - Get Gmail connection status (proxy to webhook server)
router.get('/:subaccountId/status',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  ConnectorController.getGmailStatus
);

// POST /api/gmail/:subaccountId/disconnect - Disconnect Gmail (proxy to webhook server)
router.post('/:subaccountId/disconnect',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(50, 60000),
  ConnectorController.disconnectGmail
);

module.exports = router;

