const express = require('express');
const router = express.Router();

// Import controllers
const AIInsightsController = require('../controllers/aiInsightsController');

// Import middleware
const { authenticateToken, requestLogger } = require('../middleware/authMiddleware');
const { userLimiter, subaccountLimiter } = require('../middleware/rateLimiter');
const { requireResourcePermission } = require('../middleware/rbacClient');
const { attachTimezone, convertResponseDates, convertRequestDates } = require('../middleware/timezoneMiddleware');

// Import validators
const { validateSubaccountId } = require('../validators/databaseValidator');
const { 
  validateGetInsightsQuery,
  validateGetInsightsHistoryQuery
} = require('../validators/aiInsightsValidator');

// Apply common middleware
router.use(requestLogger);
router.use(authenticateToken);
router.use(userLimiter);

// Apply timezone middleware
router.use(attachTimezone);
router.use(convertRequestDates);
router.use(convertResponseDates);

// GET /api/ai-insights/:subaccountId - Get AI insights (cached or generate new)
router.get('/:subaccountId',
  validateSubaccountId,
  validateGetInsightsQuery,
  // requireResourcePermission(), // Uncomment when RBAC is configured
  subaccountLimiter(20, 60000), // 20 requests per minute (AI calls are expensive)
  AIInsightsController.getInsights
);

// GET /api/ai-insights/:subaccountId/history - Get insights history
router.get('/:subaccountId/history',
  validateSubaccountId,
  validateGetInsightsHistoryQuery,
  // requireResourcePermission(),
  subaccountLimiter(50, 60000),
  AIInsightsController.getInsightsHistory
);

module.exports = router;
