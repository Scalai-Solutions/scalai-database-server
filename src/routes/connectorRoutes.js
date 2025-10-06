const express = require('express');
const router = express.Router();

// Import controllers
const ConnectorController = require('../controllers/connectorController');

// Import middleware
const { authenticateToken, requestLogger } = require('../middleware/authMiddleware');
const { userLimiter, subaccountLimiter } = require('../middleware/rateLimiter');
const { authenticateServiceToken } = require('../middleware/serviceAuthMiddleware');
// Note: RBAC permissions temporarily disabled for connector routes until registered in auth server
const { requireResourcePermission } = require('../middleware/rbacClient');

// Import validators
const { 
  validateSubaccountId,
  validateConnectorId,
  validateAddConnectorBody,
  validateUpdateConnectorConfigBody
} = require('../validators/connectorValidator');

// Apply request logger to all routes
router.use(requestLogger);

// Apply JWT authentication middleware for remaining routes
router.use(authenticateToken);
router.use(userLimiter);

// GET /api/connectors/available - Get list of available connectors
router.get('/available',
  ConnectorController.getAvailableConnectors
);

// POST /api/connectors/:subaccountId - Add a connector to a subaccount
router.post('/:subaccountId',
  validateSubaccountId,
  validateAddConnectorBody,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  ConnectorController.addConnectorToSubaccount
);

// GET /api/connectors/:subaccountId - Get all connectors for a subaccount
router.get('/:subaccountId',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  ConnectorController.getSubaccountConnectors
);

// GET /api/connectors/:subaccountId/:connectorId - Get a specific connector for a subaccount
router.get('/:subaccountId/:connectorId',
  validateSubaccountId,
  validateConnectorId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  ConnectorController.getSubaccountConnector
);

// PUT /api/connectors/:subaccountId/:connectorId - Update connector configuration
router.put('/:subaccountId/:connectorId',
  validateSubaccountId,
  validateConnectorId,
  validateUpdateConnectorConfigBody,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  ConnectorController.updateConnectorConfig
);

// DELETE /api/connectors/:subaccountId/:connectorId - Delete a connector from a subaccount
router.delete('/:subaccountId/:connectorId',
  validateSubaccountId,
  validateConnectorId,
  requireResourcePermission(),
  subaccountLimiter(50, 60000),
  ConnectorController.deleteConnectorFromSubaccount
);

// POST /api/connectors/:subaccountId/handlegooglecalendar - Proxy Google Calendar connection to webhook server
router.post('/:subaccountId/handlegooglecalendar',
  validateSubaccountId,
  ConnectorController.handleGoogleCalendarConnect
);

// POST /api/connectors/:subaccountId/metadata/update - Update connector metadata (service-to-service)
router.post('/:subaccountId/metadata/update',
  validateSubaccountId,
  authenticateServiceToken,
  ConnectorController.updateConnectorMetadata
);

module.exports = router;

