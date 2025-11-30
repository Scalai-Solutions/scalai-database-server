const express = require('express');
const router = express.Router();

// Import controllers
const ConnectorController = require('../controllers/connectorController');

// Import middleware
const { authenticateToken, requestLogger } = require('../middleware/authMiddleware');
const { userLimiter, subaccountLimiter } = require('../middleware/rateLimiter');

// Import validators
const { validateSubaccountId } = require('../validators/connectorValidator');

// Apply request logger to all routes
router.use(requestLogger);

// Apply JWT authentication middleware
router.use(authenticateToken);
router.use(userLimiter);

// GET /api/gmail/:subaccountId/status - Get Gmail connection status (proxy to webhook server)
// Note: No RBAC permission check - only requires JWT authentication
router.get('/:subaccountId/status',
  validateSubaccountId,
  subaccountLimiter(100, 60000),
  ConnectorController.getGmailStatus
);

// POST /api/gmail/:subaccountId/disconnect - Disconnect Gmail (proxy to webhook server)
// Note: No RBAC permission check - only requires JWT authentication
router.post('/:subaccountId/disconnect',
  validateSubaccountId,
  subaccountLimiter(50, 60000),
  ConnectorController.disconnectGmail
);

module.exports = router;

