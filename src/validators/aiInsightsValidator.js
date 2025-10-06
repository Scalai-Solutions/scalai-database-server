const { query } = require('express-validator');
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
 * Validate get insights query parameters
 */
const validateGetInsightsQuery = [
  query('force')
    .optional()
    .isIn(['true', 'false', '1', '0'])
    .withMessage('force must be a boolean value (true/false or 1/0)'),
  
  handleValidationErrors
];

/**
 * Validate get insights history query parameters
 */
const validateGetInsightsHistoryQuery = [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('limit must be an integer between 1 and 50'),
  
  handleValidationErrors
];

module.exports = {
  validateGetInsightsQuery,
  validateGetInsightsHistoryQuery
};
