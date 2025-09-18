const express = require('express');
const router = express.Router();

// Import controllers
const {
  getUserSubaccounts,
  executeLLMQuery,
  analyzeSchema,
  generateQuery
} = require('../controllers/llmController');

// Import middleware
const { authenticateToken } = require('../middleware/authMiddleware');

// Import validators
const { validateLLMRequest } = require('../validators/requestValidator');

// LLM routes with tenant integration
router.get('/subaccounts', authenticateToken, getUserSubaccounts);
router.post('/query', authenticateToken, validateLLMRequest, executeLLMQuery);
router.get('/analyze/:subaccountId', authenticateToken, analyzeSchema);
router.post('/generate-query', authenticateToken, generateQuery);

module.exports = router;
