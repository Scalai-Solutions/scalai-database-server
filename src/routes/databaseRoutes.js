const express = require('express');
const router = express.Router();

// Import controllers
const DatabaseController = require('../controllers/databaseController');

// Import middleware
const { 
  authenticateToken, 
  validateSubaccountAccess, 
  requestLogger 
} = require('../middleware/authMiddleware');

const { 
  userLimiter, 
  subaccountLimiter, 
  burstProtection 
} = require('../middleware/rateLimiter');

// Import validators
const { 
  validateDatabaseOperation,
  validateSubaccountId,
  validateCollectionName,
  validateQueryBody,
  validateInsertBody,
  validateUpdateBody,
  validateDeleteBody,
  validateAggregateBody
} = require('../validators/databaseValidator');

// Apply common middleware
router.use(requestLogger);
router.use(authenticateToken);
router.use(userLimiter);

// Collection management routes

// GET /api/database/:subaccountId/collections - List all collections
router.get('/:subaccountId/collections',
  validateSubaccountId,
  validateSubaccountAccess('read'),
  DatabaseController.getCollections
);

// GET /api/database/:subaccountId/collections/:collection/stats - Get collection statistics
router.get('/:subaccountId/collections/:collection/stats',
  validateSubaccountId,
  validateCollectionName,
  validateSubaccountAccess('read'),
  DatabaseController.getCollectionStats
);

// CRUD Operations

// POST /api/database/:subaccountId/collections/:collection/find - Find documents
router.post('/:subaccountId/collections/:collection/find',
  validateSubaccountId,
  validateCollectionName,
  validateSubaccountAccess('read'),
  validateQueryBody,
  subaccountLimiter(200, 60000), // 200 queries per minute per subaccount
  DatabaseController.find
);

// POST /api/database/:subaccountId/collections/:collection/insertOne - Insert single document
router.post('/:subaccountId/collections/:collection/insertOne',
  validateSubaccountId,
  validateCollectionName,
  validateSubaccountAccess('write'),
  validateInsertBody,
  subaccountLimiter(100, 60000), // 100 inserts per minute per subaccount
  DatabaseController.insertOne
);

// POST /api/database/:subaccountId/collections/:collection/insertMany - Insert multiple documents
router.post('/:subaccountId/collections/:collection/insertMany',
  validateSubaccountId,
  validateCollectionName,
  validateSubaccountAccess('write'),
  validateInsertBody,
  burstProtection, // Prevent rapid bulk inserts
  DatabaseController.insertMany
);

// POST /api/database/:subaccountId/collections/:collection/updateOne - Update single document
router.post('/:subaccountId/collections/:collection/updateOne',
  validateSubaccountId,
  validateCollectionName,
  validateSubaccountAccess('write'),
  validateUpdateBody,
  subaccountLimiter(150, 60000), // 150 updates per minute per subaccount
  DatabaseController.updateOne
);

// POST /api/database/:subaccountId/collections/:collection/updateMany - Update multiple documents
router.post('/:subaccountId/collections/:collection/updateMany',
  validateSubaccountId,
  validateCollectionName,
  validateSubaccountAccess('write'),
  validateUpdateBody,
  burstProtection, // Prevent rapid bulk updates
  DatabaseController.updateMany
);

// POST /api/database/:subaccountId/collections/:collection/deleteOne - Delete single document
router.post('/:subaccountId/collections/:collection/deleteOne',
  validateSubaccountId,
  validateCollectionName,
  validateSubaccountAccess('delete'),
  validateDeleteBody,
  subaccountLimiter(50, 60000), // 50 deletes per minute per subaccount
  DatabaseController.deleteOne
);

// POST /api/database/:subaccountId/collections/:collection/deleteMany - Delete multiple documents
router.post('/:subaccountId/collections/:collection/deleteMany',
  validateSubaccountId,
  validateCollectionName,
  validateSubaccountAccess('delete'),
  validateDeleteBody,
  burstProtection, // Prevent rapid bulk deletes
  DatabaseController.deleteMany
);

// Advanced operations

// POST /api/database/:subaccountId/collections/:collection/aggregate - Aggregation pipeline
router.post('/:subaccountId/collections/:collection/aggregate',
  validateSubaccountId,
  validateCollectionName,
  validateSubaccountAccess('read'),
  validateAggregateBody,
  subaccountLimiter(50, 60000), // 50 aggregations per minute per subaccount
  DatabaseController.aggregate
);

// POST /api/database/:subaccountId/collections/:collection/count - Count documents
router.post('/:subaccountId/collections/:collection/count',
  validateSubaccountId,
  validateCollectionName,
  validateSubaccountAccess('read'),
  validateQueryBody,
  subaccountLimiter(100, 60000), // 100 counts per minute per subaccount
  DatabaseController.count
);

// POST /api/database/:subaccountId/collections/:collection/distinct - Get distinct values
router.post('/:subaccountId/collections/:collection/distinct',
  validateSubaccountId,
  validateCollectionName,
  validateSubaccountAccess('read'),
  validateQueryBody,
  subaccountLimiter(100, 60000), // 100 distinct queries per minute per subaccount
  DatabaseController.distinct
);

module.exports = router; 