const connectionPoolManager = require('./connectionPoolManager');
const mockStorageService = require('./mockStorageService');
const Logger = require('../utils/logger');

/**
 * StorageManager
 * Abstract layer that routes database operations to either MongoDB or Mock Storage
 * based on whether the request is in mock session mode
 */
class StorageManager {
  /**
   * Get appropriate storage handler based on mock session status
   * @param {boolean} isMock - Whether this is a mock session
   * @param {string} sessionId - Mock session ID (if applicable)
   * @param {string} subaccountId - Subaccount ID
   * @param {string} userId - User ID
   * @returns {Object} Storage handler with unified interface
   */
  async getStorage(isMock, sessionId, subaccountId, userId) {
    // CRITICAL: Only use mock storage if BOTH isMock AND sessionId are present
    // This prevents stale/expired sessions from accessing Redis data
    if (isMock && sessionId) {
      Logger.debug('✅ Using hybrid mock storage (Redis + MongoDB)', {
        sessionId,
        subaccountId,
        userId
      });
      // Get MongoDB connection for fallback reads
      const mongoConnection = await connectionPoolManager.getConnection(subaccountId, userId);
      return new MockStorageHandler(sessionId, mongoConnection.connection);
    } else {
      Logger.debug('✅ Using MongoDB-only storage (mock data excluded)', {
        subaccountId,
        userId,
        reason: !isMock ? 'Not in mock mode' : 'No session ID'
      });
      return await MongoDBStorageHandler.create(subaccountId, userId);
    }
  }
}

/**
 * Mock Storage Handler
 * Wraps MockStorageService with a unified interface
 * Provides hybrid access: Redis for writes, Redis+MongoDB for reads
 */
class MockStorageHandler {
  constructor(sessionId, mongoConnection) {
    this.sessionId = sessionId;
    this.mongoConnection = mongoConnection;
    this.isMock = true;
  }

  async getCollection(collectionName) {
    return new MockCollection(this.sessionId, collectionName, this.mongoConnection);
  }

  async close() {
    // No-op for mock storage
  }
}

/**
 * Mock Collection
 * Provides MongoDB-like interface for mock storage
 * READS: Check Redis first, then fallback to MongoDB - combine both
 * WRITES: Only to Redis
 */
class MockCollection {
  constructor(sessionId, collectionName, mongoConnection) {
    this.sessionId = sessionId;
    this.collectionName = collectionName;
    this.mongoConnection = mongoConnection;
    this.isMock = true;
  }

  async findOne(query) {
    // First, try to find in Redis (mock data)
    const mockDoc = await mockStorageService.findOne(this.sessionId, this.collectionName, query);
    if (mockDoc) {
      return mockDoc;
    }
    
    // If not found in Redis, fallback to MongoDB (real data)
    if (this.mongoConnection) {
      const mongoCollection = this.mongoConnection.db.collection(this.collectionName);
      return await mongoCollection.findOne(query);
    }
    
    return null;
  }

  find(query = {}, options = {}) {
    const sessionId = this.sessionId;
    const collectionName = this.collectionName;
    const mongoConnection = this.mongoConnection;
    
    return {
      toArray: async () => {
        // Get documents from both Redis and MongoDB
        const mockDocs = await mockStorageService.find(sessionId, collectionName, query, options);
        
        console.log(`🔍 [Hybrid Fetch] Redis docs: ${mockDocs.length}, Query:`, JSON.stringify(query));
        
        let mongoDocs = [];
        if (mongoConnection) {
          const mongoCollection = mongoConnection.db.collection(collectionName);
          mongoDocs = await mongoCollection.find(query, options).toArray();
          console.log(`🔍 [Hybrid Fetch] MongoDB docs: ${mongoDocs.length}`);
        }
        
        // Combine and deduplicate (prefer Redis/mock data if IDs conflict)
        const combined = [...mockDocs];
        const mockIds = new Set(mockDocs.map(d => d._id || d.call_id || d.chat_id || d.agentId));
        
        for (const mongoDoc of mongoDocs) {
          const mongoId = mongoDoc._id || mongoDoc.call_id || mongoDoc.chat_id || mongoDoc.agentId;
          if (!mockIds.has(mongoId)) {
            combined.push(mongoDoc);
          }
        }
        
        console.log(`🔍 [Hybrid Fetch] Combined: ${combined.length} (${mockDocs.length} from Redis + ${mongoDocs.length - mockIds.size} from MongoDB)`);
        
        return combined;
      },
      sort: (sortSpec) => {
        return {
          limit: (limitNum) => {
            return {
              toArray: async () => {
                // Get from both sources WITHOUT applying limit to individual sources
                const mockDocs = await mockStorageService.find(
                  sessionId,
                  collectionName,
                  query,
                  {}
                );
                
                let mongoDocs = [];
                if (mongoConnection) {
                  const mongoCollection = mongoConnection.db.collection(collectionName);
                  mongoDocs = await mongoCollection.find(query).toArray();
                }
                
                // Combine and deduplicate
                const combined = [...mockDocs];
                const mockIds = new Set(mockDocs.map(d => d._id || d.call_id || d.chat_id || d.agentId));
                
                for (const mongoDoc of mongoDocs) {
                  const mongoId = mongoDoc._id || mongoDoc.call_id || mongoDoc.chat_id || mongoDoc.agentId;
                  if (!mockIds.has(mongoId)) {
                    combined.push(mongoDoc);
                  }
                }
                
                // Sort combined results
                combined.sort((a, b) => {
                  for (const [field, order] of Object.entries(sortSpec)) {
                    const aVal = a[field];
                    const bVal = b[field];
                    
                    // Handle Date objects and timestamps
                    const aTime = aVal instanceof Date ? aVal.getTime() : aVal;
                    const bTime = bVal instanceof Date ? bVal.getTime() : bVal;
                    
                    if (aTime < bTime) return order === 1 ? -1 : 1;
                    if (aTime > bTime) return order === 1 ? 1 : -1;
                  }
                  return 0;
                });
                
                return combined.slice(0, limitNum);
              }
            };
          },
          toArray: async () => {
            // Get from both sources
            const mockDocs = await mockStorageService.find(
              sessionId,
              collectionName,
              query,
              {}
            );
            
            console.log(`🔍 [Sort toArray] Redis docs: ${mockDocs.length}`);
            
            let mongoDocs = [];
            if (mongoConnection) {
              const mongoCollection = mongoConnection.db.collection(collectionName);
              mongoDocs = await mongoCollection.find(query).toArray();
              console.log(`🔍 [Sort toArray] MongoDB docs: ${mongoDocs.length}`);
            }
            
            // Combine and deduplicate
            const combined = [...mockDocs];
            const mockIds = new Set(mockDocs.map(d => d._id || d.call_id || d.chat_id || d.agentId));
            
            for (const mongoDoc of mongoDocs) {
              const mongoId = mongoDoc._id || mongoDoc.call_id || mongoDoc.chat_id || mongoDoc.agentId;
              if (!mockIds.has(mongoId)) {
                combined.push(mongoDoc);
              }
            }
            
            console.log(`🔍 [Sort toArray] Before sort: ${combined.length}, Sort field:`, sortSpec);
            
            // Sort combined results
            combined.sort((a, b) => {
              for (const [field, order] of Object.entries(sortSpec)) {
                const aVal = a[field];
                const bVal = b[field];
                
                // Handle null/undefined values - push them to the end
                if (aVal == null && bVal == null) return 0;
                if (aVal == null) return 1;
                if (bVal == null) return -1;
                
                // Handle Date objects and timestamps
                const aTime = aVal instanceof Date ? aVal.getTime() : aVal;
                const bTime = bVal instanceof Date ? bVal.getTime() : bVal;
                
                if (aTime < bTime) return order === 1 ? -1 : 1;
                if (aTime > bTime) return order === 1 ? 1 : -1;
              }
              return 0;
            });
            
            console.log(`🔍 [Sort toArray] After sort: ${combined.length}, First 3:`, combined.slice(0, 3).map(c => ({ call_id: c.call_id, start_timestamp: c.start_timestamp })));
            
            return combined;
          }
        };
      },
      limit: (limitNum) => {
        return {
          toArray: async () => {
            // Get from both sources
            const mockDocs = await mockStorageService.find(
              sessionId,
              collectionName,
              query,
              { limit: limitNum }
            );
            
            let mongoDocs = [];
            if (mongoConnection) {
              const mongoCollection = mongoConnection.db.collection(collectionName);
              mongoDocs = await mongoCollection.find(query).limit(limitNum).toArray();
            }
            
            // Combine and deduplicate
            const combined = [...mockDocs];
            const mockIds = new Set(mockDocs.map(d => d._id || d.call_id || d.chat_id || d.agentId));
            
            for (const mongoDoc of mongoDocs) {
              const mongoId = mongoDoc._id || mongoDoc.call_id || mongoDoc.chat_id || mongoDoc.agentId;
              if (!mockIds.has(mongoId)) {
                combined.push(mongoDoc);
              }
            }
            
            return combined.slice(0, limitNum);
          }
        };
      }
    };
  }

  async insertOne(document) {
    const result = await mockStorageService.insertOne(this.sessionId, this.collectionName, document);
    return {
      insertedId: result.insertedId,
      acknowledged: true
    };
  }

  async updateOne(filter, update, options = {}) {
    if (options.upsert) {
      const result = await mockStorageService.upsert(this.sessionId, this.collectionName, filter, update);
      return {
        matchedCount: result.matchedCount || 0,
        modifiedCount: result.modifiedCount || 0,
        upsertedCount: result.success && result.insertedId ? 1 : 0,
        upsertedId: result.insertedId,
        acknowledged: true
      };
    } else {
      const result = await mockStorageService.updateOne(this.sessionId, this.collectionName, filter, update);
      return {
        matchedCount: result.matchedCount || 0,
        modifiedCount: result.modifiedCount || 0,
        acknowledged: true
      };
    }
  }

  async deleteOne(filter) {
    const result = await mockStorageService.deleteOne(this.sessionId, this.collectionName, filter);
    return {
      deletedCount: result.deletedCount || 0,
      acknowledged: true
    };
  }

  async countDocuments(query = {}) {
    return await mockStorageService.count(this.sessionId, this.collectionName, query);
  }

  async aggregate(pipeline) {
    // Get mock results
    const mockResults = await mockStorageService.aggregate(this.sessionId, this.collectionName, pipeline);
    
    // Get MongoDB results
    let mongoResults = [];
    if (this.mongoConnection) {
      const mongoCollection = this.mongoConnection.db.collection(this.collectionName);
      mongoResults = await mongoCollection.aggregate(pipeline).toArray();
    }
    
    // Combine and deduplicate
    const combined = [...mockResults];
    const mockIds = new Set(mockResults.map(d => d._id || d.call_id || d.chat_id || d.agentId));
    
    for (const mongoDoc of mongoResults) {
      const mongoId = mongoDoc._id || mongoDoc.call_id || mongoDoc.chat_id || mongoDoc.agentId;
      if (!mockIds.has(mongoId)) {
        combined.push(mongoDoc);
      }
    }
    
    return {
      toArray: async () => combined
    };
  }
}

/**
 * MongoDB Storage Handler
 * Wraps MongoDB connection with a unified interface
 */
class MongoDBStorageHandler {
  constructor(connection, subaccountId, userId) {
    this.connection = connection;
    this.subaccountId = subaccountId;
    this.userId = userId;
    this.isMock = false;
  }

  static async create(subaccountId, userId) {
    const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
    return new MongoDBStorageHandler(connectionInfo.connection, subaccountId, userId);
  }

  async getCollection(collectionName) {
    return this.connection.db.collection(collectionName);
  }

  async close() {
    // Connection pooling handles this - no explicit close needed
  }
}

/**
 * Helper function to get storage from request object
 * Extracts mock session info and returns appropriate storage
 */
async function getStorageFromRequest(req, subaccountId = null, userId = null) {
  const effectiveSubaccountId = subaccountId || req.params?.subaccountId || req.body?.subaccountId;
  const effectiveUserId = userId || req.user?.id;

  const storageManager = new StorageManager();
  
  return await storageManager.getStorage(
    req.mockSession?.isMock || false,
    req.mockSession?.sessionId || null,
    effectiveSubaccountId,
    effectiveUserId
  );
}

module.exports = {
  StorageManager,
  getStorageFromRequest
};

