const express = require('express');
const router = express.Router();

// Import controllers
const HomeController = require('../controllers/homeController');

// Import middleware
const { authenticateToken, requestLogger } = require('../middleware/authMiddleware');
const { userLimiter, subaccountLimiter } = require('../middleware/rateLimiter');
const { requireResourcePermission } = require('../middleware/rbacClient');

// Import validators
const { validateSubaccountId } = require('../validators/databaseValidator');

// Apply common middleware
router.use(requestLogger);
router.use(authenticateToken);
router.use(userLimiter);

// GET /api/home/:subaccountId/dashboard - Get dashboard metrics
router.get('/:subaccountId/dashboard',
  validateSubaccountId,
//   requireResourcePermission(),
  subaccountLimiter(200, 60000),
  HomeController.getDashboardMetrics
);

module.exports = router;
