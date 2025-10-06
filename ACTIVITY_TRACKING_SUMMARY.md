# Activity Tracking Implementation Summary

## Overview

A comprehensive activity tracking system has been implemented in the database-server to log and retrieve all major operations performed through the server. This provides an audit trail, usage analytics, and debugging capabilities.

## What's Been Implemented

### 1. Activity Service (`src/services/activityService.js`)
- **Purpose**: Core service for logging and retrieving activities
- **Features**:
  - Automatic activity logging with non-blocking design
  - Activity retrieval with filtering (category, type, date range)
  - Activity statistics aggregation
  - **Automatic cleanup**: TTL index ensures activities older than 60 days are auto-deleted
  - Comprehensive activity types and categories

### 2. Activity Controller (`src/controllers/activityController.js`)
- **Endpoints**:
  - `GET /api/activities/:subaccountId` - Get activities with filters
  - `GET /api/activities/:subaccountId/stats` - Get activity statistics
- **Features**:
  - Pagination support (limit/skip)
  - Time range filtering (hours or custom date range)
  - Category and type filtering
  - Comprehensive error handling

### 3. Activity Routes (`src/routes/activityRoutes.js`)
- **Authentication**: JWT token required
- **Rate Limits**:
  - Activities endpoint: 200 requests/minute per subaccount
  - Stats endpoint: 100 requests/minute per subaccount
- **Validation**: Query parameter validation using express-validator

### 4. Activity Validator (`src/validators/activityValidator.js`)
- Validates query parameters for both endpoints
- Ensures data integrity and proper formatting

## Tracked Activities

### Agent Operations
- ✅ Agent created
- ✅ Agent deleted
- ✅ Agent updated (details modified)

### Chat Agent Operations
- ✅ Chat agent created
- ✅ Chat agent activated
- ✅ Chat agent deactivated
- ✅ Chat agent updated

### Call Operations
- ✅ Web call created
- ✅ Call updated (via webhook)

### Chat Operations
- ✅ Chat created
- ✅ Chat message sent
- ✅ Chat ended

### Connector Operations
- ✅ Connector added to subaccount
- ✅ Connector configuration updated
- ✅ Connector deleted from subaccount
- ✅ Google Calendar connection initiated
- ✅ Connector metadata updated

## Activity Data Structure

Each activity contains:
```javascript
{
  subaccountId: string,        // Subaccount identifier
  activityType: string,         // Specific activity type
  category: string,             // Agent, chat_agent, call, chat, connector
  userId: string,               // Who performed the action
  description: string,          // Human-readable description
  metadata: object,             // Activity-specific details
  resourceId: string,           // ID of affected resource
  resourceName: string,         // Name of affected resource
  operationId: string,          // For tracking related operations
  timestamp: Date,              // When it occurred
  createdAt: Date              // When it was recorded (used for TTL)
}
```

## Data Retention & Memory Management

**Automatic Cleanup**: Activities older than 60 days (2 months) are automatically deleted.

- **Implementation**: MongoDB TTL (Time To Live) index on `createdAt` field
- **Retention Period**: 60 days (5,184,000 seconds)
- **Benefits**:
  - Prevents excessive memory/storage usage
  - Maintains optimal database performance
  - No manual cleanup required
  - Runs automatically in the background

**For Longer Retention**: If you need activities beyond 60 days:
1. Set up periodic exports to external storage (S3, data warehouse)
2. Implement a separate archival system
3. Adjust the TTL index if needed

## API Usage Examples

### Get Last 24 Hours of Activities
```bash
curl -X GET "https://your-server.com/api/activities/sub_abc123" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Get Agent Activities for Last 7 Days
```bash
curl -X GET "https://your-server.com/api/activities/sub_abc123?hours=168&category=agent" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Get Activity Statistics
```bash
curl -X GET "https://your-server.com/api/activities/sub_abc123/stats?hours=168" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### With Pagination
```bash
curl -X GET "https://your-server.com/api/activities/sub_abc123?limit=50&skip=100" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Integration Points

Activities are logged in the following controllers:

1. **DatabaseController** (`src/controllers/databaseController.js`)
   - Agent creation, deletion, updates
   - Chat agent creation, activation/deactivation, updates

2. **CallController** (`src/controllers/callController.js`)
   - Web call creation
   - Call updates via webhook

3. **ChatController** (`src/controllers/chatController.js`)
   - Chat creation
   - Message sending
   - Chat ending

4. **ConnectorController** (`src/controllers/connectorController.js`)
   - Connector addition
   - Configuration updates
   - Connector deletion
   - Google Calendar connections
   - Metadata updates

## Key Features

### 1. Non-Blocking Design
- Activity logging failures don't break the main operation
- Errors are logged but don't propagate

### 2. Comprehensive Metadata
- Each activity includes detailed metadata specific to the operation
- Includes resource IDs, names, and operation-specific details

### 3. Flexible Querying
- Filter by time range (last N hours or custom date range)
- Filter by category or specific activity type
- Pagination support for large result sets

### 4. Statistics & Analytics
- Aggregated counts by category
- Aggregated counts by activity type
- Time range analysis

### 5. Automatic Maintenance
- TTL index ensures old data is automatically cleaned up
- No manual intervention required
- Optimal performance maintained

## Files Created/Modified

### New Files
- `src/services/activityService.js` - Core activity service
- `src/controllers/activityController.js` - Activity API endpoints
- `src/routes/activityRoutes.js` - Activity routes
- `src/validators/activityValidator.js` - Request validation
- `ACTIVITY_API.md` - Complete API documentation
- `ACTIVITY_TRACKING_SUMMARY.md` - This file

### Modified Files
- `src/app.js` - Registered activity routes
- `src/controllers/databaseController.js` - Added activity logging
- `src/controllers/callController.js` - Added activity logging
- `src/controllers/chatController.js` - Added activity logging
- `src/controllers/connectorController.js` - Added activity logging

## Testing Recommendations

1. **Test Activity Logging**: Perform various operations and verify activities are logged
2. **Test Filtering**: Query activities with different filters
3. **Test Pagination**: Verify pagination works correctly
4. **Test Statistics**: Check activity statistics aggregation
5. **Test TTL Index**: Verify the TTL index is created correctly

## Use Cases

### 1. Audit Trail
Track all user actions for compliance and security purposes.

### 2. Usage Analytics
Analyze usage patterns by category, type, and time period.

### 3. Debugging
Track operation sequences using operationId for troubleshooting.

### 4. Activity Dashboard
Build real-time dashboards showing recent operations.

### 5. Resource Monitoring
Monitor changes to specific resources (agents, connectors, etc.).

### 6. User Behavior Analysis
Understand how users interact with your system.

## Performance Considerations

- Activities are stored in MongoDB with indexes for efficient querying
- TTL index runs in the background without impacting performance
- Pagination prevents large result sets from impacting performance
- Activity logging is asynchronous and non-blocking

## Security

- All endpoints require JWT authentication
- RBAC permissions can be enabled (currently commented out in routes)
- Rate limiting prevents abuse
- Activities are scoped to subaccounts for data isolation

## Future Enhancements

Potential improvements that could be added:

1. **Export Functionality**: Export activities to CSV/JSON
2. **Real-time Notifications**: WebSocket updates for activity streams
3. **Advanced Filtering**: Filter by userId, resourceId, operationId
4. **Activity Replay**: Reconstruct operation sequences
5. **Compliance Reports**: Generate audit reports
6. **Archival System**: Long-term storage for compliance needs
7. **Activity Webhooks**: Notify external systems of activities

## Maintenance

- **No manual maintenance required** - TTL index handles cleanup automatically
- Monitor storage usage if retention period needs adjustment
- Review activity patterns periodically for optimization opportunities
- Consider implementing archival if compliance requires longer retention

## Conclusion

The activity tracking system provides comprehensive logging of all major operations in the database-server. With automatic cleanup (60-day retention), it maintains optimal performance while providing valuable audit trails, analytics, and debugging capabilities.
