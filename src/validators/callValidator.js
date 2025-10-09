const Joi = require('joi');

// Validation schemas
const createWebCallBodySchema = Joi.object({
  agentId: Joi.string()
    .required()
    .messages({
      'any.required': 'Agent ID is required',
      'string.empty': 'Agent ID cannot be empty'
    }),
  metadata: Joi.object()
    .optional()
    .messages({
      'object.base': 'Metadata must be an object'
    })
});

const createPhoneCallBodySchema = Joi.object({
  from_number: Joi.string()
    .pattern(/^\+[1-9]\d{1,14}$/)
    .required()
    .messages({
      'any.required': 'From phone number is required',
      'string.empty': 'From phone number cannot be empty',
      'string.pattern.base': 'From phone number must be in E.164 format (e.g., +14157774444)'
    }),
  to_number: Joi.string()
    .pattern(/^\+[1-9]\d{1,14}$/)
    .required()
    .messages({
      'any.required': 'To phone number is required',
      'string.empty': 'To phone number cannot be empty',
      'string.pattern.base': 'To phone number must be in E.164 format (e.g., +14157774444)'
    }),
  agent_id: Joi.string()
    .optional()
    .messages({
      'string.base': 'Agent ID must be a string'
    }),
  metadata: Joi.object()
    .optional()
    .messages({
      'object.base': 'Metadata must be an object'
    }),
  dynamic_variables: Joi.object()
    .optional()
    .messages({
      'object.base': 'Dynamic variables must be an object'
    }),
  retell_llm_dynamic_variables: Joi.object()
    .optional()
    .messages({
      'object.base': 'Retell LLM dynamic variables must be an object'
    })
});

// Middleware validators
const validateCreateWebCallBody = (req, res, next) => {
  const { error } = createWebCallBodySchema.validate(req.body, { 
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

const validateCreatePhoneCallBody = (req, res, next) => {
  const { error } = createPhoneCallBodySchema.validate(req.body, { 
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

module.exports = {
  validateCreateWebCallBody,
  validateCreatePhoneCallBody
}; 