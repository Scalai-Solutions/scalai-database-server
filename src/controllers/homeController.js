const Logger = require('../utils/logger');
const connectionPoolManager = require('../services/connectionPoolManager');
const { v4: uuidv4 } = require('uuid');

class HomeController {
  /**
   * Get dashboard metrics
   * GET /api/home/:subaccountId/dashboard
   * Query params: startDate, endDate (optional, defaults to last 30 days)
   */
  static async getDashboardMetrics(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;
      
      // Parse date range from query params
      let { startDate, endDate } = req.query;
      
      // Default to last 30 days if not provided
      const now = new Date();
      if (!endDate) {
        endDate = now.toISOString();
      }
      if (!startDate) {
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        startDate = thirtyDaysAgo.toISOString();
      }

      const currentStartDate = new Date(startDate);
      const currentEndDate = new Date(endDate);
      
      // Calculate previous period (same duration)
      const periodDuration = currentEndDate - currentStartDate;
      const previousStartDate = new Date(currentStartDate.getTime() - periodDuration);
      const previousEndDate = new Date(currentStartDate);

      Logger.info('Fetching dashboard metrics', {
        operationId,
        subaccountId,
        userId,
        currentPeriod: { startDate, endDate },
        previousPeriod: { 
          startDate: previousStartDate.toISOString(), 
          endDate: previousEndDate.toISOString() 
        }
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Fetch metrics for current period
      const currentMetrics = await HomeController.fetchPeriodMetrics(
        connection,
        subaccountId,
        currentStartDate,
        currentEndDate,
        operationId
      );

      // Fetch metrics for previous period
      const previousMetrics = await HomeController.fetchPeriodMetrics(
        connection,
        subaccountId,
        previousStartDate,
        previousEndDate,
        operationId
      );

      // Calculate changes
      const calculateChange = (current, previous) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - previous) / previous) * 100);
      };

      const metrics = {
        totalCalls: {
          current: currentMetrics.totalCalls,
          previous: previousMetrics.totalCalls,
          change: calculateChange(currentMetrics.totalCalls, previousMetrics.totalCalls)
        },
        meetingsBooked: {
          current: currentMetrics.meetingsBooked,
          previous: previousMetrics.meetingsBooked,
          change: calculateChange(currentMetrics.meetingsBooked, previousMetrics.meetingsBooked)
        },
        unresponsiveCalls: {
          current: currentMetrics.unresponsiveCalls,
          previous: previousMetrics.unresponsiveCalls,
          change: calculateChange(currentMetrics.unresponsiveCalls, previousMetrics.unresponsiveCalls)
        },
        totalAgents: {
          current: currentMetrics.totalAgents,
          previous: previousMetrics.totalAgents,
          change: calculateChange(currentMetrics.totalAgents, previousMetrics.totalAgents)
        }
      };

      const duration = Date.now() - startTime;

      Logger.info('Dashboard metrics fetched successfully', {
        operationId,
        subaccountId,
        metrics,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Dashboard metrics fetched successfully',
        data: {
          metrics,
          period: {
            current: {
              startDate: currentStartDate.toISOString(),
              endDate: currentEndDate.toISOString()
            },
            previous: {
              startDate: previousStartDate.toISOString(),
              endDate: previousEndDate.toISOString()
            }
          }
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await HomeController.handleError(error, req, operationId, 'getDashboardMetrics', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Fetch metrics for a specific time period
   */
  static async fetchPeriodMetrics(connection, subaccountId, startDate, endDate, operationId) {
    const callsCollection = connection.db.collection('calls');
    const agentsCollection = connection.db.collection('agents');
    const meetingsCollection = connection.db.collection('meetings');

    // 1. Total calls in period
    const totalCalls = await callsCollection.countDocuments({
      subaccountId: subaccountId,
      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    });

    // 2. Meetings booked (from meetings collection)
    const meetingsBooked = await meetingsCollection.countDocuments({
      subaccountId: subaccountId,
      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    });

    // 3. Unresponsive calls (calls where call_successful is false)
    const unresponsiveCalls = await callsCollection.countDocuments({
      subaccountId: subaccountId,
      createdAt: {
        $gte: startDate,
        $lte: endDate
      },
      $or: [
        { disconnection_reason: { $exists: false } },
        { disconnection_reason: { $eq: null } },
        { disconnection_reason: { $eq: "" } },
        { 
          disconnection_reason: { 
            $not: { $regex: "hangup", $options: "i" } 
          }
        }
      ]
    });

    // 4. Total agents for the subaccount
    const totalAgents = await agentsCollection.countDocuments({
      subaccountId: subaccountId
    });

    Logger.debug('Period metrics fetched', {
      operationId,
      subaccountId,
      period: { startDate, endDate },
      metrics: { totalCalls, meetingsBooked, unresponsiveCalls, totalAgents }
    });

    return {
      totalCalls,
      meetingsBooked,
      unresponsiveCalls,
      totalAgents
    };
  }

  /**
   * Error handling
   */
  static async handleError(error, req, operationId, operation, startTime) {
    const duration = Date.now() - startTime;
    
    Logger.error(`Home operation failed: ${operation}`, {
      operationId,
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      subaccountId: req.params?.subaccountId,
      duration: `${duration}ms`
    });

    let statusCode = 500;
    let errorCode = 'HOME_ERROR';
    let message = 'An internal error occurred while fetching dashboard metrics';

    if (error.message.includes('Failed to create connection pool')) {
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

module.exports = HomeController;
