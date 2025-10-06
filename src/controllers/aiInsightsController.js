const Logger = require('../utils/logger');
const aiInsightsService = require('../services/aiInsightsService');
const { v4: uuidv4 } = require('uuid');

class AIInsightsController {
  /**
   * Generate or get AI insights for activities
   * GET /api/ai-insights/:subaccountId
   */
  static async getInsights(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const { force } = req.query; // Force regeneration if true
      const userId = req.user.id;

      const forceRegeneration = force === 'true' || force === '1';

      Logger.info('Getting AI insights', {
        operationId,
        subaccountId,
        userId,
        force: forceRegeneration
      });

      // Generate insights (will use cache if available and not forced)
      const result = await aiInsightsService.generateInsights(
        subaccountId,
        userId,
        forceRegeneration
      );

      if (!result.success) {
        return res.status(503).json({
          success: false,
          message: result.error || 'Failed to generate insights',
          code: 'INSIGHTS_GENERATION_FAILED'
        });
      }

      const duration = Date.now() - startTime;

      Logger.info('AI insights retrieved successfully', {
        operationId,
        subaccountId,
        cached: result.cached,
        activitiesAnalyzed: result.data.activitiesAnalyzed,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: result.cached ? 'Insights retrieved from cache' : 'Insights generated successfully',
        data: {
          insights: result.data.insights,
          charts: result.data.charts || [],
          activitiesAnalyzed: result.data.activitiesAnalyzed,
          timeRange: result.data.timeRange,
          generatedAt: result.data.generatedAt,
          model: result.data.model,
          cached: result.cached
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await AIInsightsController.handleError(error, req, operationId, 'getInsights', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Get insights history
   * GET /api/ai-insights/:subaccountId/history
   */
  static async getInsightsHistory(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const { limit = 10 } = req.query;
      const userId = req.user.id;

      Logger.info('Getting insights history', {
        operationId,
        subaccountId,
        userId,
        limit
      });

      const result = await aiInsightsService.getInsightsHistory(
        subaccountId,
        userId,
        parseInt(limit)
      );

      if (!result.success) {
        return res.status(404).json({
          success: false,
          message: 'No insights found',
          code: 'INSIGHTS_NOT_FOUND'
        });
      }

      const duration = Date.now() - startTime;

      Logger.info('Insights history retrieved successfully', {
        operationId,
        subaccountId,
        count: result.count,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Insights history retrieved successfully',
        data: {
          insights: result.data,
          count: result.count
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await AIInsightsController.handleError(error, req, operationId, 'getInsightsHistory', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Error handling
   */
  static async handleError(error, req, operationId, operation, startTime) {
    const duration = Date.now() - startTime;

    Logger.error(`AI Insights operation failed: ${operation}`, {
      operationId,
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      subaccountId: req.params?.subaccountId,
      duration: `${duration}ms`
    });

    let statusCode = 500;
    let errorCode = 'INSIGHTS_ERROR';
    let message = 'An internal error occurred while processing AI insights';

    if (error.message.includes('OpenAI')) {
      statusCode = 503;
      errorCode = 'OPENAI_ERROR';
      message = 'Failed to generate insights using AI. Please try again later.';
    } else if (error.message.includes('Failed to fetch activities')) {
      statusCode = 503;
      errorCode = 'ACTIVITIES_FETCH_FAILED';
      message = 'Unable to fetch activities for analysis.';
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
}

module.exports = AIInsightsController;
