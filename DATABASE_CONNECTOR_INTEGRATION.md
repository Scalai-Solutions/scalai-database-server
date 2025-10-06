# Database Server - Connector Integration

## Overview

The database server now includes connector information in responses to support multi-connector calendar integrations in the webhook server.

---

## Changes Made

### 1. **connectionPoolManager.js** - Updated Response Schema

#### `getSubaccountDetails()` Method

Now includes `activatedConnectors` in the response:

```javascript
const subaccountDetails = {
  mongodbUrl: mongodbUrl,
  subaccountId: subaccountId,
  activatedConnectors: response.data.data.activatedConnectors || [
    // Default to google_calendar if not specified (backward compatibility)
    {
      type: 'google_calendar',
      config: {}
    }
  ],
  databaseName: response.data.data.databaseName,
  enforceSchema: response.data.data.enforceSchema,
  // ... other fields
};
```

#### `getConnection()` Method

Now returns `activatedConnectors` along with connection:

```javascript
return {
  connection: pool.connection,
  subaccountId: pool.subaccountId,
  databaseName: pool.databaseName,
  activatedConnectors: pool.activatedConnectors || [
    {
      type: 'google_calendar',
      config: {}
    }
  ]
};
```

#### `createPool()` Method

Now stores `activatedConnectors` in the pool object:

```javascript
const pool = {
  connection: mongooseConnection,
  subaccountId,
  databaseName: subaccountDetails.databaseName,
  activatedConnectors: subaccountDetails.activatedConnectors,
  // ... other fields
};
```

---

## Expected Tenant Manager Response

The database server expects the tenant manager API to return this schema:

```json
{
  "success": true,
  "data": {
    "mongodbUrl": "mongodb://...",
    "databaseName": "subaccount_db",
    "subaccountId": "68cf05f060d294db17c0685e",
    
    "activatedConnectors": [
      {
        "type": "google_calendar",
        "config": {}
      },
      {
        "type": "outlook_calendar",
        "config": {
          "clientId": "...",
          "tenantId": "..."
        }
      }
    ],
    
    "enforceSchema": true,
    "allowedCollections": ["agents", "calls"],
    "rateLimits": {},
    "maxConnections": 5,
    "encryptionIV": "...",
    "encryptionAuthTag": "..."
  }
}
```

---

## Default Behavior

If the tenant manager does **NOT** provide `activatedConnectors`, the database server defaults to:

```json
{
  "activatedConnectors": [
    {
      "type": "google_calendar",
      "config": {}
    }
  ]
}
```

This ensures **backward compatibility** with existing setups.

---

## Connector Schema

### Connector Object Structure

```javascript
{
  type: String,        // Connector type identifier (e.g., 'google_calendar', 'outlook_calendar')
  config: Object       // Connector-specific configuration (optional)
}
```

### Supported Connector Types

Currently:
- `google_calendar` - Google Calendar integration
- `outlook_calendar` - Microsoft Outlook Calendar (future)
- `apple_calendar` - Apple Calendar (future)

---

## How It Works

### 1. Request Flow

```
Service (webhook-server)
    ↓
Database Server: connectionPoolManager.getConnection()
    ↓
Database Server: getSubaccountDetails()
    ↓
Tenant Manager API: GET /api/subaccounts/:subaccountId
    ↓
Response includes: mongodbUrl + activatedConnectors
    ↓
Cached in Redis (1 hour)
    ↓
Returned to Service
```

### 2. Caching

- **Cache Duration**: 1 hour
- **Cache Key**: `db_pool:{subaccountId}`
- **Invalidation**: Automatic after TTL expires
- **Contains**: Full subaccount details including `activatedConnectors`

### 3. Usage in Services

Services that use the database server connection now receive connector information:

```javascript
const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);

// Available fields:
connectionInfo.connection           // Mongoose connection
connectionInfo.subaccountId        // Subaccount ID
connectionInfo.databaseName        // Database name
connectionInfo.activatedConnectors // Array of activated connectors
```

---

## Integration with Webhook Server

The webhook server's `tenantService.getTenantConfig()` can now use this information:

```javascript
// webhook-server/src/services/tenantService.js
async getTenantConfig(subaccountId) {
  const response = await this.getMongoURL(subaccountId);
  
  return {
    mongoURL: response.mongoURL,
    subaccountId: response.subaccountId,
    activatedConnectors: response.activatedConnectors || [
      { type: 'google_calendar', config: {} }
    ]
  };
}
```

---

## Examples

### Example 1: Single Connector (Default)

**Tenant Manager Response:**
```json
{
  "data": {
    "mongodbUrl": "mongodb://...",
    "activatedConnectors": [
      {
        "type": "google_calendar",
        "config": {}
      }
    ]
  }
}
```

**Database Server Returns:**
```javascript
{
  connection: MongooseConnection,
  subaccountId: "68cf05f060d294db17c0685e",
  databaseName: "subaccount_db",
  activatedConnectors: [
    {
      type: "google_calendar",
      config: {}
    }
  ]
}
```

### Example 2: Multiple Connectors

**Tenant Manager Response:**
```json
{
  "data": {
    "mongodbUrl": "mongodb://...",
    "activatedConnectors": [
      {
        "type": "google_calendar",
        "config": {}
      },
      {
        "type": "outlook_calendar",
        "config": {
          "clientId": "abc123",
          "tenantId": "xyz789"
        }
      }
    ]
  }
}
```

**Database Server Returns:**
```javascript
{
  connection: MongooseConnection,
  activatedConnectors: [
    { type: "google_calendar", config: {} },
    { type: "outlook_calendar", config: { clientId: "abc123", tenantId: "xyz789" } }
  ]
}
```

### Example 3: No Connectors Specified (Backward Compatibility)

**Tenant Manager Response:**
```json
{
  "data": {
    "mongodbUrl": "mongodb://..."
    // No activatedConnectors field
  }
}
```

**Database Server Returns (with default):**
```javascript
{
  connection: MongooseConnection,
  activatedConnectors: [
    {
      type: "google_calendar",
      config: {}
    }
  ]
}
```

---

## Migration Notes

### For Existing Systems

1. **No Changes Required**: Existing systems work without modification
2. **Default Behavior**: If tenant manager doesn't return `activatedConnectors`, defaults to Google Calendar
3. **Gradual Migration**: Add connector configuration when ready

### For New Systems

1. **Tenant Manager**: Update response to include `activatedConnectors`
2. **Database Server**: Already updated ✅
3. **Webhook Server**: Already updated to use connectors ✅

---

## Testing

### Test 1: Default Connector

```bash
# Get connection (tenant manager returns no activatedConnectors)
# Should default to google_calendar
```

### Test 2: Single Connector

```bash
# Get connection (tenant manager returns one connector)
# Should return that connector
```

### Test 3: Multiple Connectors

```bash
# Get connection (tenant manager returns multiple connectors)
# Should return all connectors
```

### Test 4: Cache Behavior

```bash
# Get connection twice
# Second call should use cached data (including connectors)
```

---

## Benefits

### ✅ **Backward Compatible**
- Works with existing tenant manager responses
- Defaults to Google Calendar if not specified

### ✅ **Extensible**
- Easy to add new connector types
- Connector-specific configuration supported

### ✅ **Efficient**
- Cached for 1 hour
- No extra API calls needed

### ✅ **Consistent**
- Same connector schema across all services
- Unified configuration format

---

## Summary

The database server now:
1. ✅ Fetches `activatedConnectors` from tenant manager
2. ✅ Caches connector information with connection details
3. ✅ Returns connector information to services
4. ✅ Provides backward compatibility with defaults
5. ✅ Supports multiple connector types

**All services now have access to connector configuration!** 🎉

---

## Related Documentation

- **Webhook Server**: `CONNECTOR_PATTERN_GUIDE.md` - Full connector implementation
- **Webhook Server**: `CONNECTOR_PATTERN_SUMMARY.md` - Connector overview
- **Database Server**: `DATABASE_CONNECTOR_INTEGRATION.md` - This file

---

## Tenant Manager TODO

To fully enable the connector pattern, the tenant manager should:

1. Add `activatedConnectors` field to subaccount schema
2. Allow updating activated connectors via API
3. Return `activatedConnectors` in GET `/api/subaccounts/:subaccountId`
4. Validate connector types and configurations

**Example Tenant Manager Schema Update:**

```javascript
// Subaccount Schema
{
  mongodbUrl: String,
  databaseName: String,
  activatedConnectors: [
    {
      type: {
        type: String,
        enum: ['google_calendar', 'outlook_calendar', 'apple_calendar'],
        required: true
      },
      config: mongoose.Schema.Types.Mixed,
      isActive: {
        type: Boolean,
        default: true
      }
    }
  ]
}
```

