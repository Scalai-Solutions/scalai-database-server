const Joi = require('joi');

// Resource type enum
const RESOURCE_TYPES = {
  TEXT: 'text',
  URL: 'url',
  DOCUMENT: 'document'
};

// Scope type enum
const SCOPE_TYPES = {
  GLOBAL: 'global',
  LOCAL: 'local'
};

// Add resource body schema
const addResourceBodySchema = Joi.object({
  type: Joi.string()
    .valid(...Object.values(RESOURCE_TYPES))
    .required()
    .messages({
      'any.only': 'Type must be one of: text, url, document',
      'any.required': 'Type is required'
    }),
  scope: Joi.string()
    .valid(...Object.values(SCOPE_TYPES))
    .required()
    .messages({
      'any.only': 'Scope must be either global or local',
      'any.required': 'Scope is required'
    }),
  // For text resources
  text: Joi.string()
    .when('type', {
      is: RESOURCE_TYPES.TEXT,
      then: Joi.required(),
      otherwise: Joi.forbidden()
    })
    .messages({
      'any.required': 'Text content is required for text resources',
      'any.unknown': 'Text field is only allowed for text resources'
    }),
  title: Joi.string()
    .max(200)
    .optional()
    .messages({
      'string.max': 'Title must not exceed 200 characters'
    }),
  // For URL resources
  url: Joi.string()
    .uri()
    .when('type', {
      is: RESOURCE_TYPES.URL,
      then: Joi.required(),
      otherwise: Joi.forbidden()
    })
    .messages({
      'string.uri': 'Must be a valid URL',
      'any.required': 'URL is required for url resources',
      'any.unknown': 'URL field is only allowed for url resources'
    }),
  enableAutoRefresh: Joi.boolean()
    .optional()
    .default(false)
    .messages({
      'boolean.base': 'Enable auto refresh must be a boolean'
    }),
  // For document resources
  // Note: File will be handled by multer middleware, not Joi
  agentId: Joi.string()
    .when('scope', {
      is: SCOPE_TYPES.LOCAL,
      then: Joi.required(),
      otherwise: Joi.forbidden()
    })
    .messages({
      'any.required': 'Agent ID is required for local scope resources',
      'any.unknown': 'Agent ID is only allowed for local scope resources'
    })
}).messages({
  'object.unknown': 'Unknown field provided'
});

// Update resource scope schema
const updateResourceScopeBodySchema = Joi.object({
  scope: Joi.string()
    .valid(...Object.values(SCOPE_TYPES))
    .required()
    .messages({
      'any.only': 'Scope must be either global or local',
      'any.required': 'Scope is required'
    }),
  agentId: Joi.string()
    .when('scope', {
      is: SCOPE_TYPES.LOCAL,
      then: Joi.required(),
      otherwise: Joi.forbidden()
    })
    .messages({
      'any.required': 'Agent ID is required when changing to local scope',
      'any.unknown': 'Agent ID is not allowed for global scope'
    })
});

// Resource ID param schema
const resourceIdSchema = Joi.string()
  .required()
  .messages({
    'string.empty': 'Resource ID is required',
    'any.required': 'Resource ID is required'
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

// File upload validation middleware
const validateFileUpload = (req, res, next) => {
  if (req.body.type === RESOURCE_TYPES.DOCUMENT && !req.file) {
    return res.status(400).json({
      success: false,
      message: 'File is required for document resources',
      code: 'VALIDATION_ERROR'
    });
  }
  
  // Validate file size (max 50MB as per Retell docs)
  if (req.file && req.file.size > 50 * 1024 * 1024) {
    return res.status(400).json({
      success: false,
      message: 'File size must not exceed 50MB',
      code: 'FILE_TOO_LARGE'
    });
  }
  
  next();
};

module.exports = {
  RESOURCE_TYPES,
  SCOPE_TYPES,
  validateAddResourceBody: validate(addResourceBodySchema),
  validateUpdateResourceScopeBody: validate(updateResourceScopeBodySchema),
  validateResourceId: validateParam('resourceId', resourceIdSchema),
  validateFileUpload
};

