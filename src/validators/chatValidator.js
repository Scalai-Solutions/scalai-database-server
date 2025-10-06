const Joi = require('joi');

// Validation schemas
const createChatBodySchema = Joi.object({
  agentId: Joi.string()
    .required()
    .messages({
      'any.required': 'Agent ID is required',
      'string.empty': 'Agent ID cannot be empty'
    })
});

const sendMessageBodySchema = Joi.object({
  content: Joi.string()
    .required()
    .min(1)
    .messages({
      'any.required': 'Message content is required',
      'string.empty': 'Message content cannot be empty',
      'string.min': 'Message content must be at least 1 character long'
    })
});

const chatIdParamSchema = Joi.string()
  .required()
  .messages({
    'any.required': 'Chat ID is required',
    'string.empty': 'Chat ID cannot be empty'
  });

// Middleware validators
const validateCreateChatBody = (req, res, next) => {
  const { error } = createChatBodySchema.validate(req.body, { 
    abortEarly: false,
    stripUnknown: true 
  });

  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));

    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors
    });
  }

  next();
};

const validateSendMessageBody = (req, res, next) => {
  const { error } = sendMessageBodySchema.validate(req.body, { 
    abortEarly: false,
    stripUnknown: true 
  });

  if (error) {
    const errors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));

    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors
    });
  }

  next();
};

const validateChatId = (req, res, next) => {
  const { error } = chatIdParamSchema.validate(req.params.chatId);

  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid chatId',
      code: 'INVALID_PARAMETER',
      details: error.details[0].message
    });
  }

  next();
};

module.exports = {
  validateCreateChatBody,
  validateSendMessageBody,
  validateChatId
}; 