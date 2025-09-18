const tenantService = require('../services/tenantService');
const Logger = require('../utils/logger');

// Get user's available subaccounts
const getUserSubaccounts = async (req, res, next) => {
  try {
    const accessToken = req.headers['authorization']?.split(' ')[1];
    
    if (!accessToken) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const result = await tenantService.getUserSubaccounts(accessToken);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error
      });
    }

    Logger.info('User subaccounts retrieved', {
      userId: req.user?.id,
      subaccountCount: result.data.subaccounts?.length || 0
    });

    res.json({
      success: true,
      message: 'Subaccounts retrieved successfully',
      data: result.data
    });

  } catch (error) {
    Logger.error('Error retrieving user subaccounts', {
      userId: req.user?.id,
      error: error.message
    });
    next(error);
  }
};

// Execute LLM query with database context
const executeLLMQuery = async (req, res, next) => {
  try {
    const { subaccountId, prompt, model, maxTokens, temperature, databaseContext } = req.body;
    const accessToken = req.headers['authorization']?.split(' ')[1];
    
    if (!accessToken) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    // Validate access to subaccount
    const accessValidation = await tenantService.validateAccess(accessToken, subaccountId, 'read');
    if (!accessValidation.success || !accessValidation.hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to subaccount'
      });
    }

    let contextData = null;
    
    // If database context is requested, fetch relevant data
    if (databaseContext && databaseContext.enabled) {
      const { collection, query, limit } = databaseContext;
      
      const dbResult = await tenantService.executeQuery(accessToken, subaccountId, {
        operation: 'find',
        collection,
        query: query || {},
        options: { limit: limit || 10 }
      });

      if (dbResult.success) {
        contextData = dbResult.data.result;
      } else {
        Logger.warn('Failed to fetch database context', {
          subaccountId,
          collection,
          error: dbResult.error
        });
      }
    }

    // Prepare LLM prompt with context
    let enhancedPrompt = prompt;
    if (contextData && contextData.length > 0) {
      enhancedPrompt = `Context from database (${databaseContext.collection}):\n${JSON.stringify(contextData, null, 2)}\n\nUser Query: ${prompt}`;
    }

    // TODO: Integrate with actual LLM service (OpenAI, Claude, etc.)
    // For now, return a mock response
    const mockLLMResponse = {
      model: model || 'mock-model',
      response: `Mock LLM response for: "${prompt}"${contextData ? ' (with database context)' : ''}`,
      tokensUsed: Math.floor(Math.random() * 100) + 50,
      hasContext: !!contextData,
      contextRecords: contextData?.length || 0
    };

    Logger.info('LLM query executed', {
      userId: req.user?.id,
      subaccountId,
      model: model || 'mock-model',
      hasContext: !!contextData,
      contextRecords: contextData?.length || 0
    });

    res.json({
      success: true,
      message: 'LLM query executed successfully',
      data: mockLLMResponse
    });

  } catch (error) {
    Logger.error('LLM query execution failed', {
      userId: req.user?.id,
      subaccountId: req.body.subaccountId,
      error: error.message
    });
    next(error);
  }
};

// Analyze database schema with LLM
const analyzeSchema = async (req, res, next) => {
  try {
    const { subaccountId } = req.params;
    const accessToken = req.headers['authorization']?.split(' ')[1];
    
    if (!accessToken) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    // Get collections and stats
    const [collectionsResult, statsResult] = await Promise.all([
      tenantService.getCollections(accessToken, subaccountId),
      tenantService.getDatabaseStats(accessToken, subaccountId)
    ]);

    if (!collectionsResult.success) {
      return res.status(400).json({
        success: false,
        message: collectionsResult.error
      });
    }

    // Analyze first few documents from each collection to understand schema
    const schemaAnalysis = {};
    const collections = collectionsResult.data.collections;

    for (const collection of collections.slice(0, 5)) { // Limit to first 5 collections
      const sampleResult = await tenantService.executeQuery(accessToken, subaccountId, {
        operation: 'find',
        collection: collection.name,
        query: {},
        options: { limit: 3 }
      });

      if (sampleResult.success && sampleResult.data.result.length > 0) {
        // Analyze schema from sample documents
        const sampleDoc = sampleResult.data.result[0];
        const schema = Object.keys(sampleDoc).reduce((acc, key) => {
          acc[key] = typeof sampleDoc[key];
          return acc;
        }, {});

        schemaAnalysis[collection.name] = {
          sampleCount: sampleResult.data.result.length,
          schema,
          sampleDoc: sampleResult.data.result[0]
        };
      }
    }

    // TODO: Use actual LLM to analyze the schema
    const mockAnalysis = {
      summary: `Database contains ${collections.length} collections with various data types`,
      recommendations: [
        'Consider adding indexes for frequently queried fields',
        'Some collections might benefit from data normalization',
        'Review document sizes for optimization opportunities'
      ],
      collections: schemaAnalysis
    };

    Logger.info('Schema analysis completed', {
      userId: req.user?.id,
      subaccountId,
      collectionsAnalyzed: Object.keys(schemaAnalysis).length
    });

    res.json({
      success: true,
      message: 'Schema analysis completed',
      data: {
        analysis: mockAnalysis,
        stats: statsResult.success ? statsResult.data : null
      }
    });

  } catch (error) {
    Logger.error('Schema analysis failed', {
      userId: req.user?.id,
      subaccountId: req.params.subaccountId,
      error: error.message
    });
    next(error);
  }
};

// Generate database queries using LLM
const generateQuery = async (req, res, next) => {
  try {
    const { subaccountId, description, collection, queryType } = req.body;
    const accessToken = req.headers['authorization']?.split(' ')[1];
    
    if (!accessToken) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    // Get collection schema for context
    let schemaContext = null;
    if (collection) {
      const sampleResult = await tenantService.executeQuery(accessToken, subaccountId, {
        operation: 'find',
        collection,
        query: {},
        options: { limit: 1 }
      });

      if (sampleResult.success && sampleResult.data.result.length > 0) {
        schemaContext = Object.keys(sampleResult.data.result[0]);
      }
    }

    // TODO: Use actual LLM to generate query
    const mockQuery = {
      description,
      queryType: queryType || 'find',
      collection,
      generatedQuery: {
        operation: 'find',
        collection,
        query: { /* Generated based on description */ },
        options: {}
      },
      explanation: `This query was generated based on: "${description}"`,
      schemaUsed: schemaContext
    };

    Logger.info('Query generated', {
      userId: req.user?.id,
      subaccountId,
      collection,
      queryType: queryType || 'find'
    });

    res.json({
      success: true,
      message: 'Query generated successfully',
      data: mockQuery
    });

  } catch (error) {
    Logger.error('Query generation failed', {
      userId: req.user?.id,
      subaccountId: req.body.subaccountId,
      error: error.message
    });
    next(error);
  }
};

module.exports = {
  getUserSubaccounts,
  executeLLMQuery,
  analyzeSchema,
  generateQuery
};
