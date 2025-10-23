const Logger = require('../utils/logger');
const mockStorageService = require('../services/mockStorageService');
const { v4: uuidv4 } = require('uuid');

class MockSessionController {
  /**
   * End a mock session and clear all its data
   * DELETE /api/mock-sessions/:sessionId
   */
  static async endMockSession(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { sessionId } = req.params;
      const userId = req.user?.id;

      Logger.info('Ending mock session', {
        operationId,
        sessionId,
        userId
      });

      // Clear all data for this session
      const result = await mockStorageService.clearSession(sessionId);

      const duration = Date.now() - startTime;

      Logger.info('Mock session ended successfully', {
        operationId,
        sessionId,
        keysDeleted: result.keysDeleted,
        duration: `${duration}ms`
      });

      return res.json({
        success: true,
        message: 'Mock session ended and data cleared',
        data: {
          sessionId,
          keysDeleted: result.keysDeleted
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });
    } catch (error) {
      Logger.error('Failed to end mock session', {
        operationId,
        sessionId: req.params.sessionId,
        error: error.message,
        stack: error.stack
      });

      const duration = Date.now() - startTime;

      return res.status(500).json({
        success: false,
        message: 'Failed to end mock session',
        error: error.message,
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });
    }
  }

  /**
   * Get mock session info
   * GET /api/mock-sessions/:sessionId/info
   */
  static async getMockSessionInfo(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { sessionId } = req.params;

      Logger.info('Getting mock session info', {
        operationId,
        sessionId
      });

      const info = await mockStorageService.getSessionInfo(sessionId);

      const duration = Date.now() - startTime;

      return res.json({
        success: true,
        message: 'Mock session info retrieved',
        data: info,
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });
    } catch (error) {
      Logger.error('Failed to get mock session info', {
        operationId,
        sessionId: req.params.sessionId,
        error: error.message
      });

      const duration = Date.now() - startTime;

      return res.status(500).json({
        success: false,
        message: 'Failed to get mock session info',
        error: error.message,
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });
    }
  }
}

module.exports = MockSessionController;

