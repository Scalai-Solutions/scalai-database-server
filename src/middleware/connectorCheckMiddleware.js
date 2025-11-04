const connectionPoolManager = require('../services/connectionPoolManager');
const Logger = require('../utils/logger');

/**
 * Middleware to check if a specific connector type is connected to a subaccount
 * @param {string} connectorType - The connector type to check (e.g., 'whatsapp')
 * @returns {Function} Express middleware function
 */
const requireConnector = (connectorType) => {
  return async (req, res, next) => {
    try {
      const { subaccountId } = req.params;
      const userId = req.user?.id;

      if (!subaccountId) {
        return res.status(400).json({
          success: false,
          message: 'Subaccount ID is required',
          code: 'MISSING_SUBACCOUNT_ID'
        });
      }

      Logger.debug('Checking connector connection', {
        subaccountId,
        connectorType,
        userId,
        endpoint: req.originalUrl
      });

      // Get database connection for the subaccount
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Check if connector exists in connectorsubaccount collection
      const connector = await connection.db.collection('connectorsubaccount').findOne({
        subaccountId,
        connectorType,
        isActive: true
      });

      if (!connector) {
        Logger.warn('Connector not found or not active', {
          subaccountId,
          connectorType,
          userId,
          endpoint: req.originalUrl
        });

        return res.status(403).json({
          success: false,
          message: `${connectorType} connector is not connected to this subaccount`,
          code: 'CONNECTOR_NOT_CONNECTED',
          details: {
            subaccountId,
            connectorType,
            requiredConnector: connectorType
          }
        });
      }

      Logger.debug('Connector check passed', {
        subaccountId,
        connectorType,
        connectorId: connector._id,
        userId
      });

      // Attach connector info to request for potential use in controllers
      req.connector = connector;
      next();
    } catch (error) {
      Logger.error('Connector check middleware error', {
        error: error.message,
        stack: error.stack,
        subaccountId: req.params?.subaccountId,
        connectorType,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        message: 'Failed to verify connector connection',
        code: 'CONNECTOR_CHECK_ERROR'
      });
    }
  };
};

module.exports = {
  requireConnector
};

