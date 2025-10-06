const { body, query } = require('express-validator');
const { validationResult } = require('express-validator');

/**
 * Validation error handler middleware
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors: errors.array().map(err => ({
        field: err.param,
        message: err.msg
      }))
    });
  }
  next();
};

/**
 * Validate get activities query parameters
 */
const validateGetActivitiesQuery = [
  query('hours')
    .optional()
    .isInt({ min: 1, max: 720 }) // Max 30 days
    .withMessage('hours must be an integer between 1 and 720'),
  
  query('category')
    .optional()
    .isIn(['agent', 'chat_agent', 'call', 'chat', 'connector'])
    .withMessage('category must be one of: agent, chat_agent, call, chat, connector'),
  
  query('activityType')
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage('activityType must be a non-empty string'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('limit must be an integer between 1 and 500'),
  
  query('skip')
    .optional()
    .isInt({ min: 0 })
    .withMessage('skip must be a non-negative integer'),
  
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('startDate must be a valid ISO 8601 date'),
  
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('endDate must be a valid ISO 8601 date'),
  
  handleValidationErrors
];

/**
 * Validate get activity stats query parameters
 */
const validateGetActivityStatsQuery = [
  query('hours')
    .optional()
    .isInt({ min: 1, max: 720 })
    .withMessage('hours must be an integer between 1 and 720'),
  
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('startDate must be a valid ISO 8601 date'),
  
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('endDate must be a valid ISO 8601 date'),
  
  handleValidationErrors
];

module.exports = {
  validateGetActivitiesQuery,
  validateGetActivityStatsQuery
};
