# Google Calendar Integration - Quick Start

## What Was Implemented

✅ **Proxy Route in Database Server:** `/api/connectors/:subaccountId/handlegooglecalendar`  
✅ **Automatic Metadata Updates:** CalendarId stored in connector metadata after successful OAuth  
✅ **Service-to-Service Authentication:** Using service tokens for secure communication  
✅ **Async Callback:** Webhook server updates database server after OAuth success  
✅ **GET APIs include metadata:** All connector GET endpoints return metadata field  

## Quick Usage

### 1. Add Environment Variables

**Database Server (`.env`):**
```bash
WEBHOOK_SERVER_URL=http://localhost:3004
WEBHOOK_SERVER_SERVICE_TOKEN=your-webhook-service-token
```

**Webhook Server (`.env`):**
```bash
DATABASE_SERVER_URL=http://localhost:3002
DATABASE_SERVER_SERVICE_TOKEN=your-database-service-token
```

### 2. Use the API

```bash
# Initiate Google Calendar connection
curl -X POST 'http://localhost:3002/api/connectors/68cf05f060d294db17c0685e/handlegooglecalendar' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "userEmail": "user@example.com"
  }'
```

### 3. Response

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

### 4. After User Authorizes

The connector metadata in `connectorsubaccount` collection will automatically be updated with:

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

### 5. Retrieve Connector with Metadata

```bash
# Get specific connector (includes metadata)
curl -X GET 'http://localhost:3002/api/connectors/68cf05f060d294db17c0685e/google-calendar' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'

# Get all connectors for subaccount (includes metadata)
curl -X GET 'http://localhost:3002/api/connectors/68cf05f060d294db17c0685e' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

Both GET endpoints return the full connector object including the `metadata` field.

## Flow

```
1. User → Database Server → Webhook Server
   POST /api/connectors/:subaccountId/handlegooglecalendar
   
2. Webhook Server → User
   Returns authUrl
   
3. User → Google
   Authorizes calendar access
   
4. Google → Webhook Server
   OAuth callback with tokens
   
5. Webhook Server → Database Server (async)
   POST /api/connectors/:subaccountId/metadata/update
   Updates connector metadata with calendarId
```

## Files Modified

### Database Server
- `src/controllers/connectorController.js` - Added proxy and metadata update endpoints
- `src/services/connectorService.js` - Added OAuth proxy and metadata update methods
- `src/routes/connectorRoutes.js` - Added new routes
- `config/config.js` - Added webhook server config

### Webhook Server
- `src/controllers/googleCalendarController.js` - Added callback to database server
- `src/routes/googleCalendarRoutes.js` - Added service auth to /connect
- `src/middleware/serviceAuthMiddleware.js` - New service auth middleware (created)
- `config/config.js` - Added database server config

## Important Notes

1. **Connector ID:** Assumes Google Calendar connector ID is `"google-calendar"`
2. **Metadata Update:** Happens asynchronously - may take a few seconds
3. **Prerequisite:** Connector must exist in `connectorsubaccount` before calling this endpoint
4. **Service Tokens:** Both servers need valid service tokens configured

## Complete Documentation

See `GOOGLE_CALENDAR_PROXY_INTEGRATION.md` for full documentation.
