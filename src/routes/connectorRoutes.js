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

const {
  validatePhoneNumber,
  validateUpdatePhoneNumber
} = require('../validators/phoneNumberValidator');

// Apply request logger to all routes
router.use(requestLogger);

// =============================================================================
// SERVICE-TO-SERVICE ROUTES (No JWT auth, use service token auth only)
// These routes MUST be defined BEFORE the authenticateToken middleware
// =============================================================================

// DELETE /api/connectors/:subaccountId/twilio-trunk - Delete Twilio trunk (service-to-service)
router.delete('/:subaccountId/twilio-trunk',
  validateSubaccountId,
  authenticateServiceToken,
  ConnectorController.deleteTwilioTrunk
);

// POST /api/connectors/:subaccountId/twilio/release-phone-numbers - Release phone numbers from Twilio (service-to-service)
router.post('/:subaccountId/twilio/release-phone-numbers',
  validateSubaccountId,
  authenticateServiceToken,
  ConnectorController.releasePhoneNumbersFromTwilio
);

// =============================================================================
// USER ROUTES (Require JWT authentication)
// =============================================================================

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

// Phone Number Management Routes (must come BEFORE generic /:subaccountId/:connectorId routes)
// GET /api/connectors/:subaccountId/phone-numbers - Get all phone numbers
router.get('/:subaccountId/phone-numbers',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  ConnectorController.getAllPhoneNumbers
);

// PUT /api/connectors/:subaccountId/phone-numbers/:phoneNumber - Update phone number agent assignment
router.put('/:subaccountId/phone-numbers/:phoneNumber',
  validateSubaccountId,
  validateUpdatePhoneNumber,
  requireResourcePermission(),
  subaccountLimiter(50, 60000),
  ConnectorController.updatePhoneNumber
);

// DELETE /api/connectors/:subaccountId/phone-numbers/:phoneNumber - Delete phone number from all systems
router.delete('/:subaccountId/phone-numbers/:phoneNumber',
  validateSubaccountId,
  validatePhoneNumber,
  requireResourcePermission(),
  subaccountLimiter(20, 60000),
  ConnectorController.deletePhoneNumber
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

// Twilio Routes
// GET /api/connectors/:subaccountId/twilio/getEmergencyAddress - Get all address resources
router.get('/:subaccountId/twilio/getEmergencyAddress',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  ConnectorController.getEmergencyAddress
);

// POST /api/connectors/:subaccountId/twilio/setEmergencyAddress - Set an address as emergency address
router.post('/:subaccountId/twilio/setEmergencyAddress',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(50, 60000),
  ConnectorController.setEmergencyAddress
);

// POST /api/connectors/:subaccountId/twilio/createEmergencyAddress - Create emergency address
router.post('/:subaccountId/twilio/createEmergencyAddress',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(50, 60000),
  ConnectorController.createEmergencyAddress
);

// POST /api/connectors/:subaccountId/twilio/setup/:emergencyAddressId - Setup Twilio for Retell AI
router.post('/:subaccountId/twilio/setup/:emergencyAddressId',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(10, 60000),
  ConnectorController.setupTwilioForRetell
);

// POST /api/connectors/:subaccountId/twilio/fix-retell-credentials - Fix Retell SIP credentials
router.post('/:subaccountId/twilio/fix-retell-credentials',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(10, 60000),
  ConnectorController.fixRetellNumberCredentials
);

// GET /api/connectors/:subaccountId/twilio/phoneNumbers - Get purchased phone numbers
router.get('/:subaccountId/twilio/phoneNumbers',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  ConnectorController.getTwilioPhoneNumbers
);

// GET /api/connectors/:subaccountId/twilio/availablePhoneNumbers - Search available phone numbers
router.get('/:subaccountId/twilio/availablePhoneNumbers',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(50, 60000),
  ConnectorController.searchAvailablePhoneNumbers
);

// PUT /api/connectors/:subaccountId/twilio/emergencyAddress - Update Twilio emergency address ID
router.put('/:subaccountId/twilio/emergencyAddress',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(10, 60000),
  ConnectorController.updateTwilioEmergencyAddress
);

// PUT /api/connectors/:subaccountId/twilio/bundle - Update Twilio bundle SID
router.put('/:subaccountId/twilio/bundle',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(10, 60000),
  ConnectorController.updateTwilioBundle
);

// POST /api/connectors/:subaccountId/twilio/phoneNumbers/purchase - Purchase a phone number
router.post('/:subaccountId/twilio/phoneNumbers/purchase',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(20, 60000),
  ConnectorController.purchaseTwilioPhoneNumber
);

// POST /api/connectors/:subaccountId/twilio/phoneNumbers/import - Import an existing phone number
router.post('/:subaccountId/twilio/phoneNumbers/import',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(20, 60000),
  ConnectorController.importExistingPhoneNumber
);

// GET /api/connectors/:subaccountId/twilio - Get Twilio account info
router.get('/:subaccountId/twilio',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  ConnectorController.getTwilioClient
);

// POST /api/connectors/:subaccountId/twilio/verify - Verify Twilio credentials
router.post('/:subaccountId/twilio/verify',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(50, 60000),
  ConnectorController.verifyTwilioCredentials
);

// DELETE /api/connectors/:subaccountId/twilio/cache - Invalidate Twilio cache
router.delete('/:subaccountId/twilio/cache',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(50, 60000),
  ConnectorController.invalidateTwilioCache
);

module.exports = router;

