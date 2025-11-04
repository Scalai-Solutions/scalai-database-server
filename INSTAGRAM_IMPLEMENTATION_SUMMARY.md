# Instagram Integration - Implementation Summary

## Overview

Successfully implemented a complete Instagram Direct Message integration that allows chat agents to automatically receive and reply to Instagram messages via Instagram Graph API.

## Key Features

✅ **QR Code Generation** - Generate QR codes linking to Instagram profile/DM  
✅ **Automatic Replies** - Incoming messages automatically processed by chat agent  
✅ **Unified Storage** - Uses existing `chats` collection, no separate storage needed  
✅ **Session Management** - Persistent sessions for each Instagram user  
✅ **Activity Logging** - All Instagram activities logged in activity system  
✅ **Real-time Processing** - Instant message handling via webhooks  
✅ **Message Deduplication** - Prevents duplicate message processing  

## Architecture

### Flow Diagram

```
┌─────────────────┐
│ Instagram User  │
└────────┬────────┘
         │ Sends DM
         ↓
┌─────────────────────┐
│ Instagram Graph API │
└────────┬────────────┘
         │ Webhook
         ↓
┌─────────────────────┐
│ Instagram Connector │
└────────┬────────────┘
         │ Forwards to
         ↓
┌─────────────────────┐
│   Instagram Service │
└────────┬────────────┘
         │ Processes via
         ↓
┌─────────────────────┐
│    Chat Agent       │
│  (Retell AI)        │
└────────┬────────────┘
         │ Generates reply
         ↓
┌─────────────────────┐
│ Instagram Connector │
└────────┬────────────┘
         │ Sends via API
         ↓
┌─────────────────┐
│ Instagram User  │
└─────────────────┘
```

## Components Created

### 1. **Instagram Connector**

**File:** `src/connectors/InstagramConnector.js`

Instagram-specific implementation using Instagram Graph API:
- Uses Instagram Graph API for messaging
- QR code generation for profile/DM links
- Webhook message processing
- Message deduplication using Redis
- Connection status management

**Key Methods:**
- `initialize()` - Sets up Instagram connection
- `generateQR()` - Creates QR code linking to Instagram
- `getConnectionStatus()` - Returns connection state
- `sendMessage()` - Sends Instagram Direct Messages
- `onMessage()` - Registers message handlers
- `processWebhookMessage()` - Processes incoming webhooks

### 2. **Instagram Service**

**File:** `src/services/instagramService.js`

Service layer managing sessions and agent integration:
- Manages active Instagram connectors (Map by sessionId)
- Handles incoming messages
- Forwards to chat agent (Retell)
- Extracts and sends agent replies
- Creates/manages chat sessions per Instagram user

**Key Methods:**
- `initializeConnection()` - Connects Instagram to agent
- `handleIncomingMessage()` - Processes incoming Instagram messages
- `forwardToChatAgent()` - Sends to Retell chat agent
- `getOrCreateChatSession()` - Manages chat sessions per Instagram user ID
- `extractAgentReply()` - Parses agent response
- `processWebhook()` - Handles webhook events

### 3. **Instagram Controller**

**File:** `src/controllers/instagramController.js`

REST API endpoints:
- `POST /connect` - Initialize & generate QR
- `GET /status` - Get connection status
- `POST /disconnect` - Disconnect Instagram
- `POST /send` - Send message
- `GET /messages` - Get message history
- `GET /connections` - List all connections
- `POST /webhook` - Handle Instagram webhooks

### 4. **Routes**

**File:** `src/routes/instagramRoutes.js`

Express routes with:
- Authentication middleware
- Rate limiting
- RBAC permissions
- Request validation

### 5. **Activity Service Updates**

**File:** `src/services/activityService.js`

Added Instagram activity types:
- `INSTAGRAM_CONNECTED`
- `INSTAGRAM_DISCONNECTED`
- `INSTAGRAM_MESSAGE_SENT`
- `INSTAGRAM_MESSAGE_RECEIVED`

## Database Collections

### `instagramconnections`
Stores Instagram connection configuration:
```javascript
{
  subaccountId: String,
  agentId: String,
  status: String, // 'pending', 'connected', 'disconnected'
  accessToken: String,
  instagramAccountId: String,
  pageId: String,
  webhookVerificationToken: String,
  connectedAt: Date,
  createdAt: Date,
  updatedAt: Date
}
```

### `chats` (existing collection)
Stores Instagram conversations with metadata:
```javascript
{
  chat_id: String,
  agent_id: String,
  chat_status: String,
  metadata: {
    instagram_user_id: String,
    channel: 'instagram'
  },
  messages: Array,
  ...
}
```

## API Endpoints

### Base Path
```
/api/database/:subaccountId/chat-agents/:agentId/instagram
```

### Endpoints

1. **Connect**
   - `POST /connect`
   - Initialize connection and generate QR code
   - Requires: `accessToken`, `instagramAccountId`, `pageId`, `webhookVerificationToken`

2. **Status**
   - `GET /status`
   - Get current connection status

3. **Disconnect**
   - `POST /disconnect`
   - Disconnect Instagram account

4. **Send Message**
   - `POST /send`
   - Send message to Instagram user
   - Requires: `to` (Instagram user ID), `message`

5. **Get Messages**
   - `GET /messages?limit=50&skip=0`
   - Get message history

6. **Get Connections**
   - `GET /connections`
   - List all Instagram connections for subaccount

7. **Webhook**
   - `POST /webhook`
   - Handle Instagram webhook events
   - Supports webhook verification

## Security Features

1. **Message Deduplication**: Uses Redis to prevent duplicate message processing
2. **Webhook Verification**: Validates webhook requests from Instagram
3. **Access Token Storage**: Securely stored in database (should be encrypted in production)
4. **RBAC Integration**: All endpoints require proper permissions
5. **Rate Limiting**: Applied to all endpoints

## Differences from WhatsApp Integration

| Feature | WhatsApp | Instagram |
|---------|----------|-----------|
| Authentication | QR Code Scan | Facebook OAuth + API |
| Library | whatsapp-web.js | Instagram Graph API |
| Connection | Web-based session | API tokens |
| QR Code | Links to WhatsApp | Links to Instagram profile |
| Webhooks | Not needed | Required for receiving messages |

## Configuration Required

1. **Facebook App Setup**:
   - Create Facebook App
   - Add Messenger product
   - Link Instagram account
   - Generate Page Access Token

2. **Webhook Configuration**:
   - Set webhook URL in Facebook Developer Console
   - Configure verification token
   - Subscribe to message events

3. **Access Token Permissions**:
   - `instagram_basic`
   - `pages_messaging`
   - `instagram_manage_messages`

## Frontend Integration

See `INSTAGRAM_FRONTEND_GUIDE.md` for complete frontend integration guide including:
- React component examples
- Connection flow
- QR code display
- Status polling
- Error handling

## Testing

### Manual Testing

1. Connect Instagram account via API
2. Verify QR code generation
3. Send test message from Instagram
4. Verify webhook receives message
5. Check agent processes and responds
6. Verify message stored in database

### Test Checklist

- [ ] Connection endpoint works
- [ ] QR code generates correctly
- [ ] Status endpoint returns correct state
- [ ] Webhook verification works
- [ ] Incoming messages processed
- [ ] Agent responses sent
- [ ] Messages stored in database
- [ ] Deduplication prevents duplicates
- [ ] Error handling works correctly

## Known Limitations

1. **Instagram Account Type**: Requires Business or Creator account
2. **Facebook Page**: Must be linked to Facebook Page
3. **Webhook URL**: Must be publicly accessible (HTTPS)
4. **Rate Limits**: Subject to Instagram Graph API rate limits
5. **Message Types**: Currently supports text messages (attachments coming soon)

## Future Enhancements

- [ ] Support for media attachments (images, videos)
- [ ] Support for message templates
- [ ] Read receipts and typing indicators
- [ ] Story mentions handling
- [ ] Broadcast messages
- [ ] Multiple Instagram accounts per agent

## Documentation

- **Frontend Guide**: `INSTAGRAM_FRONTEND_GUIDE.md`
- **Quick Start**: `INSTAGRAM_QUICK_START.md`
- **This Summary**: `INSTAGRAM_IMPLEMENTATION_SUMMARY.md`

## Related Files

- `src/connectors/InstagramConnector.js`
- `src/services/instagramService.js`
- `src/controllers/instagramController.js`
- `src/routes/instagramRoutes.js`
- `src/services/activityService.js` (updated)

## Dependencies

- `axios` - HTTP client for Instagram Graph API
- `qrcode` - QR code generation
- `redis` - Message deduplication (via redisService)

No new npm packages required - uses existing dependencies.

