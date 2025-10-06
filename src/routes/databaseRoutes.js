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
  validateCreateAgentBody,
  validateAgentId,
  validateUpdateAgentDetailsBody,
  validateActivateChatAgentBody
} = require('../validators/databaseValidator');

// Apply common middleware
router.use(requestLogger);
router.use(authenticateToken);
router.use(userLimiter);

// POST /api/database/:subaccountId/agents - Create agent
router.post('/:subaccountId/agents',
  validateSubaccountId,
  validateCreateAgentBody,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.createAgent
);

// GET /api/database/:subaccountId/agents - Get all agents with statistics
router.get('/:subaccountId/agents',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(200, 60000),
  DatabaseController.getAgents
);

// GET /api/database/:subaccountId/agents/:agentId - Get agent details with statistics
router.get('/:subaccountId/agents/:agentId',
  validateSubaccountId,
  validateAgentId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.getAgentDetails
);

// DELETE /api/database/:subaccountId/agents/:agentId - Delete agent
router.delete('/:subaccountId/agents/:agentId',
  validateSubaccountId,
  validateAgentId,
  requireResourcePermission(),
  subaccountLimiter(50, 60000),
  DatabaseController.deleteAgent
);

// PATCH /api/database/:subaccountId/agents/:agentId/details - Update agent details (begin message, prompt, voice, etc.)
router.patch('/:subaccountId/agents/:agentId/details',
  validateSubaccountId,
  validateAgentId,
  validateUpdateAgentDetailsBody,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.updateAgentDetails
);

// GET /api/database/:subaccountId/agents/:agentId/details - Get agent configuration details
router.get('/:subaccountId/agents/:agentId/details',
  validateSubaccountId,
  validateAgentId,
  requireResourcePermission(),
  subaccountLimiter(200, 60000),
  DatabaseController.getAgentDetailsConfig
);

// ========== CHAT AGENTS ROUTES ==========

// POST /api/database/:subaccountId/chat-agents - Create chat agent
router.post('/:subaccountId/chat-agents',
  validateSubaccountId,
  validateCreateAgentBody,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.createChatAgent
);

// GET /api/database/:subaccountId/chat-agents - Get all chat agents with statistics
router.get('/:subaccountId/chat-agents',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(200, 60000),
  DatabaseController.getChatAgents
);

// PATCH /api/database/:subaccountId/chat-agents/:agentId/activate - Activate/deactivate chat agent (admin/super_admin only)
router.patch('/:subaccountId/chat-agents/:agentId/activate',
  validateSubaccountId,
  validateAgentId,
  validateActivateChatAgentBody,
  requireResourcePermission(),
  subaccountLimiter(50, 60000),
  DatabaseController.activateChatAgent
);

// GET /api/database/:subaccountId/chat-agents/:agentId - Get chat agent details with statistics
router.get('/:subaccountId/chat-agents/:agentId',
  validateSubaccountId,
  validateAgentId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.getChatAgentDetails
);

// PATCH /api/database/:subaccountId/chat-agents/:agentId/details - Update chat agent details (begin message, prompt, voice, etc.)
router.patch('/:subaccountId/chat-agents/:agentId/details',
  validateSubaccountId,
  validateAgentId,
  validateUpdateAgentDetailsBody,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.updateChatAgentDetails
);

// GET /api/database/:subaccountId/chat-agents/:agentId/details - Get chat agent configuration details
router.get('/:subaccountId/chat-agents/:agentId/details',
  validateSubaccountId,
  validateAgentId,
  requireResourcePermission(),
  subaccountLimiter(200, 60000),
  DatabaseController.getChatAgentDetailsConfig
);

module.exports = router; 