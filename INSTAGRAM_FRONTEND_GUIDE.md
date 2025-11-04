# Instagram Integration - Frontend Guide

## Overview

This guide provides step-by-step instructions for integrating Instagram Direct Messages with your chat agents. Users can connect their Instagram accounts via QR code scanning, and incoming messages will be automatically processed by your chat agent.

## Prerequisites

1. **Instagram Business or Creator Account**: The Instagram account must be converted to a Business or Creator account
2. **Facebook Page**: The Instagram account must be linked to a Facebook Page
3. **Facebook App**: A Facebook App with Instagram Messaging API enabled
4. **Access Tokens**: Instagram Graph API access token and Page access token

## Setup Steps

### Step 1: Facebook Developer Setup

1. Go to [Facebook for Developers](https://developers.facebook.com/)
2. Create a new app or select an existing app
3. Add the **Messenger** product to your app
4. Configure Instagram Messaging:
   - Go to Messenger → Settings
   - Under "Instagram", click "Set Up"
   - Link your Instagram Business/Creator account
5. Generate a **Page Access Token** for the Facebook Page linked to your Instagram account
6. Set up webhooks (see Webhook Configuration section below)

### Step 2: Get Required Credentials

You'll need:
- **Instagram Account ID**: The Instagram Business Account ID
- **Page ID**: The Facebook Page ID linked to your Instagram account
- **Page Access Token**: Long-lived access token with `instagram_basic`, `pages_messaging`, and `instagram_manage_messages` permissions
- **Webhook Verification Token**: A secret token for webhook verification (you can generate any random string)

## API Endpoints

### Base URL
```
/api/database/:subaccountId/chat-agents/:agentId/instagram
```

### Authentication
All endpoints require JWT authentication:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

## Frontend Integration

### 1. Connect Instagram Account

**Endpoint:** `POST /api/database/:subaccountId/chat-agents/:agentId/instagram/connect`

**Request Body:**
```json
{
  "accessToken": "YOUR_PAGE_ACCESS_TOKEN",
  "instagramAccountId": "INSTAGRAM_ACCOUNT_ID",
  "pageId": "FACEBOOK_PAGE_ID",
  "webhookVerificationToken": "YOUR_WEBHOOK_VERIFICATION_TOKEN",
  "webhookSecret": "YOUR_WEBHOOK_SECRET" // Optional
}
```

**Response:**
```json
{
  "success": true,
  "message": "Instagram QR code generated. Scan with your mobile app or connect via API.",
  "data": {
    "qrCode": "...", // Raw QR code string
    "qrCodeDataUrl": "data:image/png;base64,...", // Data URL for <img> tag
    "instagramUrl": "https://www.instagram.com/username/",
    "username": "your_username",
    "alreadyConnected": true
  }
}
```

**Example Implementation:**

```javascript
async function connectInstagram(subaccountId, agentId, credentials) {
  try {
    const response = await fetch(
      `/api/database/${subaccountId}/chat-agents/${agentId}/instagram/connect`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          accessToken: credentials.accessToken,
          instagramAccountId: credentials.instagramAccountId,
          pageId: credentials.pageId,
          webhookVerificationToken: credentials.webhookVerificationToken
        })
      }
    );

    const data = await response.json();
    
    if (data.success) {
      // Display QR code
      displayQRCode(data.data.qrCodeDataUrl);
      // Poll for connection status
      pollConnectionStatus(subaccountId, agentId);
    }
    
    return data;
  } catch (error) {
    console.error('Error connecting Instagram:', error);
    throw error;
  }
}
```

### 2. Display QR Code

**HTML:**
```html
<div id="instagram-qr-container">
  <h3>Connect Instagram to Chat Agent</h3>
  <img id="instagram-qr-code" alt="Scan with Instagram" style="width: 300px; height: 300px;" />
  <p>Scan this QR code with your Instagram app to open your profile</p>
  <p id="instagram-status">Connecting...</p>
</div>
```

**JavaScript:**
```javascript
function displayQRCode(qrCodeDataUrl) {
  const qrImage = document.getElementById('instagram-qr-code');
  qrImage.src = qrCodeDataUrl;
  
  // Show container
  document.getElementById('instagram-qr-container').style.display = 'block';
}

// Poll connection status
async function pollConnectionStatus(subaccountId, agentId) {
  const interval = setInterval(async () => {
    const status = await getInstagramStatus(subaccountId, agentId);
    
    if (status.data.isConnected) {
      clearInterval(interval);
      document.getElementById('instagram-status').textContent = 'Connected!';
      document.getElementById('instagram-qr-container').style.display = 'none';
      // Show success message or redirect
    }
  }, 2000); // Poll every 2 seconds
  
  // Stop polling after 5 minutes
  setTimeout(() => clearInterval(interval), 300000);
}
```

### 3. Get Connection Status

**Endpoint:** `GET /api/database/:subaccountId/chat-agents/:agentId/instagram/status`

**Response:**
```json
{
  "success": true,
  "data": {
    "isConnected": true,
    "isActive": true,
    "accountInfo": {
      "id": "INSTAGRAM_ACCOUNT_ID",
      "username": "your_username",
      "accountType": "BUSINESS"
    }
  }
}
```

**Example:**
```javascript
async function getInstagramStatus(subaccountId, agentId) {
  const response = await fetch(
    `/api/database/${subaccountId}/chat-agents/${agentId}/instagram/status`,
    {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    }
  );
  
  return await response.json();
}
```

### 4. Send Message

**Endpoint:** `POST /api/database/:subaccountId/chat-agents/:agentId/instagram/send`

**Request Body:**
```json
{
  "to": "INSTAGRAM_USER_ID", // Instagram scoped user ID
  "message": "Hello! How can I help you?"
}
```

**Example:**
```javascript
async function sendInstagramMessage(subaccountId, agentId, userId, message) {
  const response = await fetch(
    `/api/database/${subaccountId}/chat-agents/${agentId}/instagram/send`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        to: userId,
        message: message
      })
    }
  );
  
  return await response.json();
}
```

### 5. Get Message History

**Endpoint:** `GET /api/database/:subaccountId/chat-agents/:agentId/instagram/messages?limit=50&skip=0`

**Response:**
```json
{
  "success": true,
  "data": {
    "chats": [
      {
        "chat_id": "chat_123",
        "agent_id": "agent_456",
        "chat_status": "ongoing",
        "start_timestamp": 1234567890,
        "message_count": 5,
        "messages": [...],
        "metadata": {
          "instagram_user_id": "user_789",
          "channel": "instagram"
        }
      }
    ],
    "count": 1
  }
}
```

### 6. Disconnect

**Endpoint:** `POST /api/database/:subaccountId/chat-agents/:agentId/instagram/disconnect`

**Example:**
```javascript
async function disconnectInstagram(subaccountId, agentId) {
  const response = await fetch(
    `/api/database/${subaccountId}/chat-agents/${agentId}/instagram/disconnect`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    }
  );
  
  return await response.json();
}
```

## Complete React Component Example

```jsx
import React, { useState, useEffect } from 'react';

function InstagramIntegration({ subaccountId, agentId, authToken }) {
  const [qrCode, setQrCode] = useState(null);
  const [status, setStatus] = useState('disconnected');
  const [isConnecting, setIsConnecting] = useState(false);

  const connectInstagram = async (credentials) => {
    setIsConnecting(true);
    try {
      const response = await fetch(
        `/api/database/${subaccountId}/chat-agents/${agentId}/instagram/connect`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify(credentials)
        }
      );

      const data = await response.json();
      
      if (data.success) {
        setQrCode(data.data.qrCodeDataUrl);
        checkStatus();
      }
    } catch (error) {
      console.error('Error connecting Instagram:', error);
    } finally {
      setIsConnecting(false);
    }
  };

  const checkStatus = async () => {
    try {
      const response = await fetch(
        `/api/database/${subaccountId}/chat-agents/${agentId}/instagram/status`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        }
      );

      const data = await response.json();
      
      if (data.success) {
        setStatus(data.data.isConnected ? 'connected' : 'disconnected');
        
        if (data.data.isConnected) {
          setQrCode(null); // Hide QR code when connected
        }
      }
    } catch (error) {
      console.error('Error checking status:', error);
    }
  };

  const disconnect = async () => {
    try {
      await fetch(
        `/api/database/${subaccountId}/chat-agents/${agentId}/instagram/disconnect`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        }
      );
      
      setStatus('disconnected');
    } catch (error) {
      console.error('Error disconnecting:', error);
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="instagram-integration">
      <h2>Instagram Integration</h2>
      
      {status === 'disconnected' && (
        <div>
          <button 
            onClick={() => connectInstagram({
              accessToken: 'YOUR_TOKEN',
              instagramAccountId: 'YOUR_ACCOUNT_ID',
              pageId: 'YOUR_PAGE_ID',
              webhookVerificationToken: 'YOUR_TOKEN'
            })}
            disabled={isConnecting}
          >
            {isConnecting ? 'Connecting...' : 'Connect Instagram'}
          </button>
        </div>
      )}

      {qrCode && (
        <div className="qr-code-container">
          <img src={qrCode} alt="Instagram QR Code" />
          <p>Scan this QR code with Instagram app</p>
        </div>
      )}

      {status === 'connected' && (
        <div>
          <p>✅ Instagram Connected</p>
          <button onClick={disconnect}>Disconnect</button>
        </div>
      )}
    </div>
  );
}

export default InstagramIntegration;
```

## Webhook Configuration

### Webhook URL
```
POST /api/database/:subaccountId/chat-agents/:agentId/instagram/webhook
```

### Webhook Setup in Facebook Developer Console

1. Go to your Facebook App → Messenger → Settings
2. Under "Webhooks", click "Edit"
3. Add callback URL: `https://your-domain.com/api/database/:subaccountId/chat-agents/:agentId/instagram/webhook`
4. Set verification token (same as `webhookVerificationToken` in connect request)
5. Subscribe to these fields:
   - `messages`
   - `messaging_postbacks`
   - `messaging_optins`
   - `messaging_referrals`

### Webhook Verification

The webhook endpoint automatically handles verification. When Facebook sends a GET request with `hub.mode=subscribe`, the endpoint verifies the token and responds with the challenge.

## Error Handling

### Common Error Codes

- `AGENT_NOT_FOUND`: Chat agent doesn't exist
- `NOT_CONNECTED`: Instagram is not connected
- `AUTH_FAILED`: Authentication failed, invalid access token
- `API_ERROR`: Instagram Graph API error
- `VALIDATION_ERROR`: Missing required fields

### Example Error Response

```json
{
  "success": false,
  "message": "Instagram authentication failed. Please reconnect.",
  "code": "AUTH_FAILED",
  "meta": {
    "operationId": "uuid",
    "operation": "connect",
    "duration": "123ms"
  }
}
```

## Important Notes

1. **Access Token**: The access token must have the following permissions:
   - `instagram_basic`
   - `pages_messaging`
   - `instagram_manage_messages`

2. **Webhook URL**: Must be publicly accessible (HTTPS). Use ngrok for local development.

3. **Message Deduplication**: The system automatically prevents duplicate message processing using Redis.

4. **QR Code**: The QR code links to the Instagram profile/DM inbox. Users can scan it to quickly access your Instagram account.

5. **Message Storage**: All Instagram messages are stored in the `chats` collection with `metadata.channel: 'instagram'`.

## Testing

### Local Development

1. Use ngrok to expose your local server:
   ```bash
   ngrok http 3000
   ```

2. Update webhook URL in Facebook Developer Console with ngrok URL

3. Test connection flow:
   - Connect Instagram account
   - Send a test message from Instagram
   - Verify message is received and processed
   - Check agent response is sent back

### Production Checklist

- [ ] Instagram Business/Creator account set up
- [ ] Facebook Page linked to Instagram account
- [ ] Facebook App created with Messenger product
- [ ] Webhook URL configured and verified
- [ ] Access tokens have correct permissions
- [ ] HTTPS endpoint for webhook
- [ ] Error handling implemented in frontend
- [ ] QR code display working
- [ ] Connection status polling implemented

## Support

For issues or questions:
1. Check server logs for detailed error messages
2. Verify Instagram account is Business/Creator type
3. Ensure access token has required permissions
4. Verify webhook URL is accessible and verified
5. Check Instagram Graph API status page

## Additional Resources

- [Instagram Graph API Documentation](https://developers.facebook.com/docs/instagram-api)
- [Instagram Messaging API](https://developers.facebook.com/docs/instagram-api/guides/messaging)
- [Facebook Webhooks Guide](https://developers.facebook.com/docs/graph-api/webhooks)

