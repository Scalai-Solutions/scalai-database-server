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

module.exports = {
  validateCreateWebCallBody
}; 