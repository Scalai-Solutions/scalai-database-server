const Joi = require('joi');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const redisService = require('./redisService');

class SchemaValidationService {
  constructor() {
    this.schemas = new Map(); // collection -> schema
    this.validationCache = new Map(); // cache validation results
    this.cacheTimeout = 300000; // 5 minutes
  }

  // Initialize the service
  async initialize() {
    try {
      Logger.info('Initializing Schema Validation Service');
      
      // Load schemas from cache if available
      await this.loadSchemasFromCache();
      
      Logger.info('Schema Validation Service initialized successfully');
      return true;
    } catch (error) {
      Logger.error('Failed to initialize Schema Validation Service', {
        error: error.message
      });
      throw error;
    }
  }

  // Load schemas from Redis cache
  async loadSchemasFromCache() {
    try {
      const schemaKeys = await redisService.client.keys(`${config.redis.prefixes.schema}*`);
      
      for (const key of schemaKeys) {
        const schemaData = await redisService.get(key);
        if (schemaData) {
          const collectionName = key.replace(config.redis.prefixes.schema, '');
          this.schemas.set(collectionName, schemaData);
        }
      }
      
      Logger.debug('Loaded schemas from cache', { count: this.schemas.size });
    } catch (error) {
      Logger.warn('Failed to load schemas from cache', { error: error.message });
    }
  }

  // Register schema for a collection
  async registerSchema(subaccountId, collectionName, schema, permissions = {}) {
    try {
      const schemaKey = `${subaccountId}:${collectionName}`;
      
      // Validate the schema itself
      const validatedSchema = this.validateSchemaDefinition(schema);
      
      const schemaData = {
        subaccountId,
        collectionName,
        schema: validatedSchema,
        permissions: {
          read: permissions.read !== false,
          write: permissions.write !== false,
          delete: permissions.delete === true
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      // Store in memory
      this.schemas.set(schemaKey, schemaData);
      
      // Cache in Redis
      const cacheKey = `${config.redis.prefixes.schema}${schemaKey}`;
      await redisService.set(cacheKey, schemaData, 3600); // 1 hour cache
      
      Logger.info('Schema registered successfully', {
        subaccountId,
        collectionName,
        hasSchema: !!schema
      });
      
      return true;
    } catch (error) {
      Logger.error('Failed to register schema', {
        subaccountId,
        collectionName,
        error: error.message
      });
      throw error;
    }
  }

  // Get schema for a collection
  async getSchema(subaccountId, collectionName) {
    try {
      const schemaKey = `${subaccountId}:${collectionName}`;
      
      // Check memory cache first
      let schemaData = this.schemas.get(schemaKey);
      
      if (!schemaData) {
        // Check Redis cache
        const cacheKey = `${config.redis.prefixes.schema}${schemaKey}`;
        schemaData = await redisService.get(cacheKey);
        
        if (schemaData) {
          // Store in memory cache
          this.schemas.set(schemaKey, schemaData);
        }
      }
      
      return schemaData;
    } catch (error) {
      Logger.error('Failed to get schema', {
        subaccountId,
        collectionName,
        error: error.message
      });
      return null;
    }
  }

  // Validate document against schema
  async validateDocument(subaccountId, collectionName, document, operation = 'insert') {
    try {
      // Check if schema validation is enabled
      if (!config.security.enableSchemaValidation) {
        return { valid: true, document };
      }

      const schemaData = await this.getSchema(subaccountId, collectionName);
      
      // If no schema is defined, allow the operation (schema-less mode)
      if (!schemaData || !schemaData.schema) {
        Logger.debug('No schema defined for collection, allowing operation', {
          subaccountId,
          collectionName,
          operation
        });
        return { valid: true, document };
      }

      // Check operation permissions
      if (!this.hasOperationPermission(schemaData.permissions, operation)) {
        return {
          valid: false,
          error: `Operation '${operation}' not allowed on collection '${collectionName}'`,
          code: 'OPERATION_NOT_ALLOWED'
        };
      }

      // Validate document structure
      const validationResult = this.validateDocumentStructure(
        document,
        schemaData.schema,
        operation
      );

      if (!validationResult.valid) {
        Logger.warn('Document validation failed', {
          subaccountId,
          collectionName,
          operation,
          errors: validationResult.errors
        });
        return validationResult;
      }

      // Apply schema transformations (sanitization, defaults, etc.)
      const transformedDocument = this.applySchemaTransformations(
        validationResult.document,
        schemaData.schema,
        operation
      );

      Logger.debug('Document validation successful', {
        subaccountId,
        collectionName,
        operation
      });

      return {
        valid: true,
        document: transformedDocument
      };

    } catch (error) {
      Logger.error('Document validation failed', {
        subaccountId,
        collectionName,
        operation,
        error: error.message
      });

      return {
        valid: false,
        error: 'Validation error: ' + error.message,
        code: 'VALIDATION_ERROR'
      };
    }
  }

  // Validate multiple documents (for batch operations)
  async validateDocuments(subaccountId, collectionName, documents, operation = 'insert') {
    try {
      const results = [];
      const validDocuments = [];
      let allValid = true;

      for (let i = 0; i < documents.length; i++) {
        const result = await this.validateDocument(
          subaccountId,
          collectionName,
          documents[i],
          operation
        );

        results.push({
          index: i,
          valid: result.valid,
          error: result.error,
          code: result.code
        });

        if (result.valid) {
          validDocuments.push(result.document);
        } else {
          allValid = false;
        }
      }

      return {
        valid: allValid,
        documents: validDocuments,
        results
      };

    } catch (error) {
      Logger.error('Batch document validation failed', {
        subaccountId,
        collectionName,
        operation,
        documentCount: documents.length,
        error: error.message
      });

      return {
        valid: false,
        error: 'Batch validation error: ' + error.message,
        code: 'BATCH_VALIDATION_ERROR'
      };
    }
  }

  // Validate query against schema
  async validateQuery(subaccountId, collectionName, query, operation = 'find') {
    try {
      // Check if schema validation is enabled
      if (!config.security.enableSchemaValidation) {
        return { valid: true, query };
      }

      const schemaData = await this.getSchema(subaccountId, collectionName);
      
      // If no schema is defined, apply basic query sanitization
      if (!schemaData || !schemaData.schema) {
        const sanitizedQuery = this.sanitizeQuery(query);
        return { valid: true, query: sanitizedQuery };
      }

      // Check operation permissions
      if (!this.hasOperationPermission(schemaData.permissions, operation)) {
        return {
          valid: false,
          error: `Operation '${operation}' not allowed on collection '${collectionName}'`,
          code: 'OPERATION_NOT_ALLOWED'
        };
      }

      // Validate query fields against schema
      const validationResult = this.validateQueryFields(query, schemaData.schema);
      
      if (!validationResult.valid) {
        return validationResult;
      }

      // Sanitize and optimize query
      const sanitizedQuery = this.sanitizeQuery(validationResult.query);

      return {
        valid: true,
        query: sanitizedQuery
      };

    } catch (error) {
      Logger.error('Query validation failed', {
        subaccountId,
        collectionName,
        operation,
        error: error.message
      });

      return {
        valid: false,
        error: 'Query validation error: ' + error.message,
        code: 'QUERY_VALIDATION_ERROR'
      };
    }
  }

  // Validate schema definition itself
  validateSchemaDefinition(schema) {
    try {
      if (!schema || typeof schema !== 'object') {
        throw new Error('Schema must be a valid object');
      }

      // Convert to Joi schema if it's a plain object
      if (!schema.isJoi) {
        return this.convertToJoiSchema(schema);
      }

      return schema;
    } catch (error) {
      Logger.error('Invalid schema definition', { error: error.message });
      throw new Error('Invalid schema definition: ' + error.message);
    }
  }

  // Convert plain object schema to Joi schema
  convertToJoiSchema(plainSchema) {
    const convertField = (field) => {
      if (typeof field === 'string') {
        // Simple type definition
        switch (field.toLowerCase()) {
          case 'string':
            return Joi.string();
          case 'number':
            return Joi.number();
          case 'boolean':
            return Joi.boolean();
          case 'date':
            return Joi.date();
          case 'array':
            return Joi.array();
          case 'object':
            return Joi.object();
          default:
            return Joi.any();
        }
      }

      if (typeof field === 'object' && field !== null) {
        if (field.type) {
          let joiField = convertField(field.type);

          // Apply constraints
          if (field.required) joiField = joiField.required();
          if (field.min !== undefined) joiField = joiField.min(field.min);
          if (field.max !== undefined) joiField = joiField.max(field.max);
          if (field.pattern) joiField = joiField.pattern(new RegExp(field.pattern));
          if (field.valid) joiField = joiField.valid(...field.valid);
          if (field.default !== undefined) joiField = joiField.default(field.default);

          return joiField;
        }

        // Nested object
        const nestedSchema = {};
        for (const [key, value] of Object.entries(field)) {
          nestedSchema[key] = convertField(value);
        }
        return Joi.object(nestedSchema);
      }

      return Joi.any();
    };

    const joiSchema = {};
    for (const [key, value] of Object.entries(plainSchema)) {
      joiSchema[key] = convertField(value);
    }

    return Joi.object(joiSchema);
  }

  // Validate document structure against Joi schema
  validateDocumentStructure(document, schema, operation) {
    try {
      let validationOptions = {
        abortEarly: false,
        stripUnknown: true,
        allowUnknown: false
      };

      // For updates, allow partial validation
      if (operation === 'update' || operation === 'updateOne' || operation === 'updateMany') {
        validationOptions.allowUnknown = true;
        
        // Extract the update operators
        if (document.$set || document.$unset || document.$inc) {
          // Validate only the fields being updated
          const fieldsToValidate = document.$set || {};
          const { error, value } = schema.validate(fieldsToValidate, validationOptions);
          
          if (error) {
            return {
              valid: false,
              errors: error.details.map(detail => ({
                field: detail.path.join('.'),
                message: detail.message
              })),
              code: 'SCHEMA_VALIDATION_ERROR'
            };
          }
          
          return { valid: true, document: { ...document, $set: value } };
        }
      }

      const { error, value } = schema.validate(document, validationOptions);

      if (error) {
        return {
          valid: false,
          errors: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message
          })),
          code: 'SCHEMA_VALIDATION_ERROR'
        };
      }

      return { valid: true, document: value };

    } catch (error) {
      return {
        valid: false,
        error: 'Schema validation error: ' + error.message,
        code: 'SCHEMA_VALIDATION_ERROR'
      };
    }
  }

  // Validate query fields against schema
  validateQueryFields(query, schema) {
    try {
      // For now, implement basic field validation
      // In a full implementation, you would validate query operators and field types
      
      const sanitizedQuery = this.sanitizeQuery(query);
      
      return { valid: true, query: sanitizedQuery };
    } catch (error) {
      return {
        valid: false,
        error: 'Query field validation error: ' + error.message,
        code: 'QUERY_FIELD_ERROR'
      };
    }
  }

  // Apply schema transformations (defaults, sanitization, etc.)
  applySchemaTransformations(document, schema, operation) {
    try {
      // Add timestamps for insert operations
      if (operation === 'insert' || operation === 'insertOne' || operation === 'insertMany') {
        if (!document.createdAt) {
          document.createdAt = new Date();
        }
        if (!document.updatedAt) {
          document.updatedAt = new Date();
        }
      }

      // Update timestamp for update operations
      if (operation === 'update' || operation === 'updateOne' || operation === 'updateMany') {
        if (document.$set) {
          document.$set.updatedAt = new Date();
        } else {
          document.updatedAt = new Date();
        }
      }

      return document;
    } catch (error) {
      Logger.error('Schema transformation failed', { error: error.message });
      return document;
    }
  }

  // Check operation permissions
  hasOperationPermission(permissions, operation) {
    switch (operation) {
      case 'find':
      case 'findOne':
      case 'count':
      case 'distinct':
      case 'aggregate':
        return permissions.read;

      case 'insert':
      case 'insertOne':
      case 'insertMany':
      case 'update':
      case 'updateOne':
      case 'updateMany':
      case 'findOneAndUpdate':
        return permissions.write;

      case 'delete':
      case 'deleteOne':
      case 'deleteMany':
      case 'findOneAndDelete':
        return permissions.delete;

      default:
        return false;
    }
  }

  // Sanitize query to prevent NoSQL injection
  sanitizeQuery(query) {
    if (!config.security.enableQuerySanitization) {
      return query;
    }

    try {
      return this.sanitizeObject(query);
    } catch (error) {
      Logger.error('Query sanitization failed', { error: error.message });
      return query;
    }
  }

  // Recursively sanitize object
  sanitizeObject(obj) {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      // Remove potentially dangerous patterns
      return obj.replace(/[\$]/g, '');
    }

    if (typeof obj === 'object') {
      if (Array.isArray(obj)) {
        return obj.map(item => this.sanitizeObject(item));
      }

      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        // Remove dangerous operators (except allowed ones)
        const allowedOperators = [
          '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin',
          '$and', '$or', '$not', '$nor', '$exists', '$type', '$regex',
          '$set', '$unset', '$inc', '$mul', '$rename', '$min', '$max',
          '$currentDate', '$addToSet', '$pop', '$pull', '$push'
        ];

        if (key.startsWith('$') && !allowedOperators.includes(key)) {
          Logger.warn('Dangerous operator removed from query', { operator: key });
          continue;
        }

        sanitized[key] = this.sanitizeObject(value);
      }
      return sanitized;
    }

    return obj;
  }

  // Remove schema
  async removeSchema(subaccountId, collectionName) {
    try {
      const schemaKey = `${subaccountId}:${collectionName}`;
      
      // Remove from memory
      this.schemas.delete(schemaKey);
      
      // Remove from Redis cache
      const cacheKey = `${config.redis.prefixes.schema}${schemaKey}`;
      await redisService.del(cacheKey);
      
      Logger.info('Schema removed successfully', {
        subaccountId,
        collectionName
      });
      
      return true;
    } catch (error) {
      Logger.error('Failed to remove schema', {
        subaccountId,
        collectionName,
        error: error.message
      });
      return false;
    }
  }

  // Get all schemas for a subaccount
  async getSubaccountSchemas(subaccountId) {
    try {
      const schemas = {};
      
      // Check memory cache
      for (const [key, schemaData] of this.schemas.entries()) {
        if (schemaData.subaccountId === subaccountId) {
          schemas[schemaData.collectionName] = {
            schema: schemaData.schema,
            permissions: schemaData.permissions,
            createdAt: schemaData.createdAt,
            updatedAt: schemaData.updatedAt
          };
        }
      }
      
      // If no schemas in memory, check Redis
      if (Object.keys(schemas).length === 0) {
        const pattern = `${config.redis.prefixes.schema}${subaccountId}:*`;
        const keys = await redisService.client.keys(pattern);
        
        for (const key of keys) {
          const schemaData = await redisService.get(key);
          if (schemaData) {
            schemas[schemaData.collectionName] = {
              schema: schemaData.schema,
              permissions: schemaData.permissions,
              createdAt: schemaData.createdAt,
              updatedAt: schemaData.updatedAt
            };
          }
        }
      }
      
      return schemas;
    } catch (error) {
      Logger.error('Failed to get subaccount schemas', {
        subaccountId,
        error: error.message
      });
      return {};
    }
  }

  // Clear all schemas (for testing)
  async clearAllSchemas() {
    try {
      this.schemas.clear();
      
      const keys = await redisService.client.keys(`${config.redis.prefixes.schema}*`);
      if (keys.length > 0) {
        await redisService.client.del(...keys);
      }
      
      Logger.info('All schemas cleared');
      return true;
    } catch (error) {
      Logger.error('Failed to clear schemas', { error: error.message });
      return false;
    }
  }
}

// Singleton instance
const schemaValidationService = new SchemaValidationService();

module.exports = schemaValidationService; 