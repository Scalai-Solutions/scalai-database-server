const mongoose = require('mongoose');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const connectionPoolManager = require('../services/connectionPoolManager');
const { v4: uuidv4 } = require('uuid');

class DatabaseController {
  // Helper method to check if collection access is allowed
  static isCollectionAllowed(pool, collectionName) {
    // If no pool or schema enforcement is disabled, allow all
    if (!pool || !pool.enforceSchema) {
      return { allowed: true, reason: 'Schema enforcement disabled' };
    }
    
    // If no allowed collections specified, allow all
    if (!pool.allowedCollections || pool.allowedCollections.length === 0) {
      return { allowed: true, reason: 'No collection restrictions' };
    }
    
    // Check for wildcard access
    const hasWildcard = pool.allowedCollections.some(item => item === '*');
    if (hasWildcard) {
      return { allowed: true, reason: 'Wildcard access granted' };
    }
    
    // Check specific collection permissions
    const allowedCollection = pool.allowedCollections.find(item => 
      typeof item === 'object' && item.name === collectionName
    );
    
    if (allowedCollection) {
      return { 
        allowed: true, 
        reason: 'Collection explicitly allowed',
        permissions: allowedCollection.permissions || { read: true, write: true, delete: false }
      };
    }
    
    return { 
      allowed: false, 
      reason: `Collection '${collectionName}' not in allowed list` 
    };
  }

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
        userId,
        effectiveRole: req.permission?.effectiveRole
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
        // Check if wildcard is used (allow all collections)
        const hasWildcard = pool.allowedCollections.some(item => item === '*');
        
        if (!hasWildcard) {
          // Filter to only allowed collections
          const allowedNames = pool.allowedCollections
            .filter(c => typeof c === 'object' && c.name)
            .map(c => c.name);
          filteredCollections = collections.filter(c => allowedNames.includes(c.name));
          
          Logger.debug('Filtered collections based on allowed list', {
            subaccountId,
            totalCollections: collections.length,
            allowedCollections: allowedNames,
            filteredCount: filteredCollections.length
          });
        } else {
          Logger.debug('Wildcard access - allowing all collections', {
            subaccountId,
            totalCollections: collections.length
          });
        }
      }

      const duration = Date.now() - startTime;

      Logger.info('Collections retrieved', {
        operationId,
        subaccountId,
        userId,
        collectionCount: filteredCollections.length,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        data: {
          collections: filteredCollections.map(c => ({
            name: c.name,
            type: c.type,
            options: c.options
          }))
        },
        meta: {
          operationId,
          duration: `${duration}ms`,
          totalCollections: filteredCollections.length
        }
      });

    } catch (error) {
      await this.handleError(error, req, operationId, 'getCollections', startTime);
      next(error);
    }
  }

  // Find documents in a collection
  static async find(req, res, next) {
    const operationId = uuidv4();
    const startTime = Date.now();
    
    try {
      const { subaccountId, collection } = req.params;
      const { query = {}, options = {} } = req.body;
      const userId = req.user.id;

      Logger.info('Find operation started', {
        operationId,
        userId,
        subaccountId,
        collection,
        queryKeys: Object.keys(query),
        effectiveRole: req.permission?.effectiveRole
      });

      // Get connection and pool info
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      const pool = connectionPoolManager.pools.get(subaccountId);

      // Check collection access
      const accessCheck = this.isCollectionAllowed(pool, collection);
      if (!accessCheck.allowed) {
        Logger.security('Collection access denied', 'medium', {
          userId,
          subaccountId,
          collection,
          reason: accessCheck.reason
        });

        return res.status(403).json({
          success: false,
          message: accessCheck.reason,
          code: 'COLLECTION_ACCESS_DENIED'
        });
      }

      Logger.debug('Collection access granted', {
        operationId,
        collection,
        reason: accessCheck.reason
      });

      // Execute find operation
      const db = connection.db();
      const mongoCollection = db.collection(collection);

      // Apply query limits
      const sanitizedOptions = {
        ...options,
        limit: Math.min(options.limit || 100, config.queryLimits.maxDocuments),
        maxTimeMS: Math.min(options.maxTimeMS || config.queryLimits.maxExecutionTime, config.queryLimits.maxExecutionTime)
      };

      const documents = await mongoCollection.find(query, sanitizedOptions).toArray();
      const duration = Date.now() - startTime;

      Logger.info('Find operation completed', {
        operationId,
        userId,
        subaccountId,
        collection,
        documentsFound: documents.length,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        data: {
          documents,
          count: documents.length
        },
        meta: {
          operationId,
          duration: `${duration}ms`,
          collection,
          operation: 'find'
        }
      });

    } catch (error) {
      await this.handleError(error, req, operationId, 'find', startTime);
      next(error);
    }
  }

  // Insert single document
  static async insertOne(req, res, next) {
    const operationId = uuidv4();
    const startTime = Date.now();
    
    try {
      const { subaccountId, collection } = req.params;
      const { document, options = {} } = req.body;
      const userId = req.user.id;

      Logger.info('InsertOne operation started', {
        operationId,
        userId,
        subaccountId,
        collection,
        effectiveRole: req.permission?.effectiveRole
      });

      // Get connection and validate collection access
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      const pool = connectionPoolManager.pools.get(subaccountId);

      const accessCheck = this.isCollectionAllowed(pool, collection);
      if (!accessCheck.allowed) {
        return res.status(403).json({
          success: false,
          message: accessCheck.reason,
          code: 'COLLECTION_ACCESS_DENIED'
        });
      }

      // Execute insert operation
      const db = connection.db();
      const mongoCollection = db.collection(collection);

      const result = await mongoCollection.insertOne(document, {
        ...options,
        maxTimeMS: config.queryLimits.maxExecutionTime
      });

      const duration = Date.now() - startTime;

      Logger.info('InsertOne operation completed', {
        operationId,
        userId,
        subaccountId,
        collection,
        insertedId: result.insertedId,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        data: {
          insertedId: result.insertedId,
          acknowledged: result.acknowledged
        },
        meta: {
          operationId,
          duration: `${duration}ms`,
          collection,
          operation: 'insertOne'
        }
      });

    } catch (error) {
      await this.handleError(error, req, operationId, 'insertOne', startTime);
      next(error);
    }
  }

  // Update single document
  static async updateOne(req, res, next) {
    const operationId = uuidv4();
    const startTime = Date.now();
    
    try {
      const { subaccountId, collection } = req.params;
      const { filter, update, options = {} } = req.body;
      const userId = req.user.id;

      Logger.info('UpdateOne operation started', {
        operationId,
        userId,
        subaccountId,
        collection,
        filterKeys: Object.keys(filter || {}),
        updateKeys: Object.keys(update || {}),
        effectiveRole: req.permission?.effectiveRole
      });

      // Get connection and validate collection access
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      const pool = connectionPoolManager.pools.get(subaccountId);

      const accessCheck = this.isCollectionAllowed(pool, collection);
      if (!accessCheck.allowed) {
        return res.status(403).json({
          success: false,
          message: accessCheck.reason,
          code: 'COLLECTION_ACCESS_DENIED'
        });
      }

      // Execute update operation
      const db = connection.db();
      const mongoCollection = db.collection(collection);

      const result = await mongoCollection.updateOne(filter, update, {
        ...options,
        maxTimeMS: config.queryLimits.maxExecutionTime
      });

      const duration = Date.now() - startTime;

      Logger.info('UpdateOne operation completed', {
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
          upsertedId: result.upsertedId,
          acknowledged: result.acknowledged
        },
        meta: {
          operationId,
          duration: `${duration}ms`,
          collection,
          operation: 'updateOne'
        }
      });

    } catch (error) {
      await this.handleError(error, req, operationId, 'updateOne', startTime);
      next(error);
    }
  }

  // Delete single document
  static async deleteOne(req, res, next) {
    const operationId = uuidv4();
    const startTime = Date.now();
    
    try {
      const { subaccountId, collection } = req.params;
      const { filter, options = {} } = req.body;
      const userId = req.user.id;

      Logger.info('DeleteOne operation started', {
        operationId,
        userId,
        subaccountId,
        collection,
        filterKeys: Object.keys(filter || {}),
        effectiveRole: req.permission?.effectiveRole
      });

      // Get connection and validate collection access
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      const pool = connectionPoolManager.pools.get(subaccountId);

      const accessCheck = this.isCollectionAllowed(pool, collection);
      if (!accessCheck.allowed) {
        return res.status(403).json({
          success: false,
          message: accessCheck.reason,
          code: 'COLLECTION_ACCESS_DENIED'
        });
      }

      // Execute delete operation
      const db = connection.db();
      const mongoCollection = db.collection(collection);

      const result = await mongoCollection.deleteOne(filter, {
        ...options,
        maxTimeMS: config.queryLimits.maxExecutionTime
      });

      const duration = Date.now() - startTime;

      Logger.info('DeleteOne operation completed', {
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
          deletedCount: result.deletedCount,
          acknowledged: result.acknowledged
        },
        meta: {
          operationId,
          duration: `${duration}ms`,
          collection,
          operation: 'deleteOne'
        }
      });

    } catch (error) {
      await this.handleError(error, req, operationId, 'deleteOne', startTime);
      next(error);
    }
  }

  // Error handling
  static async handleError(error, req, operationId, operation, startTime) {
    const duration = Date.now() - startTime;
    
    Logger.error(`Database operation failed: ${operation}`, {
      operationId,
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      subaccountId: req.params?.subaccountId,
      collection: req.params?.collection,
      duration: `${duration}ms`
    });
  }
}

module.exports = DatabaseController; 