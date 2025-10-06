# Activity Tracking API

The Activity Tracking API provides comprehensive logging and retrieval of all major operations performed through the database server. This allows you to track user actions, system events, and resource changes over time.

## Overview

Activities are automatically logged for all major operations including:
- Agent creation, updates, and deletion
- Chat agent creation, activation/deactivation, and updates
- Web call creation and updates
- Chat creation, messages, and completion
- Connector operations (add, update, delete, Google Calendar connection)

## Activity Categories

Activities are organized into the following categories:

- `agent` - Call agent operations
- `chat_agent` - Chat agent operations
- `call` - Call-related activities
- `chat` - Chat session activities
- `connector` - Connector integration activities

## Activity Types

### Agent Activities
- `agent_created` - A new call agent was created
- `agent_deleted` - A call agent was deleted
- `agent_updated` - A call agent was updated

### Chat Agent Activities
- `chat_agent_created` - A new chat agent was created
- `chat_agent_activated` - A chat agent was activated
- `chat_agent_deactivated` - A chat agent was deactivated
- `chat_agent_updated` - A chat agent was updated

### Call Activities
- `web_call_created` - A new web call was initiated
- `call_updated` - Call information was updated (typically via webhook)

### Chat Activities
- `chat_created` - A new chat session was created
- `chat_message_sent` - A message was sent in a chat session
- `chat_ended` - A chat session was ended

### Connector Activities
- `connector_added` - A connector was added to a subaccount
- `connector_updated` - A connector configuration was updated
- `connector_deleted` - A connector was removed from a subaccount
- `connector_google_calendar_connected` - Google Calendar connection was initiated
- `connector_metadata_updated` - Connector metadata was updated

## API Endpoints

### Get Activities

Retrieve activities for a subaccount within a time range.

**Endpoint:** `GET /api/activities/:subaccountId`

**Authentication:** Required (JWT token)

**Parameters:**

Query Parameters:
- `hours` (optional, number): Number of hours to look back (default: 24, max: 720)
- `category` (optional, string): Filter by category (`agent`, `chat_agent`, `call`, `chat`, `connector`)
- `activityType` (optional, string): Filter by specific activity type
- `limit` (optional, number): Maximum number of results (default: 100, max: 500)
- `skip` (optional, number): Number of results to skip for pagination (default: 0)
- `startDate` (optional, ISO 8601): Custom start date (overrides `hours`)
- `endDate` (optional, ISO 8601): Custom end date (overrides `hours`)

**Example Request:**

```bash
# Get activities for the last 24 hours
curl -X GET "https://your-server.com/api/activities/sub_abc123" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Get agent-related activities for the last 7 days
curl -X GET "https://your-server.com/api/activities/sub_abc123?hours=168&category=agent" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Get activities with custom date range
curl -X GET "https://your-server.com/api/activities/sub_abc123?startDate=2024-01-01T00:00:00Z&endDate=2024-01-31T23:59:59Z" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Get activities with pagination
curl -X GET "https://your-server.com/api/activities/sub_abc123?limit=50&skip=100" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Example Response:**

```json
{
  "success": true,
  "message": "Activities retrieved successfully",
  "data": {
    "activities": [
      {
        "_id": "65a1234567890abcdef12345",
        "subaccountId": "sub_abc123",
        "activityType": "agent_created",
        "category": "agent",
        "userId": "user_xyz789",
        "description": "Agent \"Customer Support Bot\" created",
        "metadata": {
          "agentId": "agent_123abc",
          "agentName": "Customer Support Bot",
          "llmId": "llm_456def",
          "voiceId": "voice_789ghi",
          "language": "en-US"
        },
        "resourceId": "agent_123abc",
        "resourceName": "Customer Support Bot",
        "operationId": "op_951753",
        "timestamp": "2024-01-15T10:30:00.000Z",
        "createdAt": "2024-01-15T10:30:00.000Z"
      },
      {
        "_id": "65a1234567890abcdef12346",
        "subaccountId": "sub_abc123",
        "activityType": "web_call_created",
        "category": "call",
        "userId": "user_xyz789",
        "description": "Web call created for agent Customer Support Bot",
        "metadata": {
          "callId": "call_987zyx",
          "agentId": "agent_123abc",
          "agentName": "Customer Support Bot",
          "callType": "web_call"
        },
        "resourceId": "call_987zyx",
        "resourceName": "Web Call - Customer Support Bot",
        "operationId": "op_852741",
        "timestamp": "2024-01-15T11:45:00.000Z",
        "createdAt": "2024-01-15T11:45:00.000Z"
      }
    ],
    "pagination": {
      "total": 156,
      "count": 2,
      "limit": 100,
      "skip": 0,
      "hasMore": true
    },
    "filters": {
      "startDate": "2024-01-14T12:00:00.000Z",
      "endDate": "2024-01-15T12:00:00.000Z",
      "category": null,
      "activityType": null,
      "hoursRange": 24
    }
  },
  "meta": {
    "operationId": "op_753951",
    "duration": "45ms"
  }
}
```

### Get Activity Statistics

Retrieve aggregated activity statistics for a subaccount.

**Endpoint:** `GET /api/activities/:subaccountId/stats`

**Authentication:** Required (JWT token)

**Parameters:**

Query Parameters:
- `hours` (optional, number): Number of hours to look back (default: 24, max: 720)
- `startDate` (optional, ISO 8601): Custom start date
- `endDate` (optional, ISO 8601): Custom end date

**Example Request:**

```bash
# Get activity statistics for the last 24 hours
curl -X GET "https://your-server.com/api/activities/sub_abc123/stats" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Get activity statistics for the last 7 days
curl -X GET "https://your-server.com/api/activities/sub_abc123/stats?hours=168" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Example Response:**

```json
{
  "success": true,
  "message": "Activity statistics retrieved successfully",
  "data": {
    "total": 156,
    "byCategory": [
      {
        "_id": "agent",
        "count": 45
      },
      {
        "_id": "call",
        "count": 67
      },
      {
        "_id": "chat",
        "count": 32
      },
      {
        "_id": "connector",
        "count": 8
      },
      {
        "_id": "chat_agent",
        "count": 4
      }
    ],
    "byType": [
      {
        "_id": "web_call_created",
        "count": 45
      },
      {
        "_id": "agent_created",
        "count": 23
      },
      {
        "_id": "agent_updated",
        "count": 20
      },
      {
        "_id": "chat_created",
        "count": 18
      },
      {
        "_id": "chat_message_sent",
        "count": 12
      },
      {
        "_id": "call_updated",
        "count": 22
      }
    ],
    "timeRange": {
      "startDate": "2024-01-14T12:00:00.000Z",
      "endDate": "2024-01-15T12:00:00.000Z",
      "hours": 24
    }
  },
  "meta": {
    "operationId": "op_159753",
    "duration": "28ms"
  }
}
```

## Activity Document Structure

Each activity document contains the following fields:

```typescript
{
  _id: ObjectId,                  // MongoDB document ID
  subaccountId: string,           // Subaccount ID
  activityType: string,           // Type of activity (see Activity Types)
  category: string,               // Category (agent, chat_agent, call, chat, connector)
  userId: string,                 // User who performed the action
  description: string,            // Human-readable description
  metadata: object,               // Additional activity-specific data
  resourceId: string | null,      // ID of the resource affected
  resourceName: string | null,    // Name of the resource affected
  operationId: string | null,     // Operation ID for tracking
  timestamp: Date,                // When the activity occurred
  createdAt: Date                 // When the activity was recorded
}
```

## Use Cases

### 1. Audit Trail
Track all operations performed by users in your system for compliance and security purposes.

```bash
# Get all activities for a specific user
curl -X GET "https://your-server.com/api/activities/sub_abc123?hours=720" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 2. Activity Dashboard
Build a real-time activity dashboard showing recent operations.

```bash
# Get activities for the last hour
curl -X GET "https://your-server.com/api/activities/sub_abc123?hours=1" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 3. Usage Analytics
Analyze usage patterns by category or type.

```bash
# Get statistics for the last 30 days
curl -X GET "https://your-server.com/api/activities/sub_abc123/stats?hours=720" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 4. Debugging and Troubleshooting
Track the sequence of operations for debugging purposes using operationId.

```bash
# Get all activities with pagination for detailed review
curl -X GET "https://your-server.com/api/activities/sub_abc123?limit=500&skip=0" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 5. Resource Monitoring
Monitor changes to specific resources.

```bash
# Get agent-related activities
curl -X GET "https://your-server.com/api/activities/sub_abc123?category=agent" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Rate Limits

- `GET /api/activities/:subaccountId`: 200 requests per minute per subaccount
- `GET /api/activities/:subaccountId/stats`: 100 requests per minute per subaccount

## Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "errors": [
    {
      "field": "hours",
      "message": "hours must be an integer between 1 and 720"
    }
  ]
}
```

### 401 Unauthorized
```json
{
  "success": false,
  "message": "Authentication required",
  "code": "UNAUTHORIZED"
}
```

### 403 Forbidden
```json
{
  "success": false,
  "message": "You are not authorized to access these activities",
  "code": "UNAUTHORIZED"
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "message": "An internal error occurred while processing activity request",
  "code": "ACTIVITY_ERROR",
  "meta": {
    "operationId": "op_123456",
    "operation": "getActivities",
    "duration": "150ms"
  }
}
```

## Data Retention

**Activities are automatically deleted after 60 days (2 months)** to prevent excessive memory usage. This is implemented using MongoDB's TTL (Time To Live) index feature.

- Activities older than 60 days are automatically removed by MongoDB
- This cleanup happens automatically in the background
- No manual intervention is required
- The retention period helps maintain optimal database performance

If you need longer retention periods for compliance or audit purposes, you should:
1. Export activities periodically to external storage (e.g., S3, data warehouse)
2. Set up a separate archival process
3. Consider implementing a custom retention policy

## Notes

- Activities are automatically logged for all major operations - no manual intervention required
- Activity logging is designed to be non-blocking - if logging fails, the main operation continues
- Activities are stored in the `activities` collection in your subaccount database
- **Activities older than 60 days are automatically deleted** to conserve storage
- The maximum time range for querying activities is 30 days (720 hours)
- For optimal performance, use pagination for large result sets
- Activities include metadata specific to each activity type for detailed analysis
- A TTL index is automatically created on the `activities` collection on first use
