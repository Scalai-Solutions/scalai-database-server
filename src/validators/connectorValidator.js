const Joi = require('joi');

// Validation schemas
const subaccountIdSchema = Joi.string()
  .pattern(/^[0-9a-fA-F]{24}$/)
  .required()
  .messages({
    'string.pattern.base': 'Invalid subaccount ID format',
    'any.required': 'Subaccount ID is required'
  });

const connectorIdSchema = Joi.string()
  .pattern(/^[0-9a-fA-F]{24}$/)
  .required()
  .messages({
    'string.pattern.base': 'Invalid connector ID format',
    'any.required': 'Connector ID is required'
  });

const addConnectorBodySchema = Joi.object({
  connectorId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .required()
    .messages({
      'string.pattern.base': 'Invalid connector ID format',
      'any.required': 'Connector ID is required'
    }),
  config: Joi.object()
    .optional()
    .default({})
    .messages({
      'object.base': 'Config must be an object'
    }),
  isActive: Joi.boolean()
    .optional()
    .default(true)
    .messages({
      'boolean.base': 'isActive must be a boolean'
    })
});

const updateConnectorConfigBodySchema = Joi.object({
  config: Joi.object()
    .required()
    .messages({
      'object.base': 'Config must be an object',
      'any.required': 'Config is required'
    }),
  isActive: Joi.boolean()
    .optional()
    .messages({
      'boolean.base': 'isActive must be a boolean'
    })
});

// Validation middleware factory
const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        code: 'VALIDATION_ERROR',
        errors
      });
    }
    
    next();
  };
};

// Parameter validation middleware
const validateParam = (paramName, schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.params[paramName]);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: `Invalid ${paramName}`,
        code: 'INVALID_PARAMETER',
        details: error.details[0].message
      });
    }
    
    next();
  };
};

module.exports = {
  validateSubaccountId: validateParam('subaccountId', subaccountIdSchema),
  validateConnectorId: validateParam('connectorId', connectorIdSchema),
  validateAddConnectorBody: validate(addConnectorBodySchema),
  validateUpdateConnectorConfigBody: validate(updateConnectorConfigBodySchema)
};

