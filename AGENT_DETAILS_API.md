# Agent Details API Documentation

## Endpoint
`GET /api/database/:subaccountId/agents/:agentId`

## Query Parameters

| Parameter | Type | Required | Default | Format | Description |
|-----------|------|----------|---------|--------|-------------|
| `startDate` | string | No | 30 days ago | ISO 8601 | Start date of the period (YYYY-MM-DD or full ISO) |
| `endDate` | string | No | Now | ISO 8601 | End date of the period (YYYY-MM-DD or full ISO) |

**Note**: If neither parameter is provided, defaults to last 30 days. Both must be provided together.

## Authentication
- **Required**: Yes
- **Type**: Bearer Token
- **Header**: `Authorization: Bearer <token>`

## Examples

### 1. Get Last 30 Days Stats (Default)
```bash
curl -X GET \
  "http://localhost:3005/api/database/507f1f77bcf86cd799439011/agents/agent_abc123" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 2. Get Stats for Specific Date Range
```bash
curl -X GET \
  "http://localhost:3005/api/database/507f1f77bcf86cd799439011/agents/agent_abc123?startDate=2024-01-01&endDate=2024-01-31" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 3. Get This Week's Stats
```bash
curl -X GET \
  "http://localhost:3005/api/database/507f1f77bcf86cd799439011/agents/agent_abc123?startDate=2024-12-25&endDate=2024-12-31" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 4. Get Q4 2024 Stats
```bash
curl -X GET \
  "http://localhost:3005/api/database/507f1f77bcf86cd799439011/agents/agent_abc123?startDate=2024-10-01&endDate=2024-12-31" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 5. Get Stats with Full ISO Date-Time
```bash
curl -X GET \
  "http://localhost:3005/api/database/507f1f77bcf86cd799439011/agents/agent_abc123?startDate=2024-12-01T00:00:00.000Z&endDate=2024-12-31T23:59:59.999Z" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 6. Get Yesterday's Stats
```bash
# Calculate dates dynamically
START_DATE=$(date -v-1d +%Y-%m-%d)
END_DATE=$(date +%Y-%m-%d)

curl -X GET \
  "http://localhost:3005/api/database/507f1f77bcf86cd799439011/agents/agent_abc123?startDate=$START_DATE&endDate=$END_DATE" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Response Structure

```json
{
  "success": true,
  "message": "Agent details retrieved successfully",
  "data": {
    "agent": {
      "agentId": "agent_abc123",
      "name": "Customer Support Agent",
      "description": "Handles customer inquiries",
      "voiceId": "11labs-Adrian",
      "language": "en-US",
      "createdAt": "2024-01-15T10:30:00.000Z"
    },
    "currentPeriod": {
      "totalCalls": 150,
      "meetingsBooked": 45,
      "unresponsiveCalls": 12,
      "cumulativeSuccessRate": 85.5,
      "periodStart": "2024-12-01T00:00:00.000Z",
      "periodEnd": "2024-12-31T23:59:59.999Z"
    },
    "previousPeriod": {
      "totalCalls": 120,
      "meetingsBooked": 35,
      "unresponsiveCalls": 15,
      "cumulativeSuccessRate": 78.2,
      "periodStart": "2024-11-01T00:00:00.000Z",
      "periodEnd": "2024-11-30T23:59:59.999Z"
    },
    "comparison": {
      "totalCalls": {
        "change": 30,
        "percentageChange": 25.0
      },
      "meetingsBooked": {
        "change": 10,
        "percentageChange": 28.57
      },
      "unresponsiveCalls": {
        "change": -3,
        "percentageChange": -20.0
      },
      "cumulativeSuccessRate": {
        "change": 7.3,
        "percentageChange": 9.34
      }
    }
  },
  "meta": {
    "operationId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "duration": "45ms",
    "cached": false
  }
}
```

## Date Format

### Supported Formats

1. **Simple Date**: `YYYY-MM-DD`
   - Example: `2024-12-31`
   - Time defaults to 00:00:00 UTC

2. **Full ISO 8601**: `YYYY-MM-DDTHH:mm:ss.sssZ`
   - Example: `2024-12-31T23:59:59.999Z`
   - Includes time and timezone

3. **ISO with Timezone Offset**: `YYYY-MM-DDTHH:mm:ss±HH:mm`
   - Example: `2024-12-31T18:00:00-05:00`
   - Timezone aware

### Best Practices

- Use UTC timestamps for consistency
- For full day coverage: 
  - Start: `2024-01-01T00:00:00.000Z`
  - End: `2024-01-01T23:59:59.999Z`
- JavaScript: `new Date().toISOString()`
- Python: `datetime.now(timezone.utc).isoformat()`

## Statistics Breakdown

### 1. Total Calls
- **Definition**: Total number of calls handled by the agent
- **Data Source**: `calls` collection where `agent_id` matches
- **Time Filter**: `start_timestamp` between startDate and endDate

### 2. Meetings Booked
- **Definition**: Number of successful meeting bookings
- **Data Source**: `meetings` collection
- **Join**: Matches `agent_id` AND `call_id` from current period calls

### 3. Unresponsive Calls
- **Definition**: Calls where customer didn't engage properly
- **Criteria**: 
  - Missing `user_sentiment` field, OR
  - `disconnection_reason` equals `'user_hangup'`

### 4. Cumulative Success Rate
- **Definition**: Average success score across all calls
- **Calculation**: 
  - Only includes calls with `success_score > 0`
  - Formula: `sum(success_scores) / count(success_scores)`
  - Rounded to 2 decimal places

## Period Comparison Logic

### How Previous Period is Calculated

The previous period has the **same duration** as the current period and occurs **immediately before** it.

**Example 1: Monthly Comparison**
- Current Period: Jan 1 - Jan 31 (31 days)
- Previous Period: Dec 1 - Dec 31 (31 days)

**Example 2: Weekly Comparison**
- Current Period: Dec 25 - Dec 31 (7 days)
- Previous Period: Dec 18 - Dec 24 (7 days)

**Example 3: Custom Range**
- Current Period: Dec 10 - Dec 20 (11 days)
- Previous Period: Nov 29 - Dec 9 (11 days)

### Percentage Change Calculation
```
If previous = 0:
  percentageChange = current > 0 ? 100 : 0
Else:
  percentageChange = ((current - previous) / previous) × 100
```

### Interpretation
- **Positive %**: Improvement/increase
- **Negative %**: Decline/decrease
- **0%**: No change

## Caching

### Cache Strategy
- **Cache Key**: `agent:stats:{subaccountId}:{agentId}:{startTimestamp}:{endTimestamp}`
- **TTL**: 5 minutes (300 seconds)
- **Storage**: Redis

### Cache Behavior
- First request: Database query (slower)
- Subsequent requests: Cache hit (faster)
- Different date ranges: Separate cache entries
- Same date range: Shared cache

### Cache Invalidation
- Automatic: When agent is deleted
- Time-based: After 5 minutes
- Manual: Via cache invalidation endpoint (if implemented)

## Error Responses

### 400 - Invalid Date Format
```json
{
  "success": false,
  "message": "Invalid date format. Use ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)",
  "code": "INVALID_DATE_FORMAT"
}
```

### 400 - Invalid Date Range
```json
{
  "success": false,
  "message": "startDate must be before endDate",
  "code": "INVALID_DATE_RANGE"
}
```

### 400 - Date Range Too Large
```json
{
  "success": false,
  "message": "Date range cannot exceed 730 days (2 years)",
  "code": "DATE_RANGE_TOO_LARGE"
}
```

### 401 - Unauthorized
```json
{
  "success": false,
  "message": "Authentication required",
  "code": "AUTH_REQUIRED"
}
```

### 403 - Permission Denied
```json
{
  "success": false,
  "message": "Permission denied",
  "code": "PERMISSION_DENIED",
  "details": {
    "resource": "agent",
    "requiredPermission": "read"
  }
}
```

### 404 - Agent Not Found
```json
{
  "success": false,
  "message": "Agent not found",
  "code": "AGENT_NOT_FOUND"
}
```

### 500 - Server Error
```json
{
  "success": false,
  "message": "An internal database error occurred",
  "code": "DATABASE_ERROR",
  "meta": {
    "operationId": "uuid",
    "operation": "getAgentDetails",
    "duration": "123ms"
  }
}
```

## Rate Limiting
- **Limit**: 100 requests per minute per subaccount
- **Scope**: Per subaccount
- **Response**: 429 Too Many Requests (if exceeded)

## Common Use Cases

### 1. Monthly Dashboard
```bash
# January 2024
GET /api/database/{subaccountId}/agents/{agentId}?startDate=2024-01-01&endDate=2024-01-31
```

### 2. Weekly Performance Report
```bash
# Week of Dec 25-31
GET /api/database/{subaccountId}/agents/{agentId}?startDate=2024-12-25&endDate=2024-12-31
```

### 3. Quarterly Business Review
```bash
# Q1 2024
GET /api/database/{subaccountId}/agents/{agentId}?startDate=2024-01-01&endDate=2024-03-31
```

### 4. Year-End Summary
```bash
# Full Year 2024
GET /api/database/{subaccountId}/agents/{agentId}?startDate=2024-01-01&endDate=2024-12-31
```

### 5. Custom Campaign Analysis
```bash
# Campaign ran from Dec 15-20
GET /api/database/{subaccountId}/agents/{agentId}?startDate=2024-12-15&endDate=2024-12-20
```

### 6. Real-time Dashboard (Last 24 Hours)
```bash
# Default (no params) or calculate dates
GET /api/database/{subaccountId}/agents/{agentId}
```

## Performance Notes

- **Cached Response**: ~5-10ms
- **Database Query**: ~50-200ms (depends on data volume)
- **Recommended**: Use date ranges up to 90 days for best performance
- **Large Ranges**: 180+ days may take longer to compute

## Integration Examples

### JavaScript/Fetch
```javascript
const startDate = '2024-01-01';
const endDate = '2024-01-31';

const response = await fetch(
  `https://api.example.com/api/database/${subaccountId}/agents/${agentId}?startDate=${startDate}&endDate=${endDate}`,
  {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
);
const data = await response.json();
```

### JavaScript with Date Objects
```javascript
const endDate = new Date();
const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

const params = new URLSearchParams({
  startDate: startDate.toISOString().split('T')[0], // YYYY-MM-DD
  endDate: endDate.toISOString().split('T')[0]
});

const response = await fetch(
  `https://api.example.com/api/database/${subaccountId}/agents/${agentId}?${params}`,
  {
    headers: { Authorization: `Bearer ${token}` }
  }
);
```

### Python/Requests
```python
from datetime import datetime, timedelta

end_date = datetime.now()
start_date = end_date - timedelta(days=30)

response = requests.get(
    f"https://api.example.com/api/database/{subaccount_id}/agents/{agent_id}",
    params={
        "startDate": start_date.strftime("%Y-%m-%d"),
        "endDate": end_date.strftime("%Y-%m-%d")
    },
    headers={"Authorization": f"Bearer {token}"}
)
data = response.json()
```

### Node.js/Axios
```javascript
const axios = require('axios');

const { data } = await axios.get(
  `/api/database/${subaccountId}/agents/${agentId}`,
  {
    params: { 
      startDate: '2024-01-01',
      endDate: '2024-01-31'
    },
    headers: { Authorization: `Bearer ${token}` }
  }
);
```

### React Hook Example
```javascript
import { useState, useEffect } from 'react';

function useAgentStats(subaccountId, agentId, startDate, endDate) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams({
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0]
        });
        
        const response = await fetch(
          `/api/database/${subaccountId}/agents/${agentId}?${params}`,
          {
            headers: { Authorization: `Bearer ${token}` }
          }
        );
        
        const data = await response.json();
        setStats(data.data);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [subaccountId, agentId, startDate, endDate]);

  return { stats, loading, error };
}
```

## Tips & Best Practices

1. **Use URL encoding** for special characters in dates
2. **Include timezone** in ISO format to avoid ambiguity
3. **Cache on client-side** for repeated requests with same dates
4. **Validate dates** before making API calls
5. **Handle timezone conversions** if displaying in local time
6. **Use date libraries** (moment.js, date-fns) for date manipulation
7. **Consider pagination** for very large date ranges (split into chunks)
8. **Monitor rate limits** for automated reporting systems
