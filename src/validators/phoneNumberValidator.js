const Joi = require('joi');

// Validation schemas
const phoneNumberSchema = Joi.string()
  .pattern(/^\+[1-9]\d{1,14}$/)
  .required()
  .messages({
    'string.pattern.base': 'Invalid phone number format (must be in E.164 format, e.g., +14157774444)',
    'any.required': 'Phone number is required'
  });

const updatePhoneNumberBodySchema = Joi.object({
  inbound_agent_id: Joi.string()
    .optional()
    .allow(null)
    .messages({
      'string.base': 'Inbound agent ID must be a string'
    }),
  outbound_agent_id: Joi.string()
    .optional()
    .allow(null)
    .messages({
      'string.base': 'Outbound agent ID must be a string'
    }),
  nickname: Joi.string()
    .optional()
    .allow(null)
    .messages({
      'string.base': 'Nickname must be a string'
    })
}).min(1).messages({
  'object.min': 'At least one field (inbound_agent_id, outbound_agent_id, or nickname) must be provided'
});

// Validator middleware
const validatePhoneNumber = (req, res, next) => {
  const { error } = phoneNumberSchema.validate(req.params.phoneNumber);
  
  if (error) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      details: error.details.map(detail => detail.message)
    });
  }
  
  next();
};

const validateUpdatePhoneNumber = (req, res, next) => {
  // Validate phone number parameter
  const phoneNumberValidation = phoneNumberSchema.validate(req.params.phoneNumber);
  
  if (phoneNumberValidation.error) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      details: phoneNumberValidation.error.details.map(detail => detail.message)
    });
  }
  
  // Validate request body
  const bodyValidation = updatePhoneNumberBodySchema.validate(req.body);
  
  if (bodyValidation.error) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      details: bodyValidation.error.details.map(detail => detail.message)
    });
  }
  
  next();
};

module.exports = {
  validatePhoneNumber,
  validateUpdatePhoneNumber
};

