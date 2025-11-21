const express = require('express');
const router = express.Router();

// Import controllers
const ChatController = require('../controllers/chatController');

// Import middleware
const { authenticateToken, requestLogger } = require('../middleware/authMiddleware');
const { userLimiter, subaccountLimiter } = require('../middleware/rateLimiter');
const { requireResourcePermission } = require('../middleware/rbacClient');
const { attachTimezone, convertResponseDates, convertRequestDates } = require('../middleware/timezoneMiddleware');

// Import validators
const { 
  validateSubaccountId
} = require('../validators/databaseValidator');
const { 
  validateCreateChatBody,
  validateSendMessageBody,
  validateChatId
} = require('../validators/chatValidator');

// Apply common middleware
router.use(requestLogger);
router.use(authenticateToken);
router.use(userLimiter);

// Apply timezone middleware
router.use(attachTimezone);
router.use(convertRequestDates);
router.use(convertResponseDates);

// POST /api/chats/:subaccountId/create - Create a new chat
router.post('/:subaccountId/create',
  validateSubaccountId,
  validateCreateChatBody,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  ChatController.createChat
);

// POST /api/chats/:subaccountId/:chatId/message - Send a message in a chat
router.post('/:subaccountId/:chatId/message',
  validateSubaccountId,
  validateChatId,
  validateSendMessageBody,
  requireResourcePermission(),
  subaccountLimiter(200, 60000),
  ChatController.sendMessage
);

// POST /api/chats/:subaccountId/:chatId/end - End a chat
router.post('/:subaccountId/:chatId/end',
  validateSubaccountId,
  validateChatId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  ChatController.endChat
);

// GET /api/chats/:subaccountId/list - List all chats (minimal data)
router.get('/:subaccountId/list',
  validateSubaccountId,
  requireResourcePermission(),
  subaccountLimiter(50, 60000),
  ChatController.listChats
);

// GET /api/chats/:subaccountId/:chatId/transcript - Get full chat transcript
router.get('/:subaccountId/:chatId/transcript',
  validateSubaccountId,
  validateChatId,
  requireResourcePermission(),
  subaccountLimiter(100, 60000),
  ChatController.getChatTranscript
);

// DELETE /api/chats/:subaccountId/:chatId - Delete a chat
router.delete('/:subaccountId/:chatId',
  validateSubaccountId,
  validateChatId,
  requireResourcePermission(),
  subaccountLimiter(50, 60000),
  ChatController.deleteChat
);

module.exports = router; 