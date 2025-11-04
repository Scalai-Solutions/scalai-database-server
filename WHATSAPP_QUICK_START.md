# WhatsApp Integration - Quick Start

## Overview

This WhatsApp integration connects your chat agents directly to WhatsApp accounts. When someone sends a message to your WhatsApp number, it's **automatically processed by your chat agent** and the response is sent back via WhatsApp.

**Key Feature:** Messages are stored in your existing `chats` collection - no separate WhatsApp message storage needed!

## Installation

1. **Install dependencies:**
```bash
cd /Users/weekend/scalai/v2/scalai-database-server
npm install
```

2. **Restart the server:**
```bash
npm start
# or for development
npm run dev
```

## How It Works

```
WhatsApp User
    ↓ (sends message)
WhatsApp Connector
    ↓ (forwards to)
Chat Agent (Retell)
    ↓ (generates reply)
WhatsApp Connector
    ↓ (sends via WhatsApp)
WhatsApp User
```

All conversations are stored in the existing `chats` collection with `metadata.channel: 'whatsapp'`.

## Usage Flow

### Step 1: Connect WhatsApp to a Chat Agent

```bash
POST /api/database/:subaccountId/chat-agents/:agentId/whatsapp/connect
Authorization: Bearer YOUR_JWT_TOKEN
```

**Response includes:**
- `qrCode` - Raw QR code string
- `qrCodeDataUrl` - Data URL for displaying in `<img>` tag

### Step 2: Display QR Code on Agent's Internal Page

```html
<div id="whatsapp-qr-container">
  <h3>Connect WhatsApp to Agent</h3>
  <img id="qr-code" alt="Scan with WhatsApp" style="width: 300px; height: 300px;" />
  <p>Open WhatsApp → Menu → Linked Devices → Link a Device</p>
  <p id="status">Waiting for scan...</p>
</div>

<script>
async function connectWhatsApp() {
  const response = await fetch(
    `/api/whatsapp/${subaccountId}/${agentId}/connect`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );
  
  const data = await response.json();
  if (data.success) {
    document.getElementById('qr-code').src = data.data.qrCodeDataUrl;
    // Start polling for connection
    pollConnection();
  }
}

async function pollConnection() {
  const interval = setInterval(async () => {
    const response = await fetch(
      `/api/whatsapp/${subaccountId}/${agentId}/status`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    
    const data = await response.json();
    if (data.data.isConnected) {
      clearInterval(interval);
      document.getElementById('status').textContent = '✅ Connected!';
      document.getElementById('qr-code').style.display = 'none';
      showConnectedInfo(data.data);
    }
  }, 3000); // Check every 3 seconds
}

function showConnectedInfo(info) {
  document.getElementById('whatsapp-qr-container').innerHTML = `
    <h3>✅ WhatsApp Connected</h3>
    <p><strong>Phone:</strong> +${info.phoneNumber}</p>
    <p><strong>Name:</strong> ${info.pushname}</p>
    <p>Your agent is now ready to receive and reply to WhatsApp messages!</p>
  `;
}

// Start connection process
connectWhatsApp();
</script>
```

### Step 3: Test It!

1. **Send a message to the connected WhatsApp number** from any phone
2. **The chat agent automatically processes it** and sends a reply
3. **View the conversation** in your existing chat system

## Automatic Reply Flow

Once connected, the system automatically:

1. ✅ **Receives** WhatsApp messages
2. ✅ **Creates/uses** a chat session for each contact (phone number)
3. ✅ **Forwards** message to your chat agent
4. ✅ **Gets** AI-generated response from chat agent
5. ✅ **Sends** response back via WhatsApp
6. ✅ **Stores** everything in `chats` collection

**No manual intervention needed!**

## Key Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/database/:subaccountId/chat-agents/:agentId/whatsapp/connect` | Generate QR code & initialize |
| GET | `/api/database/:subaccountId/chat-agents/:agentId/whatsapp/status` | Check if connected |
| POST | `/api/database/:subaccountId/chat-agents/:agentId/whatsapp/send` | Manually send a message (optional) |
| GET | `/api/database/:subaccountId/chat-agents/:agentId/whatsapp/messages` | Get chat history from WhatsApp |
| POST | `/api/database/:subaccountId/chat-agents/:agentId/whatsapp/disconnect` | Disconnect WhatsApp |
| GET | `/api/database/:subaccountId/chat-agents/whatsapp/connections` | List all connections |

## Manual Sending (Optional)

You can also manually send messages:

```bash
POST /api/whatsapp/:subaccountId/:agentId/send
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "to": "1234567890",
  "message": "Hello from our agent!"
}
```

**Phone Number Format:** Use international format without '+' (e.g., `"1234567890"` for +1-234-567-890)

## View Chat History

Get all WhatsApp chats (stored in `chats` collection):

```bash
GET /api/database/:subaccountId/chat-agents/:agentId/whatsapp/messages?limit=50
Authorization: Bearer YOUR_JWT_TOKEN
```

Or use the existing chat API:

```bash
GET /api/chats/:subaccountId/list
GET /api/chats/:subaccountId/:chatId/transcript
```

Filter by `metadata.channel === 'whatsapp'` to get only WhatsApp chats.

## Database Schema

### Chats Collection (Existing)

WhatsApp chats are stored in the existing `chats` collection with additional metadata:

```javascript
{
  chat_id: "chat_xxx",
  agent_id: "agent_yyy",
  chat_status: "ongoing",
  messages: [...],              // All messages with chat agent
  metadata: {
    whatsapp_phone: "1234567890",  // Sender's phone number
    channel: "whatsapp"              // Identifies as WhatsApp chat
  },
  subaccountId: "...",
  createdBy: "whatsapp-service",
  // ... other chat fields
}
```

### WhatsApp Connections Collection

Connection metadata is stored separately:

```javascript
{
  subaccountId: String,
  agentId: String,
  status: "connected",           // pending/connected/disconnected
  phoneNumber: "1234567890",     // Your WhatsApp number
  platform: "android",           // android/ios/web
  connectedAt: Date,
  createdAt: Date
}
```

## Session Persistence

- Sessions stored in `.wwebjs_auth/` directory
- Session ID: `{subaccountId}_{agentId}`
- Persists across server restarts
- Delete session folder to force re-authentication

## Important Notes

### ✅ What Happens Automatically

- Incoming messages trigger chat agent responses
- Each phone number gets its own chat session
- Chat sessions persist (like web chats)
- All messages stored in existing `chats` collection
- Works 24/7 once connected

### ⚠️ Important Limitations

1. **QR Code Expires:** Generate new QR if not scanned within 30 seconds
2. **Device Limit:** WhatsApp allows max 4 linked devices per account
3. **Rate Limits:** Respect WhatsApp's messaging limits
4. **Session Management:** Ensure `.wwebjs_auth` persists (not in /tmp)
5. **One Agent Per Account:** Each WhatsApp number should connect to one chat agent

## Testing Example

```javascript
// 1. Create chat agent
const agentResponse = await fetch('/api/database/:subaccountId/chat-agents', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'WhatsApp Support Bot',
    description: 'Handles customer support via WhatsApp'
  })
});

const agent = await agentResponse.json();
const agentId = agent.data.agentId;

// 2. Connect WhatsApp
const connectResponse = await fetch(
  `/api/whatsapp/${subaccountId}/${agentId}/connect`,
  {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  }
);

const qrData = await connectResponse.json();
// Display qrData.data.qrCodeDataUrl

// 3. Scan QR with WhatsApp

// 4. Send a test message from any phone to your WhatsApp number
// The agent will automatically reply!

// 5. View the conversation
const chatsResponse = await fetch(
  `/api/whatsapp/${subaccountId}/${agentId}/messages`,
  {
    headers: { 'Authorization': `Bearer ${token}` }
  }
);

const chats = await chatsResponse.json();
console.log('WhatsApp chats:', chats.data.chats);
```

## Troubleshooting

### QR Code Not Appearing
- Check internet connectivity
- Ensure Puppeteer dependencies installed (Linux)
- Check server logs for errors

### Connection Fails After Scanning
- Ensure stable internet on phone
- Check device limit (max 4 devices)
- Wait 30 seconds and retry
- Clear session and regenerate

### Agent Not Replying
- Check connection status: `GET /api/whatsapp/:subaccountId/:agentId/status`
- Verify chat agent is activated
- Check server logs for errors
- Ensure Retell account is active

### Session Lost After Restart
- Ensure `.wwebjs_auth` is persistent
- Check file permissions
- Use volume mounts in Docker

## Linux Server Setup (if needed)

If running on Linux and encountering Puppeteer issues:

```bash
# Debian/Ubuntu
sudo apt-get update
sudo apt-get install -y \
  gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 \
  libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 \
  libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 \
  libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 \
  libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
  libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates \
  fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget
```

## Files Created

### Core Implementation
- `src/connectors/BaseChatConnector.js` - Base class for chat connectors
- `src/connectors/WhatsAppConnector.js` - WhatsApp implementation
- `src/services/whatsappService.js` - Session management & agent integration
- `src/controllers/whatsappController.js` - REST API controller
- `src/routes/whatsappRoutes.js` - API routes

### Updated Files
- `src/app.js` - Added WhatsApp routes
- `src/services/activityService.js` - Added WhatsApp activity types
- `package.json` - Added dependencies

## What Makes This Special

✨ **No separate message storage** - Uses existing `chats` collection  
✨ **Fully automated** - No manual reply needed  
✨ **Persistent sessions** - Each contact has their own chat session  
✨ **Unified system** - Same chat data structure for web and WhatsApp  
✨ **Easy integration** - Scan QR and you're done!  

## Next Steps

- ✅ Connect WhatsApp to your chat agent
- ✅ Test with a message from your phone
- ✅ Monitor conversations in your existing chat dashboard
- ✅ Customize chat agent responses for WhatsApp
- ✅ Set up activity logging and analytics

## Support

For detailed documentation:
- Full integration guide: `WHATSAPP_INTEGRATION_GUIDE.md`
- Chat agents API: `CHAT_AGENTS_API.md`
- Activity tracking: `ACTIVITY_API.md`
