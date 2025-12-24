const mongoose = require('mongoose');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const connectionPoolManager = require('../services/connectionPoolManager');
const retellService = require('../services/retellService');
const redisService = require('../services/redisService');
const Retell = require('../utils/retell');
const { v4: uuidv4 } = require('uuid');
const ActivityService = require('../services/activityService');
const { ACTIVITY_TYPES, ACTIVITY_CATEGORIES } = ActivityService;
const { RESOURCE_TYPES, SCOPE_TYPES } = require('../validators/knowledgeBaseValidator');
const fs = require('fs');
const { getOpenAIHelper } = require('../utils/openai');

/**
 * Knowledge Base Controller
 * 
 * Architecture:
 * - ONE global knowledge base per subaccount (holds all global resources)
 * - ONE local knowledge base per agent (holds agent-specific resources)
 * - MongoDB stores metadata mapping resources to KBs
 * - Agents reference their KB IDs (global + local if applicable)
 */
class KnowledgeBaseController {

  /**
   * Error handler
   */
  static async handleError(error, req, operationId, operation, startTime) {
    const duration = Date.now() - startTime;
    
    Logger.error(`${operation} failed`, {
      operationId,
      error: error.message,
      stack: error.stack,
      duration: `${duration}ms`
    });

    let statusCode = 500;
    let message = error.message;
    let code = 'INTERNAL_SERVER_ERROR';

    if (error.message.includes('not found')) {
      statusCode = 404;
      code = 'NOT_FOUND';
    } else if (error.message.includes('already exists')) {
      statusCode = 409;
      code = 'ALREADY_EXISTS';
    } else if (error.message.includes('invalid') || error.message.includes('required')) {
      statusCode = 400;
      code = 'BAD_REQUEST';
    }

    return {
      statusCode,
      response: {
        success: false,
        message,
        code,
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      }
    };
  }

  /**
   * Get or create global knowledge base for a subaccount
   * @param {Object} initialSources - Optional initial sources to add when creating KB
   * @returns {Promise<Object>} Returns { kb: mongoDoc, kbResponse: retellResponse }
   */
  static async getOrCreateGlobalKB(subaccountId, userId, retell, connection, initialSources = null) {
    const kbCollection = connection.db.collection('knowledge_bases');
    
    // Check if global KB exists
    let globalKB = await kbCollection.findOne({
      subaccountId: subaccountId,
      type: SCOPE_TYPES.GLOBAL,
      agentId: null
    });

    if (!globalKB) {
      // Create new global KB on Retell with optional initial sources
      // Use shortened subaccount ID to avoid name length limits
      const shortSubaccountId = subaccountId.slice(-8);
      const kbConfig = {
        knowledge_base_name: `Global-${shortSubaccountId}`
      };
      
      // Only add source arrays if they exist and have content
      if (initialSources) {
        if (initialSources.knowledge_base_texts && initialSources.knowledge_base_texts.length > 0) {
          kbConfig.knowledge_base_texts = initialSources.knowledge_base_texts;
        }
        if (initialSources.knowledge_base_urls && initialSources.knowledge_base_urls.length > 0) {
          kbConfig.knowledge_base_urls = initialSources.knowledge_base_urls;
        }
        if (initialSources.knowledge_base_files && initialSources.knowledge_base_files.length > 0) {
          kbConfig.knowledge_base_files = initialSources.knowledge_base_files;
        }
        if (initialSources.enable_auto_refresh) {
          kbConfig.enable_auto_refresh = initialSources.enable_auto_refresh;
        }
      }

      const kbResponse = await retell.createKnowledgeBase(kbConfig);

      // If KB was created with sources, wait for it to be ready
      let finalKbResponse = kbResponse;
      if (initialSources && Object.keys(initialSources).length > 0) {
        Logger.info('KB created with sources, waiting for processing to complete', {
          knowledgeBaseId: kbResponse.knowledge_base_id,
          initialStatus: kbResponse.status
        });
        
        try {
          finalKbResponse = await retell.waitForKnowledgeBaseReady(kbResponse.knowledge_base_id);
        } catch (waitError) {
          Logger.warn('KB wait timeout, continuing anyway', {
            knowledgeBaseId: kbResponse.knowledge_base_id,
            error: waitError.message
          });
          // Continue with original response if wait fails/times out
        }
      }

      // Store in MongoDB
      globalKB = {
        _id: new mongoose.Types.ObjectId(),
        subaccountId: subaccountId,
        type: SCOPE_TYPES.GLOBAL,
        agentId: null,
        knowledgeBaseId: finalKbResponse.knowledge_base_id,
        knowledgeBaseName: finalKbResponse.knowledge_base_name,
        resources: [],
        createdAt: new Date(),
        createdBy: userId,
        updatedAt: new Date()
      };

      await kbCollection.insertOne(globalKB);
      
      Logger.info('Global knowledge base created', {
        subaccountId,
        knowledgeBaseId: globalKB.knowledgeBaseId,
        sourcesCreated: finalKbResponse.knowledge_base_sources?.length || 0,
        status: finalKbResponse.status
      });
      
      // Return both MongoDB doc and Retell response
      return { kb: globalKB, kbResponse: finalKbResponse };
    }

    // Existing KB - return without Retell response
    return { kb: globalKB, kbResponse: null };
  }

  /**
   * Get or create local knowledge base for an agent
   * @param {Object} initialSources - Optional initial sources to add when creating KB
   * @returns {Promise<Object>} Returns { kb: mongoDoc, kbResponse: retellResponse }
   */
  static async getOrCreateLocalKB(subaccountId, agentId, userId, retell, connection, initialSources = null) {
    const kbCollection = connection.db.collection('knowledge_bases');
    
    // Check if local KB exists
    let localKB = await kbCollection.findOne({
      subaccountId: subaccountId,
      type: SCOPE_TYPES.LOCAL,
      agentId: agentId
    });

    if (!localKB) {
      // Create new local KB on Retell with optional initial sources
      // Use shortened agent ID to avoid name length limits
      const shortAgentId = agentId.slice(-8);
      const kbConfig = {
        knowledge_base_name: `Local-${shortAgentId}`
      };
      
      // Only add source arrays if they exist and have content
      if (initialSources) {
        if (initialSources.knowledge_base_texts && initialSources.knowledge_base_texts.length > 0) {
          kbConfig.knowledge_base_texts = initialSources.knowledge_base_texts;
        }
        if (initialSources.knowledge_base_urls && initialSources.knowledge_base_urls.length > 0) {
          kbConfig.knowledge_base_urls = initialSources.knowledge_base_urls;
        }
        if (initialSources.knowledge_base_files && initialSources.knowledge_base_files.length > 0) {
          kbConfig.knowledge_base_files = initialSources.knowledge_base_files;
        }
        if (initialSources.enable_auto_refresh) {
          kbConfig.enable_auto_refresh = initialSources.enable_auto_refresh;
        }
      }

      const kbResponse = await retell.createKnowledgeBase(kbConfig);

      // If KB was created with sources, wait for it to be ready
      let finalKbResponse = kbResponse;
      if (initialSources && Object.keys(initialSources).length > 0) {
        Logger.info('KB created with sources, waiting for processing to complete', {
          knowledgeBaseId: kbResponse.knowledge_base_id,
          initialStatus: kbResponse.status
        });
        
        try {
          finalKbResponse = await retell.waitForKnowledgeBaseReady(kbResponse.knowledge_base_id);
        } catch (waitError) {
          Logger.warn('KB wait timeout, continuing anyway', {
            knowledgeBaseId: kbResponse.knowledge_base_id,
            error: waitError.message
          });
          // Continue with original response if wait fails/times out
        }
      }

      // Store in MongoDB
      localKB = {
        _id: new mongoose.Types.ObjectId(),
        subaccountId: subaccountId,
        type: SCOPE_TYPES.LOCAL,
        agentId: agentId,
        knowledgeBaseId: finalKbResponse.knowledge_base_id,
        knowledgeBaseName: finalKbResponse.knowledge_base_name,
        resources: [],
        createdAt: new Date(),
        createdBy: userId,
        updatedAt: new Date()
      };

      await kbCollection.insertOne(localKB);
      
      Logger.info('Local knowledge base created', {
        subaccountId,
        agentId,
        knowledgeBaseId: localKB.knowledgeBaseId,
        sourcesCreated: finalKbResponse.knowledge_base_sources?.length || 0,
        status: finalKbResponse.status
      });
      
      // Return both MongoDB doc and Retell response
      return { kb: localKB, kbResponse: finalKbResponse };
    }

    // Existing KB - return without Retell response
    return { kb: localKB, kbResponse: null };
  }

  /**
   * Update agent's knowledge base IDs in both MongoDB and Retell LLM
   */
  static async updateAgentKBIds(subaccountId, agentId, kbIds, connection, retell, isChatAgent = false) {
    const agentsCollection = connection.db.collection(isChatAgent ? 'chatagents' : 'agents');
    
    // Update MongoDB
    await agentsCollection.updateOne(
      { subaccountId: subaccountId, agentId: agentId },
      { 
        $set: { 
          knowledgeBaseIds: kbIds,
          updatedAt: new Date()
        }
      }
    );

    // Update Retell LLM with KB IDs
    try {
      // Get agent's LLM ID
      const agent = await agentsCollection.findOne({ subaccountId, agentId });
      if (agent && agent.llmId) {
        Logger.info('Updating agent LLM with KB IDs', {
          agentId,
          llmId: agent.llmId,
          kbIds,
          isChatAgent
        });
        
        await retell.updateLLM(agent.llmId, {
          knowledge_base_ids: kbIds
        });
        
        Logger.info('Agent LLM updated with KB IDs successfully', {
          agentId,
          llmId: agent.llmId,
          isChatAgent
        });
      }
    } catch (llmError) {
      // Log but don't fail - KB is still added, LLM update can be retried
      Logger.error('Failed to update Retell LLM with KB IDs', {
        agentId,
        error: llmError.message,
        kbIds,
        isChatAgent
      });
    }
  }

  /**
   * Add a resource (text, URL, or file)
   * POST /api/knowledge-base/:subaccountId/resources
   */
  static async addResource(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    // Track what was created for rollback on failure
    let createdKBId = null;
    let createdSourceId = null;
    let retell = null;
    let kbWasCreated = false;

    try {
      const { subaccountId } = req.params;
      const { type, scope, text, title, url, enableAutoRefresh, agentId } = req.body;
      const userId = req.user.id;
      const file = req.file;

      Logger.info('Adding knowledge base resource', {
        operationId,
        subaccountId,
        userId,
        type,
        scope,
        agentId,
        hasFile: !!file
      });

      // Validate scope and agentId combination
      if (scope === SCOPE_TYPES.LOCAL && !agentId) {
        return res.status(400).json({
          success: false,
          message: 'Agent ID is required for local scope',
          code: 'VALIDATION_ERROR'
        });
      }

      // Validate TEXT type resources - text and title are required
      if (type === RESOURCE_TYPES.TEXT) {
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Text content is required for TEXT type resources',
            code: 'VALIDATION_ERROR'
          });
        }
        if (!title || typeof title !== 'string' || title.trim().length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Title is required for TEXT type resources',
            code: 'VALIDATION_ERROR'
          });
        }
      }

      // Validate URL type resources
      if (type === RESOURCE_TYPES.URL && (!url || typeof url !== 'string' || url.trim().length === 0)) {
        return res.status(400).json({
          success: false,
          message: 'URL is required for URL type resources',
          code: 'VALIDATION_ERROR'
        });
      }

      // Fetch retell account data
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      if (!retellAccountData.isActive) {
        // Clean up uploaded file if exists
        if (file && file.path && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
        return res.status(400).json({
          success: false,
          message: 'Retell account is not active',
          code: 'RETELL_ACCOUNT_INACTIVE'
        });
      }

      // Create Retell instance
      retell = new Retell(retellAccountData.apiKey, retellAccountData);

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Check if KB exists before creating
      const kbCollection = connection.db.collection('knowledge_bases');
      let existingKB;
      if (scope === SCOPE_TYPES.GLOBAL) {
        existingKB = await kbCollection.findOne({
          subaccountId: subaccountId,
          type: SCOPE_TYPES.GLOBAL,
          agentId: null
        });
      } else {
        existingKB = await kbCollection.findOne({
          subaccountId: subaccountId,
          type: SCOPE_TYPES.LOCAL,
          agentId: agentId
        });
      }

      // Prepare source data for Retell (only include the relevant type)
      const sources = {};
      
      if (type === RESOURCE_TYPES.TEXT) {
        sources.knowledge_base_texts = [{ text, title }];
      } else if (type === RESOURCE_TYPES.URL) {
        sources.knowledge_base_urls = [url];
        if (enableAutoRefresh) {
          sources.enable_auto_refresh = true;
        }
      } else if (type === RESOURCE_TYPES.DOCUMENT) {
        // For file uploads, create read stream from disk path
        Logger.info('Creating file stream for upload', { 
          operationId, 
          filePath: file.path,
          fileSize: file.size,
          fileName: file.originalname
        });
        const fileStream = fs.createReadStream(file.path);
        sources.knowledge_base_files = [fileStream];
      }
      
      Logger.debug('Prepared sources for KB', {
        operationId,
        type,
        hasTexts: !!sources.knowledge_base_texts,
        hasUrls: !!sources.knowledge_base_urls,
        hasFiles: !!sources.knowledge_base_files
      });
      
      let kb;
      let updatedKB;

      if (!existingKB) {
        // KB doesn't exist - create it WITH the resource in one call
        kbWasCreated = true;
        
        let result;
        if (scope === SCOPE_TYPES.GLOBAL) {
          result = await KnowledgeBaseController.getOrCreateGlobalKB(subaccountId, userId, retell, connection, sources);
        } else {
          // Verify agent exists (check both regular agents and chat agents)
          const agentsCollection = connection.db.collection('agents');
          const chatAgentsCollection = connection.db.collection('chatagents');
          
          const agent = await agentsCollection.findOne({ subaccountId, agentId });
          const chatAgent = await chatAgentsCollection.findOne({ subaccountId, agentId });
          
          if (!agent && !chatAgent) {
            // Clean up uploaded file if exists
            if (file && file.path && fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
            return res.status(404).json({
              success: false,
              message: 'Agent not found',
              code: 'AGENT_NOT_FOUND'
            });
          }
          result = await KnowledgeBaseController.getOrCreateLocalKB(subaccountId, agentId, userId, retell, connection, sources);
        }
        
        kb = result.kb;
        createdKBId = kb.knowledgeBaseId;
        
        // Use the KB response from creation (already has sources)
        if (result.kbResponse) {
          updatedKB = result.kbResponse;
          Logger.info('Using KB response from creation', {
            operationId,
            knowledgeBaseId: kb.knowledgeBaseId,
            sourcesCreated: updatedKB.knowledge_base_sources?.length || 0
          });
        } else {
          // Fetch the KB details if not created (existing KB case)
          Logger.info('Fetching existing KB details', { 
            operationId, 
            knowledgeBaseId: kb.knowledgeBaseId 
          });
          updatedKB = await retell.getKnowledgeBase(kb.knowledgeBaseId);
        }
      } else {
        // KB exists - add source to existing KB
        kb = existingKB;
        
        if (scope === SCOPE_TYPES.LOCAL) {
          // Verify agent exists (check both regular agents and chat agents)
          const agentsCollection = connection.db.collection('agents');
          const chatAgentsCollection = connection.db.collection('chatagents');
          
          const agent = await agentsCollection.findOne({ subaccountId, agentId });
          const chatAgent = await chatAgentsCollection.findOne({ subaccountId, agentId });
          
          if (!agent && !chatAgent) {
            // Clean up uploaded file if exists
            if (file && file.path && fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
            return res.status(404).json({
              success: false,
              message: 'Agent not found',
              code: 'AGENT_NOT_FOUND'
            });
          }
        }
        
        Logger.info('Adding source to existing Retell KB', { operationId, kbId: kb.knowledgeBaseId });
        updatedKB = await retell.addKnowledgeBaseSources(kb.knowledgeBaseId, sources);
      }

      // Get the newly added source from response
      if (!updatedKB || !updatedKB.knowledge_base_sources || updatedKB.knowledge_base_sources.length === 0) {
        throw new Error('Failed to retrieve knowledge base sources after creation/update');
      }

      // Find the newly added source by matching type and checking if it's not already in MongoDB
      const existingSourceIds = new Set(kb.resources?.map(r => r.sourceId) || []);
      const newSource = updatedKB.knowledge_base_sources.find(source => 
        !existingSourceIds.has(source.source_id) && source.type === type
      ) || updatedKB.knowledge_base_sources[updatedKB.knowledge_base_sources.length - 1]; // Fallback to last

      createdSourceId = newSource.source_id; // Track for cleanup

      Logger.info('Source added to Retell successfully', { 
        operationId, 
        sourceId: createdSourceId,
        sourceType: newSource.type,
        totalSources: updatedKB.knowledge_base_sources.length,
        hasFileUrl: !!newSource.file_url,
        fileUrl: newSource.file_url
      });

      // For documents, if file_url is missing, wait a bit and fetch again
      if (type === RESOURCE_TYPES.DOCUMENT && !newSource.file_url) {
        Logger.warn('File URL not yet available, waiting and fetching again', { 
          operationId, 
          sourceId: newSource.source_id 
        });
        
        // Wait 2 seconds for file processing
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Fetch KB again to get file_url
        const refreshedKB = await retell.getKnowledgeBase(kb.knowledgeBaseId);
        const refreshedSource = refreshedKB.knowledge_base_sources.find(s => s.source_id === newSource.source_id);
        
        if (refreshedSource && refreshedSource.file_url) {
          newSource.file_url = refreshedSource.file_url;
          Logger.info('File URL retrieved after refresh', { 
            operationId, 
            fileUrl: newSource.file_url 
          });
        } else {
          Logger.warn('File URL still not available after refresh', { operationId });
        }
      }

      // Generate smart title if not provided
      let resourceTitle = title;
      const openai = getOpenAIHelper();

      if (!resourceTitle) {
        Logger.info('Generating smart title with OpenAI', { operationId, type });
        try {
          if (type === RESOURCE_TYPES.TEXT) {
            resourceTitle = await openai.generateTextTitle(text);
          } else if (type === RESOURCE_TYPES.URL) {
            resourceTitle = await openai.generateURLTitle(url);
          } else if (type === RESOURCE_TYPES.DOCUMENT) {
            resourceTitle = await openai.generateDocumentTitle(file.originalname, file.size);
          }
          Logger.info('Smart title generated', { operationId, generatedTitle: resourceTitle });
        } catch (titleError) {
          Logger.warn('Failed to generate smart title, using fallback', { 
            operationId, 
            error: titleError.message 
          });
          // Fallback titles
          if (type === RESOURCE_TYPES.TEXT) {
            resourceTitle = text.substring(0, 50).trim() || 'Text Content';
          } else if (type === RESOURCE_TYPES.URL) {
            resourceTitle = new URL(url).hostname.replace('www.', '').substring(0, 50);
          } else if (type === RESOURCE_TYPES.DOCUMENT) {
            resourceTitle = file.originalname.replace(/\.[^/.]+$/, '').substring(0, 50);
          }
        }
      }

      // Create resource metadata based on source type
      const resourceId = uuidv4();
      const resource = {
        resourceId,
        type,
        sourceId: newSource.source_id,
        title: resourceTitle,
        text: type === RESOURCE_TYPES.TEXT ? text : undefined,
        url: type === RESOURCE_TYPES.URL ? (url || newSource.url) : undefined,
        filename: type === RESOURCE_TYPES.DOCUMENT ? (newSource.filename || file?.originalname) : undefined,
        fileUrl: type === RESOURCE_TYPES.DOCUMENT ? newSource.file_url : undefined,
        fileSize: type === RESOURCE_TYPES.DOCUMENT ? file?.size : undefined, // Store file size in bytes
        enableAutoRefresh: type === RESOURCE_TYPES.URL ? enableAutoRefresh : undefined,
        createdAt: new Date(),
        createdBy: userId
      };

      // Update KB in MongoDB
      await kbCollection.updateOne(
        { _id: kb._id },
        {
          $push: { resources: resource },
          $set: { updatedAt: new Date() }
        }
      );

      Logger.info('Resource metadata saved to MongoDB', { operationId, resourceId });

      // If this is for a specific agent, update agent's KB IDs
      if (scope === SCOPE_TYPES.LOCAL) {
        const globalResult = await KnowledgeBaseController.getOrCreateGlobalKB(subaccountId, userId, retell, connection);
        const kbIds = [globalResult.kb.knowledgeBaseId, kb.knowledgeBaseId];
        
        // Determine if this is a chat agent or regular agent
        const agentsCollection = connection.db.collection('agents');
        const chatAgentsCollection = connection.db.collection('chatagents');
        const agent = await agentsCollection.findOne({ subaccountId, agentId });
        const chatAgent = await chatAgentsCollection.findOne({ subaccountId, agentId });
        const isChatAgent = !!chatAgent && !agent;
        
        await KnowledgeBaseController.updateAgentKBIds(subaccountId, agentId, kbIds, connection, retell, isChatAgent);
        
        // Invalidate agent cache
        await redisService.invalidateAgentDetails(subaccountId, agentId);
      } else {
        // Update all agents (both regular and chat agents) with global KB ID
        const agentsCollection = connection.db.collection('agents');
        const chatAgentsCollection = connection.db.collection('chatagents');
        
        const agents = await agentsCollection.find({ subaccountId }).toArray();
        const chatAgents = await chatAgentsCollection.find({ subaccountId }).toArray();
        
        // Update regular agents
        for (const agent of agents) {
          const existingKBIds = agent.knowledgeBaseIds || [];
          if (!existingKBIds.includes(kb.knowledgeBaseId)) {
            existingKBIds.unshift(kb.knowledgeBaseId); // Add global KB at start
            await KnowledgeBaseController.updateAgentKBIds(subaccountId, agent.agentId, existingKBIds, connection, retell, false);
            await redisService.invalidateAgentDetails(subaccountId, agent.agentId);
          }
        }
        
        // Update chat agents
        for (const chatAgent of chatAgents) {
          const existingKBIds = chatAgent.knowledgeBaseIds || [];
          if (!existingKBIds.includes(kb.knowledgeBaseId)) {
            existingKBIds.unshift(kb.knowledgeBaseId); // Add global KB at start
            await KnowledgeBaseController.updateAgentKBIds(subaccountId, chatAgent.agentId, existingKBIds, connection, retell, true);
            await redisService.invalidateAgentDetails(subaccountId, chatAgent.agentId);
          }
        }
      }

      // Invalidate KB cache
      await redisService.invalidateKnowledgeBase(subaccountId, scope, scope === SCOPE_TYPES.LOCAL ? agentId : null);

      // Clean up uploaded file after successful processing
      if (file && file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
        Logger.info('Uploaded file cleaned up', { operationId, filePath: file.path });
      }

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.AGENT_UPDATED,
        category: ACTIVITY_CATEGORIES.AGENT,
        userId,
        description: `Knowledge base resource added (${type}, ${scope})`,
        metadata: {
          resourceId,
          type,
          scope,
          agentId: scope === SCOPE_TYPES.LOCAL ? agentId : null,
          knowledgeBaseId: kb.knowledgeBaseId
        },
        operationId
      });

      const duration = Date.now() - startTime;

      Logger.info('Knowledge base resource added successfully', {
        operationId,
        resourceId,
        knowledgeBaseId: kb.knowledgeBaseId,
        duration: `${duration}ms`
      });

      res.status(201).json({
        success: true,
        message: 'Resource added successfully',
        data: {
          resourceId,
          knowledgeBaseId: kb.knowledgeBaseId,
          type,
          scope,
          resource: {
            ...resource,
            text: undefined, // Don't return full text in response
            url: type === RESOURCE_TYPES.URL ? url : undefined,
            title,
            filename: resource.filename
          }
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      // CLEANUP ON FAILURE
      Logger.error('Error adding resource, initiating cleanup', {
        operationId,
        error: error.message,
        createdSourceId,
        createdKBId,
        kbWasCreated
      });

      // Clean up uploaded file
      const file = req.file;
      if (file && file.path && fs.existsSync(file.path)) {
        try {
          fs.unlinkSync(file.path);
          Logger.info('Cleanup: Uploaded file deleted', { operationId, filePath: file.path });
        } catch (cleanupError) {
          Logger.error('Cleanup failed: Could not delete uploaded file', {
            operationId,
            cleanupError: cleanupError.message,
            filePath: file.path
          });
        }
      }

      // Attempt to delete the created source from Retell if it was created
      if (retell && createdSourceId && createdKBId) {
        try {
          Logger.info('Cleaning up: Deleting source from Retell', { 
            operationId, 
            sourceId: createdSourceId,
            kbId: createdKBId 
          });
          await retell.deleteKnowledgeBaseSource(createdKBId, createdSourceId);
          Logger.info('Cleanup successful: Source deleted from Retell', { operationId });
        } catch (cleanupError) {
          Logger.error('Cleanup failed: Could not delete source from Retell', {
            operationId,
            cleanupError: cleanupError.message,
            sourceId: createdSourceId
          });
        }
      }

      // If KB was just created and has no resources now, delete it
      if (retell && kbWasCreated && createdKBId) {
        try {
          Logger.info('Cleaning up: Deleting newly created KB', { 
            operationId, 
            kbId: createdKBId 
          });
          
          // Get connection to delete from MongoDB
          const { subaccountId } = req.params;
          const userId = req.user.id;
          const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
          const { connection } = connectionInfo;
          const kbCollection = connection.db.collection('knowledge_bases');
          
          // Delete from MongoDB
          await kbCollection.deleteOne({ knowledgeBaseId: createdKBId });
          
          // Delete from Retell
          await retell.deleteKnowledgeBase(createdKBId);
          
          Logger.info('Cleanup successful: Empty KB deleted', { operationId });
        } catch (cleanupError) {
          Logger.error('Cleanup failed: Could not delete KB', {
            operationId,
            cleanupError: cleanupError.message,
            kbId: createdKBId
          });
        }
      }

      const errorInfo = await KnowledgeBaseController.handleError(error, req, operationId, 'addResource', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Get global knowledge base
   * GET /api/knowledge-base/:subaccountId/global
   */
  static async getGlobalKB(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;

      Logger.info('Fetching global knowledge base', {
        operationId,
        subaccountId,
        userId
      });

      // Check cache
      try {
        const cachedKB = await redisService.getCachedKnowledgeBase(subaccountId, SCOPE_TYPES.GLOBAL);
        if (cachedKB) {
          const duration = Date.now() - startTime;
          return res.json({
            success: true,
            message: 'Global knowledge base fetched successfully',
            data: cachedKB,
            meta: { operationId, duration: `${duration}ms`, cached: true }
          });
        }
      } catch (cacheError) {
        Logger.warn('Cache fetch failed', { operationId, error: cacheError.message });
      }

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Fetch global KB
      const kbCollection = connection.db.collection('knowledge_bases');
      const globalKB = await kbCollection.findOne({
        subaccountId: subaccountId,
        type: SCOPE_TYPES.GLOBAL,
        agentId: null
      });

      // If no KB exists yet, return empty structure
      const kbData = globalKB ? {
        knowledgeBaseId: globalKB.knowledgeBaseId,
        knowledgeBaseName: globalKB.knowledgeBaseName,
        type: globalKB.type,
        resources: globalKB.resources || [],
        resourceCount: (globalKB.resources || []).length,
        createdAt: globalKB.createdAt,
        updatedAt: globalKB.updatedAt
      } : {
        knowledgeBaseId: null,
        knowledgeBaseName: null,
        type: SCOPE_TYPES.GLOBAL,
        resources: [],
        resourceCount: 0,
        createdAt: null,
        updatedAt: null
      };

      // Cache the result
      try {
        await redisService.cacheKnowledgeBase(subaccountId, SCOPE_TYPES.GLOBAL, null, kbData);
      } catch (cacheError) {
        Logger.warn('Cache write failed', { operationId, error: cacheError.message });
      }

      const duration = Date.now() - startTime;

      Logger.info('Global knowledge base fetched successfully', {
        operationId,
        resourceCount: kbData.resourceCount,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Global knowledge base fetched successfully',
        data: kbData,
        meta: { operationId, duration: `${duration}ms`, cached: false }
      });

    } catch (error) {
      const errorInfo = await KnowledgeBaseController.handleError(error, req, operationId, 'getGlobalKB', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Get local knowledge base for an agent
   * GET /api/knowledge-base/:subaccountId/agents/:agentId/local
   */
  static async getLocalKB(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;

      Logger.info('Fetching local knowledge base', {
        operationId,
        subaccountId,
        agentId,
        userId
      });

      // Check cache
      try {
        const cachedKB = await redisService.getCachedKnowledgeBase(subaccountId, SCOPE_TYPES.LOCAL, agentId);
        if (cachedKB) {
          const duration = Date.now() - startTime;
          return res.json({
            success: true,
            message: 'Local knowledge base fetched successfully',
            data: cachedKB,
            meta: { operationId, duration: `${duration}ms`, cached: true }
          });
        }
      } catch (cacheError) {
        Logger.warn('Cache fetch failed', { operationId, error: cacheError.message });
      }

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Verify agent exists
      const agentsCollection = connection.db.collection('agents');
      const agent = await agentsCollection.findOne({ subaccountId, agentId });
      if (!agent) {
        return res.status(404).json({
          success: false,
          message: 'Agent not found',
          code: 'AGENT_NOT_FOUND'
        });
      }

      // Fetch local KB
      const kbCollection = connection.db.collection('knowledge_bases');
      const localKB = await kbCollection.findOne({
        subaccountId: subaccountId,
        type: SCOPE_TYPES.LOCAL,
        agentId: agentId
      });

      // If no KB exists yet, return empty structure
      const kbData = localKB ? {
        knowledgeBaseId: localKB.knowledgeBaseId,
        knowledgeBaseName: localKB.knowledgeBaseName,
        type: localKB.type,
        agentId: localKB.agentId,
        resources: localKB.resources || [],
        resourceCount: (localKB.resources || []).length,
        createdAt: localKB.createdAt,
        updatedAt: localKB.updatedAt
      } : {
        knowledgeBaseId: null,
        knowledgeBaseName: null,
        type: SCOPE_TYPES.LOCAL,
        agentId: agentId,
        resources: [],
        resourceCount: 0,
        createdAt: null,
        updatedAt: null
      };

      // Cache the result
      try {
        await redisService.cacheKnowledgeBase(subaccountId, SCOPE_TYPES.LOCAL, agentId, kbData);
      } catch (cacheError) {
        Logger.warn('Cache write failed', { operationId, error: cacheError.message });
      }

      const duration = Date.now() - startTime;

      Logger.info('Local knowledge base fetched successfully', {
        operationId,
        agentId,
        resourceCount: kbData.resourceCount,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Local knowledge base fetched successfully',
        data: kbData,
        meta: { operationId, duration: `${duration}ms`, cached: false }
      });

    } catch (error) {
      const errorInfo = await KnowledgeBaseController.handleError(error, req, operationId, 'getLocalKB', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * List all knowledge bases for a subaccount (global + all local)
   * GET /api/knowledge-base/:subaccountId
   */
  static async listKnowledgeBases(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;

      Logger.info('Listing knowledge bases', {
        operationId,
        subaccountId,
        userId
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Fetch all KBs
      const kbCollection = connection.db.collection('knowledge_bases');
      const kbs = await kbCollection.find({ subaccountId: subaccountId }).toArray();

      const kbList = kbs.map(kb => ({
        knowledgeBaseId: kb.knowledgeBaseId,
        knowledgeBaseName: kb.knowledgeBaseName,
        type: kb.type,
        agentId: kb.agentId,
        resourceCount: (kb.resources || []).length,
        createdAt: kb.createdAt,
        updatedAt: kb.updatedAt
      }));

      const duration = Date.now() - startTime;

      Logger.info('Knowledge bases listed successfully', {
        operationId,
        count: kbList.length,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Knowledge bases fetched successfully',
        data: {
          knowledgeBases: kbList,
          count: kbList.length
        },
        meta: { operationId, duration: `${duration}ms` }
      });

    } catch (error) {
      const errorInfo = await KnowledgeBaseController.handleError(error, req, operationId, 'listKnowledgeBases', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Delete a resource
   * DELETE /api/knowledge-base/:subaccountId/resources/:resourceId
   */
  static async deleteResource(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, resourceId } = req.params;
      const userId = req.user.id;

      Logger.info('Deleting knowledge base resource', {
        operationId,
        subaccountId,
        resourceId,
        userId
      });

      // Fetch retell account data
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      if (!retellAccountData.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Retell account is not active',
          code: 'RETELL_ACCOUNT_INACTIVE'
        });
      }

      // Create Retell instance
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Find the KB containing this resource
      const kbCollection = connection.db.collection('knowledge_bases');
      const kb = await kbCollection.findOne({
        subaccountId: subaccountId,
        'resources.resourceId': resourceId
      });

      if (!kb) {
        return res.status(404).json({
          success: false,
          message: 'Resource not found',
          code: 'RESOURCE_NOT_FOUND'
        });
      }

      // Find the specific resource
      const resource = kb.resources.find(r => r.resourceId === resourceId);
      if (!resource) {
        return res.status(404).json({
          success: false,
          message: 'Resource not found',
          code: 'RESOURCE_NOT_FOUND'
        });
      }

      // Get actual KB from Retell to check source count (source of truth)
      const retellKB = await retell.getKnowledgeBase(kb.knowledgeBaseId);
      const actualSourceCount = retellKB.knowledge_base_sources?.length || 0;
      const isLastResource = actualSourceCount === 1;

      Logger.info('Checking resource count before deletion', {
        operationId,
        mongoResourceCount: kb.resources.length,
        retellSourceCount: actualSourceCount,
        isLastResource
      });

      if (isLastResource) {
        // Retell doesn't allow deleting the last source - must delete entire KB
        Logger.info('Deleting last resource - will delete entire KB', {
          operationId,
          knowledgeBaseId: kb.knowledgeBaseId,
          sourceCount: actualSourceCount
        });

        // Delete the entire KB from Retell
        await retell.deleteKnowledgeBase(kb.knowledgeBaseId);

        // Delete KB from MongoDB
        await kbCollection.deleteOne({ _id: kb._id });

        // Remove KB ID from all agents
        const agentsCollection = connection.db.collection('agents');
        if (kb.type === SCOPE_TYPES.LOCAL) {
          // Remove local KB ID from specific agent
          await agentsCollection.updateOne(
            { subaccountId, agentId: kb.agentId },
            { $pull: { knowledgeBaseIds: kb.knowledgeBaseId } }
          );
        } else {
          // Remove global KB ID from all agents in subaccount
          await agentsCollection.updateMany(
            { subaccountId },
            { $pull: { knowledgeBaseIds: kb.knowledgeBaseId } }
          );
        }

        Logger.info('Knowledge base deleted (was last resource)', {
          operationId,
          knowledgeBaseId: kb.knowledgeBaseId
        });
      } else {
        // Delete single source from Retell KB
        await retell.deleteKnowledgeBaseSource(kb.knowledgeBaseId, resource.sourceId);

        // Remove resource from MongoDB
        await kbCollection.updateOne(
          { _id: kb._id },
          {
            $pull: { resources: { resourceId: resourceId } },
            $set: { updatedAt: new Date() }
          }
        );

        Logger.info('Resource deleted from KB', {
          operationId,
          knowledgeBaseId: kb.knowledgeBaseId,
          remainingResources: kb.resources.length - 1
        });
      }

      // Invalidate cache
      await redisService.invalidateKnowledgeBase(subaccountId, kb.type, kb.agentId);

      // Invalidate agent caches if needed
      if (kb.type === SCOPE_TYPES.LOCAL) {
        await redisService.invalidateAgentDetails(subaccountId, kb.agentId);
      } else {
        // Invalidate all agent caches for global KB changes
        const agentsCollection = connection.db.collection('agents');
        const agents = await agentsCollection.find({ subaccountId }).toArray();
        for (const agent of agents) {
          await redisService.invalidateAgentDetails(subaccountId, agent.agentId);
        }
      }

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.AGENT_UPDATED,
        category: ACTIVITY_CATEGORIES.AGENT,
        userId,
        description: isLastResource 
          ? `Knowledge base deleted (last resource removed, ${resource.type}, ${kb.type})`
          : `Knowledge base resource deleted (${resource.type}, ${kb.type})`,
        metadata: {
          resourceId,
          type: resource.type,
          scope: kb.type,
          agentId: kb.agentId,
          knowledgeBaseId: kb.knowledgeBaseId,
          wasLastResource: isLastResource,
          kbDeleted: isLastResource
        },
        operationId
      });

      const duration = Date.now() - startTime;

      Logger.info('Knowledge base resource deleted successfully', {
        operationId,
        resourceId,
        knowledgeBaseId: kb.knowledgeBaseId,
        wasLastResource: isLastResource,
        kbDeleted: isLastResource,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: isLastResource 
          ? 'Resource deleted successfully (knowledge base removed as it was the last resource)'
          : 'Resource deleted successfully',
        data: {
          resourceId,
          knowledgeBaseId: kb.knowledgeBaseId,
          knowledgeBaseDeleted: isLastResource
        },
        meta: { operationId, duration: `${duration}ms` }
      });

    } catch (error) {
      const errorInfo = await KnowledgeBaseController.handleError(error, req, operationId, 'deleteResource', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Change resource scope (local <-> global)
   * PATCH /api/knowledge-base/:subaccountId/resources/:resourceId/scope
   * 
   * NOTE: This endpoint should be DISABLED in the frontend.
   * "Move to Local" and "Move to Global" buttons should be removed from the UI.
   * Keeping the backend implementation for potential future use.
   */
  static async updateResourceScope(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, resourceId } = req.params;
      const { scope, agentId } = req.body;
      const userId = req.user.id;

      Logger.info('Updating resource scope', {
        operationId,
        subaccountId,
        resourceId,
        newScope: scope,
        agentId,
        userId
      });

      // Fetch retell account data
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      if (!retellAccountData.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Retell account is not active',
          code: 'RETELL_ACCOUNT_INACTIVE'
        });
      }

      // Create Retell instance
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Find the KB containing this resource
      const kbCollection = connection.db.collection('knowledge_bases');
      const sourceKB = await kbCollection.findOne({
        subaccountId: subaccountId,
        'resources.resourceId': resourceId
      });

      if (!sourceKB) {
        return res.status(404).json({
          success: false,
          message: 'Resource not found',
          code: 'RESOURCE_NOT_FOUND'
        });
      }

      // Find the specific resource
      const resource = sourceKB.resources.find(r => r.resourceId === resourceId);
      
      // Check if scope is already the same
      if (sourceKB.type === scope) {
        return res.status(400).json({
          success: false,
          message: `Resource is already in ${scope} scope`,
          code: 'INVALID_SCOPE_CHANGE'
        });
      }

      // Get or create target KB
      let targetKB;
      if (scope === SCOPE_TYPES.GLOBAL) {
        const result = await KnowledgeBaseController.getOrCreateGlobalKB(subaccountId, userId, retell, connection);
        targetKB = result.kb;
      } else {
        // Verify agent exists (check both regular agents and chat agents)
        const agentsCollection = connection.db.collection('agents');
        const chatAgentsCollection = connection.db.collection('chatagents');
        
        const agent = await agentsCollection.findOne({ subaccountId, agentId });
        const chatAgent = await chatAgentsCollection.findOne({ subaccountId, agentId });
        
        if (!agent && !chatAgent) {
          return res.status(404).json({
            success: false,
            message: 'Agent not found',
            code: 'AGENT_NOT_FOUND'
          });
        }
        const result = await KnowledgeBaseController.getOrCreateLocalKB(subaccountId, agentId, userId, retell, connection);
        targetKB = result.kb;
      }

      // Delete source from old KB on Retell
      await retell.deleteKnowledgeBaseSource(sourceKB.knowledgeBaseId, resource.sourceId);

      // Add source to new KB on Retell
      const sources = {};
      if (resource.type === RESOURCE_TYPES.TEXT) {
        sources.knowledge_base_texts = [{ text: resource.text, title: resource.title }];
      } else if (resource.type === RESOURCE_TYPES.URL) {
        sources.knowledge_base_urls = [resource.url];
        if (resource.enableAutoRefresh) {
          sources.enable_auto_refresh = true;
        }
      }
      // Note: Document type cannot be moved as we don't have the file anymore

      if (resource.type === RESOURCE_TYPES.DOCUMENT) {
        return res.status(400).json({
          success: false,
          message: 'Document resources cannot be moved between scopes',
          code: 'UNSUPPORTED_OPERATION'
        });
      }

      const updatedKB = await retell.addKnowledgeBaseSources(targetKB.knowledgeBaseId, sources);
      const newSource = updatedKB.knowledge_base_sources[updatedKB.knowledge_base_sources.length - 1];

      // Update resource with new sourceId
      const updatedResource = {
        ...resource,
        sourceId: newSource.source_id
      };

      // Remove from source KB in MongoDB
      await kbCollection.updateOne(
        { _id: sourceKB._id },
        {
          $pull: { resources: { resourceId: resourceId } },
          $set: { updatedAt: new Date() }
        }
      );

      // Add to target KB in MongoDB
      await kbCollection.updateOne(
        { _id: targetKB._id },
        {
          $push: { resources: updatedResource },
          $set: { updatedAt: new Date() }
        }
      );

      // Update agent KB IDs as needed
      const agentsCollection = connection.db.collection('agents');
      const chatAgentsCollection = connection.db.collection('chatagents');
      
      if (scope === SCOPE_TYPES.LOCAL) {
        // Add local KB to specific agent
        const globalResult = await KnowledgeBaseController.getOrCreateGlobalKB(subaccountId, userId, retell, connection);
        
        // Determine if this is a chat agent or regular agent
        const agent = await agentsCollection.findOne({ subaccountId, agentId });
        const chatAgent = await chatAgentsCollection.findOne({ subaccountId, agentId });
        const isChatAgent = !!chatAgent && !agent;
        
        await KnowledgeBaseController.updateAgentKBIds(subaccountId, agentId, [globalResult.kb.knowledgeBaseId, targetKB.knowledgeBaseId], connection, retell, isChatAgent);
        await redisService.invalidateAgentDetails(subaccountId, agentId);
      } else {
        // Update all agents (both regular and chat agents) with global KB
        const agents = await agentsCollection.find({ subaccountId }).toArray();
        const chatAgents = await chatAgentsCollection.find({ subaccountId }).toArray();
        
        // Update regular agents
        for (const agent of agents) {
          const existingKBIds = agent.knowledgeBaseIds || [];
          if (!existingKBIds.includes(targetKB.knowledgeBaseId)) {
            existingKBIds.unshift(targetKB.knowledgeBaseId);
            await KnowledgeBaseController.updateAgentKBIds(subaccountId, agent.agentId, existingKBIds, connection, retell, false);
          }
          await redisService.invalidateAgentDetails(subaccountId, agent.agentId);
        }
        
        // Update chat agents
        for (const chatAgent of chatAgents) {
          const existingKBIds = chatAgent.knowledgeBaseIds || [];
          if (!existingKBIds.includes(targetKB.knowledgeBaseId)) {
            existingKBIds.unshift(targetKB.knowledgeBaseId);
            await KnowledgeBaseController.updateAgentKBIds(subaccountId, chatAgent.agentId, existingKBIds, connection, retell, true);
          }
          await redisService.invalidateAgentDetails(subaccountId, chatAgent.agentId);
        }
      }

      // Invalidate both KB caches
      await redisService.invalidateKnowledgeBase(subaccountId, sourceKB.type, sourceKB.agentId);
      await redisService.invalidateKnowledgeBase(subaccountId, targetKB.type, targetKB.agentId);

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.AGENT_UPDATED,
        category: ACTIVITY_CATEGORIES.AGENT,
        userId,
        description: `Resource scope changed from ${sourceKB.type} to ${scope}`,
        metadata: {
          resourceId,
          oldScope: sourceKB.type,
          newScope: scope,
          oldKBId: sourceKB.knowledgeBaseId,
          newKBId: targetKB.knowledgeBaseId,
          agentId: scope === SCOPE_TYPES.LOCAL ? agentId : null
        },
        operationId
      });

      const duration = Date.now() - startTime;

      Logger.info('Resource scope updated successfully', {
        operationId,
        resourceId,
        oldScope: sourceKB.type,
        newScope: scope,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Resource scope updated successfully',
        data: {
          resourceId,
          oldScope: sourceKB.type,
          newScope: scope,
          oldKnowledgeBaseId: sourceKB.knowledgeBaseId,
          newKnowledgeBaseId: targetKB.knowledgeBaseId
        },
        meta: { operationId, duration: `${duration}ms` }
      });

    } catch (error) {
      const errorInfo = await KnowledgeBaseController.handleError(error, req, operationId, 'updateResourceScope', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Get local knowledge base for a chat agent
  static async getChatAgentLocalKB(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;

      Logger.info('Fetching local knowledge base for chat agent', {
        operationId,
        subaccountId,
        agentId,
        userId
      });

      // Check cache
      try {
        const cachedKB = await redisService.getCachedKnowledgeBase(subaccountId, SCOPE_TYPES.LOCAL, agentId);
        if (cachedKB) {
          const duration = Date.now() - startTime;
          return res.json({
            success: true,
            message: 'Local knowledge base fetched successfully',
            data: cachedKB,
            meta: { operationId, duration: `${duration}ms`, cached: true }
          });
        }
      } catch (cacheError) {
        Logger.warn('Cache fetch failed', { operationId, error: cacheError.message });
      }

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Verify chat agent exists
      const chatAgentsCollection = connection.db.collection('chatagents');
      const agent = await chatAgentsCollection.findOne({ subaccountId, agentId });
      if (!agent) {
        return res.status(404).json({
          success: false,
          message: 'Chat agent not found',
          code: 'CHAT_AGENT_NOT_FOUND'
        });
      }

      // Fetch local KB
      const kbCollection = connection.db.collection('knowledge_bases');
      const localKB = await kbCollection.findOne({
        subaccountId: subaccountId,
        type: SCOPE_TYPES.LOCAL,
        agentId: agentId
      });

      // If no KB exists yet, return empty structure
      const kbData = localKB ? {
        knowledgeBaseId: localKB.knowledgeBaseId,
        knowledgeBaseName: localKB.knowledgeBaseName,
        type: localKB.type,
        agentId: localKB.agentId,
        resources: localKB.resources || [],
        resourceCount: (localKB.resources || []).length,
        createdAt: localKB.createdAt,
        updatedAt: localKB.updatedAt
      } : {
        knowledgeBaseId: null,
        knowledgeBaseName: null,
        type: SCOPE_TYPES.LOCAL,
        agentId: agentId,
        resources: [],
        resourceCount: 0,
        createdAt: null,
        updatedAt: null
      };

      // Cache the result
      try {
        await redisService.cacheKnowledgeBase(subaccountId, SCOPE_TYPES.LOCAL, agentId, kbData);
      } catch (cacheError) {
        Logger.warn('Cache write failed', { operationId, error: cacheError.message });
      }

      const duration = Date.now() - startTime;

      Logger.info('Local knowledge base fetched successfully for chat agent', {
        operationId,
        agentId,
        resourceCount: kbData.resourceCount,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Local knowledge base fetched successfully',
        data: kbData,
        meta: { operationId, duration: `${duration}ms`, cached: false }
      });

    } catch (error) {
      const errorInfo = await KnowledgeBaseController.handleError(error, req, operationId, 'getChatAgentLocalKB', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }
}

module.exports = KnowledgeBaseController;

