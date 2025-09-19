const mongoose = require('mongoose');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const connectionPoolManager = require('../services/connectionPoolManager');
const schemaValidationService = require('../services/schemaValidationService');
const redisService = require('../services/redisService');
// const AuditLog = require('../../scalai-auth-server/src/models/AuditLog'); // TODO: Move to shared models package
const { v4: uuidv4 } = require('uuid');

class DatabaseController {
  // Get collections in a database
  static async getCollections(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;

      Logger.info('Getting collections', {
        operationId,
        subaccountId,
        userId
      });

      // Get connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // List collections
      const collections = await connection.db.listCollections().toArray();
      
      // Filter collections based on allowed collections if schema enforcement is enabled
      const pool = connectionPoolManager.pools.get(subaccountId);
      let filteredCollections = collections;
      
      if (pool && pool.enforceSchema && pool.allowedCollections.length > 0) {
        const allowedNames = pool.allowedCollections.map(c => c.name);
        filteredCollections = collections.filter(c => allowedNames.includes(c.name));
      }

      // Get collection stats
      const collectionsWithStats = await Promise.all(
        filteredCollections.map(async (col) => {
          try {
            const stats = await connection.db.collection(col.name).stats();
            return {
              name: col.name,
              type: col.type,
              options: col.options,
              stats: {
                count: stats.count,
                size: stats.size,
                avgObjSize: stats.avgObjSize,
                storageSize: stats.storageSize,
                totalIndexSize: stats.totalIndexSize,
                indexCount: stats.nindexes
              }
            };
          } catch (error) {
            // If stats fail, return basic info
            return {
              name: col.name,
              type: col.type,
              options: col.options,
              stats: null
            };
          }
        })
      );

      const executionTime = Date.now() - startTime;

      // Log audit trail
      await this.logOperation({
        operationId,
        userId,
        subaccountId,
        operation: 'listCollections',
        collectionName: '*',
        queryDetails: { query: {} },
        result: {
          success: true,
          documentsReturned: collectionsWithStats.length,
          executionTimeMs: executionTime
        },
        requestContext: this.getRequestContext(req)
      });

      Logger.info('Collections retrieved successfully', {
        operationId,
        subaccountId,
        userId,
        collectionCount: collectionsWithStats.length,
        executionTime
      });

      res.json({
        success: true,
        message: 'Collections retrieved successfully',
        data: {
          collections: collectionsWithStats,
          total: collectionsWithStats.length
        },
        metadata: {
          operationId,
          executionTime
        }
      });

    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      await this.logOperation({
        operationId,
        userId: req.user?.id,
        subaccountId: req.params.subaccountId,
        operation: 'listCollections',
        collectionName: '*',
        queryDetails: { query: {} },
        result: {
          success: false,
          executionTimeMs: executionTime,
          error: {
            message: error.message,
            code: error.code,
            stack: error.stack
          }
        },
        requestContext: this.getRequestContext(req)
      });

      Logger.error('Failed to get collections', {
        operationId,
        subaccountId: req.params.subaccountId,
        userId: req.user?.id,
        error: error.message,
        executionTime
      });

      next(error);
    }
  }

  // Execute find operation
  static async find(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, collection } = req.params;
      const { query = {}, options = {} } = req.body;
      const userId = req.user.id;

      Logger.debug('Executing find operation', {
        operationId,
        subaccountId,
        collection,
        userId
      });

      // Validate query
      const queryValidation = await schemaValidationService.validateQuery(
        subaccountId,
        collection,
        query,
        'find'
      );

      if (!queryValidation.valid) {
        return res.status(400).json({
          success: false,
          message: queryValidation.error,
          code: queryValidation.code,
          operationId
        });
      }

      // Apply query limits
      const sanitizedOptions = this.sanitizeOptions(options);

      // Execute query
      const result = await connectionPoolManager.executeQuery(
        subaccountId,
        userId,
        'find',
        collection,
        queryValidation.query,
        sanitizedOptions
      );

      const executionTime = Date.now() - startTime;

      // Log audit trail
      await this.logOperation({
        operationId,
        userId,
        subaccountId,
        operation: 'find',
        collectionName: collection,
        queryDetails: {
          query: queryValidation.query,
          options: sanitizedOptions
        },
        result: {
          success: result.success,
          documentsReturned: result.success ? result.data.length : 0,
          executionTimeMs: executionTime,
          error: result.success ? null : { message: result.error }
        },
        requestContext: this.getRequestContext(req)
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error,
          operationId
        });
      }

      Logger.info('Find operation completed successfully', {
        operationId,
        subaccountId,
        collection,
        userId,
        documentsFound: result.data.length,
        executionTime
      });

      res.json({
        success: true,
        message: 'Query executed successfully',
        data: result.data,
        metadata: {
          operationId,
          collection,
          operation: 'find',
          documentsReturned: result.data.length,
          executionTime
        }
      });

    } catch (error) {
      await this.handleError(error, req, operationId, 'find', startTime);
      next(error);
    }
  }

  // Execute insertOne operation
  static async insertOne(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, collection } = req.params;
      const { document } = req.body;
      const userId = req.user.id;

      Logger.debug('Executing insertOne operation', {
        operationId,
        subaccountId,
        collection,
        userId
      });

      // Validate document
      const documentValidation = await schemaValidationService.validateDocument(
        subaccountId,
        collection,
        document,
        'insertOne'
      );

      if (!documentValidation.valid) {
        return res.status(400).json({
          success: false,
          message: documentValidation.error,
          code: documentValidation.code,
          errors: documentValidation.errors,
          operationId
        });
      }

      // Execute operation
      const result = await connectionPoolManager.executeQuery(
        subaccountId,
        userId,
        'insertOne',
        collection,
        documentValidation.document
      );

      const executionTime = Date.now() - startTime;

      // Log audit trail
      await this.logOperation({
        operationId,
        userId,
        subaccountId,
        operation: 'insertOne',
        collectionName: collection,
        queryDetails: {
          query: documentValidation.document
        },
        result: {
          success: result.success,
          documentsAffected: result.success ? 1 : 0,
          executionTimeMs: executionTime,
          error: result.success ? null : { message: result.error }
        },
        requestContext: this.getRequestContext(req)
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error,
          operationId
        });
      }

      Logger.info('InsertOne operation completed successfully', {
        operationId,
        subaccountId,
        collection,
        userId,
        insertedId: result.data.insertedId,
        executionTime
      });

      res.status(201).json({
        success: true,
        message: 'Document inserted successfully',
        data: {
          insertedId: result.data.insertedId,
          acknowledged: result.data.acknowledged
        },
        metadata: {
          operationId,
          collection,
          operation: 'insertOne',
          documentsAffected: 1,
          executionTime
        }
      });

    } catch (error) {
      await this.handleError(error, req, operationId, 'insertOne', startTime);
      next(error);
    }
  }

  // Execute insertMany operation
  static async insertMany(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, collection } = req.params;
      const { documents } = req.body;
      const userId = req.user.id;

      if (!Array.isArray(documents) || documents.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Documents array is required and cannot be empty',
          code: 'INVALID_DOCUMENTS',
          operationId
        });
      }

      Logger.debug('Executing insertMany operation', {
        operationId,
        subaccountId,
        collection,
        userId,
        documentCount: documents.length
      });

      // Validate documents
      const documentsValidation = await schemaValidationService.validateDocuments(
        subaccountId,
        collection,
        documents,
        'insertMany'
      );

      if (!documentsValidation.valid) {
        return res.status(400).json({
          success: false,
          message: 'Document validation failed',
          code: 'VALIDATION_ERROR',
          results: documentsValidation.results,
          operationId
        });
      }

      // Execute operation
      const result = await connectionPoolManager.executeQuery(
        subaccountId,
        userId,
        'insertMany',
        collection,
        documentsValidation.documents
      );

      const executionTime = Date.now() - startTime;

      // Log audit trail
      await this.logOperation({
        operationId,
        userId,
        subaccountId,
        operation: 'insertMany',
        collectionName: collection,
        queryDetails: {
          query: { documentCount: documentsValidation.documents.length }
        },
        result: {
          success: result.success,
          documentsAffected: result.success ? result.data.insertedCount : 0,
          executionTimeMs: executionTime,
          error: result.success ? null : { message: result.error }
        },
        requestContext: this.getRequestContext(req)
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error,
          operationId
        });
      }

      Logger.info('InsertMany operation completed successfully', {
        operationId,
        subaccountId,
        collection,
        userId,
        insertedCount: result.data.insertedCount,
        executionTime
      });

      res.status(201).json({
        success: true,
        message: 'Documents inserted successfully',
        data: {
          insertedIds: result.data.insertedIds,
          insertedCount: result.data.insertedCount,
          acknowledged: result.data.acknowledged
        },
        metadata: {
          operationId,
          collection,
          operation: 'insertMany',
          documentsAffected: result.data.insertedCount,
          executionTime
        }
      });

    } catch (error) {
      await this.handleError(error, req, operationId, 'insertMany', startTime);
      next(error);
    }
  }

  // Execute updateOne operation
  static async updateOne(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, collection } = req.params;
      const { filter, update, options = {} } = req.body;
      const userId = req.user.id;

      Logger.debug('Executing updateOne operation', {
        operationId,
        subaccountId,
        collection,
        userId
      });

      // Validate filter
      const filterValidation = await schemaValidationService.validateQuery(
        subaccountId,
        collection,
        filter,
        'updateOne'
      );

      if (!filterValidation.valid) {
        return res.status(400).json({
          success: false,
          message: filterValidation.error,
          code: filterValidation.code,
          operationId
        });
      }

      // Validate update document
      const updateValidation = await schemaValidationService.validateDocument(
        subaccountId,
        collection,
        update,
        'updateOne'
      );

      if (!updateValidation.valid) {
        return res.status(400).json({
          success: false,
          message: updateValidation.error,
          code: updateValidation.code,
          errors: updateValidation.errors,
          operationId
        });
      }

      // Execute operation
      const result = await connectionPoolManager.executeQuery(
        subaccountId,
        userId,
        'updateOne',
        collection,
        {
          filter: filterValidation.query,
          update: updateValidation.document
        },
        this.sanitizeOptions(options)
      );

      const executionTime = Date.now() - startTime;

      // Log audit trail
      await this.logOperation({
        operationId,
        userId,
        subaccountId,
        operation: 'updateOne',
        collectionName: collection,
        queryDetails: {
          query: filterValidation.query,
          updateData: updateValidation.document,
          options: this.sanitizeOptions(options)
        },
        result: {
          success: result.success,
          documentsAffected: result.success ? result.data.modifiedCount : 0,
          executionTimeMs: executionTime,
          error: result.success ? null : { message: result.error }
        },
        requestContext: this.getRequestContext(req)
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error,
          operationId
        });
      }

      Logger.info('UpdateOne operation completed successfully', {
        operationId,
        subaccountId,
        collection,
        userId,
        modifiedCount: result.data.modifiedCount,
        executionTime
      });

      res.json({
        success: true,
        message: 'Document updated successfully',
        data: {
          matchedCount: result.data.matchedCount,
          modifiedCount: result.data.modifiedCount,
          acknowledged: result.data.acknowledged,
          upsertedId: result.data.upsertedId
        },
        metadata: {
          operationId,
          collection,
          operation: 'updateOne',
          documentsAffected: result.data.modifiedCount,
          executionTime
        }
      });

    } catch (error) {
      await this.handleError(error, req, operationId, 'updateOne', startTime);
      next(error);
    }
  }

  // Execute deleteOne operation
  static async deleteOne(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, collection } = req.params;
      const { filter, options = {} } = req.body;
      const userId = req.user.id;

      Logger.debug('Executing deleteOne operation', {
        operationId,
        subaccountId,
        collection,
        userId
      });

      // Validate filter
      const filterValidation = await schemaValidationService.validateQuery(
        subaccountId,
        collection,
        filter,
        'deleteOne'
      );

      if (!filterValidation.valid) {
        return res.status(400).json({
          success: false,
          message: filterValidation.error,
          code: filterValidation.code,
          operationId
        });
      }

      // Execute operation
      const result = await connectionPoolManager.executeQuery(
        subaccountId,
        userId,
        'deleteOne',
        collection,
        filterValidation.query,
        this.sanitizeOptions(options)
      );

      const executionTime = Date.now() - startTime;

      // Log audit trail
      await this.logOperation({
        operationId,
        userId,
        subaccountId,
        operation: 'deleteOne',
        collectionName: collection,
        queryDetails: {
          query: filterValidation.query,
          options: this.sanitizeOptions(options)
        },
        result: {
          success: result.success,
          documentsAffected: result.success ? result.data.deletedCount : 0,
          executionTimeMs: executionTime,
          error: result.success ? null : { message: result.error }
        },
        requestContext: this.getRequestContext(req)
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error,
          operationId
        });
      }

      Logger.info('DeleteOne operation completed successfully', {
        operationId,
        subaccountId,
        collection,
        userId,
        deletedCount: result.data.deletedCount,
        executionTime
      });

      res.json({
        success: true,
        message: 'Document deleted successfully',
        data: {
          deletedCount: result.data.deletedCount,
          acknowledged: result.data.acknowledged
        },
        metadata: {
          operationId,
          collection,
          operation: 'deleteOne',
          documentsAffected: result.data.deletedCount,
          executionTime
        }
      });

    } catch (error) {
      await this.handleError(error, req, operationId, 'deleteOne', startTime);
      next(error);
    }
  }

  // Execute aggregate operation
  static async aggregate(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, collection } = req.params;
      const { pipeline, options = {} } = req.body;
      const userId = req.user.id;

      if (!Array.isArray(pipeline) || pipeline.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Pipeline array is required and cannot be empty',
          code: 'INVALID_PIPELINE',
          operationId
        });
      }

      if (pipeline.length > config.queryLimits.maxAggregationStages) {
        return res.status(400).json({
          success: false,
          message: `Pipeline cannot exceed ${config.queryLimits.maxAggregationStages} stages`,
          code: 'PIPELINE_TOO_LONG',
          operationId
        });
      }

      Logger.debug('Executing aggregate operation', {
        operationId,
        subaccountId,
        collection,
        userId,
        pipelineStages: pipeline.length
      });

      // Validate pipeline stages
      const sanitizedPipeline = this.sanitizeAggregationPipeline(pipeline);

      // Execute operation
      const result = await connectionPoolManager.executeQuery(
        subaccountId,
        userId,
        'aggregate',
        collection,
        sanitizedPipeline,
        this.sanitizeOptions(options)
      );

      const executionTime = Date.now() - startTime;

      // Log audit trail
      await this.logOperation({
        operationId,
        userId,
        subaccountId,
        operation: 'aggregate',
        collectionName: collection,
        queryDetails: {
          pipeline: sanitizedPipeline,
          options: this.sanitizeOptions(options)
        },
        result: {
          success: result.success,
          documentsReturned: result.success ? result.data.length : 0,
          executionTimeMs: executionTime,
          error: result.success ? null : { message: result.error }
        },
        requestContext: this.getRequestContext(req)
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.error,
          operationId
        });
      }

      Logger.info('Aggregate operation completed successfully', {
        operationId,
        subaccountId,
        collection,
        userId,
        documentsReturned: result.data.length,
        executionTime
      });

      res.json({
        success: true,
        message: 'Aggregation executed successfully',
        data: result.data,
        metadata: {
          operationId,
          collection,
          operation: 'aggregate',
          pipelineStages: pipeline.length,
          documentsReturned: result.data.length,
          executionTime
        }
      });

    } catch (error) {
      await this.handleError(error, req, operationId, 'aggregate', startTime);
      next(error);
    }
  }

  // Get collection statistics
  static async getCollectionStats(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, collection } = req.params;
      const userId = req.user.id;

      Logger.debug('Getting collection statistics', {
        operationId,
        subaccountId,
        collection,
        userId
      });

      // Get connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get collection stats
      const stats = await connection.db.collection(collection).stats();
      
      // Get indexes
      const indexes = await connection.db.collection(collection).indexes();

      const executionTime = Date.now() - startTime;

      // Log audit trail
      await this.logOperation({
        operationId,
        userId,
        subaccountId,
        operation: 'stats',
        collectionName: collection,
        queryDetails: { query: {} },
        result: {
          success: true,
          documentsReturned: 0,
          executionTimeMs: executionTime
        },
        requestContext: this.getRequestContext(req)
      });

      const collectionStats = {
        collection,
        stats: {
          count: stats.count,
          size: stats.size,
          avgObjSize: stats.avgObjSize,
          storageSize: stats.storageSize,
          totalIndexSize: stats.totalIndexSize,
          indexCount: stats.nindexes
        },
        indexes: indexes.map(index => ({
          name: index.name,
          key: index.key,
          unique: index.unique || false,
          sparse: index.sparse || false,
          background: index.background || false
        }))
      };

      Logger.info('Collection statistics retrieved successfully', {
        operationId,
        subaccountId,
        collection,
        userId,
        documentCount: stats.count,
        executionTime
      });

      res.json({
        success: true,
        message: 'Collection statistics retrieved successfully',
        data: collectionStats,
        metadata: {
          operationId,
          executionTime
        }
      });

    } catch (error) {
      await this.handleError(error, req, operationId, 'stats', startTime);
      next(error);
    }
  }

  // Update many documents
  static async updateMany(req, res, next) {
    const operationId = uuidv4();
    const startTime = Date.now();
    
    try {
      const { subaccountId, collection } = req.params;
      const { filter, update, options = {} } = req.body;
      const userId = req.user.id;

      Logger.info('UpdateMany operation started', {
        operationId,
        userId,
        subaccountId,
        collection,
        filterKeys: Object.keys(filter || {}),
        updateKeys: Object.keys(update || {})
      });

      // Execute update many operation
      const connection = await connectionPoolManager.getConnection(subaccountId, userId);
      const db = connection.db();
      const coll = db.collection(collection);

      const result = await coll.updateMany(filter, update, {
        ...options,
        maxTimeMS: config.queryLimits.maxExecutionTime
      });

      const duration = Date.now() - startTime;

      // Log operation for audit
      await this.logOperation({
        operationId,
        userId,
        subaccountId,
        operation: 'updateMany',
        collection,
        filter,
        update,
        options,
        result: {
          success: true,
          matchedCount: result.matchedCount,
          modifiedCount: result.modifiedCount,
          upsertedCount: result.upsertedCount
        },
        duration,
        timestamp: new Date()
      });

      Logger.info('UpdateMany operation completed', {
        operationId,
        userId,
        subaccountId,
        collection,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        data: {
          matchedCount: result.matchedCount,
          modifiedCount: result.modifiedCount,
          upsertedCount: result.upsertedCount,
          upsertedId: result.upsertedId
        },
        meta: {
          operationId,
          duration: `${duration}ms`,
          collection,
          operation: 'updateMany'
        }
      });

    } catch (error) {
      await this.handleError(error, req, operationId, 'updateMany', startTime);
      next(error);
    }
  }

  // Delete many documents
  static async deleteMany(req, res, next) {
    const operationId = uuidv4();
    const startTime = Date.now();
    
    try {
      const { subaccountId, collection } = req.params;
      const { filter, options = {} } = req.body;
      const userId = req.user.id;

      Logger.info('DeleteMany operation started', {
        operationId,
        userId,
        subaccountId,
        collection,
        filterKeys: Object.keys(filter || {})
      });

      // Execute delete many operation
      const connection = await connectionPoolManager.getConnection(subaccountId, userId);
      const db = connection.db();
      const coll = db.collection(collection);

      const result = await coll.deleteMany(filter, {
        ...options,
        maxTimeMS: config.queryLimits.maxExecutionTime
      });

      const duration = Date.now() - startTime;

      // Log operation for audit
      await this.logOperation({
        operationId,
        userId,
        subaccountId,
        operation: 'deleteMany',
        collection,
        filter,
        options,
        result: {
          success: true,
          deletedCount: result.deletedCount
        },
        duration,
        timestamp: new Date()
      });

      Logger.info('DeleteMany operation completed', {
        operationId,
        userId,
        subaccountId,
        collection,
        deletedCount: result.deletedCount,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        data: {
          deletedCount: result.deletedCount
        },
        meta: {
          operationId,
          duration: `${duration}ms`,
          collection,
          operation: 'deleteMany'
        }
      });

    } catch (error) {
      await this.handleError(error, req, operationId, 'deleteMany', startTime);
      next(error);
    }
  }

  // Count documents
  static async count(req, res, next) {
    const operationId = uuidv4();
    const startTime = Date.now();
    
    try {
      const { subaccountId, collection } = req.params;
      const { query = {}, options = {} } = req.body;
      const userId = req.user.id;

      Logger.info('Count operation started', {
        operationId,
        userId,
        subaccountId,
        collection,
        queryKeys: Object.keys(query)
      });

      // Execute count operation
      const connection = await connectionPoolManager.getConnection(subaccountId, userId);
      const db = connection.db();
      const coll = db.collection(collection);

      const count = await coll.countDocuments(query, {
        ...options,
        maxTimeMS: config.queryLimits.maxExecutionTime
      });

      const duration = Date.now() - startTime;

      // Log operation for audit
      await this.logOperation({
        operationId,
        userId,
        subaccountId,
        operation: 'count',
        collection,
        query,
        options,
        result: {
          success: true,
          count
        },
        duration,
        timestamp: new Date()
      });

      Logger.info('Count operation completed', {
        operationId,
        userId,
        subaccountId,
        collection,
        count,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        data: {
          count
        },
        meta: {
          operationId,
          duration: `${duration}ms`,
          collection,
          operation: 'count'
        }
      });

    } catch (error) {
      await this.handleError(error, req, operationId, 'count', startTime);
      next(error);
    }
  }

  // Get distinct values
  static async distinct(req, res, next) {
    const operationId = uuidv4();
    const startTime = Date.now();
    
    try {
      const { subaccountId, collection } = req.params;
      const { field, query = {}, options = {} } = req.body;
      const userId = req.user.id;

      if (!field) {
        return res.status(400).json({
          success: false,
          message: 'Field parameter is required for distinct operation',
          code: 'FIELD_REQUIRED'
        });
      }

      Logger.info('Distinct operation started', {
        operationId,
        userId,
        subaccountId,
        collection,
        field,
        queryKeys: Object.keys(query)
      });

      // Execute distinct operation
      const connection = await connectionPoolManager.getConnection(subaccountId, userId);
      const db = connection.db();
      const coll = db.collection(collection);

      const values = await coll.distinct(field, query, {
        ...options,
        maxTimeMS: config.queryLimits.maxExecutionTime
      });

      const duration = Date.now() - startTime;

      // Log operation for audit
      await this.logOperation({
        operationId,
        userId,
        subaccountId,
        operation: 'distinct',
        collection,
        field,
        query,
        options,
        result: {
          success: true,
          count: values.length
        },
        duration,
        timestamp: new Date()
      });

      Logger.info('Distinct operation completed', {
        operationId,
        userId,
        subaccountId,
        collection,
        field,
        distinctCount: values.length,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        data: {
          field,
          values,
          count: values.length
        },
        meta: {
          operationId,
          duration: `${duration}ms`,
          collection,
          operation: 'distinct'
        }
      });

    } catch (error) {
      await this.handleError(error, req, operationId, 'distinct', startTime);
      next(error);
    }
  }

  // Helper methods
  static sanitizeOptions(options) {
    const sanitized = { ...options };
    
    // Apply limits
    if (sanitized.limit && sanitized.limit > config.queryLimits.maxDocuments) {
      sanitized.limit = config.queryLimits.maxDocuments;
    }
    
    // Set execution timeout
    sanitized.maxTimeMS = Math.min(
      sanitized.maxTimeMS || config.queryLimits.maxExecutionTime,
      config.queryLimits.maxExecutionTime
    );
    
    return sanitized;
  }

  static sanitizeAggregationPipeline(pipeline) {
    // Remove dangerous stages
    const dangerousStages = ['$out', '$merge', '$planCacheClear'];
    
    return pipeline.filter(stage => {
      const stageKeys = Object.keys(stage);
      return !stageKeys.some(key => dangerousStages.includes(key));
    });
  }

  static getRequestContext(req) {
    return {
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      headers: {
        'content-type': req.get('Content-Type'),
        'accept': req.get('Accept')
      },
      endpoint: req.originalUrl,
      method: req.method,
      requestId: req.requestId || uuidv4()
    };
  }

  static async logOperation(operationData) {
    try {
      if (config.security.enableAuditLogging) {
        // TODO: Implement audit logging with shared models package
        // await AuditLog.logOperation(operationData);
        Logger.info('Operation logged', operationData);
      }
    } catch (error) {
      Logger.error('Failed to log operation', {
        error: error.message,
        operationId: operationData.operationId
      });
    }
  }

  static async handleError(error, req, operationId, operation, startTime) {
    const executionTime = Date.now() - startTime;
    
    await this.logOperation({
      operationId,
      userId: req.user?.id,
      subaccountId: req.params.subaccountId,
      operation,
      collectionName: req.params.collection || '*',
      queryDetails: { query: req.body || {} },
      result: {
        success: false,
        executionTimeMs: executionTime,
        error: {
          message: error.message,
          code: error.code,
          stack: error.stack
        }
      },
      requestContext: this.getRequestContext(req)
    });

    Logger.error('Database operation failed', {
      operationId,
      subaccountId: req.params.subaccountId,
      userId: req.user?.id,
      operation,
      collection: req.params.collection,
      error: error.message,
      executionTime
    });
  }
}

module.exports = DatabaseController; 