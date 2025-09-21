const express = require('express');
const router = express.Router();

// Import controllers
const DatabaseController = require('../controllers/databaseController');

// Import middleware
const { authenticateToken, requestLogger } = require('../middleware/authMiddleware');
const { userLimiter, subaccountLimiter } = require('../middleware/rateLimiter');
const { requireResourcePermission } = require('../middleware/rbacClient');

// Import validators
const { 
  validateSubaccountId,
  validateCollectionName,
  validateQueryBody,
  validateInsertBody,
  validateUpdateBody,
  validateDeleteBody
} = require('../validators/databaseValidator');

// Apply common middleware
router.use(requestLogger);
router.use(authenticateToken);
router.use(userLimiter);


// Basic CRUD Operations with Dynamic RBAC

// GET /api/database/:subaccountId/collections - List collections
router.get('/:subaccountId/collections',
  validateSubaccountId,
  requireResourcePermission(),
  DatabaseController.getCollections
);

// POST /api/database/:subaccountId/collections/:collection/find - Find documents
router.post('/:subaccountId/collections/:collection/find',
  validateSubaccountId,
  validateCollectionName,
  validateQueryBody,
  requireResourcePermission(),
  subaccountLimiter(200, 60000),
  DatabaseController.find
);

// POST /api/database/:subaccountId/collections/:collection/insertOne - Insert document
router.post('/:subaccountId/collections/:collection/insertOne',
  validateSubaccountId,
  validateCollectionName,
  validateInsertBody,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.insertOne
);

// POST /api/database/:subaccountId/collections/:collection/updateOne - Update document
router.post('/:subaccountId/collections/:collection/updateOne',
  validateSubaccountId,
  validateCollectionName,
  validateUpdateBody,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.updateOne
);

// POST /api/database/:subaccountId/collections/:collection/deleteOne - Delete document
router.post('/:subaccountId/collections/:collection/deleteOne',
  validateSubaccountId,
  validateCollectionName,
  validateDeleteBody,
  requireResourcePermission(),
  subaccountLimiter(50, 60000),
  DatabaseController.deleteOne
);

module.exports = router; 