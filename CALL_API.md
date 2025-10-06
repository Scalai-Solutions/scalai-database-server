# Call API Documentation

## Overview
The Call API allows you to create and manage web calls using Retell agents.

## Base URL
```
/api/calls
```

## Authentication
All endpoints require authentication using a Bearer token in the Authorization header:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

---

## Endpoints

### Create Web Call

Create a web call using a specific agent.

**Endpoint:** `POST /api/calls/:subaccountId/web-call`

**URL Parameters:**
- `subaccountId` (string, required) - The subaccount ID (24-character MongoDB ObjectId)

**Request Body:**
```json
{
  "agentId": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
  "metadata": {
    "customField": "customValue"
  }
}
```

**Request Body Parameters:**
- `agentId` (string, required) - The ID of the agent to use for the call
- `metadata` (object, optional) - Custom metadata to attach to the call

**Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Web call created successfully",
  "data": {
    "agent_id": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
    "call_id": "11111111111111111111111111111111",
    "access_token": "your-access-token-here",
    "sample_rate": 24000,
    "call_status": "registered",
    "retellAccount": {
      "accountName": "My Retell Account",
      "accountId": "123456"
    }
  },
  "meta": {
    "operationId": "550e8400-e29b-41d4-a716-446655440000",
    "duration": "150ms"
  }
}
```

**Error Responses:**

- **400 Bad Request** - Validation error or inactive Retell account
```json
{
  "success": false,
  "message": "Retell account is not active",
  "code": "RETELL_ACCOUNT_INACTIVE"
}
```

- **404 Not Found** - Agent not found
```json
{
  "success": false,
  "message": "Agent not found",
  "code": "AGENT_NOT_FOUND"
}
```

- **503 Service Unavailable** - Failed to create web call
```json
{
  "success": false,
  "message": "Failed to create web call. Please try again later.",
  "code": "WEB_CALL_CREATION_FAILED",
  "meta": {
    "operationId": "550e8400-e29b-41d4-a716-446655440000",
    "operation": "createWebCall",
    "duration": "200ms"
  }
}
```

---

## Example Usage

### Using cURL
```bash
curl -X POST https://your-server.com/api/calls/507f1f77bcf86cd799439011/web-call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "agentId": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
    "metadata": {
      "userId": "user123",
      "campaign": "spring-2024"
    }
  }'
```

### Using JavaScript (Node.js)
```javascript
const axios = require('axios');

const createWebCall = async () => {
  try {
    const response = await axios.post(
      'https://your-server.com/api/calls/507f1f77bcf86cd799439011/web-call',
      {
        agentId: 'oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD',
        metadata: {
          userId: 'user123',
          campaign: 'spring-2024'
        }
      },
      {
        headers: {
          'Authorization': 'Bearer YOUR_JWT_TOKEN',
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Call ID:', response.data.data.call_id);
    console.log('Access Token:', response.data.data.access_token);
  } catch (error) {
    console.error('Error creating web call:', error.response?.data || error.message);
  }
};

createWebCall();
```

### Using Retell SDK
```javascript
import Retell from 'retell-sdk';

const client = new Retell({
  apiKey: 'YOUR_RETELL_API_KEY',
});

const webCallResponse = await client.call.createWebCall({ 
  agent_id: 'oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD' 
});

console.log(webCallResponse.agent_id);
console.log(webCallResponse.call_id);
console.log(webCallResponse.access_token);
```

---

## Rate Limits
- User rate limit: Applies to all authenticated requests
- Subaccount rate limit: 100 requests per minute per subaccount

---

## Notes
- The `access_token` in the response is used by the Retell SDK to establish the web call connection
- The `sample_rate` indicates the audio sample rate for the call (typically 24000)
- Call information is automatically stored in the database for tracking and analytics
- The agent must exist in the database and be associated with the specified subaccount
- The Retell account associated with the subaccount must be active

---

## Related Endpoints
- `POST /api/database/:subaccountId/agents` - Create a new agent
- `GET /api/database/:subaccountId/agents` - List all agents
- `GET /api/database/:subaccountId/agents/:agentId` - Get agent details 