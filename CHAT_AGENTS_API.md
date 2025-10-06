# Chat Agents API Documentation

## Overview
Chat agents are a separate type of agent stored in the `chatagents` collection. They use the same configuration and creation logic as regular agents but include an `activated` flag that can only be modified by admin or super_admin users.

## Endpoints

### 1. Create Chat Agent
Create a new chat agent in the system.

**Endpoint:** `POST /api/database/:subaccountId/chat-agents`

**Request Body:**
```json
{
  "name": "My Chat Agent",
  "description": "Agent description"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Chat agent created successfully",
  "data": {
    "agentId": "agent_123",
    "agentName": "My Chat Agent",
    "llmId": "llm_456",
    "description": "Agent description",
    "activated": false,
    "retellAccount": {
      "accountName": "Account Name",
      "accountId": "account_789",
      "verificationStatus": "verified"
    },
    "voiceId": "11labs-Adrian",
    "language": "en-US",
    "storedInDatabase": true
  },
  "meta": {
    "operationId": "uuid",
    "duration": "1234ms"
  }
}
```

### 2. Get All Chat Agents
Retrieve all chat agents with statistics for a subaccount.

**Endpoint:** `GET /api/database/:subaccountId/chat-agents`

**Response:**
```json
{
  "success": true,
  "message": "Chat agents retrieved successfully",
  "data": {
    "agents": [
      {
        "agentId": "agent_123",
        "name": "My Chat Agent",
        "description": "Agent description",
        "voiceId": "11labs-Adrian",
        "language": "en-US",
        "activated": false,
        "createdAt": "2024-01-01T00:00:00.000Z",
        "numberOfCalls": 10,
        "cumulativeSuccessRate": 85.5
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

### 3. Activate/Deactivate Chat Agent
Update the activation status of a chat agent. **Only admin or super_admin can perform this action.**

**Endpoint:** `PATCH /api/database/:subaccountId/chat-agents/:agentId/activate`

**Request Body:**
```json
{
  "activated": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "Chat agent activated successfully",
  "data": {
    "agentId": "agent_123",
    "agentName": "My Chat Agent",
    "activated": true,
    "updatedBy": "user_id",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  },
  "meta": {
    "operationId": "uuid",
    "duration": "234ms"
  }
}
```

**Error Response (Insufficient Permissions):**
```json
{
  "success": false,
  "message": "Only admin or super_admin can activate/deactivate chat agents",
  "code": "INSUFFICIENT_PERMISSIONS",
  "details": {
    "effectiveRole": "user",
    "requiredRoles": ["admin", "super_admin"]
  }
}
```

## Key Features

1. **Separate Collection**: Chat agents are stored in the `chatagents` collection, separate from regular agents
2. **Activated Flag**: All chat agents have an `activated` boolean field that defaults to `false`
3. **Role-Based Activation**: Only users with `admin` or `super_admin` roles can activate/deactivate chat agents
4. **Same Configuration**: Chat agents use the same LLM configuration and agent setup as regular agents
5. **Statistics**: Chat agents support the same call statistics aggregation as regular agents

## Database Schema

### Chat Agent Document
```javascript
{
  agentId: String,           // Retell agent ID
  name: String,              // Agent name
  description: String,       // Agent description
  llmId: String,             // Associated LLM ID
  voiceId: String,           // Voice ID
  voiceModel: String,        // Voice model
  language: String,          // Language
  webhookUrl: String,        // Webhook URL
  activated: Boolean,        // Activation status (default: false)
  createdAt: Date,           // Creation timestamp
  createdBy: String,         // User ID who created
  subaccountId: String,      // Subaccount ID
  operationId: String,       // Operation ID for tracking
  retellAccountId: String,   // Retell account ID
  updatedAt: Date,           // Last update timestamp (optional)
  updatedBy: String          // User ID who last updated (optional)
}
```

## Middleware & Validation

All chat agent endpoints use:
- `authenticateToken` - JWT authentication
- `requestLogger` - Request logging
- `userLimiter` - Rate limiting per user
- `subaccountLimiter` - Rate limiting per subaccount
- `requireResourcePermission()` - RBAC permission checking
- Input validation using Joi schemas

## Rate Limits

- Create chat agent: 100 requests per minute per subaccount
- Get chat agents: 200 requests per minute per subaccount
- Activate/deactivate: 50 requests per minute per subaccount 