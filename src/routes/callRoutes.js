const express = require('express');
const router = express.Router();

// Import controllers
const CallController = require('../controllers/callController');

// Import middleware
const { authenticateToken, requestLogger } = require('../middleware/authMiddleware');
const { authenticateServiceToken } = require('../middleware/serviceAuthMiddleware');
const { userLimiter, subaccountLimiter } = require('../middleware/rateLimiter');
const { requireResourcePermission } = require('../middleware/rbacClient');

// Import validators
const { 
  validateSubaccountId,
  validateAgentId
} = require('../validators/databaseValidator');
const { validateCreateWebCallBody } = require('../validators/callValidator');

// Webhook endpoint for updating calls (service token auth only - BEFORE common middleware)
router.patch('/:subaccountId/webhook-update',
  authenticateServiceToken,
  validateSubaccountId,
  CallController.webhookUpdateCall
);

// Apply common middleware
router.use(requestLogger);
router.use(authenticateToken);
router.use(userLimiter);

// POST /api/calls/:subaccountId/web-call - Create a web call
router.post('/:subaccountId/web-call',
  validateSubaccountId,
  validateCreateWebCallBody,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  CallController.createWebCall
);

module.exports = router; 