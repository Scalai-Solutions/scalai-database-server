const redisService = require('./redisService');
const Logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * MockStorageService
 * Handles storage for mock sessions using Redis
 */
class MockStorageService {
  constructor() {
    this.defaultTTL = 86400; // 24 hours
    this.keyPrefix = 'mock';
  }

  generateKey(sessionId, collection, documentId = null) {
    if (documentId) {
      return `${this.keyPrefix}:${sessionId}:${collection}:${documentId}`;
    }
    return `${this.keyPrefix}:${sessionId}:${collection}`;
  }

  generateListKey(sessionId, collection) {
    return `${this.keyPrefix}:${sessionId}:${collection}:list`;
  }

  async insertOne(sessionId, collection, document) {
    try {
      const documentId = document._id || document.call_id || document.chat_id || document.agentId || uuidv4();
      const key = this.generateKey(sessionId, collection, documentId);
      
      const documentWithMeta = {
        ...document,
        _id: documentId,
        _mockSession: sessionId,
        _mockCreatedAt: new Date(),
        _mockUpdatedAt: new Date()
      };

      await redisService.set(key, documentWithMeta, this.defaultTTL);
      await this.addToList(sessionId, collection, documentId);

      Logger.info('Mock document inserted', { sessionId, collection, documentId });

      return { success: true, insertedId: documentId, document: documentWithMeta };
    } catch (error) {
      Logger.error('Failed to insert mock document', { sessionId, collection, error: error.message });
      throw error;
    }
  }

  async findOne(sessionId, collection, query) {
    try {
      const idField = query.call_id || query.chat_id || query.agentId || query._id;
      
      if (idField) {
        const key = this.generateKey(sessionId, collection, idField);
        const document = await redisService.get(key);
        
        if (document && this.matchesQuery(document, query)) {
          return document;
        }
      }

      const documents = await this.find(sessionId, collection, query);
      return documents.length > 0 ? documents[0] : null;
    } catch (error) {
      Logger.error('Failed to find mock document', { sessionId, collection, error: error.message });
      throw error;
    }
  }

  async find(sessionId, collection, query = {}, options = {}) {
    try {
      const listKey = this.generateListKey(sessionId, collection);
      const documentIds = await redisService.get(listKey) || [];

      const documents = [];
      for (const docId of documentIds) {
        const key = this.generateKey(sessionId, collection, docId);
        const doc = await redisService.get(key);
        
        if (doc && this.matchesQuery(doc, query)) {
          documents.push(doc);
        }
      }

      if (options.sort) {
        documents.sort((a, b) => this.compareDocuments(a, b, options.sort));
      }

      if (options.limit) {
        return documents.slice(0, options.limit);
      }

      return documents;
    } catch (error) {
      Logger.error('Failed to find mock documents', { sessionId, collection, error: error.message });
      throw error;
    }
  }

  async updateOne(sessionId, collection, filter, update) {
    try {
      const document = await this.findOne(sessionId, collection, filter);
      
      if (!document) {
        return { success: false, matchedCount: 0, modifiedCount: 0 };
      }

      const updatedDocument = this.applyUpdate(document, update);
      updatedDocument._mockUpdatedAt = new Date();

      const documentId = document._id || document.call_id || document.chat_id || document.agentId;
      const key = this.generateKey(sessionId, collection, documentId);

      await redisService.set(key, updatedDocument, this.defaultTTL);

      return { success: true, matchedCount: 1, modifiedCount: 1, document: updatedDocument };
    } catch (error) {
      Logger.error('Failed to update mock document', { sessionId, collection, error: error.message });
      throw error;
    }
  }

  async upsert(sessionId, collection, filter, update) {
    try {
      const existing = await this.findOne(sessionId, collection, filter);

      if (existing) {
        return await this.updateOne(sessionId, collection, filter, update);
      } else {
        const documentData = this.applyUpdate({}, update);
        Object.assign(documentData, filter);
        return await this.insertOne(sessionId, collection, documentData);
      }
    } catch (error) {
      Logger.error('Failed to upsert mock document', { sessionId, collection, error: error.message });
      throw error;
    }
  }

  async deleteOne(sessionId, collection, filter) {
    try {
      const document = await this.findOne(sessionId, collection, filter);
      
      if (!document) {
        return { success: false, deletedCount: 0 };
      }

      const documentId = document._id || document.call_id || document.chat_id || document.agentId;
      const key = this.generateKey(sessionId, collection, documentId);

      await redisService.del(key);
      await this.removeFromList(sessionId, collection, documentId);

      return { success: true, deletedCount: 1 };
    } catch (error) {
      Logger.error('Failed to delete mock document', { sessionId, collection, error: error.message });
      throw error;
    }
  }

  async count(sessionId, collection, query = {}) {
    try {
      const documents = await this.find(sessionId, collection, query);
      return documents.length;
    } catch (error) {
      Logger.error('Failed to count mock documents', { sessionId, collection, error: error.message });
      throw error;
    }
  }

  async aggregate(sessionId, collection, pipeline) {
    try {
      let documents = await this.find(sessionId, collection, {});

      for (const stage of pipeline) {
        if (stage.$match) {
          documents = documents.filter(doc => this.matchesQuery(doc, stage.$match));
        } else if (stage.$sort) {
          documents.sort((a, b) => this.compareDocuments(a, b, stage.$sort));
        } else if (stage.$limit) {
          documents = documents.slice(0, stage.$limit);
        } else if (stage.$lookup) {
          documents = await this.performLookup(sessionId, documents, stage.$lookup);
        }
      }

      return documents;
    } catch (error) {
      Logger.error('Failed to aggregate mock documents', { sessionId, collection, error: error.message });
      throw error;
    }
  }

  async addToList(sessionId, collection, documentId) {
    const listKey = this.generateListKey(sessionId, collection);
    let list = await redisService.get(listKey) || [];
    
    if (!list.includes(documentId)) {
      list.push(documentId);
      await redisService.set(listKey, list, this.defaultTTL);
    }
  }

  async removeFromList(sessionId, collection, documentId) {
    const listKey = this.generateListKey(sessionId, collection);
    let list = await redisService.get(listKey) || [];
    
    list = list.filter(id => id !== documentId);
    await redisService.set(listKey, list, this.defaultTTL);
  }

  matchesQuery(document, query) {
    if (!query || Object.keys(query).length === 0) {
      return true;
    }

    for (const [key, value] of Object.entries(query)) {
      // Handle MongoDB operators and custom range formats
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Handle custom range format (lower/upper) for timestamps
        if (value.lower !== undefined || value.upper !== undefined) {
          const docValue = document[key];
          if (value.lower !== undefined && docValue < value.lower) {
            return false;
          }
          if (value.upper !== undefined && docValue > value.upper) {
            return false;
          }
          continue;
        }
        
        // Handle $in operator
        if (value.$in) {
          if (!value.$in.includes(document[key])) {
            return false;
          }
          continue;
        }
        
        // Handle $ne operator
        if (value.$ne !== undefined) {
          if (document[key] === value.$ne) {
            return false;
          }
          continue;
        }
        
        // Handle $gt, $gte, $lt, $lte
        if (value.$gt !== undefined && !(document[key] > value.$gt)) {
          return false;
        }
        if (value.$gte !== undefined && !(document[key] >= value.$gte)) {
          return false;
        }
        if (value.$lt !== undefined && !(document[key] < value.$lt)) {
          return false;
        }
        if (value.$lte !== undefined && !(document[key] <= value.$lte)) {
          return false;
        }
      } else {
        // Direct equality check
        if (document[key] !== value) {
          return false;
        }
      }
    }

    return true;
  }

  applyUpdate(document, update) {
    const result = { ...document };

    if (update.$set) {
      Object.assign(result, update.$set);
    }

    if (update.$unset) {
      for (const key of Object.keys(update.$unset)) {
        delete result[key];
      }
    }

    if (update.$inc) {
      for (const [key, value] of Object.entries(update.$inc)) {
        result[key] = (result[key] || 0) + value;
      }
    }

    if (!update.$set && !update.$unset && !update.$inc) {
      Object.assign(result, update);
    }

    return result;
  }

  compareDocuments(a, b, sortSpec) {
    for (const [field, order] of Object.entries(sortSpec)) {
      const aVal = a[field];
      const bVal = b[field];
      
      if (aVal < bVal) return order === 1 ? -1 : 1;
      if (aVal > bVal) return order === 1 ? 1 : -1;
    }
    return 0;
  }

  async performLookup(sessionId, documents, lookupSpec) {
    const { from, localField, foreignField, as } = lookupSpec;

    for (const doc of documents) {
      const localValue = doc[localField];
      const query = { [foreignField]: localValue };
      const relatedDocs = await this.find(sessionId, from, query);
      doc[as] = relatedDocs;
    }

    return documents;
  }

  async clearSession(sessionId) {
    try {
      Logger.info('Clearing mock session data', { sessionId });

      // Get Redis client directly
      const client = redisService.client;
      
      // Use SCAN to find all matching keys for this session
      const pattern = `${this.keyPrefix}:${sessionId}:*`;
      let cursor = 0;
      let keysDeleted = 0;
      
      do {
        const reply = await client.scan(cursor, {
          MATCH: pattern,
          COUNT: 100
        });
        
        cursor = reply.cursor;
        const keys = reply.keys;
        
        if (keys.length > 0) {
          await client.del(keys);
          keysDeleted += keys.length;
          Logger.debug('Deleted keys batch', { count: keys.length, sessionId });
        }
      } while (cursor !== 0);

      Logger.info('Mock session cleared', { sessionId, keysDeleted });

      return { success: true, keysDeleted, message: 'Session data cleared' };
    } catch (error) {
      Logger.error('Failed to clear mock session', { sessionId, error: error.message });
      throw error;
    }
  }

  async getSessionInfo(sessionId) {
    try {
      const collections = ['calls', 'chats', 'agents', 'chatagents'];
      const info = { sessionId, collections: {} };

      for (const collection of collections) {
        const count = await this.count(sessionId, collection);
        info.collections[collection] = { count };
      }

      return info;
    } catch (error) {
      Logger.error('Failed to get mock session info', { sessionId, error: error.message });
      throw error;
    }
  }
}

const mockStorageService = new MockStorageService();
module.exports = mockStorageService;
