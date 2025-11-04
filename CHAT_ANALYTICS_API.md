# Chat Analytics API

## Overview

The Chat Analytics API provides detailed analytics for chat agents, including success rates, timeline data, peak hours, and outcome distribution. This endpoint is designed to give comprehensive insights into chat agent performance over time.

## Endpoint

```
GET /api/database/:subaccountId/chat-agents/:agentId/chat-analytics
```

## Authentication

Requires a valid JWT token in the `Authorization` header:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

## Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `subaccountId` | string | Yes | The subaccount ID (24-character MongoDB ObjectId) |
| `agentId` | string | Yes | The chat agent ID |

## Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startDate` | string | No | 30 days ago | Start date in ISO 8601 format (e.g., `2025-10-03T00:00:00.000Z`) |
| `endDate` | string | No | Now | End date in ISO 8601 format (e.g., `2025-11-02T23:59:59.999Z`) |
| `groupBy` | string | No | `day` | Grouping for timeline data: `day`, `week`, or `month` |

## Response Format

### Success Response (200 OK)

```json
{
  "success": true,
  "message": "Chat analytics retrieved successfully",
  "data": {
    "agent": {
      "agentId": "agent_e84bf2fa5280bf39be9a5ef837",
      "name": "Sales Chat Agent",
      "description": "AI-powered sales assistant",
      "voiceId": "11labs-Adrian",
      "language": "en-US",
      "createdAt": "2025-10-09T15:24:16.138Z"
    },
    "dateRange": {
      "start": "2025-10-03T00:00:00.000Z",
      "end": "2025-11-02T23:59:59.999Z",
      "groupBy": "day"
    },
    "summary": {
      "totalChats": 25,
      "successfulChats": 15,
      "unsuccessfulChats": 10,
      "successRate": 60.0,
      "meetingsBooked": 18
    },
    "successTimeline": [
      {
        "date": "2025-10-03",
        "successful": 2,
        "unsuccessful": 1,
        "timestamp": 1728000000000
      },
      {
        "date": "2025-10-04",
        "successful": 3,
        "unsuccessful": 2,
        "timestamp": 1728086400000
      }
      // ... more entries
    ],
    "peakHours": [
      {
        "hour": 0,
        "chatCount": 0,
        "hourLabel": "12 AM"
      },
      {
        "hour": 9,
        "chatCount": 5,
        "hourLabel": "9 AM"
      },
      {
        "hour": 14,
        "chatCount": 8,
        "hourLabel": "2 PM"
      }
      // ... all 24 hours
    ],
    "outcomeDistribution": [
      {
        "sentiment": "Meeting Booked",
        "count": 15,
        "percentage": 60.0
      },
      {
        "sentiment": "No Meeting",
        "count": 10,
        "percentage": 40.0
      }
    ]
  },
  "meta": {
    "operationId": "e0e1c6c8-bcbe-43fc-a9b2-8dc8339f7174",
    "duration": "245ms",
    "cached": false
  }
}
```

## Response Fields

### `data.agent`
Information about the chat agent.

| Field | Type | Description |
|-------|------|-------------|
| `agentId` | string | Unique agent identifier |
| `name` | string | Agent name |
| `description` | string | Agent description |
| `voiceId` | string | Voice ID used |
| `language` | string | Language code (e.g., `en-US`) |
| `createdAt` | string | ISO 8601 timestamp of when the agent was created |

### `data.dateRange`
The date range for the analytics.

| Field | Type | Description |
|-------|------|-------------|
| `start` | string | Start date in ISO 8601 format |
| `end` | string | End date in ISO 8601 format |
| `groupBy` | string | Grouping method: `day`, `week`, or `month` |

### `data.summary`
Overall statistics for the period.

| Field | Type | Description |
|-------|------|-------------|
| `totalChats` | number | Total number of chat conversations |
| `successfulChats` | number | Number of unique chats that resulted in at least one meeting |
| `unsuccessfulChats` | number | Number of chats that did not result in a meeting |
| `successRate` | number | Percentage of chats that resulted in meetings (0-100) |
| `meetingsBooked` | number | Total number of meetings booked (can be > successfulChats if multiple meetings per chat) |

### `data.successTimeline`
Array of success/failure counts grouped by the specified period.

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | Date/period identifier (format depends on groupBy) |
| `successful` | number | Number of successful chats in this period |
| `unsuccessful` | number | Number of unsuccessful chats in this period |
| `timestamp` | number | Unix timestamp in milliseconds |

**Date Format by GroupBy:**
- `day`: `YYYY-MM-DD` (e.g., `2025-10-03`)
- `week`: `YYYY-MM-DD` (start of week, e.g., `2025-10-27`)
- `month`: `YYYY-MM` (e.g., `2025-10`)

### `data.peakHours`
Array of 24 entries showing chat distribution by hour of day.

| Field | Type | Description |
|-------|------|-------------|
| `hour` | number | Hour of day (0-23) |
| `chatCount` | number | Number of chats started in this hour |
| `hourLabel` | string | Human-readable hour label (e.g., `9 AM`, `2 PM`) |

### `data.outcomeDistribution`
Distribution of chat outcomes.

| Field | Type | Description |
|-------|------|-------------|
| `sentiment` | string | Outcome label (`Meeting Booked` or `No Meeting`) |
| `count` | number | Number of chats with this outcome |
| `percentage` | number | Percentage of total chats (0-100) |

## Examples

### Example 1: Get Analytics for Last 30 Days (Daily)

```bash
curl 'http://localhost:3002/api/database/68cf05f060d294db17c0685e/chat-agents/agent_e84bf2fa5280bf39be9a5ef837/chat-analytics' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json'
```

### Example 2: Get Analytics for Specific Date Range (Daily)

```bash
curl 'http://localhost:3002/api/database/68cf05f060d294db17c0685e/chat-agents/agent_e84bf2fa5280bf39be9a5ef837/chat-analytics?startDate=2025-10-01T00:00:00.000Z&endDate=2025-10-31T23:59:59.999Z&groupBy=day' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json'
```

### Example 3: Get Weekly Analytics

```bash
curl 'http://localhost:3002/api/database/68cf05f060d294db17c0685e/chat-agents/agent_e84bf2fa5280bf39be9a5ef837/chat-analytics?startDate=2025-09-01T00:00:00.000Z&endDate=2025-10-31T23:59:59.999Z&groupBy=week' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json'
```

### Example 4: Get Monthly Analytics

```bash
curl 'http://localhost:3002/api/database/68cf05f060d294db17c0685e/chat-agents/agent_e84bf2fa5280bf39be9a5ef837/chat-analytics?startDate=2025-01-01T00:00:00.000Z&endDate=2025-12-31T23:59:59.999Z&groupBy=month' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json'
```

## Error Responses

### 400 Bad Request - Invalid Group By

```json
{
  "success": false,
  "message": "Invalid groupBy parameter. Must be one of: day, week, month",
  "code": "INVALID_GROUP_BY"
}
```

### 400 Bad Request - Invalid Date Format

```json
{
  "success": false,
  "message": "Invalid date format. Use ISO 8601 format",
  "code": "INVALID_DATE_FORMAT"
}
```

### 400 Bad Request - Invalid Date Range

```json
{
  "success": false,
  "message": "startDate must be before endDate",
  "code": "INVALID_DATE_RANGE"
}
```

### 404 Not Found - Agent Not Found

```json
{
  "success": false,
  "message": "Chat agent not found",
  "code": "CHAT_AGENT_NOT_FOUND"
}
```

### 401 Unauthorized

```json
{
  "success": false,
  "message": "Invalid or expired token",
  "code": "UNAUTHORIZED"
}
```

## Use Cases

### 1. Display Agent Performance Dashboard
Use this endpoint to populate a dashboard showing:
- Overall success rate
- Trend over time (using `successTimeline`)
- Best hours for chat engagement (using `peakHours`)
- Conversion funnel (using `outcomeDistribution`)

### 2. Compare Time Periods
Make multiple requests with different date ranges to compare:
- This month vs last month
- This quarter vs last quarter
- Year-over-year performance

### 3. Optimize Chat Agent Hours
Use the `peakHours` data to:
- Identify when customers are most active
- Allocate resources during peak hours
- Understand global timezone patterns

### 4. Track Improvement Over Time
Use weekly or monthly grouping to:
- Monitor long-term trends
- Measure impact of agent improvements
- Set performance benchmarks

## Technical Notes

### Performance
- The endpoint is optimized for date ranges up to 1 year
- Uses indexed queries on `agent_id`, `start_timestamp`, and `createdAt`
- Response times typically < 500ms for reasonable date ranges

### Caching
- Currently not cached (fresh data on every request)
- Consider implementing caching for historical data (> 7 days old)

### Rate Limiting
- Limited to 100 requests per minute per subaccount
- Rate limit headers included in response

### Data Accuracy
- **successfulChats**: Counts unique chats with at least one meeting
- **meetingsBooked**: Can be higher than successfulChats (multiple meetings per chat)
- **successRate**: Calculated as `(successfulChats / totalChats) × 100`

### Chat-to-Meeting Linking
- Meetings must include `chat_id` field to be counted as successful
- Ensure webhook calls pass `chat_id` when booking appointments
- See [WEBHOOK_TOOL_APIS.md](../../webhook-server/WEBHOOK_TOOL_APIS.md) for details

## Related Endpoints

- `GET /api/database/:subaccountId/chat-agents/:agentId` - Get agent details with period comparison
- `GET /api/database/:subaccountId/chat-agents` - List all chat agents
- `GET /api/database/:subaccountId/agents/:agentId/call-analytics` - Similar analytics for voice agents

## Support

For issues or questions:
1. Check logs: `logs/db-app.log`
2. Verify agent exists and has chats
3. Ensure date range is valid
4. Check authentication token

---

**Last Updated**: November 2025

