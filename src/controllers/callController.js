const Logger = require('../utils/logger');
const retellService = require('../services/retellService');
const connectionPoolManager = require('../services/connectionPoolManager');
const redisService = require('../services/redisService');
const Retell = require('../utils/retell');
const { v4: uuidv4 } = require('uuid');
const ActivityService = require('../services/activityService');
const { ACTIVITY_TYPES, ACTIVITY_CATEGORIES } = ActivityService;
const { getStorageFromRequest } = require('../services/storageManager');
const { calculateCallSuccessRate } = require('../utils/callHelper');

class CallController {
  /**
   * Create a web call using an agent
   * POST /api/calls/:subaccountId/web-call
   */
  static async createWebCall(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const { agentId, metadata } = req.body;
      const userId = req.user.id;

      Logger.info('Creating web call', {
        operationId,
        subaccountId,
        userId,
        agentId,
        effectiveRole: req.permission?.effectiveRole,
        isMockSession: req.mockSession?.isMock || false,
        mockSessionId: req.mockSession?.sessionId
      });

      // Fetch retell account data (with caching)
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      
      if (!retellAccountData.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Retell account is not active',
          code: 'RETELL_ACCOUNT_INACTIVE'
        });
      }

      // Create Retell instance with decrypted API key
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);
      
      Logger.info('Retell instance created for web call', {
        operationId,
        accountName: retellAccountData.accountName,
        accountId: retellAccountData.id
      });

      // Always get agents from MongoDB (agents are shared resources, not mock-specific)
      const agentConnectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const agentsCollection = agentConnectionInfo.connection.db.collection('agents');
      
      // Verify agent exists in MongoDB
      const agentDocument = await agentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Agent not found',
          code: 'AGENT_NOT_FOUND'
        });
      }

      // Enhance metadata with mock session info
      const enhancedMetadata = {
        ...metadata,
        isMockSession: req.mockSession?.isMock || false,
        mockSessionId: req.mockSession?.sessionId || null,
        subaccountId: subaccountId
      };

      // Create web call with enhanced metadata
      const callOptions = { metadata: enhancedMetadata };
      const webCallResponse = await retell.createWebCall(agentId, callOptions);

      // Note: Web calls are NOT stored in MongoDB - they are ephemeral and only exist in Retell
      Logger.info('Web call created (not stored in MongoDB)', {
        operationId,
        subaccountId,
        agentId,
        callId: webCallResponse.call_id,
        isMockSession: req.mockSession?.isMock || false
      });

      // Note: No cache invalidation needed for web calls since they're not stored in MongoDB

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.WEB_CALL_CREATED,
        category: ACTIVITY_CATEGORIES.CALL,
        userId,
        description: `Web call created for agent ${agentDocument.name || agentId}`,
        metadata: {
          callId: webCallResponse.call_id,
          agentId,
          agentName: agentDocument.name,
          callType: 'web_call',
          metadata: metadata || {}
        },
        resourceId: webCallResponse.call_id,
        resourceName: `Web Call - ${agentDocument.name || agentId}`,
        operationId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Web call created successfully',
        data: {
          agent_id: webCallResponse.agent_id,
          call_id: webCallResponse.call_id,
          access_token: webCallResponse.access_token,
          sample_rate: webCallResponse.sample_rate,
          call_status: webCallResponse.call_status,
          retellAccount: {
            accountName: retellAccountData.accountName,
            accountId: retellAccountData.id
          }
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await CallController.handleError(error, req, operationId, 'createWebCall', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Webhook update call (for webhook server)
   * PATCH /api/calls/:subaccountId/webhook-update
   */
  static async webhookUpdateCall(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const { callId, updateData } = req.body;
      const serviceName = req.service?.serviceName || 'unknown';

      Logger.info('Webhook updating call', {
        operationId,
        subaccountId,
        callId,
        serviceName,
        updateFields: Object.keys(updateData || {}),
        isMockSession: req.mockSession?.isMock || false
      });

      if (!callId || !updateData) {
        return res.status(400).json({
          success: false,
          message: 'callId and updateData are required',
          code: 'MISSING_REQUIRED_FIELDS'
        });
      }

      // Skip storing web_call calls in MongoDB - they are ephemeral and only exist in Retell
      if (updateData.call_type === 'web_call') {
        Logger.debug('Skipping MongoDB storage for web_call', {
          operationId,
          subaccountId,
          callId
        });

        return res.json({
          success: true,
          message: 'Web call update skipped (web calls are not stored in MongoDB)',
          data: {
            callId,
            skipped: true,
            reason: 'web_call type not stored in MongoDB'
          },
          meta: {
            operationId,
            duration: `${Date.now() - startTime}ms`
          }
        });
      }

      // Get storage (MongoDB or Mock based on session)
      const storage = await getStorageFromRequest(req, subaccountId, 'webhook-service');
      const callsCollection = await storage.getCollection('calls');

      // Calculate success_rate if call_analysis is being updated
      let successRate = null;
      if (updateData.call_analysis) {
        successRate = calculateCallSuccessRate(updateData.call_analysis);
        if (successRate !== null) {
          updateData.success_rate = successRate;
          Logger.debug('Success rate calculated for call', {
            operationId,
            subaccountId,
            callId,
            successRate
          });
        }
      } else {
        // If call_analysis is not being updated, try to calculate from existing document
        // This handles cases where call_analysis was updated in a previous webhook
        const existingCall = await callsCollection.findOne({ call_id: callId });
        if (existingCall?.call_analysis && !existingCall.success_rate) {
          successRate = calculateCallSuccessRate(existingCall.call_analysis);
          if (successRate !== null) {
            updateData.success_rate = successRate;
            Logger.debug('Success rate calculated from existing call_analysis', {
              operationId,
              subaccountId,
              callId,
              successRate
            });
          }
        }
      }

      // Upsert the call document
      const result = await callsCollection.updateOne(
        { call_id: callId },
        { 
          $set: {
            ...updateData,
            subaccountId: subaccountId,
            lastUpdatedBy: 'webhook-service',
            lastUpdatedAt: new Date()
          },
          $setOnInsert: {
            createdAt: new Date(), // Only set on insert, not on update
            createdBy: 'webhook-service'
          }
        },
        { upsert: true }
      );

      const duration = Date.now() - startTime;

      Logger.info('Call updated via webhook', {
        operationId,
        subaccountId,
        callId,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedCount: result.upsertedCount,
        duration: `${duration}ms`
      });

      // Invalidate call logs cache
      if (redisService.isConnected) {
        try {
          await redisService.invalidateCallLogs(subaccountId);
          Logger.debug('Call logs cache invalidated after webhook update', {
            operationId,
            subaccountId
          });
        } catch (cacheError) {
          Logger.warn('Failed to invalidate call logs cache', {
            operationId,
            error: cacheError.message
          });
        }
      }

      // Log activity
      // await ActivityService.logActivity({
      //   subaccountId,
      //   activityType: ACTIVITY_TYPES.CALL_UPDATED,
      //   category: ACTIVITY_CATEGORIES.CALL,
      //   userId: 'webhook-service',
      //   description: `Call ${callId} updated via webhook`,
      //   metadata: {
      //     callId,
      //     updatedFields: Object.keys(updateData || {}),
      //     serviceName,
      //     upserted: result.upsertedCount > 0
      //   },
      //   resourceId: callId,
      //   resourceName: `Call ${callId}`,
      //   operationId
      // });

      res.json({
        success: true,
        message: 'Call updated successfully',
        data: {
          callId,
          matchedCount: result.matchedCount,
          modifiedCount: result.modifiedCount,
          upsertedCount: result.upsertedCount,
          upsertedId: result.upsertedId
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await CallController.handleError(error, req, operationId, 'webhookUpdateCall', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Error handling
   */
  static async handleError(error, req, operationId, operation, startTime) {
    const duration = Date.now() - startTime;
    
    Logger.error(`Call operation failed: ${operation}`, {
      operationId,
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      subaccountId: req.params?.subaccountId,
      duration: `${duration}ms`
    });

    let statusCode = 500;
    let errorCode = 'CALL_ERROR';
    let message = 'An internal error occurred while creating the call';

    if (error.message.includes('Failed to fetch retell account')) {
      statusCode = 503;
      errorCode = 'RETELL_FETCH_FAILED';
      message = 'Unable to fetch Retell account details. Please try again later.';
    } else if (error.message.includes('Failed to decrypt API key')) {
      statusCode = 500;
      errorCode = 'API_KEY_DECRYPTION_ERROR';
      message = 'Unable to decrypt Retell API key. Please contact support.';
    } else if (error.message.includes('Failed to create web call')) {
      statusCode = 503;
      errorCode = 'WEB_CALL_CREATION_FAILED';
      message = 'Failed to create web call. Please try again later.';
    } else if (error.message.includes('Failed to create connection pool')) {
      statusCode = 503;
      errorCode = 'CONNECTION_FAILED';
      message = 'Unable to connect to the database.';
    }

    return {
      statusCode,
      response: {
        success: false,
        message,
        code: errorCode,
        meta: {
          operationId,
          operation,
          duration: `${duration}ms`
        }
      }
    };
  }

  /**
   * Create a phone call using Retell
   * POST /api/calls/:subaccountId/phone-call
   */
  static async createPhoneCall(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const { from_number, to_number, agent_id, metadata, dynamic_variables, retell_llm_dynamic_variables } = req.body;
      const userId = req.user.id;

      // Use dynamic_variables if provided, otherwise use retell_llm_dynamic_variables
      const dynamicVars = dynamic_variables || retell_llm_dynamic_variables;

      Logger.info('Creating phone call', {
        operationId,
        subaccountId,
        userId,
        from_number,
        to_number,
        agent_id,
        dynamic_variables: dynamicVars,
        effectiveRole: req.permission?.effectiveRole,
        isMockSession: req.mockSession?.isMock || false
      });

      // Fetch retell account data (with caching)
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      
      if (!retellAccountData.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Retell account is not active',
          code: 'RETELL_ACCOUNT_INACTIVE'
        });
      }

      // Create Retell instance with decrypted API key
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);
      
      Logger.info('Retell instance created for phone call', {
        operationId,
        accountName: retellAccountData.accountName,
        accountId: retellAccountData.id
      });

      // Always get agents and phone numbers from MongoDB (shared resources)
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);

      // If agent_id is provided, verify agent exists in MongoDB
      if (agent_id) {
        const agentsCollection = connectionInfo.connection.db.collection('agents');
        const agentDocument = await agentsCollection.findOne({ 
          agentId: agent_id,
          subaccountId: subaccountId 
        });

        if (!agentDocument) {
          return res.status(404).json({
            success: false,
            message: 'Agent not found',
            code: 'AGENT_NOT_FOUND'
          });
        }
      }

      // Verify from_number exists in phonenumbers collection (MongoDB)
      const phoneNumbersCollection = connectionInfo.connection.db.collection('phonenumbers');
      const phoneNumberDocument = await phoneNumbersCollection.findOne({
        subaccountId: subaccountId,
        phone_number: from_number
      });

      if (!phoneNumberDocument) {
        return res.status(404).json({
          success: false,
          message: `Phone number ${from_number} not found. Please add it to your account first.`,
          code: 'PHONE_NUMBER_NOT_FOUND'
        });
      }

      // Enhance metadata with mock session info
      const enhancedMetadata = {
        ...metadata,
        isMockSession: req.mockSession?.isMock || false,
        mockSessionId: req.mockSession?.sessionId || null,
        subaccountId: subaccountId
      };

      // Create phone call with Retell
      const callConfig = {
        from_number,
        to_number,
        metadata: enhancedMetadata
      };

      if (agent_id) {
        callConfig.agent_id = agent_id;
      }
      if (dynamicVars) {
        callConfig.retell_llm_dynamic_variables = dynamicVars;
      }

      const phoneCallResponse = await retell.createPhoneCall(callConfig);

      // Get storage for CALLS only (MongoDB or Mock based on session)
      const storage = await getStorageFromRequest(req, subaccountId, userId);
      const callsCollection = await storage.getCollection('calls');
      const now = new Date();
      const callDocument = {
        call_id: phoneCallResponse.call_id,
        agent_id: phoneCallResponse.agent_id || agent_id,
        call_type: 'phone_call',
        from_number: from_number,
        to_number: to_number,
        call_status: phoneCallResponse.call_status || 'registered',
        start_timestamp: now.getTime(), // Add timestamp for filtering
        metadata: enhancedMetadata,
        retell_llm_dynamic_variables: dynamicVars || null,
        subaccountId: subaccountId,
        createdBy: userId,
        createdAt: now,
        operationId: operationId,
        retellAccountId: retellAccountData.id,
        _isMockSession: req.mockSession?.isMock || false,
        _mockSessionId: req.mockSession?.sessionId || null
      };

      await callsCollection.insertOne(callDocument);
      
      Logger.info('Phone call created and stored', {
        operationId,
        subaccountId,
        from_number,
        to_number,
        callId: phoneCallResponse.call_id,
        isMockSession: req.mockSession?.isMock || false,
        storageType: storage.isMock ? 'Redis (Mock)' : 'MongoDB'
      });

      // Invalidate call logs cache
      if (redisService.isConnected) {
        try {
          await redisService.invalidateCallLogs(subaccountId);
          Logger.debug('Call logs cache invalidated after phone call creation', {
            operationId,
            subaccountId
          });
        } catch (cacheError) {
          Logger.warn('Failed to invalidate call logs cache', {
            operationId,
            error: cacheError.message
          });
        }
      }

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.PHONE_CALL_CREATED,
        category: ACTIVITY_CATEGORIES.CALL,
        userId,
        description: `Outbound call was initiated to ${to_number}`,
        metadata: {
          callId: phoneCallResponse.call_id,
          from_number,
          to_number,
          agent_id: phoneCallResponse.agent_id || agent_id,
          dynamic_variables: dynamicVars
        },
        resourceId: phoneCallResponse.call_id,
        resourceName: `Call to ${to_number}`,
        operationId
      });

      const duration = Date.now() - startTime;

      return res.status(200).json({
        success: true,
        message: 'Phone call created successfully',
        data: {
          call_id: phoneCallResponse.call_id,
          agent_id: phoneCallResponse.agent_id,
          from_number: phoneCallResponse.from_number,
          to_number: phoneCallResponse.to_number,
          call_status: phoneCallResponse.call_status,
          call_type: 'phone_call'
        },
        retellAccount: {
          accountName: retellAccountData.accountName,
          accountId: retellAccountData.id
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await CallController.handleError(error, req, operationId, 'createPhoneCall', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Get call logs (list all calls)
   * GET /api/calls/:subaccountId/logs
   * POST /api/calls/:subaccountId/logs/filter (with filters and pagination)
   */
  static async getCallLogs(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;

      // Extract filter criteria and pagination from request body (POST) or query params (GET)
      const filterCriteria = req.body?.filter_criteria || {};
      const limit = req.body?.limit || req.query?.limit || 50;
      const paginationKey = req.body?.pagination_key || req.query?.pagination_key;

      Logger.info('Fetching call logs', {
        operationId,
        subaccountId,
        userId,
        hasFilters: Object.keys(filterCriteria).length > 0,
        limit,
        hasPaginationKey: !!paginationKey,
        effectiveRole: req.permission?.effectiveRole,
        isMockSession: req.mockSession?.isMock || false
      });

      // For MOCK sessions, fetch from storage layer (Redis + MongoDB)
      if (req.mockSession?.isMock && req.mockSession?.sessionId) {
        Logger.info('🎭 Fetching call logs from mock storage (Redis + MongoDB)', {
          operationId,
          subaccountId,
          mockSessionId: req.mockSession.sessionId
        });

        // Get storage (will return hybrid Redis + MongoDB)
        const storage = await getStorageFromRequest(req, subaccountId, userId);
        const callsCollection = await storage.getCollection('calls');

        // Build query using agent_id from filters (since subaccountId might be null in MongoDB)
        // We'll filter by subaccountId in-memory
        const query = {};
        
        // If agent_id filter is provided, use it in the query
        if (filterCriteria.agent_id && Array.isArray(filterCriteria.agent_id)) {
          query.agent_id = { $in: filterCriteria.agent_id };
        }

        // Fetch calls from hybrid storage
        // Sort by start_timestamp (not createdAt) to match Retell API behavior
        // Include success_rate in projection
        let calls = await callsCollection
          .find(query)
          .sort({ start_timestamp: -1 })
          .toArray();
        
        // Filter by subaccountId in-memory (since MongoDB calls might have null subaccountId)
        // In non-mock mode, Retell API returns pre-filtered calls
        // But in mock mode, we need to check both the subaccountId field and rely on agent ownership
        calls = calls.filter(call => {
          // Accept if subaccountId matches
          if (call.subaccountId === subaccountId) return true;
          
          // Also accept calls from MongoDB that don't have subaccountId set
          // (legacy/webhook calls) as long as agent_id matches our query
          if (!call.subaccountId && !call._mockSession) return true;
          
          return false;
        });

        // Ensure success_rate is included in response (calculate if missing)
        calls = calls.map(call => {
          // If success_rate already exists, keep it
          if (call.success_rate !== null && call.success_rate !== undefined) {
            return call;
          }
          
          // Otherwise, try to calculate from call_analysis
          if (call.call_analysis) {
            const calculatedRate = calculateCallSuccessRate(call.call_analysis);
            if (calculatedRate !== null) {
              return {
                ...call,
                success_rate: calculatedRate
              };
            }
          }
          
          return call;
        });

        Logger.debug('🎭 Mock hybrid fetch results', {
          operationId,
          subaccountId,
          totalCalls: calls.length,
          mockCalls: calls.filter(c => c._mockSession).length,
          mongoCalls: calls.filter(c => !c._mockSession).length
        });

        // Apply remaining filters in-memory
        if (filterCriteria.call_type) {
          calls = calls.filter(call => call.call_type === filterCriteria.call_type);
        }
        if (filterCriteria.call_status && Array.isArray(filterCriteria.call_status)) {
          calls = calls.filter(call => filterCriteria.call_status.includes(call.call_status));
        }
        if (filterCriteria.start_timestamp) {
          calls = calls.filter(call => {
            const timestamp = call.start_timestamp;
            if (!timestamp) return false;
            if (filterCriteria.start_timestamp.lower && timestamp < filterCriteria.start_timestamp.lower) {
              return false;
            }
            if (filterCriteria.start_timestamp.upper && timestamp > filterCriteria.start_timestamp.upper) {
              return false;
            }
            return true;
          });
        }

        // Apply limit
        calls = calls.slice(0, parseInt(limit));

        // Calculate duration for calls that have timestamps but no duration
        const callsWithDuration = calls.map(call => {
          // If duration_ms already exists, keep it
          if (call.duration_ms) {
            return call;
          }
          
          // Calculate duration from timestamps if available
          if (call.start_timestamp && call.end_timestamp) {
            return {
              ...call,
              duration_ms: call.end_timestamp - call.start_timestamp
            };
          }
          
          return call;
        });

        Logger.info('Call logs fetched from mock storage', {
          operationId,
          subaccountId,
          callCount: callsWithDuration.length,
          mockCallsIncluded: true
        });

        const duration = Date.now() - startTime;

        return res.json({
          success: true,
          message: 'Call logs retrieved successfully (mock mode)',
          data: callsWithDuration,
          meta: {
            operationId,
            duration: `${duration}ms`,
            count: callsWithDuration.length,
            isMockSession: true,
            source: 'Redis + MongoDB'
          }
        });
      }

      // For REGULAR sessions, use Retell API (existing logic)
      // Build cache key including filters and pagination for POST requests
      const cacheKey = `call:logs:${subaccountId}`;
      const shouldUseCache = !paginationKey && Object.keys(filterCriteria).length === 0 && limit === 50;

      // Check cache first (only for simple queries without filters/pagination)
      let callResponses = null;
      let cacheHit = false;
      
      if (shouldUseCache && redisService.isConnected) {
        try {
          callResponses = await redisService.getCachedCallLogs(subaccountId);
          if (callResponses) {
            cacheHit = true;
            Logger.debug('Call logs retrieved from cache', {
              operationId,
              subaccountId,
              callCount: callResponses?.length || 0
            });
          }
        } catch (cacheError) {
          Logger.warn('Failed to get call logs from cache, fetching from Retell', {
            operationId,
            error: cacheError.message
          });
        }
      }

      // If not in cache, fetch from Retell
      if (!callResponses) {
        // Fetch retell account data (with caching)
        const retellAccountData = await retellService.getRetellAccount(subaccountId);
        
        if (!retellAccountData.isActive) {
          return res.status(400).json({
            success: false,
            message: 'Retell account is not active',
            code: 'RETELL_ACCOUNT_INACTIVE'
          });
        }

        // Create Retell instance with decrypted API key
        const retell = new Retell(retellAccountData.apiKey, retellAccountData);
        
        Logger.info('Retell instance created for listing calls', {
          operationId,
          accountName: retellAccountData.accountName,
          accountId: retellAccountData.id
        });

        // Build options for Retell API
        const listOptions = {};
        if (Object.keys(filterCriteria).length > 0) {
          listOptions.filter_criteria = filterCriteria;
        }
        if (limit) {
          listOptions.limit = parseInt(limit);
        }
        if (paginationKey) {
          listOptions.pagination_key = paginationKey;
        }

        // List all calls from Retell with filters and pagination
        const retellCallResponses = await retell.listCalls(listOptions);

        Logger.info('Call logs fetched successfully from Retell', {
          operationId,
          subaccountId,
          callCount: retellCallResponses?.length || 0,
          hasFilters: Object.keys(filterCriteria).length > 0
        });

        // Get database connection to filter by MongoDB presence
        const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
        const { connection } = connectionInfo;
        const callsCollection = connection.db.collection('calls');

        // Get all call_ids and success_rate that exist in MongoDB for this subaccount
        const callIdsInMongo = await callsCollection
          .find(
            { subaccountId: subaccountId },
            { projection: { call_id: 1, success_rate: 1, _id: 0 } }
          )
          .toArray();

        const mongoCallIdSet = new Set(callIdsInMongo.map(doc => doc.call_id));
        // Create a map of call_id to success_rate for quick lookup
        const successRateMap = new Map(
          callIdsInMongo
            .filter(doc => doc.success_rate !== null && doc.success_rate !== undefined)
            .map(doc => [doc.call_id, doc.success_rate])
        );

        Logger.debug('MongoDB call_ids retrieved', {
          operationId,
          subaccountId,
          mongoCallCount: mongoCallIdSet.size,
          successRateCount: successRateMap.size
        });

        // Filter Retell responses to only include calls present in MongoDB
        // and enrich with success_rate from MongoDB
        callResponses = retellCallResponses
          .filter(call => mongoCallIdSet.has(call.call_id))
          .map(call => {
            // Add success_rate from MongoDB if available
            const successRate = successRateMap.get(call.call_id);
            if (successRate !== undefined) {
              return {
                ...call,
                success_rate: successRate
              };
            }
            return call;
          });

        const filteredOutCount = retellCallResponses.length - callResponses.length;

        Logger.info('Call logs filtered by MongoDB presence', {
          operationId,
          subaccountId,
          retellCount: retellCallResponses.length,
          mongoFilteredCount: callResponses.length,
          filteredOut: filteredOutCount
        });

        // Cache the filtered results (only for simple queries)
        if (shouldUseCache && redisService.isConnected) {
          try {
            await redisService.cacheCallLogs(subaccountId, callResponses, 300); // Cache for 5 minutes
            Logger.debug('Call logs cached successfully', {
              operationId,
              subaccountId,
              cachedCount: callResponses.length
            });
          } catch (cacheError) {
            Logger.warn('Failed to cache call logs', {
              operationId,
              error: cacheError.message
            });
          }
        }
      }

      // Get retell account data for response (needed even if cached)
      const retellAccountData = await retellService.getRetellAccount(subaccountId);

      // Determine next pagination key (last call_id in the response)
      const nextPaginationKey = callResponses && callResponses.length > 0 
        ? callResponses[callResponses.length - 1]?.call_id 
        : null;

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CALL_LOGS_VIEWED,
        category: ACTIVITY_CATEGORIES.CALL,
        userId,
        description: `Call logs viewed (${callResponses?.length || 0} calls)`,
        metadata: {
          callCount: callResponses?.length || 0,
          retellAccountId: retellAccountData.id,
          cacheHit,
          hasFilters: Object.keys(filterCriteria).length > 0,
          limit,
          filteredByMongoDB: true
        },
        resourceId: `call-logs-${subaccountId}`,
        resourceName: 'Call Logs',
        operationId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Call logs retrieved successfully (filtered by MongoDB presence)',
        data: callResponses,
        pagination: {
          limit: parseInt(limit),
          count: callResponses?.length || 0,
          next_pagination_key: nextPaginationKey,
          has_more: callResponses?.length === parseInt(limit)
        },
        retellAccount: {
          accountName: retellAccountData.accountName,
          accountId: retellAccountData.id
        },
        meta: {
          operationId,
          duration: `${duration}ms`,
          cacheHit,
          filteredByMongoDB: true
        }
      });

    } catch (error) {
      const errorInfo = await CallController.handleError(error, req, operationId, 'getCallLogs', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Delete a call log
   * DELETE /api/calls/:subaccountId/logs/:callId
   */
  static async deleteCallLog(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, callId } = req.params;
      const userId = req.user.id;

      Logger.info('Deleting call log', {
        operationId,
        subaccountId,
        userId,
        callId,
        effectiveRole: req.permission?.effectiveRole
      });

      // Fetch retell account data (with caching)
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      
      if (!retellAccountData.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Retell account is not active',
          code: 'RETELL_ACCOUNT_INACTIVE'
        });
      }

      // Create Retell instance with decrypted API key
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);
      
      Logger.info('Retell instance created for deleting call', {
        operationId,
        accountName: retellAccountData.accountName,
        accountId: retellAccountData.id
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Check if call exists in our database
      const callsCollection = connection.db.collection('calls');
      const callDocument = await callsCollection.findOne({
        call_id: callId,
        subaccountId: subaccountId
      });

      // Delete call from Retell
      await retell.deleteCall(callId);

      // Delete call from our database if it exists
      if (callDocument) {
        await callsCollection.deleteOne({
          call_id: callId,
          subaccountId: subaccountId
        });
        
        Logger.info('Call deleted from database', {
          operationId,
          subaccountId,
          callId
        });
      }

      Logger.info('Call log deleted successfully', {
        operationId,
        subaccountId,
        callId
      });

      // Invalidate call logs cache
      if (redisService.isConnected) {
        try {
          await redisService.invalidateCallLogs(subaccountId);
          Logger.debug('Call logs cache invalidated after call deletion', {
            operationId,
            subaccountId
          });
        } catch (cacheError) {
          Logger.warn('Failed to invalidate call logs cache', {
            operationId,
            error: cacheError.message
          });
        }
      }

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CALL_DELETED,
        category: ACTIVITY_CATEGORIES.CALL,
        userId,
        description: `Call ${callId} deleted`,
        metadata: {
          callId,
          retellAccountId: retellAccountData.id,
          deletedFromDatabase: !!callDocument
        },
        resourceId: callId,
        resourceName: `Call ${callId}`,
        operationId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Call log deleted successfully',
        data: {
          callId,
          deletedFromRetell: true,
          deletedFromDatabase: !!callDocument
        },
        retellAccount: {
          accountName: retellAccountData.accountName,
          accountId: retellAccountData.id
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await CallController.handleError(error, req, operationId, 'deleteCallLog', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Create a batch call (multiple outbound phone calls)
   * POST /api/calls/:subaccountId/batch-call
   */
  static async createBatchCall(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const { from_number, tasks, name, trigger_timestamp, ignore_e164_validation } = req.body;
      const userId = req.user.id;

      Logger.info('Creating batch call', {
        operationId,
        subaccountId,
        userId,
        from_number,
        taskCount: tasks?.length || 0,
        name,
        effectiveRole: req.permission?.effectiveRole
      });

      // Fetch retell account data (with caching)
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      
      if (!retellAccountData.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Retell account is not active',
          code: 'RETELL_ACCOUNT_INACTIVE'
        });
      }

      // Create Retell instance with decrypted API key
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);
      
      Logger.info('Retell instance created for batch call', {
        operationId,
        accountName: retellAccountData.accountName,
        accountId: retellAccountData.id
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Verify from_number exists in phonenumbers collection
      const phoneNumbersCollection = connection.db.collection('phonenumbers');
      const phoneNumberDocument = await phoneNumbersCollection.findOne({
        subaccountId: subaccountId,
        phone_number: from_number
      });

      if (!phoneNumberDocument) {
        return res.status(404).json({
          success: false,
          message: `Phone number ${from_number} not found. Please add it to your account first.`,
          code: 'PHONE_NUMBER_NOT_FOUND'
        });
      }

      // Create batch call with Retell
      const batchCallConfig = {
        from_number,
        tasks
      };

      if (name) {
        batchCallConfig.name = name;
      }
      if (trigger_timestamp) {
        batchCallConfig.trigger_timestamp = trigger_timestamp;
      }
      if (ignore_e164_validation !== undefined) {
        batchCallConfig.ignore_e164_validation = ignore_e164_validation;
      }

      const batchCallResponse = await retell.createBatchCall(batchCallConfig);

      // Store batch call information in database
      const batchCallsCollection = connection.db.collection('batch_calls');
      const batchCallDocument = {
        batch_call_id: batchCallResponse.batch_call_id,
        name: batchCallResponse.name || name,
        from_number: batchCallResponse.from_number,
        scheduled_timestamp: batchCallResponse.scheduled_timestamp,
        total_task_count: batchCallResponse.total_task_count,
        tasks: tasks,
        subaccountId: subaccountId,
        createdBy: userId,
        createdAt: new Date(),
        operationId: operationId,
        retellAccountId: retellAccountData.id
      };

      await batchCallsCollection.insertOne(batchCallDocument);
      
      Logger.info('Batch call created and stored in database', {
        operationId,
        subaccountId,
        batchCallId: batchCallResponse.batch_call_id,
        taskCount: batchCallResponse.total_task_count
      });

      // Invalidate call logs cache (batch calls will eventually create individual calls)
      if (redisService.isConnected) {
        try {
          await redisService.invalidateCallLogs(subaccountId);
          Logger.debug('Call logs cache invalidated after batch call creation', {
            operationId,
            subaccountId
          });
        } catch (cacheError) {
          Logger.warn('Failed to invalidate call logs cache', {
            operationId,
            error: cacheError.message
          });
        }
      }

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.PHONE_CALL_CREATED,
        category: ACTIVITY_CATEGORIES.CALL,
        userId,
        description: `Bulk call was initiated to ${batchCallResponse.total_task_count} numbers`,
        metadata: {
          batchCallId: batchCallResponse.batch_call_id,
          from_number,
          taskCount: batchCallResponse.total_task_count,
          name: batchCallResponse.name,
          scheduled: !!trigger_timestamp
        },
        resourceId: batchCallResponse.batch_call_id,
        resourceName: `Batch Call - ${batchCallResponse.name || 'Unnamed'}`,
        operationId
      });

      const duration = Date.now() - startTime;

      return res.status(200).json({
        success: true,
        message: 'Batch call created successfully',
        data: {
          batch_call_id: batchCallResponse.batch_call_id,
          name: batchCallResponse.name,
          from_number: batchCallResponse.from_number,
          scheduled_timestamp: batchCallResponse.scheduled_timestamp,
          total_task_count: batchCallResponse.total_task_count
        },
        retellAccount: {
          accountName: retellAccountData.accountName,
          accountId: retellAccountData.id
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await CallController.handleError(error, req, operationId, 'createBatchCall', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }
}

module.exports = CallController; 