# WhatsApp Integration Guide

## Overview

The WhatsApp integration allows you to connect chat agents with WhatsApp accounts using QR code authentication. Once connected, your chat agent can send and receive WhatsApp messages, enabling automated customer support through WhatsApp.

## Features

- 🔐 **QR Code Authentication** - Easy setup by scanning QR code with WhatsApp mobile app
- 💬 **Two-way Messaging** - Send and receive WhatsApp messages
- 📝 **Message History** - Track all WhatsApp conversations in the database
- 🔄 **Session Management** - Persistent sessions with automatic reconnection
- 📊 **Activity Logging** - All WhatsApp activities are logged for audit and analytics
- 🤖 **Agent Integration** - Link WhatsApp to existing chat agents

## Architecture

The WhatsApp integration follows the connector pattern and consists of:

1. **BaseChatConnector** - Abstract base class for chat connectors
2. **WhatsAppConnector** - WhatsApp-specific implementation using `whatsapp-web.js`
3. **WhatsAppService** - Service layer for managing WhatsApp sessions
4. **WhatsAppController** - REST API endpoints for WhatsApp operations
5. **Database Collections**:
   - `whatsappconnections` - Stores connection metadata
   - `whatsappmessages` - Stores message history

## Prerequisites

Before you begin, ensure you have:

1. A chat agent created in the system
2. WhatsApp Business or Personal account
3. Access to WhatsApp mobile app for QR scanning

## Quick Start

### Step 1: Install Dependencies

The required dependencies are already added to `package.json`:

```bash
npm install
```

Dependencies include:
- `whatsapp-web.js` - WhatsApp Web API library
- `qrcode` - QR code generation

### Step 2: Connect WhatsApp to a Chat Agent

#### Initialize Connection and Generate QR Code

**Endpoint:** `POST /api/whatsapp/:subaccountId/:agentId/connect`

**Request:**
```bash
curl -X POST \
  'https://your-domain.com/api/whatsapp/SUBACCOUNT_ID/AGENT_ID/connect' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response:**
```json
{
  "success": true,
  "message": "WhatsApp QR code generated. Scan with your mobile app.",
  "data": {
    "qrCode": "2@XXX...",
    "qrCodeDataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSU...",
    "message": "Scan this QR code with WhatsApp mobile app"
  },
  "meta": {
    "operationId": "uuid",
    "duration": "1234ms"
  }
}
```

#### Display QR Code on Frontend

Use the `qrCodeDataUrl` to display the QR code on your internal agent's page:

```html
<img src="data:image/png;base64,iVBORw0KGgoAAAANSU..." alt="WhatsApp QR Code" />
<p>Scan this QR code with your WhatsApp mobile app</p>
```

#### Scan with WhatsApp Mobile App

1. Open WhatsApp on your phone
2. Tap Menu (⋮) or Settings
3. Tap "Linked Devices"
4. Tap "Link a Device"
5. Point your phone at the QR code displayed on screen

Once scanned, the connection will be established automatically.

### Step 3: Check Connection Status

**Endpoint:** `GET /api/whatsapp/:subaccountId/:agentId/status`

**Request:**
```bash
curl -X GET \
  'https://your-domain.com/api/whatsapp/SUBACCOUNT_ID/AGENT_ID/status' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Response (Connected):**
```json
{
  "success": true,
  "message": "WhatsApp connection status retrieved",
  "data": {
    "isConnected": true,
    "isActive": true,
    "hasQR": false,
    "qrCodeDataUrl": null,
    "phoneNumber": "1234567890",
    "platform": "android",
    "pushname": "My Business"
  },
  "meta": {
    "operationId": "uuid",
    "duration": "123ms"
  }
}
```

**Response (Not Connected):**
```json
{
  "success": true,
  "message": "WhatsApp connection status retrieved",
  "data": {
    "isConnected": false,
    "status": "not_initialized"
  },
  "meta": {
    "operationId": "uuid",
    "duration": "45ms"
  }
}
```

## API Reference

### 1. Initialize Connection

**Endpoint:** `POST /api/whatsapp/:subaccountId/:agentId/connect`

**Description:** Initializes WhatsApp connection and generates QR code for scanning.

**Path Parameters:**
- `subaccountId` (string, required) - The subaccount ID
- `agentId` (string, required) - The chat agent ID

**Response:** QR code data for scanning

### 2. Get Connection Status

**Endpoint:** `GET /api/whatsapp/:subaccountId/:agentId/status`

**Description:** Get current WhatsApp connection status.

**Path Parameters:**
- `subaccountId` (string, required) - The subaccount ID
- `agentId` (string, required) - The chat agent ID

**Response:** Connection status and account information

### 3. Send WhatsApp Message

**Endpoint:** `POST /api/whatsapp/:subaccountId/:agentId/send`

**Description:** Send a WhatsApp message to a recipient.

**Path Parameters:**
- `subaccountId` (string, required) - The subaccount ID
- `agentId` (string, required) - The chat agent ID

**Request Body:**
```json
{
  "to": "1234567890",
  "message": "Hello from our chat agent!"
}
```

**Notes:**
- Phone number format: International format without '+' (e.g., "1234567890")
- The system automatically adds "@c.us" suffix

**Response:**
```json
{
  "success": true,
  "message": "WhatsApp message sent successfully",
  "data": {
    "messageId": "true_1234567890@c.us_ABC123",
    "to": "1234567890@c.us",
    "message": "Hello from our chat agent!",
    "timestamp": 1699564800
  },
  "meta": {
    "operationId": "uuid",
    "duration": "567ms"
  }
}
```

### 4. Get Message History

**Endpoint:** `GET /api/whatsapp/:subaccountId/:agentId/messages`

**Description:** Retrieve WhatsApp message history for a specific agent.

**Path Parameters:**
- `subaccountId` (string, required) - The subaccount ID
- `agentId` (string, required) - The chat agent ID

**Query Parameters:**
- `limit` (number, optional) - Number of messages to retrieve (default: 50)
- `skip` (number, optional) - Number of messages to skip for pagination (default: 0)

**Response:**
```json
{
  "success": true,
  "message": "WhatsApp message history retrieved",
  "data": {
    "messages": [
      {
        "messageId": "true_1234567890@c.us_ABC123",
        "from": "1234567890@c.us",
        "to": null,
        "message": "Hello!",
        "direction": "inbound",
        "timestamp": "2024-01-01T12:00:00.000Z",
        "hasMedia": false,
        "type": "chat",
        "createdAt": "2024-01-01T12:00:01.000Z"
      }
    ],
    "count": 1
  },
  "meta": {
    "operationId": "uuid",
    "duration": "234ms"
  }
}
```

### 5. Get All Connections

**Endpoint:** `GET /api/whatsapp/:subaccountId/connections`

**Description:** Get all WhatsApp connections for a subaccount.

**Path Parameters:**
- `subaccountId` (string, required) - The subaccount ID

**Response:**
```json
{
  "success": true,
  "message": "WhatsApp connections retrieved",
  "data": {
    "connections": [
      {
        "subaccountId": "123",
        "agentId": "agent_456",
        "status": "connected",
        "phoneNumber": "1234567890",
        "platform": "android",
        "connectedAt": "2024-01-01T12:00:00.000Z",
        "createdAt": "2024-01-01T11:50:00.000Z",
        "updatedAt": "2024-01-01T12:00:00.000Z"
      }
    ],
    "count": 1
  },
  "meta": {
    "operationId": "uuid",
    "duration": "123ms"
  }
}
```

### 6. Disconnect WhatsApp

**Endpoint:** `POST /api/whatsapp/:subaccountId/:agentId/disconnect`

**Description:** Disconnect WhatsApp from a chat agent.

**Path Parameters:**
- `subaccountId` (string, required) - The subaccount ID
- `agentId` (string, required) - The chat agent ID

**Response:**
```json
{
  "success": true,
  "message": "WhatsApp disconnected successfully",
  "data": {
    "message": "WhatsApp disconnected successfully"
  },
  "meta": {
    "operationId": "uuid",
    "duration": "456ms"
  }
}
```

## Database Schema

### WhatsApp Connections Collection

Collection: `whatsappconnections`

```javascript
{
  subaccountId: String,
  agentId: String,
  status: String,                    // 'pending', 'connected', 'disconnected'
  qrGenerated: Boolean,
  connectedAt: Date,
  phoneNumber: String,
  platform: String,                  // 'android', 'ios', 'web'
  pushname: String,                  // Display name on WhatsApp
  createdBy: String,                 // User ID who created the connection
  createdAt: Date,
  updatedAt: Date,
  disconnectedAt: Date
}
```

### WhatsApp Messages Collection

Collection: `whatsappmessages`

```javascript
{
  subaccountId: String,
  agentId: String,
  messageId: String,                 // WhatsApp message ID
  from: String,                      // Sender (null for outbound)
  to: String,                        // Recipient (null for inbound)
  message: String,                   // Message content
  direction: String,                 // 'inbound' or 'outbound'
  timestamp: Date,                   // Message timestamp
  hasMedia: Boolean,
  type: String,                      // 'chat', 'image', 'video', etc.
  createdAt: Date
}
```

## Activity Tracking

All WhatsApp operations are automatically logged in the activity system:

**Activity Types:**
- `whatsapp_connected` - WhatsApp connection established
- `whatsapp_disconnected` - WhatsApp disconnected
- `whatsapp_message_sent` - Message sent via WhatsApp
- `whatsapp_message_received` - Message received from WhatsApp (future)

**Activity Category:** `chat`

## Frontend Integration Example

```javascript
// 1. Initialize connection and get QR code
async function connectWhatsApp(subaccountId, agentId) {
  const response = await fetch(
    `/api/whatsapp/${subaccountId}/${agentId}/connect`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );
  
  const data = await response.json();
  
  if (data.success) {
    // Display QR code
    document.getElementById('qr-code').src = data.data.qrCodeDataUrl;
    
    // Start polling for connection status
    pollConnectionStatus(subaccountId, agentId);
  }
}

// 2. Poll connection status
async function pollConnectionStatus(subaccountId, agentId) {
  const interval = setInterval(async () => {
    const response = await fetch(
      `/api/whatsapp/${subaccountId}/${agentId}/status`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    const data = await response.json();
    
    if (data.data.isConnected) {
      clearInterval(interval);
      console.log('WhatsApp connected!');
      document.getElementById('qr-code').style.display = 'none';
      document.getElementById('connected-message').style.display = 'block';
    }
  }, 3000); // Check every 3 seconds
}

// 3. Send a message
async function sendWhatsAppMessage(subaccountId, agentId, to, message) {
  const response = await fetch(
    `/api/whatsapp/${subaccountId}/${agentId}/send`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to, message })
    }
  );
  
  const data = await response.json();
  
  if (data.success) {
    console.log('Message sent:', data.data.messageId);
  }
}
```

## Session Management

WhatsApp sessions are persisted using the LocalAuth strategy:

- **Session Storage:** `.wwebjs_auth` directory in the project root
- **Session ID:** `{subaccountId}_{agentId}`
- **Automatic Reconnection:** Sessions persist across server restarts
- **Session Cleanup:** Delete session files to force re-authentication

## Troubleshooting

### QR Code Not Appearing

**Problem:** QR code generation times out

**Solutions:**
1. Check server has internet connectivity
2. Ensure Puppeteer dependencies are installed (especially on Linux)
3. Check server logs for errors
4. Try restarting the server

### Connection Fails After Scanning

**Problem:** QR code scanned but connection doesn't establish

**Solutions:**
1. Ensure phone has stable internet connection
2. Check if WhatsApp account is already linked to maximum devices (4 devices max)
3. Wait 30 seconds and try scanning again
4. Clear session and regenerate QR code

### Messages Not Sending

**Problem:** Send message API returns success but message not delivered

**Solutions:**
1. Verify WhatsApp is still connected (check status endpoint)
2. Ensure phone number format is correct (international format without '+')
3. Check if recipient number is on WhatsApp
4. Verify WhatsApp account hasn't been banned/restricted

### Session Lost After Restart

**Problem:** WhatsApp disconnects after server restart

**Solutions:**
1. Ensure `.wwebjs_auth` directory is persistent (not in /tmp)
2. Check file permissions on session directory
3. Verify session files aren't being deleted
4. Consider using volume mounts if running in Docker

## Rate Limits

- **Connect:** 20 requests per minute per subaccount
- **Status:** 100 requests per minute per subaccount
- **Send Message:** 200 requests per minute per subaccount
- **Get Messages:** 100 requests per minute per subaccount
- **Get Connections:** 50 requests per minute per subaccount
- **Disconnect:** 20 requests per minute per subaccount

## Security Considerations

1. **QR Code Security:** QR codes contain sensitive session data. Never expose them publicly.
2. **Session Files:** Protect `.wwebjs_auth` directory with proper file permissions.
3. **Phone Numbers:** Always validate phone numbers before sending messages.
4. **Rate Limiting:** Respect WhatsApp's rate limits to avoid account restrictions.
5. **Message Content:** Implement content filtering to prevent spam/abuse.

## Best Practices

1. **One Agent, One Account:** Link each chat agent to a separate WhatsApp account
2. **Monitor Status:** Regularly check connection status to detect disconnections
3. **Graceful Degradation:** Handle WhatsApp disconnections gracefully in your app
4. **Message Queuing:** Implement a queue for outbound messages during high load
5. **Activity Monitoring:** Use activity logs to track usage and debug issues
6. **Session Management:** Implement logic to handle session expiration and re-authentication

## Future Enhancements

Planned features for future releases:

- ✅ QR code authentication
- ✅ Send/receive text messages
- ✅ Message history
- ✅ Session persistence
- 🔄 Media message support (images, videos, documents)
- 🔄 Group chat support
- 🔄 WhatsApp Business API integration
- 🔄 Webhook notifications for incoming messages
- 🔄 Message templates
- 🔄 Automated responses via chat agent AI

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review server logs for errors
3. Consult the whatsapp-web.js documentation
4. Contact the ScalAI support team

## Related Documentation

- [Chat Agents API](./CHAT_AGENTS_API.md)
- [Activity Tracking API](./ACTIVITY_API.md)
- [RBAC System](../docs/rbac-system.md)

