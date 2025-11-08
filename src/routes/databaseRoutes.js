const express = require('express');
const router = express.Router();

// Import controllers
const DatabaseController = require('../controllers/databaseController');

// Import middleware
const { authenticateToken, requestLogger } = require('../middleware/authMiddleware');
const { authenticateTokenOrService } = require('../middleware/serviceAuthMiddleware');
const { userLimiter, subaccountLimiter } = require('../middleware/rateLimiter');
const { requireResourcePermission } = require('../middleware/rbacClient');

// Import validators
const { 
  validateSubaccountId,
  validateCreateAgentBody,
  validateAgentId,
  validateUpdateAgentDetailsBody,
  validateActivateChatAgentBody,
  validateUpdateAgentVoiceBody,
  validateUpdateAgentLLMBody
} = require('../validators/databaseValidator');

// Apply common middleware to request logging only (auth is per-route)
router.use(requestLogger);

// Routes that support service authentication (defined before global auth middleware)
// GET /api/database/:subaccountId/agents/:agentId/email-template - Get agent email template (supports service auth)
router.get('/:subaccountId/agents/:agentId/email-template',
  authenticateTokenOrService,
  validateSubaccountId,
  validateAgentId,
  userLimiter,
  subaccountLimiter(200, 60000),
  DatabaseController.getAgentEmailTemplate
);

// GET /api/database/:subaccountId/chat-agents/:agentId/email-template - Get chat agent email template (supports service auth)
router.get('/:subaccountId/chat-agents/:agentId/email-template',
  authenticateTokenOrService,
  validateSubaccountId,
  validateAgentId,
  userLimiter,
  subaccountLimiter(200, 60000),
  DatabaseController.getChatAgentEmailTemplate
);

// Apply JWT authentication and rate limiting to all other routes
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
  subaccountLimiter(2000, 60000),
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

// GET /api/database/:subaccountId/agents/:agentId/stats-with-cost - Get agent details with cost and duration statistics
router.get('/:subaccountId/agents/:agentId/analytics-stats',
  validateSubaccountId,
  validateAgentId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.getAgentDetailsWithCost
);

// GET /api/database/:subaccountId/agents/:agentId/costs-breakdown - Get detailed cost breakdown for all calls
router.get('/:subaccountId/agents/:agentId/costs-breakdown',
  validateSubaccountId,
  validateAgentId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.getAgentCallCostsBreakdown
);

// GET /api/database/:subaccountId/agents/:agentId/call-analytics - Get call analytics (success/failure, peak hours, outcome distribution)
router.get('/:subaccountId/agents/:agentId/call-analytics',
  validateSubaccountId,
  validateAgentId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.getAgentCallAnalytics
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

// PATCH /api/database/:subaccountId/agents/:agentId/email-template - Update agent email template (user auth only)
router.patch('/:subaccountId/agents/:agentId/email-template',
  validateSubaccountId,
  validateAgentId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.updateAgentEmailTemplate
);

// PATCH /api/database/:subaccountId/chat-agents/:agentId/email-template - Update chat agent email template (user auth only)
router.patch('/:subaccountId/chat-agents/:agentId/email-template',
  validateSubaccountId,
  validateAgentId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.updateChatAgentEmailTemplate
);

// ========== VOICE MANAGEMENT ROUTES ==========

// GET /api/database/:subaccountId/voices - Get list of available voices (ElevenLabs only)
router.get('/:subaccountId/voices',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.getVoices
);

// PATCH /api/database/:subaccountId/agents/:agentId/voice - Update agent voice
router.patch('/:subaccountId/agents/:agentId/voice',
  validateSubaccountId,
  validateAgentId,
  validateUpdateAgentVoiceBody,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.updateAgentVoice
);

// PATCH /api/database/:subaccountId/agents/:agentId/llm - Update agent LLM model
router.patch('/:subaccountId/agents/:agentId/llm',
  validateSubaccountId,
  validateAgentId,
  validateUpdateAgentLLMBody,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.updateAgentLLM
);

// PATCH /api/database/:subaccountId/chat-agents/:agentId/llm - Update chat agent LLM model
router.patch('/:subaccountId/chat-agents/:agentId/llm',
  validateSubaccountId,
  validateAgentId,
  validateUpdateAgentLLMBody,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.updateChatAgentLLM
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

// GET /api/database/:subaccountId/chat-agents/:agentId/chat-analytics - Get detailed chat analytics
router.get('/:subaccountId/chat-agents/:agentId/chat-analytics',
  validateSubaccountId,
  validateAgentId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.getChatAgentAnalytics
);

// GET /api/database/:subaccountId/chat-agents/:agentId/analytics-stats - Get analytics stats with period comparison
router.get('/:subaccountId/chat-agents/:agentId/analytics-stats',
  validateSubaccountId,
  validateAgentId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.getChatAnalyticsStats
);

// GET /api/database/:subaccountId/chat-agents/:agentId/costs-breakdown - Get cost breakdown
router.get('/:subaccountId/chat-agents/:agentId/costs-breakdown',
  validateSubaccountId,
  validateAgentId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  DatabaseController.getChatCostsBreakdown
);

// DELETE /api/database/:subaccountId/chat-agents/:agentId - Delete chat agent
router.delete('/:subaccountId/chat-agents/:agentId',
  validateSubaccountId,
  validateAgentId,
  requireResourcePermission(),
  subaccountLimiter(50, 60000),
  DatabaseController.deleteChatAgent
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