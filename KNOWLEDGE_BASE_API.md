# Knowledge Base API

This document describes the Knowledge Base Management API for managing global and agent-specific knowledge bases.

## Architecture Overview

The system uses an optimized approach to minimize the number of knowledge bases:

- **One Global Knowledge Base** per subaccount - contains resources shared across all agents
- **One Local Knowledge Base** per agent - contains agent-specific resources
- Each agent references both global and local knowledge base IDs
- Resources can be text, URLs, or documents

### Data Structure

```
Subaccount
├── Global KB (shared by all agents)
│   ├── Resource 1 (text)
│   ├── Resource 2 (URL)
│   └── Resource 3 (document)
└── Agents
    ├── Agent 1
    │   ├── References: [Global KB, Local KB 1]
    │   └── Local KB 1
    │       ├── Resource 4 (text)
    │       └── Resource 5 (URL)
    └── Agent 2
        ├── References: [Global KB, Local KB 2]
        └── Local KB 2
            └── Resource 6 (document)
```

## Endpoints

### 1. Add Resource

Add a text, URL, or file resource to a knowledge base.

**Endpoint:** `POST /api/knowledge-base/:subaccountId/resources`

**Authentication:** JWT Token Required

**Content-Type:** `multipart/form-data` (for file uploads) or `application/json`

**Parameters:**
- `subaccountId` (path parameter) - The subaccount ID (24-character hex string)

**Request Body:**

For **Text Resource**:
```json
{
  "type": "text",
  "scope": "global",
  "text": "This is the knowledge base content...",
  "title": "Product Information"
}
```

For **URL Resource**:
```json
{
  "type": "url",
  "scope": "global",
  "url": "https://www.example.com",
  "enableAutoRefresh": true
}
```

For **Local (Agent-Specific) Resource**:
```json
{
  "type": "text",
  "scope": "local",
  "agentId": "agent_abc123",
  "text": "Agent-specific information...",
  "title": "Agent Instructions"
}
```

For **Document Resource** (multipart/form-data):
```
type: document
scope: global
file: <file upload>
```

#### cURL Examples

**Add Global Text Resource:**
```bash
curl -X POST "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/resources" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "text",
    "scope": "global",
    "text": "Our company specializes in AI solutions...",
    "title": "Company Overview"
  }'
```

**Add Global URL Resource:**
```bash
curl -X POST "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/resources" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "url",
    "scope": "global",
    "url": "https://docs.example.com",
    "enableAutoRefresh": true
  }'
```

**Add Local Text Resource:**
```bash
curl -X POST "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/resources" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "text",
    "scope": "local",
    "agentId": "agent_abc123",
    "text": "You are a sales assistant specialized in...",
    "title": "Agent Role"
  }'
```

**Add Document Resource:**
```bash
curl -X POST "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/resources" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "type=document" \
  -F "scope=global" \
  -F "file=@/path/to/document.pdf"
```

#### Success Response (201 Created)

```json
{
  "success": true,
  "message": "Resource added successfully",
  "data": {
    "resourceId": "550e8400-e29b-41d4-a716-446655440000",
    "knowledgeBaseId": "knowledge_base_a456426614174000",
    "type": "text",
    "scope": "global",
    "resource": {
      "resourceId": "550e8400-e29b-41d4-a716-446655440000",
      "type": "text",
      "sourceId": "source_123",
      "title": "Company Overview",
      "createdAt": "2025-01-15T10:30:00.000Z",
      "createdBy": "user123"
    }
  },
  "meta": {
    "operationId": "123e4567-e89b-12d3-a456-426614174000",
    "duration": "1250ms"
  }
}
```

#### Error Responses

**400 Bad Request - Validation Error:**
```json
{
  "success": false,
  "message": "Validation error",
  "code": "VALIDATION_ERROR",
  "errors": [
    {
      "field": "type",
      "message": "Type must be one of: text, url, document"
    }
  ]
}
```

**400 Bad Request - File Too Large:**
```json
{
  "success": false,
  "message": "File size must not exceed 50MB",
  "code": "FILE_TOO_LARGE"
}
```

**404 Not Found - Agent Not Found:**
```json
{
  "success": false,
  "message": "Agent not found",
  "code": "AGENT_NOT_FOUND"
}
```

---

### 2. Get Global Knowledge Base

Retrieve the global knowledge base for a subaccount.

**Endpoint:** `GET /api/knowledge-base/:subaccountId/global`

**Authentication:** JWT Token Required

**Parameters:**
- `subaccountId` (path parameter) - The subaccount ID

#### cURL Example

```bash
curl -X GET "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/global" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Success Response (200 OK)

**With Resources:**
```json
{
  "success": true,
  "message": "Global knowledge base fetched successfully",
  "data": {
    "knowledgeBaseId": "knowledge_base_global_123",
    "knowledgeBaseName": "Global KB - 507f1f77bcf86cd799439011",
    "type": "global",
    "resources": [
      {
        "resourceId": "550e8400-e29b-41d4-a716-446655440000",
        "type": "text",
        "sourceId": "source_123",
        "title": "Company Overview",
        "createdAt": "2025-01-15T10:30:00.000Z",
        "createdBy": "user123"
      },
      {
        "resourceId": "660e8400-e29b-41d4-a716-446655440001",
        "type": "url",
        "sourceId": "source_124",
        "url": "https://docs.example.com",
        "enableAutoRefresh": true,
        "createdAt": "2025-01-15T11:00:00.000Z",
        "createdBy": "user123"
      }
    ],
    "resourceCount": 2,
    "createdAt": "2025-01-15T10:00:00.000Z",
    "updatedAt": "2025-01-15T11:00:00.000Z"
  },
  "meta": {
    "operationId": "123e4567-e89b-12d3-a456-426614174000",
    "duration": "125ms",
    "cached": false
  }
}
```

**Empty (No Resources Yet):**
```json
{
  "success": true,
  "message": "Global knowledge base fetched successfully",
  "data": {
    "knowledgeBaseId": null,
    "knowledgeBaseName": null,
    "type": "global",
    "resources": [],
    "resourceCount": 0,
    "createdAt": null,
    "updatedAt": null
  },
  "meta": {
    "operationId": "123e4567-e89b-12d3-a456-426614174000",
    "duration": "85ms",
    "cached": false
  }
}
```

**Note:** This endpoint always returns 200 OK, even if no knowledge base exists yet. It returns an empty structure with `knowledgeBaseId: null` and empty `resources` array.

---

### 3. Get Local Knowledge Base

Retrieve the local knowledge base for a specific agent.

**Endpoint:** `GET /api/knowledge-base/:subaccountId/agents/:agentId/local`

**Authentication:** JWT Token Required

**Parameters:**
- `subaccountId` (path parameter) - The subaccount ID
- `agentId` (path parameter) - The agent ID

#### cURL Example

```bash
curl -X GET "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/agents/agent_abc123/local" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Success Response (200 OK)

**With Resources:**
```json
{
  "success": true,
  "message": "Local knowledge base fetched successfully",
  "data": {
    "knowledgeBaseId": "knowledge_base_local_456",
    "knowledgeBaseName": "Local KB - Agent agent_abc123",
    "type": "local",
    "agentId": "agent_abc123",
    "resources": [
      {
        "resourceId": "770e8400-e29b-41d4-a716-446655440002",
        "type": "text",
        "sourceId": "source_125",
        "title": "Agent Instructions",
        "createdAt": "2025-01-15T12:00:00.000Z",
        "createdBy": "user123"
      }
    ],
    "resourceCount": 1,
    "createdAt": "2025-01-15T12:00:00.000Z",
    "updatedAt": "2025-01-15T12:00:00.000Z"
  },
  "meta": {
    "operationId": "123e4567-e89b-12d3-a456-426614174000",
    "duration": "98ms",
    "cached": true
  }
}
```

**Empty (No Resources Yet):**
```json
{
  "success": true,
  "message": "Local knowledge base fetched successfully",
  "data": {
    "knowledgeBaseId": null,
    "knowledgeBaseName": null,
    "type": "local",
    "agentId": "agent_abc123",
    "resources": [],
    "resourceCount": 0,
    "createdAt": null,
    "updatedAt": null
  },
  "meta": {
    "operationId": "123e4567-e89b-12d3-a456-426614174000",
    "duration": "75ms",
    "cached": false
  }
}
```

**Note:** This endpoint always returns 200 OK, even if no knowledge base exists yet. It returns an empty structure with `knowledgeBaseId: null` and empty `resources` array.

---

### 4. List All Knowledge Bases

List all knowledge bases (global + all local) for a subaccount.

**Endpoint:** `GET /api/knowledge-base/:subaccountId`

**Authentication:** JWT Token Required

**Parameters:**
- `subaccountId` (path parameter) - The subaccount ID

#### cURL Example

```bash
curl -X GET "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Success Response (200 OK)

```json
{
  "success": true,
  "message": "Knowledge bases fetched successfully",
  "data": {
    "knowledgeBases": [
      {
        "knowledgeBaseId": "knowledge_base_global_123",
        "knowledgeBaseName": "Global KB - 507f1f77bcf86cd799439011",
        "type": "global",
        "agentId": null,
        "resourceCount": 3,
        "createdAt": "2025-01-15T10:00:00.000Z",
        "updatedAt": "2025-01-15T11:00:00.000Z"
      },
      {
        "knowledgeBaseId": "knowledge_base_local_456",
        "knowledgeBaseName": "Local KB - Agent agent_abc123",
        "type": "local",
        "agentId": "agent_abc123",
        "resourceCount": 2,
        "createdAt": "2025-01-15T12:00:00.000Z",
        "updatedAt": "2025-01-15T13:00:00.000Z"
      },
      {
        "knowledgeBaseId": "knowledge_base_local_789",
        "knowledgeBaseName": "Local KB - Agent agent_def456",
        "type": "local",
        "agentId": "agent_def456",
        "resourceCount": 1,
        "createdAt": "2025-01-15T14:00:00.000Z",
        "updatedAt": "2025-01-15T14:00:00.000Z"
      }
    ],
    "count": 3
  },
  "meta": {
    "operationId": "123e4567-e89b-12d3-a456-426614174000",
    "duration": "175ms"
  }
}
```

---

### 5. Delete Resource

Delete a resource from a knowledge base.

**Endpoint:** `DELETE /api/knowledge-base/:subaccountId/resources/:resourceId`

**Authentication:** JWT Token Required

**Parameters:**
- `subaccountId` (path parameter) - The subaccount ID
- `resourceId` (path parameter) - The resource ID to delete

#### cURL Example

```bash
curl -X DELETE "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/resources/550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Success Response (200 OK)

```json
{
  "success": true,
  "message": "Resource deleted successfully",
  "data": {
    "resourceId": "550e8400-e29b-41d4-a716-446655440000",
    "knowledgeBaseId": "knowledge_base_global_123"
  },
  "meta": {
    "operationId": "123e4567-e89b-12d3-a456-426614174000",
    "duration": "856ms"
  }
}
```

#### Error Responses

**404 Not Found:**
```json
{
  "success": false,
  "message": "Resource not found",
  "code": "RESOURCE_NOT_FOUND"
}
```

---

### 6. Update Resource Scope

Change a resource's scope between global and local (agent-specific).

**Note:** Document resources cannot be moved between scopes due to file handling limitations.

**Endpoint:** `PATCH /api/knowledge-base/:subaccountId/resources/:resourceId/scope`

**Authentication:** JWT Token Required

**Parameters:**
- `subaccountId` (path parameter) - The subaccount ID
- `resourceId` (path parameter) - The resource ID to update

**Request Body:**

To change to global scope:
```json
{
  "scope": "global"
}
```

To change to local scope:
```json
{
  "scope": "local",
  "agentId": "agent_abc123"
}
```

#### cURL Examples

**Change to Global Scope:**
```bash
curl -X PATCH "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/resources/550e8400-e29b-41d4-a716-446655440000/scope" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "global"
  }'
```

**Change to Local Scope:**
```bash
curl -X PATCH "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/resources/550e8400-e29b-41d4-a716-446655440000/scope" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "local",
    "agentId": "agent_abc123"
  }'
```

#### Success Response (200 OK)

```json
{
  "success": true,
  "message": "Resource scope updated successfully",
  "data": {
    "resourceId": "550e8400-e29b-41d4-a716-446655440000",
    "oldScope": "local",
    "newScope": "global",
    "oldKnowledgeBaseId": "knowledge_base_local_456",
    "newKnowledgeBaseId": "knowledge_base_global_123"
  },
  "meta": {
    "operationId": "123e4567-e89b-12d3-a456-426614174000",
    "duration": "1580ms"
  }
}
```

#### Error Responses

**400 Bad Request - Document Type:**
```json
{
  "success": false,
  "message": "Document resources cannot be moved between scopes",
  "code": "UNSUPPORTED_OPERATION"
}
```

**400 Bad Request - Same Scope:**
```json
{
  "success": false,
  "message": "Resource is already in global scope",
  "code": "INVALID_SCOPE_CHANGE"
}
```

---

## Resource Types

### Text Resources
- **Type:** `text`
- **Required Fields:** `text`, `title`
- **Use Case:** Store formatted text content, instructions, FAQs
- **Limitations:** None
- **Can Move Between Scopes:** Yes

### URL Resources
- **Type:** `url`
- **Required Fields:** `url`
- **Optional Fields:** `enableAutoRefresh` (boolean)
- **Use Case:** Reference external documentation, websites
- **Auto-Refresh:** If enabled, content is refreshed every 12 hours
- **Can Move Between Scopes:** Yes

### Document Resources
- **Type:** `document`
- **Required Fields:** `file` (uploaded via multipart/form-data)
- **Supported Formats:** PDF, TXT, DOCX, and other text-based formats
- **Max Size:** 50MB per file
- **Can Move Between Scopes:** No (file cannot be re-uploaded)

---

## Scope Types

### Global Scope
- **Identifier:** `global`
- **Visibility:** All agents in the subaccount
- **Use Case:** Company information, shared knowledge, common FAQs
- **Knowledge Base:** One per subaccount
- **Auto-Assignment:** Automatically assigned to all agents

### Local Scope
- **Identifier:** `local`
- **Visibility:** Only the specified agent
- **Required Field:** `agentId`
- **Use Case:** Agent-specific instructions, role definitions, specialized knowledge
- **Knowledge Base:** One per agent
- **Assignment:** Must specify target agent

---

## Caching

### Knowledge Base Caching
- **Cache Duration:** 1 hour (3600 seconds)
- **Cache Keys:**
  - Global: `kb:{subaccountId}:global`
  - Local: `kb:{subaccountId}:local:{agentId}`
- **Invalidation:** Automatic on add, delete, or scope change
- **Response Indicator:** `meta.cached` field shows if served from cache

### Agent Cache Invalidation
When KB resources are modified, related agent caches are automatically invalidated:
- **Agent Details Cache:** `agent:details:{subaccountId}:{agentId}`
- **Agent Stats Cache:** `agent:stats:{subaccountId}:{agentId}`

This ensures agents always reference the latest knowledge base configuration.

---

## Optimization Strategy

### Minimal Knowledge Base Approach

The system is optimized to use the minimum number of knowledge bases:

1. **Global Resources → One Global KB**
   - All global resources go into a single global KB per subaccount
   - Reduces KB count and API calls

2. **Local Resources → One KB per Agent**
   - Each agent gets one local KB for their specific resources
   - Only created when first local resource is added

3. **Agent References**
   - Each agent stores `knowledgeBaseIds: [globalKBId, localKBId]`
   - Agents without local resources only reference global KB
   - Array structure allows efficient updates

4. **Resource Movement**
   - Moving resources between scopes transfers them between KBs
   - No duplicate KBs created
   - Efficient Retell API usage

### Performance Benefits
- **Reduced API Calls:** Fewer KBs to manage
- **Lower Costs:** Retell charges per KB
- **Faster Processing:** Single KB per scope type
- **Easier Management:** Clear structure and ownership

---

## Common Workflows

### Add Global Knowledge Available to All Agents

```bash
# 1. Add a global text resource
curl -X POST "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/resources" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "text",
    "scope": "global",
    "text": "Our product pricing: Basic $10/mo, Pro $50/mo, Enterprise custom",
    "title": "Pricing Information"
  }'

# 2. All agents automatically have access to this resource
```

### Add Agent-Specific Instructions

```bash
# Add local resource for sales agent
curl -X POST "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/resources" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "text",
    "scope": "local",
    "agentId": "agent_sales_01",
    "text": "You are a sales assistant. Always mention our current promotion...",
    "title": "Sales Agent Instructions"
  }'
```

### Promote Local Resource to Global

```bash
# 1. Get the resource ID from local KB
curl -X GET "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/agents/agent_abc123/local" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# 2. Change scope to global
curl -X PATCH "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/resources/550e8400-e29b-41d4-a716-446655440000/scope" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "global"
  }'
```

### Add Documentation from URL

```bash
curl -X POST "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/resources" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "url",
    "scope": "global",
    "url": "https://docs.mycompany.com/api",
    "enableAutoRefresh": true
  }'
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_ERROR` | Request body validation failed |
| `RETELL_ACCOUNT_INACTIVE` | Retell account is not active |
| `AGENT_NOT_FOUND` | Specified agent does not exist |
| `KB_NOT_FOUND` | Knowledge base not found |
| `RESOURCE_NOT_FOUND` | Resource not found |
| `FILE_TOO_LARGE` | Uploaded file exceeds 50MB limit |
| `UNSUPPORTED_OPERATION` | Operation not supported (e.g., moving documents) |
| `INVALID_SCOPE_CHANGE` | Resource already in target scope |
| `UNAUTHORIZED` | Authentication token invalid or missing |
| `INTERNAL_SERVER_ERROR` | Server error occurred |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| Add Resource | 100 requests/minute per subaccount |
| Get Global/Local KB | 200 requests/minute per subaccount |
| List KBs | 200 requests/minute per subaccount |
| Delete Resource | 100 requests/minute per subaccount |
| Update Scope | 50 requests/minute per subaccount |

---

## Notes

- All endpoints require valid JWT authentication
- Knowledge bases are automatically created when first resource is added
- Global KB is shared by all agents in the subaccount
- Local KBs are created per-agent as needed
- Document resources (files) cannot be moved between scopes
- URL resources can have auto-refresh enabled (refreshes every 12 hours)
- Activity logging is performed for all operations
- Cache is automatically managed for optimal performance

