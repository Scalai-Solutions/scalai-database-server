const OpenAI = require('openai');
const Logger = require('../utils/logger');
const config = require('../../config/config');
const ActivityService = require('./activityService');
const connectionPoolManager = require('./connectionPoolManager');

class AIInsightsService {
  constructor() {
    if (!config.openai.apiKey) {
      Logger.warn('OpenAI API key not configured. AI insights will not be available.');
      this.enabled = false;
      return;
    }

    this.openai = new OpenAI({
      apiKey: config.openai.apiKey
    });
    this.enabled = true;
    
    Logger.info('AI Insights Service initialized', {
      model: config.openai.model,
      enabled: this.enabled
    });
  }

  /**
   * Ensure TTL index exists on ai_insights collection
   * Automatically deletes insights older than 30 days
   * @param {Object} connection - MongoDB connection
   * @returns {Promise<void>}
   */
  async ensureTTLIndex(connection) {
    try {
      const insightsCollection = connection.db.collection('ai_insights');
      
      // Check if TTL index already exists
      const indexes = await insightsCollection.indexes();
      const hasTTL = indexes.some(index => 
        index.key.generatedAt === 1 && index.expireAfterSeconds !== undefined
      );

      if (!hasTTL) {
        // Create TTL index: delete documents 30 days after generatedAt
        await insightsCollection.createIndex(
          { generatedAt: 1 },
          { 
            expireAfterSeconds: 2592000, // 30 days = 30 * 24 * 60 * 60 seconds
            name: 'generatedAt_ttl_30days'
          }
        );
        
        Logger.info('TTL index created on ai_insights collection', {
          field: 'generatedAt',
          expireAfterSeconds: 2592000,
          expireAfterDays: 30
        });
      } else {
        Logger.debug('TTL index already exists on ai_insights collection');
      }
    } catch (error) {
      Logger.error('Failed to ensure TTL index on ai_insights', {
        error: error.message,
        stack: error.stack
      });
      // Don't throw - this is not critical enough to stop the service
    }
  }

  /**
   * Check if insights need to be regenerated (older than 24 hours or forced)
   * @param {Object} lastInsight - Last insight document
   * @param {boolean} force - Force regeneration
   * @returns {boolean}
   */
  shouldRegenerateInsights(lastInsight, force = false) {
    if (force) return true;
    if (!lastInsight) return true;
    
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return new Date(lastInsight.generatedAt) < twentyFourHoursAgo;
  }

  /**
   * Generate AI insights for activities
   * @param {string} subaccountId - Subaccount ID
   * @param {string} userId - User ID requesting insights
   * @param {boolean} force - Force regeneration even if cached
   * @returns {Promise<Object>}
   */
  async generateInsights(subaccountId, userId, force = false) {
    try {
      if (!this.enabled) {
        return {
          success: false,
          error: 'AI Insights service is not enabled. Please configure OPENAI_API_KEY in environment variables.'
        };
      }

      Logger.info('Generating AI insights', {
        subaccountId,
        userId,
        force
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      
      const insightsCollection = connection.db.collection('ai_insights');

      // Ensure TTL index exists for automatic cleanup of old insights
      await this.ensureTTLIndex(connection);

      // Check if we have recent insights
      const lastInsight = await insightsCollection.findOne(
        { subaccountId },
        { sort: { generatedAt: -1 } }
      );

      if (!this.shouldRegenerateInsights(lastInsight, force)) {
        Logger.info('Using cached insights', {
          subaccountId,
          age: Date.now() - new Date(lastInsight.generatedAt).getTime()
        });

        return {
          success: true,
          data: lastInsight,
          cached: true
        };
      }

      // Get activities from last 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const now = new Date();

      const activitiesResult = await ActivityService.getActivities(subaccountId, userId, {
        startDate: sevenDaysAgo,
        endDate: now,
        limit: 500
      });

      if (!activitiesResult.success) {
        throw new Error('Failed to fetch activities');
      }

      const activities = activitiesResult.data.activities;

      if (activities.length === 0) {
        return {
          success: true,
          data: {
            subaccountId,
            insights: {
              summary: 'No activities found in the last 7 days.',
              trends: [],
              recommendations: [],
              keyMetrics: {}
            },
            activitiesAnalyzed: 0,
            generatedAt: new Date(),
            cached: false
          }
        };
      }

      // Get activity statistics
      const statsResult = await ActivityService.getActivityStats(subaccountId, userId, sevenDaysAgo, now);
      
      // Prepare data for OpenAI
      const activitySummary = this.prepareActivitySummary(activities, statsResult.data);

      // Generate insights using OpenAI
      const aiInsights = await this.callOpenAI(activitySummary);

      // Generate chart data
      const charts = this.generateChartData(activities, statsResult.data);

      // Store insights in database
      const insightDocument = {
        subaccountId,
        insights: aiInsights,
        charts: charts,
        activitiesAnalyzed: activities.length,
        timeRange: {
          start: sevenDaysAgo,
          end: now,
          days: 7
        },
        generatedAt: new Date(),
        generatedBy: userId,
        model: config.openai.model
      };

      await insightsCollection.insertOne(insightDocument);

      Logger.info('AI insights generated and stored', {
        subaccountId,
        activitiesAnalyzed: activities.length
      });

      return {
        success: true,
        data: insightDocument,
        cached: false
      };

    } catch (error) {
      Logger.error('Failed to generate AI insights', {
        error: error.message,
        stack: error.stack,
        subaccountId
      });

      throw error;
    }
  }

  /**
   * Prepare activity summary for OpenAI
   * @param {Array} activities - Activity documents
   * @param {Object} stats - Activity statistics
   * @returns {string}
   */
  prepareActivitySummary(activities, stats) {
    // Group activities by category
    const byCategory = activities.reduce((acc, activity) => {
      if (!acc[activity.category]) {
        acc[activity.category] = [];
      }
      acc[activity.category].push(activity);
      return acc;
    }, {});

    // Create summary text
    let summary = `Activity Analysis for Last 7 Days\n\n`;
    summary += `Total Activities: ${stats.total}\n\n`;
    
    summary += `Activity Breakdown by Category:\n`;
    stats.byCategory.forEach(cat => {
      summary += `- ${cat._id}: ${cat.count} activities\n`;
    });
    
    summary += `\nActivity Breakdown by Type:\n`;
    stats.byType.forEach(type => {
      summary += `- ${type._id}: ${type.count} activities\n`;
    });

    summary += `\nRecent Activities (Sample):\n`;
    activities.slice(0, 20).forEach(activity => {
      summary += `- [${activity.category}] ${activity.description} (${new Date(activity.timestamp).toLocaleDateString()})\n`;
    });

    summary += `\nDetailed Category Insights:\n`;
    Object.keys(byCategory).forEach(category => {
      const categoryActivities = byCategory[category];
      summary += `\n${category.toUpperCase()} (${categoryActivities.length} activities):\n`;
      
      // Get unique activity types in this category
      const types = [...new Set(categoryActivities.map(a => a.activityType))];
      types.forEach(type => {
        const count = categoryActivities.filter(a => a.activityType === type).length;
        summary += `  - ${type}: ${count}\n`;
      });
    });

    return summary;
  }

  /**
   * Calculate optimal chart width based on data complexity and chart type
   * @param {string} chartType - Type of chart (pie, bar, line, etc.)
   * @param {number} dataPoints - Number of data points or categories
   * @param {Array} labels - Chart labels (to check label length)
   * @param {number} seriesCount - Number of data series (for multi-line charts)
   * @returns {number} Width percentage (33, 50, 66, or 100)
   */
  calculateChartWidth(chartType, dataPoints, labels = [], seriesCount = 1) {
    // Calculate average label length
    const avgLabelLength = labels.length > 0 
      ? labels.reduce((sum, label) => sum + String(label).length, 0) / labels.length 
      : 0;
    
    const hasLongLabels = avgLabelLength > 15;

    switch (chartType) {
      case 'pie':
        // Pie charts are compact and circular
        return 100;                        // Complex, give more space
      
      case 'bar':
        // Vertical bar charts
        if (dataPoints <= 3 && !hasLongLabels) return 33;
        if (dataPoints <= 5 && !hasLongLabels) return 50;
        if (dataPoints <= 7) return 66;
        return 100;  // Many categories need full width
      
      case 'horizontalBar':
        // Horizontal bars need more width due to labels on left
        if (dataPoints <= 4 && !hasLongLabels) return 50;
        if (dataPoints <= 6 && !hasLongLabels) return 66;
        return 100;  // Usually need full width for readable labels
      
      case 'line':
        // Line charts for time series
        if (seriesCount === 1) {
          // Single line
          if (dataPoints <= 4) return 50;
          if (dataPoints <= 6) return 66;
          return 100;
        } else {
          // Multiple lines need more space
          if (seriesCount <= 2 && dataPoints <= 5) return 50;
          if (seriesCount <= 3 && dataPoints <= 6) return 66;
          return 100;
        }
      
      case 'heatmap':
        // Heatmaps always need full width for grid visibility
        return 100;
      
      default:
        return 100;  // Default to full width for unknown types
    }
  }

  /**
   * Generate chart data from activities and statistics
   * @param {Array} activities - Activity documents
   * @param {Object} stats - Activity statistics
   * @returns {Array} Array of chart configurations
   */
  generateChartData(activities, stats) {
    const charts = [];

    // 1. Activity by Category - Pie Chart
    if (stats.byCategory && stats.byCategory.length > 0) {
      const labels = stats.byCategory.map(cat => cat._id || 'Unknown');
      const categoryCount = stats.byCategory.length;
      
      charts.push({
        type: 'pie',
        title: 'Activity Distribution by Category',
        description: 'Breakdown of activities across different categories',
        width: this.calculateChartWidth('pie', categoryCount, labels),
        data: {
          labels: labels,
          values: stats.byCategory.map(cat => cat.count),
          colors: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6']
        }
      });

      // Also create a bar chart version
      charts.push({
        type: 'bar',
        title: 'Activity Count by Category',
        description: 'Comparison of activity volumes across categories',
        width: this.calculateChartWidth('bar', categoryCount, labels),
        data: {
          labels: labels,
          datasets: [{
            label: 'Activity Count',
            values: stats.byCategory.map(cat => cat.count),
            backgroundColor: '#3B82F6'
          }]
        }
      });
    }

    // 2. Activity by Type - Horizontal Bar Chart
    if (stats.byType && stats.byType.length > 0) {
      // Take top 10 activity types
      const topTypes = stats.byType.slice(0, 10);
      const labels = topTypes.map(type => (type._id || 'Unknown').replace(/_/g, ' '));
      
      charts.push({
        type: 'horizontalBar',
        title: 'Top 10 Activity Types',
        description: 'Most common operations performed',
        width: this.calculateChartWidth('horizontalBar', topTypes.length, labels),
        data: {
          labels: labels,
          datasets: [{
            label: 'Count',
            values: topTypes.map(type => type.count),
            backgroundColor: '#10B981'
          }]
        }
      });
    }

    // 3. Activity Timeline - Line Chart
    const timelineData = this.generateTimelineData(activities);
    if (timelineData.dates.length > 0) {
      charts.push({
        type: 'line',
        title: 'Activity Timeline (Last 7 Days)',
        description: 'Daily activity trend over the past week',
        width: this.calculateChartWidth('line', timelineData.dates.length, timelineData.dates, 1),
        data: {
          labels: timelineData.dates,
          datasets: [{
            label: 'Total Activities',
            values: timelineData.counts,
            borderColor: '#3B82F6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fill: true
          }]
        }
      });
    }

    // 4. Category Timeline - Multi-line Chart
    const categoryTimeline = this.generateCategoryTimelineData(activities);
    if (Object.keys(categoryTimeline).length > 0) {
      const categoryCount = Object.keys(categoryTimeline).length;
      const datasets = Object.entries(categoryTimeline).map(([category, data], index) => ({
        label: category,
        values: data.counts,
        borderColor: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'][index % 5],
        fill: false
      }));

      const firstCategoryDates = categoryTimeline[Object.keys(categoryTimeline)[0]].dates;
      
      charts.push({
        type: 'line',
        title: 'Activity Trends by Category',
        description: 'Compare activity trends across different categories',
        width: this.calculateChartWidth('line', firstCategoryDates.length, firstCategoryDates, categoryCount),
        data: {
          labels: firstCategoryDates,
          datasets: datasets
        }
      });
    }

    // 5. Activity Heatmap Data (hourly distribution if data available)
    const heatmapData = this.generateHeatmapData(activities);
    if (heatmapData.length > 0) {
      charts.push({
        type: 'heatmap',
        title: 'Activity Heatmap (Day vs Hour)',
        description: 'When activities occur throughout the week',
        width: this.calculateChartWidth('heatmap', 168), // 7 days * 24 hours
        data: heatmapData
      });
    }

    return charts;
  }

  /**
   * Generate timeline data grouped by day
   * @param {Array} activities - Activity documents
   * @returns {Object}
   */
  generateTimelineData(activities) {
    const dailyCounts = {};
    
    activities.forEach(activity => {
      const date = new Date(activity.timestamp);
      const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
      dailyCounts[dateKey] = (dailyCounts[dateKey] || 0) + 1;
    });

    // Sort by date and fill missing days
    const dates = Object.keys(dailyCounts).sort();
    const counts = dates.map(date => dailyCounts[date]);

    return { dates, counts };
  }

  /**
   * Generate category timeline data
   * @param {Array} activities - Activity documents
   * @returns {Object}
   */
  generateCategoryTimelineData(activities) {
    const categoryData = {};

    activities.forEach(activity => {
      const date = new Date(activity.timestamp);
      const dateKey = date.toISOString().split('T')[0];
      const category = activity.category;

      if (!categoryData[category]) {
        categoryData[category] = {};
      }
      categoryData[category][dateKey] = (categoryData[category][dateKey] || 0) + 1;
    });

    // Convert to array format
    const result = {};
    Object.keys(categoryData).forEach(category => {
      const dates = Object.keys(categoryData[category]).sort();
      const counts = dates.map(date => categoryData[category][date]);
      result[category] = { dates, counts };
    });

    return result;
  }

  /**
   * Generate heatmap data (day of week vs hour of day)
   * @param {Array} activities - Activity documents
   * @returns {Array}
   */
  generateHeatmapData(activities) {
    const heatmap = [];
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Initialize heatmap grid
    for (let day = 0; day < 7; day++) {
      for (let hour = 0; hour < 24; hour++) {
        heatmap.push({
          day: days[day],
          hour: hour,
          value: 0
        });
      }
    }

    // Count activities by day and hour
    activities.forEach(activity => {
      const date = new Date(activity.timestamp);
      const dayIndex = date.getDay();
      const hour = date.getHours();
      const index = dayIndex * 24 + hour;
      heatmap[index].value++;
    });

    return heatmap;
  }

  /**
   * Call OpenAI API to generate insights
   * @param {string} activitySummary - Prepared activity summary
   * @returns {Promise<Object>}
   */
  async callOpenAI(activitySummary) {
    try {
      const prompt = `You are an AI assistant analyzing user activity data for a SaaS platform that provides AI-powered voice agents and chat agents.

Here is the activity data from the last 7 days:

${activitySummary}

Based on this data, provide insights in the following JSON format:
{
  "summary": "A brief 2-3 sentence summary of overall activity patterns",
  "trends": [
    "Key trend 1",
    "Key trend 2",
    "Key trend 3"
  ],
  "recommendations": [
    "Actionable recommendation 1",
    "Actionable recommendation 2",
    "Actionable recommendation 3"
  ],
  "keyMetrics": {
    "mostActiveCategory": "The category with most activity",
    "mostCommonOperation": "The most common operation type",
    "activityTrend": "increasing/stable/decreasing",
    "peakDay": "Day with most activity (if identifiable)",
    "totalActivities": "Total number of activities",
    "averagePerDay": "Average activities per day"
  },
  "alerts": [
    "Any concerning patterns or anomalies (if any)"
  ]
}

Focus on:
1. Usage patterns and trends
2. Resource utilization (agents, calls, chats, connectors)
3. Growth indicators
4. Potential issues or optimization opportunities
5. User engagement patterns

Note: Your insights will be displayed alongside interactive charts. Charts are intelligently sized based on their 
complexity - simple visualizations may appear horizontally aligned for optimal space usage, while complex charts 
with more data points will use full width for clarity. Keep your insights concise and actionable to complement the visual data.

Return ONLY the JSON object, no additional text.`;

      const response = await this.openai.chat.completions.create({
        model: config.openai.model,
        messages: [
          {
            role: 'system',
            content: 'You are a data analyst expert specializing in SaaS metrics and user behavior analysis. Provide actionable insights based on activity data.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: config.openai.temperature,
        max_tokens: config.openai.maxTokens,
        response_format: { type: 'json_object' }
      });

      const insightsText = response.choices[0].message.content;
      const insights = JSON.parse(insightsText);

      Logger.debug('OpenAI insights generated', {
        model: response.model,
        tokensUsed: response.usage.total_tokens
      });

      return insights;

    } catch (error) {
      Logger.error('OpenAI API call failed', {
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to generate AI insights: ${error.message}`);
    }
  }

  /**
   * Get the latest insights for a subaccount
   * @param {string} subaccountId - Subaccount ID
   * @param {string} userId - User ID
   * @returns {Promise<Object>}
   */
  async getLatestInsights(subaccountId, userId) {
    try {
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      
      const insightsCollection = connection.db.collection('ai_insights');

      const lastInsight = await insightsCollection.findOne(
        { subaccountId },
        { sort: { generatedAt: -1 } }
      );

      if (!lastInsight) {
        return {
          success: false,
          error: 'No insights available. Generate insights first.'
        };
      }

      return {
        success: true,
        data: lastInsight
      };

    } catch (error) {
      Logger.error('Failed to get latest insights', {
        error: error.message,
        stack: error.stack,
        subaccountId
      });
      throw error;
    }
  }

  /**
   * Get insights history
   * @param {string} subaccountId - Subaccount ID
   * @param {string} userId - User ID
   * @param {number} limit - Number of insights to retrieve
   * @returns {Promise<Object>}
   */
  async getInsightsHistory(subaccountId, userId, limit = 10) {
    try {
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      
      const insightsCollection = connection.db.collection('ai_insights');

      const insights = await insightsCollection
        .find({ subaccountId })
        .sort({ generatedAt: -1 })
        .limit(limit)
        .toArray();

      return {
        success: true,
        data: insights,
        count: insights.length
      };

    } catch (error) {
      Logger.error('Failed to get insights history', {
        error: error.message,
        stack: error.stack,
        subaccountId
      });
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new AIInsightsService();
