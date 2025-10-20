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
const { 
  validateCreateWebCallBody,
  validateCreatePhoneCallBody,
  validateCreateBatchCallBody
} = require('../validators/callValidator');

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

// POST /api/calls/:subaccountId/phone-call - Create a phone call
router.post('/:subaccountId/phone-call',
  validateSubaccountId,
  validateCreatePhoneCallBody,
  requireResourcePermission(),
  subaccountLimiter(50, 60000),
  CallController.createPhoneCall
);

// POST /api/calls/:subaccountId/batch-call - Create a batch call
router.post('/:subaccountId/batch-call',
  validateSubaccountId,
  validateCreateBatchCallBody,
  requireResourcePermission(),
  subaccountLimiter(10, 60000),
  CallController.createBatchCall
);

// GET /api/calls/:subaccountId/logs - Get call logs (simple)
router.get('/:subaccountId/logs',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  CallController.getCallLogs
);

// POST /api/calls/:subaccountId/logs/filter - Get call logs with filters and pagination
router.post('/:subaccountId/logs/filter',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  CallController.getCallLogs
);

// DELETE /api/calls/:subaccountId/logs/:callId - Delete a call log
router.delete('/:subaccountId/logs/:callId',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(50, 60000),
  CallController.deleteCallLog
);

module.exports = router; 