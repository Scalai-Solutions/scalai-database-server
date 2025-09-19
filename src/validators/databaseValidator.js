const Joi = require('joi');
const mongoose = require('mongoose');

// Validation schemas
const subaccountIdSchema = Joi.string()
  .pattern(/^[0-9a-fA-F]{24}$/)
  .required()
  .messages({
    'string.pattern.base': 'Invalid subaccount ID format',
    'any.required': 'Subaccount ID is required'
  });

const collectionNameSchema = Joi.string()
  .min(1)
  .max(100)
  .pattern(/^[a-zA-Z][a-zA-Z0-9_]*$/)
  .required()
  .messages({
    'string.pattern.base': 'Collection name must start with a letter and contain only letters, numbers, and underscores',
    'any.required': 'Collection name is required'
  });

const queryBodySchema = Joi.object({
  query: Joi.object().optional().default({}),
  options: Joi.object({
    limit: Joi.number().integer().min(1).max(1000).optional(),
    skip: Joi.number().integer().min(0).optional(),
    sort: Joi.object().optional(),
    projection: Joi.object().optional()
  }).optional().default({})
});

const insertBodySchema = Joi.object({
  document: Joi.alternatives().try(
    Joi.object().required(),
    Joi.array().items(Joi.object()).required()
  ).required(),
  options: Joi.object().optional().default({})
});

const updateBodySchema = Joi.object({
  filter: Joi.object().required(),
  update: Joi.object().required(),
  options: Joi.object({
    upsert: Joi.boolean().optional(),
    returnDocument: Joi.string().valid('before', 'after').optional()
  }).optional().default({})
});

const deleteBodySchema = Joi.object({
  filter: Joi.object().required(),
  options: Joi.object().optional().default({})
});

const aggregateBodySchema = Joi.object({
  pipeline: Joi.array().items(Joi.object()).required(),
  options: Joi.object({
    maxTimeMS: Joi.number().integer().min(1000).max(30000).optional(),
    allowDiskUse: Joi.boolean().optional()
  }).optional().default({})
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

// Database operation validation
const validateDatabaseOperation = (req, res, next) => {
  const operation = req.body.operation;
  const allowedOperations = [
    'find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete',
    'insertOne', 'insertMany', 'updateOne', 'updateMany',
    'deleteOne', 'deleteMany', 'aggregate', 'count', 'distinct'
  ];
  
  if (!operation || !allowedOperations.includes(operation)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid or missing database operation',
      code: 'INVALID_OPERATION',
      allowedOperations
    });
  }
  
  next();
};

module.exports = {
  validateDatabaseOperation,
  validateSubaccountId: validateParam('subaccountId', subaccountIdSchema),
  validateCollectionName: validateParam('collection', collectionNameSchema),
  validateQueryBody: validate(queryBodySchema),
  validateInsertBody: validate(insertBodySchema),
  validateUpdateBody: validate(updateBodySchema),
  validateDeleteBody: validate(deleteBodySchema),
  validateAggregateBody: validate(aggregateBodySchema)
}; 