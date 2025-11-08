const express = require('express');
const router = express.Router();
const multer = require('multer');

// Import controllers
const KnowledgeBaseController = require('../controllers/knowledgeBaseController');

// Import middleware
const { authenticateToken, requestLogger } = require('../middleware/authMiddleware');
const { userLimiter, subaccountLimiter } = require('../middleware/rateLimiter');
const { requireResourcePermission } = require('../middleware/rbacClient');

// Import validators
const { validateSubaccountId, validateAgentId } = require('../validators/databaseValidator');
const {
  validateAddResourceBody,
  validateUpdateResourceScopeBody,
  validateResourceId,
  validateFileUpload
} = require('../validators/knowledgeBaseValidator');

// Configure multer for file uploads (disk storage for creating streams)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const fs = require('fs');
    const uploadDir = 'uploads/knowledge-base';
    // Ensure upload directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit as per Retell docs
  }
});

// Apply common middleware
router.use(requestLogger);
router.use(authenticateToken);
router.use(userLimiter);

// Middleware to extract agentId from path and set scope to local
const extractAgentIdFromPath = (req, res, next) => {
  if (req.params.agentId) {
    req.body.agentId = req.params.agentId;
    req.body.scope = 'local'; // Force local scope when agentId is in path
  }
  next();
};

// POST /api/knowledge-base/:subaccountId/chat-agents/:agentId/resources - Add a resource for a chat agent
router.post('/:subaccountId/chat-agents/:agentId/resources',
  upload.single('file'), // Handle file upload
  validateSubaccountId,
  validateAgentId,
  extractAgentIdFromPath,
  validateAddResourceBody,
  validateFileUpload,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  KnowledgeBaseController.addResource
);

// POST /api/knowledge-base/:subaccountId/agents/:agentId/resources - Add a resource for a regular agent
router.post('/:subaccountId/agents/:agentId/resources',
  upload.single('file'), // Handle file upload
  validateSubaccountId,
  validateAgentId,
  extractAgentIdFromPath,
  validateAddResourceBody,
  validateFileUpload,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  KnowledgeBaseController.addResource
);

// POST /api/knowledge-base/:subaccountId/resources - Add a resource (text, URL, or file)
router.post('/:subaccountId/resources',
  upload.single('file'), // Handle file upload
  validateSubaccountId,
  validateAddResourceBody,
  validateFileUpload,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  KnowledgeBaseController.addResource
);

// GET /api/knowledge-base/:subaccountId - List all knowledge bases (global + all local)
router.get('/:subaccountId',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(200, 60000),
  KnowledgeBaseController.listKnowledgeBases
);

// GET /api/knowledge-base/:subaccountId/global - Get global knowledge base
router.get('/:subaccountId/global',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(200, 60000),
  KnowledgeBaseController.getGlobalKB
);

// GET /api/knowledge-base/:subaccountId/agents/:agentId/local - Get local knowledge base for an agent
router.get('/:subaccountId/agents/:agentId/local',
  validateSubaccountId,
  validateAgentId,
  requireResourcePermission(),
  subaccountLimiter(200, 60000),
  KnowledgeBaseController.getLocalKB
);

// GET /api/knowledge-base/:subaccountId/chat-agents/:agentId/local - Get local knowledge base for a chat agent
router.get('/:subaccountId/chat-agents/:agentId/local',
  validateSubaccountId,
  validateAgentId,
  requireResourcePermission(),
  subaccountLimiter(200, 60000),
  KnowledgeBaseController.getChatAgentLocalKB
);

// DELETE /api/knowledge-base/:subaccountId/resources/:resourceId - Delete a resource
router.delete('/:subaccountId/resources/:resourceId',
  validateSubaccountId,
  validateResourceId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  KnowledgeBaseController.deleteResource
);

// PATCH /api/knowledge-base/:subaccountId/resources/:resourceId/scope - Change resource scope (local <-> global)
router.patch('/:subaccountId/resources/:resourceId/scope',
  validateSubaccountId,
  validateResourceId,
  validateUpdateResourceScopeBody,
  requireResourcePermission(),
  subaccountLimiter(50, 60000),
  KnowledgeBaseController.updateResourceScope
);

module.exports = router;

