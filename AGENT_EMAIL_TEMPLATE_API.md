# Agent Email Template API

This document describes the email template functionality for agents, which allows storing and managing custom email templates for post-call summaries and notifications.

## Overview

Email templates can be stored for each agent to customize automated emails sent after calls. The template field is stored in the agent document and can be updated independently or as part of the agent details.

## Email Template Field

- **Field Name:** `emailTemplate`
- **Type:** `string` or `null`
- **Default Value:** `null` (when agent is created)
- **Storage:** Agent document in MongoDB
- **Supported For:** Both regular agents and chat agents

---

## API Endpoints

### 1. Get Agent Email Template

Get the email template for a specific agent.

#### Endpoint
```
GET /api/database/:subaccountId/agents/:agentId/email-template
```

#### Parameters
| Parameter | Type | Location | Required | Description |
|-----------|------|----------|----------|-------------|
| subaccountId | string | Path | Yes | MongoDB ObjectId of the subaccount |
| agentId | string | Path | Yes | Retell agent ID |

#### Response - Success (200)
```json
{
  "success": true,
  "message": "Email template retrieved successfully",
  "data": {
    "agentId": "agent_79c975172339842b22346abbd1",
    "agentName": "Sales Agent",
    "emailTemplate": "<html>...</html>"
  },
  "meta": {
    "operationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "duration": "45ms"
  }
}
```

#### Response - Agent Not Found (404)
```json
{
  "success": false,
  "message": "Agent not found",
  "code": "AGENT_NOT_FOUND"
}
```

#### Example cURL Command
```bash
curl -X GET "http://localhost:3002/api/database/68cf05f060d294db17c0685e/agents/agent_79c975172339842b22346abbd1/email-template" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### 2. Update Agent Email Template

Update the email template for a specific agent.

#### Endpoint
```
PATCH /api/database/:subaccountId/agents/:agentId/email-template
```

#### Parameters
| Parameter | Type | Location | Required | Description |
|-----------|------|----------|----------|-------------|
| subaccountId | string | Path | Yes | MongoDB ObjectId of the subaccount |
| agentId | string | Path | Yes | Retell agent ID |

#### Request Body
```json
{
  "emailTemplate": "<html>...</html>"
}
```

#### Request Body Fields
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| emailTemplate | string or null | Yes | Email template content (HTML or plain text). Use `null` to remove the template. |

#### Response - Success (200)
```json
{
  "success": true,
  "message": "Email template updated successfully",
  "data": {
    "agentId": "agent_79c975172339842b22346abbd1",
    "agentName": "Sales Agent",
    "emailTemplate": "<html>...</html>",
    "updated": true
  },
  "meta": {
    "operationId": "b2c3d4e5-f6a7-8901-bcde-f2345678901a",
    "duration": "78ms"
  }
}
```

#### Response - Invalid Template (400)
```json
{
  "success": false,
  "message": "Email template must be a string or null",
  "code": "INVALID_EMAIL_TEMPLATE"
}
```

#### Response - Agent Not Found (404)
```json
{
  "success": false,
  "message": "Agent not found",
  "code": "AGENT_NOT_FOUND"
}
```

#### Example cURL Command
```bash
curl -X PATCH "http://localhost:3002/api/database/68cf05f060d294db17c0685e/agents/agent_79c975172339842b22346abbd1/email-template" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "emailTemplate": "<html><body><h1>Call Summary</h1><p>{{summary}}</p></body></html>"
  }'
```

#### Remove Email Template
```bash
curl -X PATCH "http://localhost:3002/api/database/68cf05f060d294db17c0685e/agents/agent_79c975172339842b22346abbd1/email-template" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "emailTemplate": null
  }'
```

---

### 3. Update Email Template via Agent Details

You can also update the email template as part of the general agent details update.

#### Endpoint
```
PATCH /api/database/:subaccountId/agents/:agentId/details
```

#### Request Body (Partial Update)
```json
{
  "emailTemplate": "<html>...</html>",
  "beginMessage": "Hello!",
  "generalPrompt": "You are a helpful assistant."
}
```

This endpoint allows updating multiple agent fields at once, including `emailTemplate`.

---

### 4. Get Email Template via Agent Details

The email template is also included when fetching agent configuration details.

#### Endpoint
```
GET /api/database/:subaccountId/agents/:agentId/details
```

#### Response
```json
{
  "success": true,
  "message": "Agent configuration details retrieved successfully",
  "data": {
    "agent": {
      "agentId": "agent_79c975172339842b22346abbd1",
      "name": "Sales Agent",
      "description": "Agent for sales calls",
      "voiceId": "voice_123",
      "language": "en-US",
      "emailTemplate": "<html>...</html>",
      "createdAt": "2025-01-15T10:30:00.000Z",
      "updatedAt": "2025-01-16T14:20:00.000Z"
    },
    "llm": {
      "llmId": "llm_abc123",
      "model": "gpt-4o-mini",
      "beginMessage": "Hello!",
      "generalPrompt": "You are a helpful assistant.",
      "modelTemperature": 0,
      "version": 0
    }
  },
  "meta": {
    "operationId": "c3d4e5f6-a7b8-9012-cdef-34567890abcd",
    "duration": "92ms",
    "cached": false
  }
}
```

---

## Email Template Format

The email template can be stored in any format (HTML, plain text, etc.). Here are some common use cases:

### HTML Email Template
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; }
    .header { background-color: #4CAF50; color: white; padding: 10px; }
    .content { padding: 20px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Call Summary</h1>
  </div>
  <div class="content">
    <h2>Call with {{customer_name}}</h2>
    <p><strong>Date:</strong> {{call_date}}</p>
    <p><strong>Duration:</strong> {{call_duration}}</p>
    <h3>Summary:</h3>
    <p>{{call_summary}}</p>
    <h3>Next Steps:</h3>
    <ul>
      {{#next_steps}}
      <li>{{.}}</li>
      {{/next_steps}}
    </ul>
  </div>
</body>
</html>
```

### Plain Text Template
```text
Call Summary - {{call_date}}

Customer: {{customer_name}}
Duration: {{call_duration}}

Summary:
{{call_summary}}

Next Steps:
{{#next_steps}}
- {{.}}
{{/next_steps}}

---
This is an automated summary generated by {{agent_name}}.
```

### Template Variables

Common variables that can be used in templates (depends on your implementation):
- `{{customer_name}}` - Customer's name
- `{{call_date}}` - Date of the call
- `{{call_duration}}` - Duration of the call
- `{{call_summary}}` - AI-generated summary
- `{{agent_name}}` - Name of the agent
- `{{appointment_booked}}` - Whether an appointment was booked
- `{{appointment_date}}` - Date of booked appointment (if applicable)

---

## Features

### ✅ Cache Invalidation
When the email template is updated, the agent details cache is automatically invalidated to ensure fresh data is served.

### ✅ Activity Logging
All email template updates are logged as agent update activities for audit purposes.

### ✅ Permissions
All endpoints require proper authentication and resource permissions via RBAC.

### ✅ Rate Limiting
- GET requests: 200 requests per minute per subaccount
- PATCH requests: 100 requests per minute per subaccount

---

## Database Structure

### Agents Collection
```javascript
{
  "_id": ObjectId("..."),
  "agentId": "agent_79c975172339842b22346abbd1",
  "name": "Sales Agent",
  "description": "Agent for sales calls",
  "llmId": "llm_abc123",
  "voiceId": "voice_123",
  "voiceModel": "eleven_turbo_v2",
  "language": "en-US",
  "webhookUrl": "https://...",
  "emailTemplate": "<html>...</html>", // NEW FIELD
  "createdAt": ISODate("2025-01-15T10:30:00.000Z"),
  "createdBy": "user_123",
  "updatedAt": ISODate("2025-01-16T14:20:00.000Z"),
  "updatedBy": "user_123",
  "subaccountId": "68cf05f060d294db17c0685e",
  "operationId": "...",
  "retellAccountId": "..."
}
```

---

## Integration Example

### Complete Workflow

```javascript
// 1. Create an agent (emailTemplate starts as null)
const createResponse = await fetch('/api/database/68cf05f060d294db17c0685e/agents', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Sales Agent',
    description: 'Agent for sales calls'
  })
});

const { data: { agentId } } = await createResponse.json();

// 2. Set the email template
const updateResponse = await fetch(
  `/api/database/68cf05f060d294db17c0685e/agents/${agentId}/email-template`,
  {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer YOUR_JWT_TOKEN',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      emailTemplate: '<html>...'
    })
  }
);

// 3. Get the email template
const getResponse = await fetch(
  `/api/database/68cf05f060d294db17c0685e/agents/${agentId}/email-template`,
  {
    headers: {
      'Authorization': 'Bearer YOUR_JWT_TOKEN'
    }
  }
);

const { data: { emailTemplate } } = await getResponse.json();
console.log('Email template:', emailTemplate);
```

---

## Error Handling

| Status Code | Error Code | Description |
|-------------|------------|-------------|
| 400 | INVALID_EMAIL_TEMPLATE | Email template must be a string or null |
| 401 | UNAUTHORIZED | Missing or invalid authentication token |
| 403 | FORBIDDEN | Insufficient permissions for this resource |
| 404 | AGENT_NOT_FOUND | Agent does not exist |
| 500 | INTERNAL_SERVER_ERROR | Server error occurred |

---

## Notes

1. **Null Values**: Setting `emailTemplate` to `null` removes the template. This is different from an empty string.

2. **Storage Limit**: While there's no hard limit enforced, it's recommended to keep email templates under 100KB for performance.

3. **HTML Sanitization**: The API does not sanitize HTML content. Ensure you sanitize/validate templates on the client side or before sending emails.

4. **Template Engine**: The API only stores the template. You'll need to implement your own template rendering logic (e.g., using Handlebars, Mustache, etc.) in your email sending service.

5. **Chat Agents**: Chat agents also support email templates with the same structure.

---

## Related Documentation

- **[AGENT_DETAILS_API.md](AGENT_DETAILS_API.md)** - Complete agent management documentation
- **[README.md](README.md)** - General server documentation

---

**Last Updated:** October 7, 2025  
**Version:** 1.0.0

