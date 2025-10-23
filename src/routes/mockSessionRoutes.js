const express = require('express');
const router = express.Router();
const MockSessionController = require('../controllers/mockSessionController');
const { authenticateToken } = require('../middleware/authMiddleware');

// DELETE /api/mock-sessions/:sessionId - End mock session and clear data
router.delete('/:sessionId',
  authenticateToken,
  MockSessionController.endMockSession
);

// GET /api/mock-sessions/:sessionId/info - Get mock session info
router.get('/:sessionId/info',
  authenticateToken,
  MockSessionController.getMockSessionInfo
);

module.exports = router;

