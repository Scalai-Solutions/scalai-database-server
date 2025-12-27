# Chat Dynamic Variables Implementation

## Overview

Added support for standard dynamic variables (`phone_number`, `agent_id`, `subaccount_id`) in all chat sessions, similar to voice calls.

## Changes Made

### 1. Chat Controller (`src/controllers/chatController.js`)

**Frontend-Initiated Chats:**
- Added automatic inclusion of standard dynamic variables when creating chats
- `phone_number`: Can be passed from frontend in `retell_llm_dynamic_variables`
- `agent_id`: Automatically set from the agent being used
- `subaccount_id`: Automatically set from the subaccount context
- Custom dynamic variables from frontend are merged with standard ones

**Example Request:**
```json
{
  "agentId": "agent_123",
  "retell_llm_dynamic_variables": {
    "phone_number": "+1234567890",
    "custom_field": "custom_value"
  },
  "metadata": {
    "channel": "web"
  }
}
```

**Resulting Dynamic Variables:**
```json
{
  "phone_number": "+1234567890",
  "agent_id": "agent_123",
  "subaccount_id": "68cf05f060d294db17c0685e",
  "custom_field": "custom_value"
}
```

### 2. WhatsApp Service (`src/services/whatsappService.js`)

**WhatsApp-Initiated Chats:**
- Automatically extracts phone number from WhatsApp message (`message.from`)
- Removes `@c.us` suffix to get clean phone number
- Sets all standard dynamic variables:
  - `phone_number`: WhatsApp sender's phone number
  - `agent_id`: Chat agent ID
  - `subaccount_id`: Subaccount ID
  - `customer_phone`: Same as phone_number (for backward compatibility)
  - `channel`: Set to "whatsapp"
  - `customer_name`: Contact name if available
  - `customer_email`: Contact email if available

**Enhanced Logging:**
- Added detailed logging to track chat responses
- Logs full response structure for debugging
- Logs message extraction process

### 3. Instagram Service (`src/services/instagramService.js`)

**Instagram-Initiated Chats:**
- Sets standard dynamic variables (Instagram doesn't have phone numbers)
- `phone_number`: Empty string (Instagram uses user IDs, not phone numbers)
- `agent_id`: Chat agent ID
- `subaccount_id`: Subaccount ID
- `instagram_user_id`: Instagram user identifier
- `channel`: Set to "instagram"

### 4. Webhook Controller (`src/controllers/webhookController.js`)

**Inbound Call Webhooks:**
- Added support for `call_inbound` event type
- Returns dynamic variables for inbound calls:
  - `phone_number`: Caller's phone number
  - `agent_id`: Agent ID from URL
  - `subaccount_id`: Subaccount ID from URL
- Supports multiple URL patterns:
  - `/:subaccountId/retell/:agentId`
  - `/:subaccountId/:agentId/retell`

## Dynamic Variables Usage

### In Agent Prompts

Use these variables in your chat agent prompts:

```
Hello! I can see you're calling from {{phone_number}}.
Agent ID: {{agent_id}}
Subaccount: {{subaccount_id}}
Channel: {{channel}}
Customer Name: {{customer_name}}
```

### Standard Variables (Always Available)

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `phone_number` | Customer's phone number | `"+1234567890"` or `""` (if not available) |
| `agent_id` | Chat agent identifier | `"agent_123abc..."` |
| `subaccount_id` | Subaccount identifier | `"68cf05f060d294db17c0685e"` |

### Channel-Specific Variables

#### WhatsApp
- `customer_phone`: Same as `phone_number`
- `channel`: `"whatsapp"`
- `customer_name`: Contact name (if available)
- `customer_email`: Contact email (if available)

#### Instagram
- `instagram_user_id`: Instagram user ID
- `channel`: `"instagram"`

#### Web Chat (Frontend)
- Any custom variables passed in `retell_llm_dynamic_variables`
- `channel`: As set by frontend (e.g., `"web"`, `"mobile"`)

## API Endpoints

### Create Chat (Frontend)

**Endpoint:** `POST /api/chats/:subaccountId/create`

**Request Body:**
```json
{
  "agentId": "agent_123",
  "retell_llm_dynamic_variables": {
    "phone_number": "+1234567890",
    "custom_var": "value"
  },
  "metadata": {
    "channel": "web"
  },
  "agent_version": 1
}
```

**Notes:**
- `phone_number` in `retell_llm_dynamic_variables` is optional
- If not provided, it defaults to empty string
- `agent_id` and `subaccount_id` are automatically added
- Custom variables are preserved and merged

### WhatsApp Connect

**Endpoint:** `POST /api/database/:subaccountId/chat-agents/:agentId/whatsapp/connect`

**Behavior:**
- Automatically extracts phone number from incoming WhatsApp messages
- Creates chat session with dynamic variables on first message
- Reuses chat session for subsequent messages from same number

### Instagram Connect

**Endpoint:** `POST /api/database/:subaccountId/chat-agents/:agentId/instagram/connect`

**Behavior:**
- Automatically extracts Instagram user ID from incoming messages
- Creates chat session with dynamic variables on first message
- Reuses chat session for subsequent messages from same user

## Benefits

1. **Consistency**: Same dynamic variables across voice calls and chats
2. **Personalization**: Agents can reference customer phone numbers and other data
3. **Context**: Agents always know which channel the message came from
4. **Flexibility**: Frontend can pass custom variables as needed
5. **Debugging**: Enhanced logging helps diagnose issues

## Debugging

### Check Chat Document

Query the `chats` collection to see stored dynamic variables:

```javascript
db.chats.findOne({ chat_id: "your_chat_id" })
```

Look for:
```javascript
{
  "retell_llm_dynamic_variables": {
    "phone_number": "+1234567890",
    "agent_id": "agent_123",
    "subaccount_id": "68cf05f060d294db17c0685e",
    // ... other variables
  }
}
```

### Check Logs

**WhatsApp:**
```
Creating WhatsApp chat with dynamic variables
Received response from Retell
Extracting agent reply from response
```

**Frontend:**
```
Creating chat with dynamic variables
```

## Migration Notes

- Existing chat sessions will NOT have the new dynamic variables
- New chat sessions (created after this update) will have all standard dynamic variables
- WhatsApp/Instagram chats created before this update will continue working
- No database migration needed - variables are set on creation

## Testing

### Test WhatsApp Dynamic Variables

1. Connect WhatsApp to a chat agent
2. Send a message from WhatsApp
3. Check logs for "Creating WhatsApp chat with dynamic variables"
4. Verify the agent has access to `{{phone_number}}` in prompts

### Test Frontend Dynamic Variables

```bash
curl -X POST http://localhost:3002/api/chats/SUBACCOUNT_ID/create \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "AGENT_ID",
    "retell_llm_dynamic_variables": {
      "phone_number": "+1234567890"
    }
  }'
```

### Test Inbound Call Dynamic Variables

1. Configure Retell phone number webhook URL
2. Make an inbound call
3. Check webhook logs for "Inbound call webhook received"
4. Verify dynamic variables are returned

## Files Modified

1. `src/controllers/chatController.js` - Frontend chat creation
2. `src/services/whatsappService.js` - WhatsApp chat handling
3. `src/services/instagramService.js` - Instagram chat handling
4. `src/controllers/webhookController.js` - Inbound call webhooks
5. `src/routes/webhookRoutes.js` - Added route for Retell URL pattern

## Related Documentation

- `RETELL_TOOLS_UPDATE_SUMMARY.md` - Tool configurations
- `WHATSAPP_IMPLEMENTATION_SUMMARY.md` - WhatsApp integration
- `INSTAGRAM_IMPLEMENTATION_SUMMARY.md` - Instagram integration
- `CALL_API.md` - Voice call API (similar dynamic variables)

