# Call Logs API - Complete Examples with Filtering & Pagination

Based on [Retell API Documentation](https://docs.retellai.com/api-references/list-calls)

## Overview

The Call Logs API fetches data from **Retell AI** and filters it to show only calls that exist in your **MongoDB database**. This hybrid approach ensures:
- You only see calls that were successfully created through your system
- Data consistency between Retell and your database
- Accurate call tracking and management

**Features:**
- **Simple GET requests** for basic call log retrieval
- **POST requests with filters** for advanced querying
- **Pagination** for handling large datasets
- **Redis caching** for improved performance
- **MongoDB filtering** - Only shows calls present in your database

---

## How It Works

### Data Flow
1. **Fetch from Retell** - API retrieves call data from Retell AI
2. **Query MongoDB** - System checks which call_ids exist in your database
3. **Filter Results** - Only returns calls present in MongoDB
4. **Cache Filtered Data** - Stores filtered results in Redis (5 min TTL)
5. **Return to Client** - Sends filtered, paginated response

### Why MongoDB Filtering?
- **Consistency** - Ensures you only see calls created through your system
- **Integrity** - Prevents showing orphaned calls from Retell
- **Accuracy** - Matches your database records exactly
- **Security** - Only exposes calls you have permission to access

---

## Endpoints

### 1. GET - Simple Call Logs (No Filters)
`GET /api/calls/:subaccountId/logs`

### 2. POST - Call Logs with Filters & Pagination
`POST /api/calls/:subaccountId/logs/filter`

### 3. DELETE - Delete Call Log
`DELETE /api/calls/:subaccountId/logs/:callId`

**Note:** Delete removes the call from both Retell AI and your MongoDB database.

---

## Filter Criteria

Based on the Retell API, you can filter calls by:

| Filter | Type | Description | Example |
|--------|------|-------------|---------|
| `agent_id` | array | Filter by specific agent IDs | `["agent_123", "agent_456"]` |
| `call_status` | array | Filter by call status | `["ended", "ongoing"]` |
| `call_type` | array | Filter by call type | `["web_call", "phone_call"]` |
| `direction` | array | Filter by call direction | `["inbound", "outbound"]` |
| `user_sentiment` | array | Filter by user sentiment | `["Positive", "Negative", "Neutral"]` |
| `call_successful` | boolean | Filter by call success | `true` or `false` |
| `start_timestamp` | object | Filter by timestamp range | `{"lower": 1703302407333, "upper": 1703388807333}` |

### Call Status Options
- `registered` - Call is registered but not started
- `not_connected` - Call did not connect
- `ongoing` - Call is in progress
- `ended` - Call has ended
- `error` - Call encountered an error

### Call Type Options
- `web_call` - Web-based call
- `phone_call` - Phone-based call

### Direction Options
- `inbound` - Incoming call
- `outbound` - Outgoing call

---

## Pagination

| Parameter | Type | Description | Default | Max |
|-----------|------|-------------|---------|-----|
| `limit` | number | Number of calls per page | 50 | 1000 |
| `pagination_key` | string | Key for next page (call_id from previous response) | null | - |

---

## cURL Examples

### 1. Simple GET - All Calls (Default: 50 calls)

```bash
curl -X GET "http://localhost:3000/api/calls/507f1f77bcf86cd799439011/logs" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Call logs retrieved successfully (filtered by MongoDB presence)",
  "data": [...],
  "pagination": {
    "limit": 50,
    "count": 50,
    "next_pagination_key": "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",
    "has_more": true
  },
  "retellAccount": {
    "accountName": "My Retell Account",
    "accountId": "123456"
  },
  "meta": {
    "operationId": "550e8400-e29b-41d4-a716-446655440000",
    "duration": "15ms",
    "cacheHit": true,
    "filteredByMongoDB": true
  }
}
```

---

### 2. GET with Query Parameters - Custom Limit

```bash
curl -X GET "http://localhost:3000/api/calls/507f1f77bcf86cd799439011/logs?limit=100" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### 3. POST - Filter by Agent ID

```bash
curl -X POST "http://localhost:3000/api/calls/507f1f77bcf86cd799439011/logs/filter" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "filter_criteria": {
      "agent_id": ["oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD"]
    },
    "limit": 50
  }'
```

---

### 4. POST - Filter by Call Status (Ended Calls Only)

```bash
curl -X POST "http://localhost:3000/api/calls/507f1f77bcf86cd799439011/logs/filter" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "filter_criteria": {
      "call_status": ["ended"]
    },
    "limit": 100
  }'
```

---

### 5. POST - Filter by Call Type (Phone Calls Only)

```bash
curl -X POST "http://localhost:3000/api/calls/507f1f77bcf86cd799439011/logs/filter" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "filter_criteria": {
      "call_type": ["phone_call"]
    },
    "limit": 50
  }'
```

---

### 6. POST - Filter by User Sentiment (Positive Only)

```bash
curl -X POST "http://localhost:3000/api/calls/507f1f77bcf86cd799439011/logs/filter" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "filter_criteria": {
      "user_sentiment": ["Positive"]
    },
    "limit": 50
  }'
```

---

### 7. POST - Filter by Successful Calls Only

```bash
curl -X POST "http://localhost:3000/api/calls/507f1f77bcf86cd799439011/logs/filter" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "filter_criteria": {
      "call_successful": true
    },
    "limit": 50
  }'
```

---

### 8. POST - Filter by Time Range (Last 24 Hours)

```bash
# Calculate timestamps (example for last 24 hours)
# current_time = Date.now() (in milliseconds)
# 24_hours_ago = current_time - (24 * 60 * 60 * 1000)

curl -X POST "http://localhost:3000/api/calls/507f1f77bcf86cd799439011/logs/filter" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "filter_criteria": {
      "start_timestamp": {
        "lower": 1703302407333,
        "upper": 1703388807333
      }
    },
    "limit": 50
  }'
```

---

### 9. POST - Multiple Filters Combined

```bash
curl -X POST "http://localhost:3000/api/calls/507f1f77bcf86cd799439011/logs/filter" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "filter_criteria": {
      "agent_id": ["oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD"],
      "call_status": ["ended"],
      "call_type": ["phone_call"],
      "call_successful": true,
      "user_sentiment": ["Positive"]
    },
    "limit": 100
  }'
```

---

### 10. POST - Pagination (First Page)

```bash
curl -X POST "http://localhost:3000/api/calls/507f1f77bcf86cd799439011/logs/filter" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "filter_criteria": {
      "call_status": ["ended"]
    },
    "limit": 50
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Call logs retrieved successfully",
  "data": [
    { "call_id": "call_001", ... },
    { "call_id": "call_002", ... },
    ...
    { "call_id": "call_050", ... }
  ],
  "pagination": {
    "limit": 50,
    "count": 50,
    "next_pagination_key": "call_050",
    "has_more": true
  },
  ...
}
```

---

### 11. POST - Pagination (Second Page)

```bash
# Use next_pagination_key from previous response
curl -X POST "http://localhost:3000/api/calls/507f1f77bcf86cd799439011/logs/filter" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "filter_criteria": {
      "call_status": ["ended"]
    },
    "limit": 50,
    "pagination_key": "call_050"
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Call logs retrieved successfully",
  "data": [
    { "call_id": "call_051", ... },
    { "call_id": "call_052", ... },
    ...
    { "call_id": "call_100", ... }
  ],
  "pagination": {
    "limit": 50,
    "count": 50,
    "next_pagination_key": "call_100",
    "has_more": true
  },
  ...
}
```

---

### 12. POST - Large Page Size (Max 1000)

```bash
curl -X POST "http://localhost:3000/api/calls/507f1f77bcf86cd799439011/logs/filter" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "filter_criteria": {},
    "limit": 1000
  }'
```

---

### 13. DELETE - Delete Call Log

```bash
curl -X DELETE "http://localhost:3000/api/calls/507f1f77bcf86cd799439011/logs/Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "message": "Call log deleted successfully",
  "data": {
    "callId": "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",
    "deletedFromRetell": true,
    "deletedFromDatabase": true
  },
  "retellAccount": {
    "accountName": "My Retell Account",
    "accountId": "123456"
  },
  "meta": {
    "operationId": "550e8400-e29b-41d4-a716-446655440000",
    "duration": "180ms"
  }
}
```

---

## Complete Pagination Example

### Step 1: Get First Page
```bash
curl -X POST "http://localhost:3000/api/calls/507f1f77bcf86cd799439011/logs/filter" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "filter_criteria": {
      "call_status": ["ended"]
    },
    "limit": 20
  }'
```

### Step 2: Use `next_pagination_key` from Response
```bash
curl -X POST "http://localhost:3000/api/calls/507f1f77bcf86cd799439011/logs/filter" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "filter_criteria": {
      "call_status": ["ended"]
    },
    "limit": 20,
    "pagination_key": "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6"
  }'
```

### Step 3: Continue Until `has_more: false`
Repeat with new `next_pagination_key` until `has_more: false` in response.

---

## Response Structure

### Success Response
```json
{
  "success": true,
  "message": "Call logs retrieved successfully (filtered by MongoDB presence)",
  "data": [
    {
      "call_type": "web_call",
      "call_id": "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",
      "agent_id": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
      "call_status": "ended",
      "start_timestamp": 1703302407333,
      "end_timestamp": 1703302428855,
      "duration_ms": 10000,
      "transcript": "...",
      "recording_url": "...",
      "call_analysis": {
        "call_summary": "...",
        "user_sentiment": "Positive",
        "call_successful": true
      },
      "call_cost": {
        "combined_cost": 70
      }
    }
  ],
  "pagination": {
    "limit": 50,
    "count": 50,
    "next_pagination_key": "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",
    "has_more": true
  },
  "retellAccount": {
    "accountName": "My Retell Account",
    "accountId": "123456"
  },
  "meta": {
    "operationId": "550e8400-e29b-41d4-a716-446655440000",
    "duration": "245ms",
    "cacheHit": false,
    "filteredByMongoDB": true
  }
}
```

---

## Caching Behavior

### Cached Requests (Fast Response)
- Simple GET requests without filters
- Default limit (50)
- No pagination key
- **Cache TTL:** 5 minutes
- **Response includes:** `"cacheHit": true`
- **Note:** Cached data is already filtered by MongoDB presence

### Non-Cached Requests
- Requests with filters
- Custom pagination
- Pagination with pagination_key
- **Response includes:** `"cacheHit": false`
- **Note:** Data is fetched from Retell and filtered by MongoDB on each request

### Cache Invalidation
Cache is automatically cleared when:
- New call is created (web or phone)
- Call is deleted
- Call is updated via webhook

**Why invalidate?** When calls are created/deleted, the MongoDB filtering results change, so cache must be refreshed.

---

## Best Practices

### 1. Use Appropriate Page Sizes
```bash
# Small page for UI pagination
"limit": 20

# Medium page for typical use
"limit": 50

# Large page for data export
"limit": 1000
```

### 2. Always Check `has_more` Flag
```javascript
while (response.pagination.has_more) {
  // Fetch next page using next_pagination_key
}
```

### 3. Combine Filters for Precise Results
```json
{
  "filter_criteria": {
    "agent_id": ["agent_123"],
    "call_status": ["ended"],
    "call_successful": true,
    "start_timestamp": {
      "lower": 1703302407333
    }
  }
}
```

### 4. Use Timestamps for Date Ranges
```javascript
// Last 7 days
const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
const now = Date.now();

{
  "filter_criteria": {
    "start_timestamp": {
      "lower": sevenDaysAgo,
      "upper": now
    }
  }
}
```

---

## Common Use Cases

### 1. Get All Ended Calls for Specific Agent
```bash
curl -X POST "http://localhost:3000/api/calls/507f1f77bcf86cd799439011/logs/filter" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "filter_criteria": {
      "agent_id": ["oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD"],
      "call_status": ["ended"]
    },
    "limit": 100
  }'
```

### 2. Get Today's Successful Phone Calls
```bash
# Calculate today's timestamp range
START_OF_TODAY=$(date -u -d "today 00:00:00" +%s)000
NOW=$(date +%s)000

curl -X POST "http://localhost:3000/api/calls/507f1f77bcf86cd799439011/logs/filter" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d "{
    \"filter_criteria\": {
      \"call_type\": [\"phone_call\"],
      \"call_successful\": true,
      \"start_timestamp\": {
        \"lower\": $START_OF_TODAY,
        \"upper\": $NOW
      }
    },
    \"limit\": 100
  }"
```

### 3. Get Calls with Negative Sentiment
```bash
curl -X POST "http://localhost:3000/api/calls/507f1f77bcf86cd799439011/logs/filter" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "filter_criteria": {
      "user_sentiment": ["Negative"],
      "call_status": ["ended"]
    },
    "limit": 50
  }'
```

---

## Error Responses

### 400 - Validation Error
```json
{
  "success": false,
  "message": "Validation failed",
  "code": "VALIDATION_ERROR",
  "errors": [...]
}
```

### 401 - Unauthorized
```json
{
  "success": false,
  "message": "Unauthorized",
  "code": "UNAUTHORIZED"
}
```

### 404 - Call Not Found (for DELETE)
```json
{
  "success": false,
  "message": "Call not found",
  "code": "CALL_NOT_FOUND"
}
```

---

## Rate Limits

- **GET/POST Call Logs:** 100 requests per minute per subaccount
- **DELETE Call Log:** 50 requests per minute per subaccount

---

## Notes

### Important Implementation Details

**Hybrid Data Source:**
- Call data is fetched from **Retell AI** (source of truth for call details)
- Results are filtered by **MongoDB** (only shows calls in your database)
- This ensures you only see calls created through your system

**Data Consistency:**
- When you create a call, it's stored in both Retell and MongoDB
- When you delete a call, it's removed from both Retell and MongoDB
- Call logs only show calls present in MongoDB
- If a call exists in Retell but not MongoDB, it won't appear in results

**Performance Optimization:**
- MongoDB query only fetches `call_id` field (lightweight)
- Filtering happens in-memory using a Set (O(1) lookup)
- Cached results are already filtered (no re-filtering on cache hits)

### General Notes

- Replace `507f1f77bcf86cd799439011` with your actual subaccount ID
- Replace `YOUR_JWT_TOKEN` with your actual JWT authentication token
- All timestamps are in milliseconds since epoch
- Maximum limit is 1000 calls per request
- Pagination key is the `call_id` of the last call from previous response
- Cache is only used for simple GET requests without filters
- All responses include `"filteredByMongoDB": true` in metadata

---

## Related Documentation

- [Retell API - List Calls](https://docs.retellai.com/api-references/list-calls)
- [Call Logs Caching Documentation](./CALL_LOGS_CACHING.md)
- [Call API Documentation](./CALL_API.md)

