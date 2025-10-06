# Google Calendar Proxy Integration

This document describes the Google Calendar integration between the database-server and webhook-server.

## Overview

The database-server now acts as a proxy for Google Calendar connections, forwarding requests to the webhook-server and automatically updating connector metadata when OAuth is successful.

## Architecture Flow

```
User/Frontend
    ↓
    POST /api/connectors/:subaccountId/handlegooglecalendar
    ↓
Database Server (Proxy)
    ↓ (with service token)
    POST /api/google/{subaccountId}/connect
    ↓
Webhook Server
    ↓
    Returns authUrl
    ↓
User clicks authUrl → Google OAuth
    ↓
Google redirects to callback
    ↓
Webhook Server handles callback
    ↓
    Stores Google OAuth tokens
    ↓
    Creates/Updates Calendar entry
    ↓
    **Directly updates connector metadata**
    (using its own connection pool)
```

**Note:** The webhook server now directly updates the `connectorsubaccount` collection using its own database connection pool instead of making HTTP requests to the database server. This is more efficient and avoids authentication complexity.

## API Endpoints

### 1. Initiate Google Calendar Connection (Database Server)

**Endpoint:** `POST /api/connectors/:subaccountId/handlegooglecalendar`

**Authentication:** JWT Bearer Token

**Path Parameters:**
- `subaccountId` (string, required) - The subaccount ID

**Request Body:**
```json
{
  "userEmail": "user@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Authorization link sent to user@example.com",
  "data": {
    "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
    "userEmail": "user@example.com",
    "subaccountId": "68cf05f060d294db17c0685e",
    "emailSent": true
  }
}
```

**What it does:**
- Validates input (subaccountId and userEmail required)
- Proxies the request to webhook-server with service authentication
- Returns the OAuth authorization URL to the user
- Optionally sends email with the auth link (default: true)

### 2. ~~Update Connector Metadata Endpoint~~ (Deprecated)

**Note:** This endpoint still exists in the database server but is **no longer used**. The webhook server now directly updates the connector metadata in the database using its own connection pool.

The webhook server performs the following after successful OAuth:
1. Gets MongoDB connection for the subaccount
2. Finds the `connectorsubaccount` document
3. Updates the metadata field with:
   - `calendarId` - The created calendar ID
   - `userEmail` - User's email from request
   - `googleEmail` - Authenticated Google account email
   - `connectedAt` - ISO timestamp
   - `isConnected` - Boolean (true)
4. Updates the `updatedAt` field

This approach:
- ✅ Avoids service-to-service HTTP requests
- ✅ No authentication complexity
- ✅ Better performance
- ✅ Simpler error handling

## Service Configuration

### Database Server Environment Variables

Add these to your `.env`:

```bash
# Webhook Server Configuration
WEBHOOK_SERVER_URL=http://localhost:3004
WEBHOOK_SERVER_SERVICE_TOKEN=your-webhook-server-service-token
```

### Webhook Server Environment Variables

**Note:** The webhook server now updates connector metadata directly using its connection pool, so `DATABASE_SERVER_URL` and `DATABASE_SERVER_SERVICE_TOKEN` are **no longer required** for this feature. However, you may still need them for other integrations.

```bash
# Not required for Google Calendar metadata updates anymore
# DATABASE_SERVER_URL=http://localhost:3002
# DATABASE_SERVER_SERVICE_TOKEN=your-database-server-service-token
```

## Code Changes

### Database Server

1. **New Controller Methods** (`src/controllers/connectorController.js`):
   - `handleGoogleCalendarConnect()` - Proxy endpoint
   - `updateConnectorMetadata()` - Metadata update endpoint

2. **New Service Methods** (`src/services/connectorService.js`):
   - `initiateGoogleCalendarOAuth()` - Proxy to webhook-server
   - `updateConnectorMetadata()` - Update connector metadata in DB

3. **New Routes** (`src/routes/connectorRoutes.js`):
   - `POST /:subaccountId/handlegooglecalendar` - With JWT auth
   - `POST /:subaccountId/metadata/update` - With service token auth (deprecated, not used)

4. **Updated Config** (`config/config.js`):
   - Added `webhookServer` configuration section

### Webhook Server

1. **Updated Controller** (`src/controllers/googleCalendarController.js`):
   - Modified `handleOAuthCallback()` to update metadata directly
   - Added `updateConnectorMetadata()` helper function that:
     - Uses `connectionService.getConnection(subaccountId)` to get DB connection
     - Directly updates the `connectorsubaccount` collection
     - No HTTP requests needed

2. **New Middleware** (`src/middleware/serviceAuthMiddleware.js`):
   - Service token authentication middleware
   - Permission checking middleware

3. **Updated Routes** (`src/routes/googleCalendarRoutes.js`):
   - Added service authentication to `/connect` endpoint

## Usage Example

### cURL Request

```bash
curl --location 'http://localhost:3002/api/connectors/68cf05f060d294db17c0685e/handlegooglecalendar' \
--header 'Authorization: Bearer YOUR_JWT_TOKEN' \
--header 'Content-Type: application/json' \
--data-raw '{
    "userEmail": "user@example.com"
}'
```

### Response Flow

1. **Initial Request Response:**
   - Returns OAuth authorization URL
   - Email sent to user (if configured)

2. **User Authorizes:**
   - User clicks the authUrl
   - Completes Google OAuth flow

3. **Callback Handling:**
   - Webhook-server handles the callback
   - Stores tokens in GoogleAuth collection
   - Creates/updates Calendar entry
   - **Directly and asynchronously** updates connector metadata in the same database

4. **Final State:**
   - Connector metadata in `connectorsubaccount` collection contains:
     ```json
     {
       "metadata": {
         "calendarId": "507f1f77bcf86cd799439011",
         "userEmail": "user@example.com",
         "googleEmail": "googleuser@gmail.com",
         "connectedAt": "2025-10-05T12:00:00.000Z",
         "isConnected": true
       }
     }
     ```

## Database Schema

### connectorsubaccount Collection

After successful OAuth, the connector document will include:

```javascript
{
  _id: ObjectId("..."),
  subaccountId: "68cf05f060d294db17c0685e",
  connectorId: "google-calendar",
  connectorType: "calendar",
  config: { /* existing config */ },
  metadata: {
    calendarId: "507f1f77bcf86cd799439011",
    userEmail: "user@example.com",
    googleEmail: "googleuser@gmail.com", 
    connectedAt: "2025-10-05T12:00:00.000Z",
    isConnected: true
  },
  isActive: true,
  createdAt: Date(...),
  updatedAt: Date(...)
}
```

## Security

1. **Service-to-Service Authentication:**
   - All inter-service communication uses service tokens
   - Tokens are validated with auth-server
   - Results cached for 5 minutes

2. **User Authentication:**
   - Frontend endpoints require JWT authentication
   - User must have appropriate permissions

3. **Token Storage:**
   - Google OAuth tokens stored securely in MongoDB
   - Access tokens cached in Redis with TTL
   - Automatic token refresh on expiry

## Error Handling

1. **Proxy Errors:**
   - If webhook-server is unavailable, returns 500
   - Detailed error logging for debugging

2. **OAuth Errors:**
   - Handled by webhook-server
   - User-friendly error messages

3. **Metadata Update Errors:**
   - Async operation - doesn't block OAuth callback
   - Errors logged but don't affect user flow

## Testing

### Test the Proxy Endpoint

```bash
# 1. Initiate connection
curl -X POST http://localhost:3002/api/connectors/YOUR_SUBACCOUNT_ID/handlegooglecalendar \
  -H "Authorization: Bearer JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userEmail": "user@example.com"
  }'

# 2. User visits the returned authUrl and authorizes

# 3. Check connector metadata
curl -X GET http://localhost:3002/api/connectors/YOUR_SUBACCOUNT_ID/google-calendar \
  -H "Authorization: Bearer JWT_TOKEN"
```

### Test Metadata Update (Not Needed)

**Note:** The metadata update now happens automatically and directly in the webhook server after successful OAuth. No manual testing of the metadata endpoint is required. The metadata will be updated when you complete the OAuth flow.

## Notes

1. **Connector ID:** The system assumes the connector ID for Google Calendar is `"google-calendar"`. Ensure this matches the ID in tenant-manager.

2. **Async Updates:** The metadata update is performed asynchronously after OAuth callback. This means:
   - User gets immediate feedback on successful OAuth
   - Metadata might take a few seconds to appear
   - Failures in metadata update won't affect user experience

3. **Cache Invalidation:** Both connector list and individual connector caches are invalidated when metadata is updated.

4. **Service Tokens:** Ensure both servers have valid service tokens configured and that the auth-server recognizes them.

## Troubleshooting

### Issue: "Service token required" error

**Solution:** Ensure `WEBHOOK_SERVER_SERVICE_TOKEN` is set in database-server's `.env`

### Issue: Metadata not updating after OAuth

**Check:**
1. Webhook-server logs for errors calling database-server
2. Database-server service token is valid
3. `DATABASE_SERVER_SERVICE_TOKEN` is set in webhook-server's `.env`
4. Connector exists in `connectorsubaccount` collection

### Issue: "Connector not found" error

**Solution:** Ensure the connector is added to the subaccount first using:
```bash
POST /api/connectors/:subaccountId
```

## Future Enhancements

1. Add retry logic for metadata updates
2. Add webhook notifications for successful connections
3. Support multiple calendar connections per subaccount
4. Add disconnect endpoint that cleans up metadata
