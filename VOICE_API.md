# Voice Management API

This document describes the Voice Management API endpoints for listing available voices and updating agent voices.

## Endpoints

### 1. Get Available Voices (ElevenLabs only)

Get a list of all available ElevenLabs voices that can be assigned to agents.

**Endpoint:** `GET /api/database/:subaccountId/voices`

**Authentication:** JWT Token Required

**Parameters:**
- `subaccountId` (path parameter) - The subaccount ID (24-character hex string)

**Rate Limit:** 100 requests per minute per subaccount

#### cURL Example

```bash
curl -X GET "https://your-domain.com/api/database/507f1f77bcf86cd799439011/voices" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

#### Success Response (200 OK)

```json
{
  "success": true,
  "message": "Voices fetched successfully",
  "data": {
    "voices": [
      {
        "voice_id": "11labs-Adrian",
        "voice_name": "Adrian",
        "provider": "elevenlabs",
        "accent": "American",
        "gender": "male",
        "age": "Young",
        "preview_audio_url": "https://retell-utils-public.s3.us-west-2.amazonaws.com/adrian.mp3"
      },
      {
        "voice_id": "11labs-Emily",
        "voice_name": "Emily",
        "provider": "elevenlabs",
        "accent": "British",
        "gender": "female",
        "age": "Middle Aged",
        "preview_audio_url": "https://retell-utils-public.s3.us-west-2.amazonaws.com/emily.mp3"
      }
    ],
    "count": 2
  },
  "meta": {
    "operationId": "123e4567-e89b-12d3-a456-426614174000",
    "duration": "245ms",
    "cached": false
  }
}
```

**Note:** The `meta.cached` field indicates whether the response was served from cache (`true`) or fetched from the Retell API (`false`).

#### Error Responses

**400 Bad Request - Invalid Subaccount ID**
```json
{
  "success": false,
  "message": "Invalid subaccountId",
  "code": "INVALID_PARAMETER",
  "details": "Invalid subaccount ID format"
}
```

**400 Bad Request - Retell Account Inactive**
```json
{
  "success": false,
  "message": "Retell account is not active",
  "code": "RETELL_ACCOUNT_INACTIVE"
}
```

**401 Unauthorized**
```json
{
  "success": false,
  "message": "Unauthorized",
  "code": "UNAUTHORIZED"
}
```

**500 Internal Server Error**
```json
{
  "success": false,
  "message": "Failed to list voices: <error details>",
  "code": "INTERNAL_SERVER_ERROR",
  "meta": {
    "operationId": "123e4567-e89b-12d3-a456-426614174000",
    "duration": "150ms"
  }
}
```

---

### 2. Update Agent Voice

Update the voice for a specific agent.

**Endpoint:** `PATCH /api/database/:subaccountId/agents/:agentId/voice`

**Authentication:** JWT Token Required

**Parameters:**
- `subaccountId` (path parameter) - The subaccount ID (24-character hex string)
- `agentId` (path parameter) - The agent ID

**Rate Limit:** 100 requests per minute per subaccount

**Request Body:**
```json
{
  "voiceId": "11labs-Adrian"
}
```

**Body Schema:**
- `voiceId` (string, required) - The voice ID to set for the agent (must be a valid ElevenLabs voice ID)

#### cURL Example

```bash
curl -X PATCH "https://your-domain.com/api/database/507f1f77bcf86cd799439011/agents/agent_abc123/voice" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "voiceId": "11labs-Adrian"
  }'
```

#### Success Response (200 OK)

```json
{
  "success": true,
  "message": "Agent voice updated successfully",
  "data": {
    "agentId": "agent_abc123",
    "agentName": "Customer Support Agent",
    "voiceId": "11labs-Adrian"
  },
  "meta": {
    "operationId": "123e4567-e89b-12d3-a456-426614174000",
    "duration": "482ms"
  }
}
```

#### Error Responses

**400 Bad Request - Invalid Subaccount ID**
```json
{
  "success": false,
  "message": "Invalid subaccountId",
  "code": "INVALID_PARAMETER",
  "details": "Invalid subaccount ID format"
}
```

**400 Bad Request - Invalid Agent ID**
```json
{
  "success": false,
  "message": "Invalid agentId",
  "code": "INVALID_PARAMETER",
  "details": "Agent ID is required"
}
```

**400 Bad Request - Missing Voice ID**
```json
{
  "success": false,
  "message": "Validation error",
  "code": "VALIDATION_ERROR",
  "errors": [
    {
      "field": "voiceId",
      "message": "Voice ID is required"
    }
  ]
}
```

**400 Bad Request - Retell Account Inactive**
```json
{
  "success": false,
  "message": "Retell account is not active",
  "code": "RETELL_ACCOUNT_INACTIVE"
}
```

**401 Unauthorized**
```json
{
  "success": false,
  "message": "Unauthorized",
  "code": "UNAUTHORIZED"
}
```

**404 Not Found - Agent Not Found**
```json
{
  "success": false,
  "message": "Agent not found",
  "code": "AGENT_NOT_FOUND"
}
```

**500 Internal Server Error**
```json
{
  "success": false,
  "message": "Failed to update agent: <error details>",
  "code": "INTERNAL_SERVER_ERROR",
  "meta": {
    "operationId": "123e4567-e89b-12d3-a456-426614174000",
    "duration": "320ms"
  }
}
```

---

## Voice Object Schema

Each voice object in the response contains the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `voice_id` | string | Unique identifier for the voice (e.g., "11labs-Adrian") |
| `voice_name` | string | Human-readable name of the voice (e.g., "Adrian") |
| `provider` | string | Voice provider, always "elevenlabs" for this endpoint |
| `accent` | string | Accent annotation of the voice (e.g., "American", "British") |
| `gender` | string | Gender of the voice ("male" or "female") |
| `age` | string | Age annotation of the voice (e.g., "Young", "Middle Aged") |
| `preview_audio_url` | string | URL to preview audio sample of the voice |

---

## Workflow Example

### Complete workflow to list voices and update an agent's voice:

1. **Get available voices:**
```bash
curl -X GET "https://your-domain.com/api/database/507f1f77bcf86cd799439011/voices" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

2. **Select a voice from the response** (e.g., "11labs-Adrian")

3. **Update agent with selected voice:**
```bash
curl -X PATCH "https://your-domain.com/api/database/507f1f77bcf86cd799439011/agents/agent_abc123/voice" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "voiceId": "11labs-Adrian"
  }'
```

---

## Notes

- Only ElevenLabs voices are returned by the GET voices endpoint (filtered by `provider === "elevenlabs"`)
- The voice update is applied to both the Retell platform and the local database
- Activity logging is automatically performed when an agent's voice is updated
- Cache is automatically invalidated after voice update to ensure fresh data on subsequent requests
- Both endpoints require valid JWT authentication and appropriate resource permissions
- Rate limiting is applied per subaccount to prevent abuse

## Caching

### Voice List Caching
- **Cache Duration:** 24 hours (86400 seconds)
- **Cache Key:** `voices:{subaccountId}`
- **Strategy:** Check cache first, fetch from Retell API if not cached
- **Response Indicator:** The `meta.cached` field indicates whether data was served from cache (`true`) or fetched fresh (`false`)

Example cached response:
```json
{
  "success": true,
  "message": "Voices fetched successfully",
  "data": {
    "voices": [...],
    "count": 50
  },
  "meta": {
    "operationId": "123e4567-e89b-12d3-a456-426614174000",
    "duration": "15ms",
    "cached": true
  }
}
```

### Agent Cache Invalidation on Voice Update
When an agent's voice is updated, the following caches are automatically invalidated:
- **Agent Details Cache:** `agent:details:{subaccountId}:{agentId}`
- **Agent Stats Cache:** `agent:stats:{subaccountId}:{agentId}`

This ensures that all agent-related data reflects the updated voice configuration immediately.

