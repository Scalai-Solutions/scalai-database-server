const express = require('express');
const router = express.Router();

// Import controllers
const ActivityController = require('../controllers/activityController');

// Import middleware
const { authenticateToken, requestLogger } = require('../middleware/authMiddleware');
const { userLimiter, subaccountLimiter } = require('../middleware/rateLimiter');
const { requireResourcePermission } = require('../middleware/rbacClient');

// Import validators
const { validateSubaccountId } = require('../validators/databaseValidator');
const { 
  validateGetActivitiesQuery,
  validateGetActivityStatsQuery
} = require('../validators/activityValidator');

// Apply common middleware
router.use(requestLogger);
router.use(authenticateToken);
router.use(userLimiter);

// GET /api/activities/:subaccountId - Get activities for last 24 hours (or custom range)
router.get('/:subaccountId',
  validateSubaccountId,
  validateGetActivitiesQuery,
  // requireResourcePermission(),
  subaccountLimiter(200, 60000),
  ActivityController.getActivities
);

// GET /api/activities/:subaccountId/stats - Get activity statistics
router.get('/:subaccountId/stats',
  validateSubaccountId,
  validateGetActivityStatsQuery,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  ActivityController.getActivityStats
);

module.exports = router;
