# AI Insights API

The AI Insights API provides AI-powered analysis of your activities using OpenAI's GPT models. It automatically analyzes the last 7 days of activities and generates actionable insights, trends, and recommendations.

## Features

- **Automatic Analysis**: Analyzes activities from the last 7 days
- **Smart Caching**: Generates insights once every 24 hours to optimize costs
- **Manual Triggering**: Force regeneration when needed
- **Comprehensive Insights**: Includes summary, trends, recommendations, key metrics, and alerts
- **Historical Tracking**: View past insights to track improvements over time

## Setup

### 1. Configure OpenAI API Key

Add the following to your `.env` file:

```env
# Required
OPENAI_API_KEY=sk-your-api-key-here

# Optional (with defaults)
OPENAI_MODEL=gpt-4o-mini
OPENAI_MAX_TOKENS=2000
OPENAI_TEMPERATURE=0.7
```

### 2. Supported Models

- `gpt-4o-mini` (default) - Cost-effective, fast
- `gpt-4o` - More capable, higher cost
- `gpt-4-turbo` - Balanced performance
- `gpt-3.5-turbo` - Budget option

## API Endpoints

### Get AI Insights

Retrieve AI-powered insights for the last 7 days. Automatically uses cached insights if generated within the last 24 hours.

**Endpoint:** `GET /api/ai-insights/:subaccountId`

**Authentication:** Required (JWT token)

**Query Parameters:**
- `force` (optional, boolean): Force regeneration even if cached insights exist
  - Values: `true`, `false`, `1`, `0`
  - Default: `false`

**Example Requests:**

```bash
# Get insights (uses cache if available)
curl -X GET "https://your-server.com/api/ai-insights/sub_abc123" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Force regeneration
curl -X GET "https://your-server.com/api/ai-insights/sub_abc123?force=true" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Example Response:**

```json
{
  "success": true,
  "message": "Insights generated successfully",
  "data": {
    "insights": {
      "summary": "Activity shows healthy growth with consistent agent creation and usage. The subaccount has created 15 new agents and processed 67 web calls in the past week, indicating strong engagement with the platform.",
      "trends": [
        "Agent creation has increased by 40% compared to typical patterns",
        "Web call volume is steady at approximately 10 calls per day",
        "Chat activity shows a 25% increase, suggesting growing adoption of chat agents",
        "Peak activity occurs on weekdays between 9 AM - 5 PM"
      ],
      "recommendations": [
        "Consider scaling infrastructure to handle growing web call volume",
        "Implement automated monitoring for agent performance metrics",
        "Set up bulk operations for agent creation to save time",
        "Review connector usage - only 2 connectors active despite multiple agents",
        "Enable more chat agents to capitalize on growing chat engagement"
      ],
      "keyMetrics": {
        "mostActiveCategory": "call",
        "mostCommonOperation": "web_call_created",
        "activityTrend": "increasing",
        "peakDay": "Wednesday"
      },
      "alerts": [
        "3 agents were deleted in a short time period - verify if intentional",
        "No connector activity in the last 2 days - potential integration issues"
      ]
    },
    "charts": [
      {
        "type": "pie",
        "title": "Activity Distribution by Category",
        "description": "Breakdown of activities across different categories",
        "width": 50,
        "data": {
          "labels": ["agent", "call", "chat", "connector"],
          "values": [45, 67, 32, 8],
          "colors": ["#3B82F6", "#10B981", "#F59E0B", "#EF4444"]
        }
      },
      {
        "type": "bar",
        "title": "Activity Count by Category",
        "description": "Comparison of activity volumes across categories",
        "width": 100,
        "data": {
          "labels": ["agent", "call", "chat", "connector"],
          "datasets": [{
            "label": "Activity Count",
            "values": [45, 67, 32, 8],
            "backgroundColor": "#3B82F6"
          }]
        }
      },
      {
        "type": "line",
        "title": "Activity Timeline (Last 7 Days)",
        "description": "Daily activity trend over the past week",
        "width": 100,
        "data": {
          "labels": ["2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11", "2024-01-12", "2024-01-13", "2024-01-14"],
          "datasets": [{
            "label": "Total Activities",
            "values": [12, 18, 25, 30, 22, 28, 21],
            "borderColor": "#3B82F6",
            "backgroundColor": "rgba(59, 130, 246, 0.1)",
            "fill": true
          }]
        }
      }
    ],
    "activitiesAnalyzed": 156,
    "timeRange": {
      "start": "2024-01-08T12:00:00.000Z",
      "end": "2024-01-15T12:00:00.000Z",
      "days": 7
    },
    "generatedAt": "2024-01-15T12:00:00.000Z",
    "model": "gpt-4o-mini",
    "cached": false
  },
  "meta": {
    "operationId": "op_123456",
    "duration": "3245ms"
  }
}
```

### Get Insights History

Retrieve historical insights to track changes over time.

**Endpoint:** `GET /api/ai-insights/:subaccountId/history`

**Authentication:** Required (JWT token)

**Query Parameters:**
- `limit` (optional, number): Number of insights to retrieve
  - Range: 1-50
  - Default: 10

**Example Request:**

```bash
curl -X GET "https://your-server.com/api/ai-insights/sub_abc123/history?limit=5" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Example Response:**

```json
{
  "success": true,
  "message": "Insights history retrieved successfully",
  "data": {
    "insights": [
      {
        "_id": "65a1234567890abcdef12345",
        "subaccountId": "sub_abc123",
        "insights": {
          "summary": "Recent insights...",
          "trends": [...],
          "recommendations": [...],
          "keyMetrics": {...},
          "alerts": [...]
        },
        "activitiesAnalyzed": 156,
        "timeRange": {
          "start": "2024-01-08T12:00:00.000Z",
          "end": "2024-01-15T12:00:00.000Z",
          "days": 7
        },
        "generatedAt": "2024-01-15T12:00:00.000Z",
        "generatedBy": "user_xyz789",
        "model": "gpt-4o-mini"
      },
      // ... more historical insights
    ],
    "count": 5
  },
  "meta": {
    "operationId": "op_789012",
    "duration": "45ms"
  }
}
```

## Insight Structure

Each insight contains:

```typescript
{
  summary: string;              // 2-3 sentence overview of activity patterns
  trends: string[];             // Key trends identified (3-5 items)
  recommendations: string[];     // Actionable recommendations (3-5 items)
  keyMetrics: {
    mostActiveCategory: string;  // Category with most activity
    mostCommonOperation: string; // Most frequent operation type
    activityTrend: string;       // 'increasing', 'stable', or 'decreasing'
    peakDay?: string;            // Day with most activity (if identifiable)
  };
  alerts: string[];             // Concerning patterns or anomalies (if any)
}
```

## Charts Data

Each insight response includes a `charts` array with multiple ready-to-use chart configurations. Each chart contains:

```typescript
{
  type: string;         // Chart type: 'pie', 'bar', 'horizontalBar', 'line', 'heatmap'
  title: string;        // Display title for the chart
  description: string;  // What the chart shows
  width: number;        // Recommended width as percentage of container (50-100)
  data: object;         // Chart data in standard format
}
```

**Width Property:**
- The chart container takes up **50% of the screen width**
- The `width` value is a percentage **relative to that container**
- Example: `width: 50` = 50% of container = 25% of screen width
- Example: `width: 100` = 100% of container = 50% of screen width
- Width is **dynamically calculated** based on data complexity, chart type, and label length

**Dynamic Width Calculation:**
Charts automatically receive optimal widths (33%, 50%, 66%, or 100%) based on:
- Chart type characteristics (pie charts are compact, heatmaps need space)
- Number of data points or categories
- Label length (short vs long labels)
- Number of series (for multi-line charts)

**Chart Types:**
1. **Pie Chart** (`width: 33-66%`) - Activity distribution by category
2. **Bar Chart** (`width: 33-100%`) - Activity count by category
3. **Horizontal Bar** (`width: 50-100%`) - Top 10 activity types
4. **Line Chart** (`width: 50-100%`) - Activity timeline (7 days)
5. **Multi-line Chart** (`width: 50-100%`) - Activity trends by category
6. **Heatmap** (`width: 100%`) - Activity by day and hour

**Example Chart Objects:**
```json
// Simple pie chart - 33% width (3 categories, allows 3 per row)
{
  "type": "pie",
  "title": "Activity Distribution by Category",
  "description": "Breakdown of activities across different categories",
  "width": 33,
  "data": {
    "labels": ["agent", "call", "chat"],
    "values": [45, 67, 32],
    "colors": ["#3B82F6", "#10B981", "#F59E0B"]
  }
}

// Bar chart - 50% width (4 categories with short labels, allows 2 per row)
{
  "type": "bar",
  "title": "Activity Count by Category",
  "description": "Comparison of activity volumes across categories",
  "width": 50,
  "data": {
    "labels": ["agent", "call", "chat", "connector"],
    "values": [45, 67, 32, 8]
  }
}

// Complex line chart - 100% width (many data points)
{
  "type": "line",
  "title": "Activity Timeline (Last 7 Days)",
  "description": "Daily activity trend over the past week",
  "width": 100,
  "data": {
    "labels": ["2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11", "2024-01-12", "2024-01-13", "2024-01-14"],
    "values": [12, 18, 25, 30, 22, 28, 21]
  }
}
```

For detailed chart formats and implementation examples, see [CHART_DATA_FORMAT.md](./CHART_DATA_FORMAT.md).

## Caching Behavior

### Automatic Caching (Default)
- Insights are generated once and cached for 24 hours
- Subsequent requests within 24 hours return cached insights immediately
- No additional OpenAI API calls = cost savings
- Cache is per-subaccount

### Force Regeneration
- Use `?force=true` query parameter
- Ignores cache and generates fresh insights
- Useful when:
  - You need up-to-date analysis after major changes
  - Testing new configurations
  - Cache might be stale due to high activity

## Cost Optimization

### Estimated Costs (using gpt-4o-mini)
- Average cost per insight generation: $0.01 - $0.03
- With 24-hour caching: ~$0.30 - $0.90 per month per subaccount
- Without caching: Could be $10+ per month with frequent requests

### Best Practices
1. **Use default caching** - Let the system cache for 24 hours
2. **Limit manual triggers** - Only force regeneration when necessary
3. **Use appropriate model** - gpt-4o-mini is sufficient for most use cases
4. **Monitor usage** - Track API costs in OpenAI dashboard

## Rate Limits

- `GET /api/ai-insights/:subaccountId`: **20 requests per minute** per subaccount
  - Lower limit due to AI processing costs
  - Use caching to stay within limits
- `GET /api/ai-insights/:subaccountId/history`: 50 requests per minute per subaccount

## Use Cases

### 1. Daily Dashboard
Display latest insights on your admin dashboard for quick overview.

```javascript
// Get latest insights (uses cache if available)
fetch('/api/ai-insights/sub_abc123', {
  headers: { 'Authorization': `Bearer ${token}` }
})
  .then(res => res.json())
  .then(data => displayInsights(data.insights));
```

### 2. Weekly Reports
Schedule weekly reports showing trends and recommendations.

```javascript
// Every Monday at 9 AM, force fresh insights
if (isMonday && hour === 9) {
  fetch('/api/ai-insights/sub_abc123?force=true', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
    .then(res => res.json())
    .then(data => sendWeeklyReport(data.insights));
}
```

### 3. Trend Analysis
Compare insights over time to identify improvements or issues.

```javascript
// Get last 10 insights for trend analysis
fetch('/api/ai-insights/sub_abc123/history?limit=10', {
  headers: { 'Authorization': `Bearer ${token}` }
})
  .then(res => res.json())
  .then(data => analyzeTrends(data.insights));
```

### 4. Anomaly Detection
Set up alerts based on AI-detected issues.

```javascript
// Check for alerts
const insights = await getInsights(subaccountId);
if (insights.alerts.length > 0) {
  sendAlertNotification(insights.alerts);
}
```

## Data Storage

Insights are stored in the `ai_insights` collection in your subaccount database:

```javascript
{
  _id: ObjectId,
  subaccountId: string,
  insights: {
    summary: string,
    trends: string[],
    recommendations: string[],
    keyMetrics: object,
    alerts: string[]
  },
  activitiesAnalyzed: number,
  timeRange: {
    start: Date,
    end: Date,
    days: number
  },
  generatedAt: Date,
  generatedBy: string,  // User ID who triggered generation
  model: string         // OpenAI model used
}
```

## Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "errors": [
    {
      "field": "force",
      "message": "force must be a boolean value (true/false or 1/0)"
    }
  ]
}
```

### 503 Service Unavailable
```json
{
  "success": false,
  "message": "AI Insights service is not enabled. Please configure OPENAI_API_KEY in environment variables.",
  "code": "INSIGHTS_GENERATION_FAILED"
}
```

### 503 OpenAI Error
```json
{
  "success": false,
  "message": "Failed to generate insights using AI. Please try again later.",
  "code": "OPENAI_ERROR",
  "meta": {
    "operationId": "op_123456",
    "operation": "getInsights",
    "duration": "5234ms"
  }
}
```

## Troubleshooting

### No insights available
**Issue**: "No insights available. Generate insights first."

**Solution**: 
- First request will generate insights (may take 3-5 seconds)
- Subsequent requests will be instant (cached)

### OpenAI API errors
**Issue**: "Failed to generate insights using AI"

**Possible causes**:
1. Invalid or missing API key
2. Insufficient OpenAI credits
3. Rate limits exceeded
4. Network connectivity issues

**Solutions**:
1. Verify `OPENAI_API_KEY` in `.env`
2. Check OpenAI account balance
3. Wait a few minutes and retry
4. Check server logs for detailed error

### High costs
**Issue**: Unexpected OpenAI costs

**Solutions**:
1. Ensure you're using caching (don't force every request)
2. Switch to `gpt-4o-mini` model (more cost-effective)
3. Reduce `OPENAI_MAX_TOKENS` if responses are too long
4. Monitor usage in OpenAI dashboard

## Security

- All endpoints require JWT authentication
- Insights are scoped to subaccounts (data isolation)
- Rate limiting prevents abuse
- API keys are stored securely in environment variables
- No sensitive data is sent to OpenAI (only activity summaries)

## Performance

- **First generation**: 3-5 seconds (OpenAI API call)
- **Cached retrieval**: <100ms (database lookup)
- **History retrieval**: <50ms (database query)
- Insights are generated asynchronously in the background

## Best Practices

1. **Use caching**: Let the 24-hour cache work for you
2. **Schedule wisely**: If forcing regeneration, do it during off-peak hours
3. **Monitor costs**: Track OpenAI usage in your dashboard
4. **Act on insights**: Use recommendations to improve your platform
5. **Track trends**: Review historical insights weekly/monthly
6. **Alert setup**: Configure notifications for critical alerts
7. **Model selection**: Start with gpt-4o-mini, upgrade if needed

## Future Enhancements

Potential features that could be added:

1. **Custom time ranges**: Analyze specific date ranges
2. **Email reports**: Automated email with insights
3. **Comparison views**: Compare multiple time periods
4. **Custom prompts**: Allow custom analysis questions
5. **Export functionality**: PDF/CSV export of insights
6. **Webhooks**: Notify when new insights are generated
7. **Multi-subaccount**: Compare insights across subaccounts
