const Joi = require('joi');

// Example validation schema for future LLM requests
const llmRequestSchema = Joi.object({
  prompt: Joi.string()
    .min(1)
    .max(5000)
    .required()
    .messages({
      'string.min': 'Prompt cannot be empty',
      'string.max': 'Prompt cannot exceed 5000 characters',
      'any.required': 'Prompt is required'
    }),
  
  model: Joi.string()
    .valid('gpt-3.5-turbo', 'gpt-4', 'claude-3-sonnet', 'claude-3-haiku')
    .optional()
    .messages({
      'any.only': 'Invalid model specified'
    }),
  
  maxTokens: Joi.number()
    .integer()
    .min(1)
    .max(4000)
    .optional()
    .messages({
      'number.base': 'Max tokens must be a number',
      'number.integer': 'Max tokens must be an integer',
      'number.min': 'Max tokens must be at least 1',
      'number.max': 'Max tokens cannot exceed 4000'
    }),
  
  temperature: Joi.number()
    .min(0)
    .max(2)
    .optional()
    .messages({
      'number.base': 'Temperature must be a number',
      'number.min': 'Temperature must be at least 0',
      'number.max': 'Temperature cannot exceed 2'
    })
});

// Validation middleware
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
        errors
      });
    }
    
    next();
  };
};

module.exports = {
  validateLLMRequest: validate(llmRequestSchema)
}; 