# Instagram Integration - Quick Start

## Overview

This Instagram integration connects your chat agents directly to Instagram Direct Messages. When someone sends a message to your Instagram account, it's **automatically processed by your chat agent** and the response is sent back via Instagram.

**Key Feature:** Messages are stored in your existing `chats` collection - no separate Instagram message storage needed!

## Prerequisites

1. **Instagram Business or Creator Account** (required for API access)
2. **Facebook Page** linked to your Instagram account
3. **Facebook App** with Messenger product enabled
4. **Instagram Graph API Access Token** with required permissions

## Quick Setup

### Step 1: Facebook Developer Setup

1. Go to [Facebook for Developers](https://developers.facebook.com/)
2. Create a new app or use an existing one
3. Add **Messenger** product
4. Connect your Instagram Business/Creator account
5. Generate **Page Access Token** (long-lived)
6. Get your **Instagram Account ID** and **Facebook Page ID**

### Step 2: Connect Instagram to Chat Agent

```bash
POST /api/database/:subaccountId/chat-agents/:agentId/instagram/connect
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "accessToken": "YOUR_PAGE_ACCESS_TOKEN",
  "instagramAccountId": "INSTAGRAM_ACCOUNT_ID",
  "pageId": "FACEBOOK_PAGE_ID",
  "webhookVerificationToken": "YOUR_SECRET_TOKEN"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "qrCodeDataUrl": "data:image/png;base64,...",
    "instagramUrl": "https://www.instagram.com/username/",
    "username": "your_username"
  }
}
```

### Step 3: Display QR Code

```html
<img src="QR_CODE_DATA_URL" alt="Scan with Instagram" />
```

Users can scan the QR code to open your Instagram profile and send messages.

### Step 4: Set Up Webhook

1. In Facebook Developer Console → Messenger → Webhooks
2. Add callback URL: `https://your-domain.com/api/database/:subaccountId/chat-agents/:agentId/instagram/webhook`
3. Set verification token (same as `webhookVerificationToken`)
4. Subscribe to: `messages`, `messaging_postbacks`

## How It Works

```
Instagram User
    ↓ (sends DM)
Instagram Graph API
    ↓ (webhook)
Instagram Connector
    ↓ (forwards to)
Chat Agent (Retell)
    ↓ (generates reply)
Instagram Connector
    ↓ (sends via Instagram API)
Instagram User
```

All conversations are stored in the existing `chats` collection with `metadata.channel: 'instagram'`.

## API Endpoints

### Connect
```bash
POST /api/database/:subaccountId/chat-agents/:agentId/instagram/connect
```

### Get Status
```bash
GET /api/database/:subaccountId/chat-agents/:agentId/instagram/status
```

### Send Message
```bash
POST /api/database/:subaccountId/chat-agents/:agentId/instagram/send
{
  "to": "INSTAGRAM_USER_ID",
  "message": "Hello!"
}
```

### Get Messages
```bash
GET /api/database/:subaccountId/chat-agents/:agentId/instagram/messages
```

### Disconnect
```bash
POST /api/database/:subaccountId/chat-agents/:agentId/instagram/disconnect
```

## Frontend Example

```javascript
// Connect Instagram
async function connectInstagram() {
  const response = await fetch(
    `/api/database/${subaccountId}/chat-agents/${agentId}/instagram/connect`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        accessToken: 'YOUR_TOKEN',
        instagramAccountId: 'YOUR_ACCOUNT_ID',
        pageId: 'YOUR_PAGE_ID',
        webhookVerificationToken: 'YOUR_TOKEN'
      })
    }
  );
  
  const data = await response.json();
  if (data.success) {
    // Display QR code
    document.getElementById('qr-code').src = data.data.qrCodeDataUrl;
  }
}

// Check connection status
async function checkStatus() {
  const response = await fetch(
    `/api/database/${subaccountId}/chat-agents/${agentId}/instagram/status`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );
  
  const data = await response.json();
  console.log('Connected:', data.data.isConnected);
}
```

## Required Permissions

Your Instagram access token needs:
- `instagram_basic`
- `pages_messaging`
- `instagram_manage_messages`

## Troubleshooting

**"Authentication failed"**
- Verify access token is valid and has required permissions
- Check token hasn't expired
- Ensure Instagram account is Business/Creator type

**"Webhook not receiving messages"**
- Verify webhook URL is publicly accessible (HTTPS)
- Check webhook is verified in Facebook Developer Console
- Ensure subscribed to correct fields

**"QR code not displaying"**
- Check `qrCodeDataUrl` in response
- Verify image can be rendered (data URL format)

## Next Steps

- See [INSTAGRAM_FRONTEND_GUIDE.md](./INSTAGRAM_FRONTEND_GUIDE.md) for detailed frontend integration
- Check Instagram Graph API docs for advanced features
- Set up message templates for better user experience

