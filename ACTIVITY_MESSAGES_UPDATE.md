# Activity Messages Update

## Summary

Updated activity log messages across the system to be more user-friendly and descriptive, using human-readable names instead of IDs where possible.

## Changes Made

### 1. Call Activity Messages

#### Single Outbound Call
- **Before**: `Phone call created from +1234567890 to +0987654321`
- **After**: `Outbound call was initiated to +0987654321`
- **File**: `scalai-database-server/src/controllers/callController.js`

#### Bulk Call
- **Before**: `Batch call created with 5 tasks from +1234567890`
- **After**: `Bulk call was initiated to 5 numbers`
- **File**: `scalai-database-server/src/controllers/callController.js`

#### Inbound Call (NEW)
- **Message**: `Call was received from +1234567890`
- **Files**: 
  - Added `INBOUND_CALL_RECEIVED` activity type in `scalai-database-server/src/services/activityService.js`
  - Logs activity when webhook receives inbound call in `scalai-webhook-server/src/controllers/webhookController.js`

### 2. Meeting Activity Messages (NEW)

#### Meeting Booked
- **Message**: `Meeting successfully booked with +1234567890` (or "customer" if no phone number)
- **Files**:
  - Added `MEETING_BOOKED` activity type and `MEETING` category in `scalai-database-server/src/services/activityService.js`
  - Logs activity when meeting is created via webhook in `scalai-webhook-server/src/controllers/webhookController.js`

### 3. Connector Activity Messages

#### Connector Added
- **Before**: `Connector 68fbca15e990538380e08b7a added to subaccount`
- **After**: `Connector Twilio added to subaccount` (uses connector name)
- **File**: `scalai-database-server/src/controllers/connectorController.js`

#### Connector Updated
- **Before**: `Connector 68fbca15e990538380e08b7a configuration updated`
- **After**: `Connector Twilio configuration updated` (uses connector name)
- **File**: `scalai-database-server/src/controllers/connectorController.js`

#### Connector Deleted
- **Before**: `Connector 68fbca15e990538380e08b7a removed from subaccount`
- **After**: `Connector Twilio removed from subaccount` (uses connector name)
- **File**: `scalai-database-server/src/controllers/connectorController.js`

#### Connector Metadata Updated
- **Before**: `Connector 68fbca15e990538380e08b7a metadata updated`
- **After**: `Connector Twilio metadata updated` (uses connector name)
- **File**: `scalai-database-server/src/controllers/connectorController.js`

## Technical Implementation

### New Activity Types

Added to `scalai-database-server/src/services/activityService.js`:
```javascript
INBOUND_CALL_RECEIVED: 'inbound_call_received'
MEETING_BOOKED: 'meeting_booked'
```

### New Activity Category

Added to `scalai-database-server/src/services/activityService.js`:
```javascript
MEETING: 'meeting'
```

### Service-to-Service Activity Logging

Created a new endpoint for webhook server to log activities:

**Endpoint**: `POST /api/activities/:subaccountId/log`
**Authentication**: Service token (X-Service-Token header)
**Files**:
- Controller: `scalai-database-server/src/controllers/activityController.js` (new `logActivity` method)
- Routes: `scalai-database-server/src/routes/activityRoutes.js` (new route)

**Request Body**:
```json
{
  "activityType": "inbound_call_received",
  "category": "call",
  "userId": "webhook-service",
  "description": "Call was received from +1234567890",
  "metadata": { ... },
  "resourceId": "call_id",
  "resourceName": "Inbound Call from +1234567890"
}
```

### Webhook Server Integration

Created helper function in `scalai-webhook-server/src/controllers/webhookController.js`:

```javascript
async function logActivityInDatabase(subaccountId, activityData, requestId)
```

This function:
- Calls the database server's activity logging endpoint
- Uses service-to-service authentication
- Gracefully handles failures (logs error but doesn't break main flow)

### Activity Logging Points

#### Inbound Calls
- **Trigger**: When `call_started` webhook event is received with `direction === 'inbound'`
- **Location**: `handleCallStarted()` in webhook controller
- **Data logged**: call ID, from number, to number, agent ID

#### Meetings
- **Trigger**: When appointment is successfully booked via `/book-appointment` webhook endpoint
- **Location**: `handleBookAppointment()` in webhook controller
- **Data logged**: meeting ID, customer details, date/time, agent ID

#### Connectors
- **Trigger**: When connector is added, updated, deleted, or metadata is updated
- **Location**: Various methods in `ConnectorController`
- **Enhancement**: Fetches connector name from connector service instead of just using ID

## Configuration Required

### Webhook Server `.env`

Ensure these variables are set:
```bash
DATABASE_SERVER_URL=http://localhost:3002
DATABASE_SERVER_SERVICE_TOKEN=your_service_token_here
```

## Testing

### Test Inbound Call Activity
1. Make an inbound call to a phone number connected to a Retell agent
2. Wait for `call_started` webhook
3. Check activities API: `GET /api/activities/:subaccountId`
4. Verify activity shows: "Call was received from +1234567890"

### Test Meeting Booking Activity
1. Use the `/book-appointment` webhook endpoint
2. Successfully book a meeting
3. Check activities API
4. Verify activity shows: "Meeting successfully booked with +1234567890"

### Test Bulk Call Activity
1. Create a bulk call via: `POST /api/calls/:subaccountId/batch-call`
2. Check activities API
3. Verify activity shows: "Bulk call was initiated to X numbers"

### Test Connector Name Display
1. Update a connector config: `PATCH /api/connectors/:subaccountId/:connectorId/config`
2. Check activities API
3. Verify activity shows connector name instead of ID
4. Check logs for connector fetch details

## Files Modified

### Database Server
1. `src/services/activityService.js` - Added new activity types and category
2. `src/controllers/activityController.js` - Added service endpoint for logging activities
3. `src/routes/activityRoutes.js` - Added route for service-to-service activity logging
4. `src/controllers/callController.js` - Updated outbound and bulk call messages
5. `src/controllers/connectorController.js` - Updated all connector messages to use names

### Webhook Server
1. `src/controllers/webhookController.js` - Added activity logging for inbound calls and meetings, plus helper function

## Benefits

1. **Better UX**: Users see descriptive, human-readable activity messages
2. **Clearer History**: Activity log is easier to understand at a glance
3. **Consistent Format**: All messages follow similar patterns
4. **Complete Tracking**: Now tracks inbound calls and meeting bookings
5. **Service Integration**: Webhook server can log activities via database server API

