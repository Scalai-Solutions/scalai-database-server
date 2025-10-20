# Knowledge Base API - Frontend Implementation Guide

This guide provides everything frontend developers need to integrate the Knowledge Base Management API.

## Table of Contents
- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [API Endpoints](#api-endpoints)
- [Request/Response Examples](#requestresponse-examples)
- [Frontend Implementation](#frontend-implementation)
- [React Examples](#react-examples)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

---

## Quick Start

### Base URL
```
Production: https://your-domain.com/api/knowledge-base
Development: http://localhost:3000/api/knowledge-base
```

### Required Headers
```javascript
{
  'Authorization': 'Bearer YOUR_JWT_TOKEN',
  'Content-Type': 'application/json' // or 'multipart/form-data' for file uploads
}
```

### Resource Types
- `text` - Text content with title
- `url` - External URL (with optional auto-refresh)
- `document` - File upload (PDF, DOCX, TXT, etc.)

### Scope Types
- `global` - Visible to all agents in the subaccount
- `local` - Visible to a specific agent only

---

## Authentication

All requests require a valid JWT token in the Authorization header:

```javascript
const headers = {
  'Authorization': `Bearer ${userToken}`,
  'Content-Type': 'application/json'
};
```

---

## API Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/:subaccountId/resources` | Add resource |
| `GET` | `/:subaccountId` | List all KBs |
| `GET` | `/:subaccountId/global` | Get global KB |
| `GET` | `/:subaccountId/agents/:agentId/local` | Get agent's local KB |
| `DELETE` | `/:subaccountId/resources/:resourceId` | Delete resource |
| `PATCH` | `/:subaccountId/resources/:resourceId/scope` | Change scope |

---

## Request/Response Examples

### 1. Add Global Text Resource

**Request:**
```bash
curl -X POST "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/resources" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "type": "text",
    "scope": "global",
    "text": "Our company offers 24/7 customer support via phone, email, and live chat. Support hours: Monday-Friday 9AM-5PM EST for phone support, email support available 24/7 with response within 24 hours.",
    "title": "Customer Support Information"
  }'
```

**Response (201 Created):**
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
      "sourceId": "source_abc123",
      "title": "Customer Support Information",
      "createdAt": "2025-01-15T10:30:00.000Z",
      "createdBy": "user_123"
    }
  },
  "meta": {
    "operationId": "123e4567-e89b-12d3-a456-426614174000",
    "duration": "1250ms"
  }
}
```

**JavaScript (Fetch):**
```javascript
const addGlobalTextResource = async (subaccountId, text, title) => {
  const response = await fetch(`${API_BASE_URL}/${subaccountId}/resources`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'text',
      scope: 'global',
      text: text,
      title: title
    })
  });

  if (!response.ok) {
    throw new Error('Failed to add resource');
  }

  return await response.json();
};
```

---

### 2. Add Local Text Resource (Agent-Specific)

**Request:**
```bash
curl -X POST "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/resources" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "type": "text",
    "scope": "local",
    "agentId": "agent_abc123",
    "text": "You are a sales assistant specializing in enterprise solutions. Your key talking points: 1) Scalability, 2) Security, 3) ROI within 6 months. Always ask about current pain points before presenting solutions.",
    "title": "Sales Agent Instructions"
  }'
```

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Resource added successfully",
  "data": {
    "resourceId": "660e8400-e29b-41d4-a716-446655440001",
    "knowledgeBaseId": "knowledge_base_b789426614174001",
    "type": "text",
    "scope": "local",
    "resource": {
      "resourceId": "660e8400-e29b-41d4-a716-446655440001",
      "type": "text",
      "sourceId": "source_def456",
      "title": "Sales Agent Instructions",
      "createdAt": "2025-01-15T11:00:00.000Z",
      "createdBy": "user_123"
    }
  },
  "meta": {
    "operationId": "234e5678-e89b-12d3-a456-426614174001",
    "duration": "1180ms"
  }
}
```

**JavaScript (Fetch):**
```javascript
const addLocalTextResource = async (subaccountId, agentId, text, title) => {
  const response = await fetch(`${API_BASE_URL}/${subaccountId}/resources`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'text',
      scope: 'local',
      agentId: agentId,
      text: text,
      title: title
    })
  });

  return await response.json();
};
```

---

### 3. Add URL Resource with Auto-Refresh

**Request:**
```bash
curl -X POST "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/resources" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "type": "url",
    "scope": "global",
    "url": "https://docs.mycompany.com/api/v2",
    "enableAutoRefresh": true
  }'
```

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Resource added successfully",
  "data": {
    "resourceId": "770e8400-e29b-41d4-a716-446655440002",
    "knowledgeBaseId": "knowledge_base_a456426614174000",
    "type": "url",
    "scope": "global",
    "resource": {
      "resourceId": "770e8400-e29b-41d4-a716-446655440002",
      "type": "url",
      "sourceId": "source_ghi789",
      "url": "https://docs.mycompany.com/api/v2",
      "enableAutoRefresh": true,
      "title": "API Documentation",
      "createdAt": "2025-01-15T12:00:00.000Z",
      "createdBy": "user_123"
    }
  },
  "meta": {
    "operationId": "345e6789-e89b-12d3-a456-426614174002",
    "duration": "1450ms"
  }
}
```

**JavaScript (Fetch):**
```javascript
const addURLResource = async (subaccountId, url, scope = 'global', agentId = null, enableAutoRefresh = false) => {
  const body = {
    type: 'url',
    scope: scope,
    url: url,
    enableAutoRefresh: enableAutoRefresh
  };

  if (scope === 'local' && agentId) {
    body.agentId = agentId;
  }

  const response = await fetch(`${API_BASE_URL}/${subaccountId}/resources`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  return await response.json();
};
```

---

### 4. Upload Document (File)

**Request:**
```bash
curl -X POST "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/resources" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -F "type=document" \
  -F "scope=global" \
  -F "file=@/Users/john/Documents/company-policy.pdf"
```

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Resource added successfully",
  "data": {
    "resourceId": "880e8400-e29b-41d4-a716-446655440003",
    "knowledgeBaseId": "knowledge_base_a456426614174000",
    "type": "document",
    "scope": "global",
    "resource": {
      "resourceId": "880e8400-e29b-41d4-a716-446655440003",
      "type": "document",
      "sourceId": "source_jkl012",
      "title": "company-policy.pdf",
      "filename": "company-policy.pdf",
      "createdAt": "2025-01-15T13:00:00.000Z",
      "createdBy": "user_123"
    }
  },
  "meta": {
    "operationId": "456e7890-e89b-12d3-a456-426614174003",
    "duration": "2850ms"
  }
}
```

**JavaScript (Fetch with FormData):**
```javascript
const uploadDocument = async (subaccountId, file, scope = 'global', agentId = null) => {
  const formData = new FormData();
  formData.append('type', 'document');
  formData.append('scope', scope);
  formData.append('file', file);
  
  if (scope === 'local' && agentId) {
    formData.append('agentId', agentId);
  }

  const response = await fetch(`${API_BASE_URL}/${subaccountId}/resources`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
      // Note: Do NOT set Content-Type for FormData, browser sets it automatically with boundary
    },
    body: formData
  });

  return await response.json();
};
```

---

### 5. Get Global Knowledge Base

**Request:**
```bash
curl -X GET "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/global" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Response (200 OK - With Resources):**
```json
{
  "success": true,
  "message": "Global knowledge base fetched successfully",
  "data": {
    "knowledgeBaseId": "knowledge_base_a456426614174000",
    "knowledgeBaseName": "Global KB - 507f1f77bcf86cd799439011",
    "type": "global",
    "resources": [
      {
        "resourceId": "550e8400-e29b-41d4-a716-446655440000",
        "type": "text",
        "sourceId": "source_abc123",
        "title": "Customer Support Information",
        "createdAt": "2025-01-15T10:30:00.000Z",
        "createdBy": "user_123"
      },
      {
        "resourceId": "770e8400-e29b-41d4-a716-446655440002",
        "type": "url",
        "sourceId": "source_ghi789",
        "url": "https://docs.mycompany.com/api/v2",
        "enableAutoRefresh": true,
        "title": "API Documentation",
        "createdAt": "2025-01-15T12:00:00.000Z",
        "createdBy": "user_123"
      },
      {
        "resourceId": "880e8400-e29b-41d4-a716-446655440003",
        "type": "document",
        "sourceId": "source_jkl012",
        "title": "company-policy.pdf",
        "filename": "company-policy.pdf",
        "createdAt": "2025-01-15T13:00:00.000Z",
        "createdBy": "user_123"
      }
    ],
    "resourceCount": 3,
    "createdAt": "2025-01-15T10:00:00.000Z",
    "updatedAt": "2025-01-15T13:00:00.000Z"
  },
  "meta": {
    "operationId": "567e8901-e89b-12d3-a456-426614174004",
    "duration": "125ms",
    "cached": false
  }
}
```

**Response (200 OK - Empty/No Resources):**
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
    "operationId": "567e8901-e89b-12d3-a456-426614174004",
    "duration": "85ms",
    "cached": false
  }
}
```

**JavaScript (Fetch):**
```javascript
const getGlobalKB = async (subaccountId) => {
  const response = await fetch(`${API_BASE_URL}/${subaccountId}/global`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  return await response.json();
};
```

**Note:** This endpoint always returns 200 OK, even if no knowledge base exists yet. Check `data.knowledgeBaseId === null` to determine if KB hasn't been created yet.

---

### 6. Get Agent's Local Knowledge Base

**Request:**
```bash
curl -X GET "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/agents/agent_abc123/local" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Response (200 OK - With Resources):**
```json
{
  "success": true,
  "message": "Local knowledge base fetched successfully",
  "data": {
    "knowledgeBaseId": "knowledge_base_b789426614174001",
    "knowledgeBaseName": "Local KB - Agent agent_abc123",
    "type": "local",
    "agentId": "agent_abc123",
    "resources": [
      {
        "resourceId": "660e8400-e29b-41d4-a716-446655440001",
        "type": "text",
        "sourceId": "source_def456",
        "title": "Sales Agent Instructions",
        "createdAt": "2025-01-15T11:00:00.000Z",
        "createdBy": "user_123"
      }
    ],
    "resourceCount": 1,
    "createdAt": "2025-01-15T11:00:00.000Z",
    "updatedAt": "2025-01-15T11:00:00.000Z"
  },
  "meta": {
    "operationId": "678e9012-e89b-12d3-a456-426614174005",
    "duration": "98ms",
    "cached": true
  }
}
```

**Response (200 OK - Empty/No Resources):**
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
    "operationId": "678e9012-e89b-12d3-a456-426614174005",
    "duration": "75ms",
    "cached": false
  }
}
```

**JavaScript (Fetch):**
```javascript
const getLocalKB = async (subaccountId, agentId) => {
  const response = await fetch(`${API_BASE_URL}/${subaccountId}/agents/${agentId}/local`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  return await response.json();
};
```

**Note:** This endpoint always returns 200 OK, even if no knowledge base exists yet. Check `data.knowledgeBaseId === null` to determine if KB hasn't been created yet.

---

### 7. List All Knowledge Bases

**Request:**
```bash
curl -X GET "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Knowledge bases fetched successfully",
  "data": {
    "knowledgeBases": [
      {
        "knowledgeBaseId": "knowledge_base_a456426614174000",
        "knowledgeBaseName": "Global KB - 507f1f77bcf86cd799439011",
        "type": "global",
        "agentId": null,
        "resourceCount": 3,
        "createdAt": "2025-01-15T10:00:00.000Z",
        "updatedAt": "2025-01-15T13:00:00.000Z"
      },
      {
        "knowledgeBaseId": "knowledge_base_b789426614174001",
        "knowledgeBaseName": "Local KB - Agent agent_abc123",
        "type": "local",
        "agentId": "agent_abc123",
        "resourceCount": 1,
        "createdAt": "2025-01-15T11:00:00.000Z",
        "updatedAt": "2025-01-15T11:00:00.000Z"
      },
      {
        "knowledgeBaseId": "knowledge_base_c012426614174002",
        "knowledgeBaseName": "Local KB - Agent agent_def456",
        "type": "local",
        "agentId": "agent_def456",
        "resourceCount": 2,
        "createdAt": "2025-01-15T14:00:00.000Z",
        "updatedAt": "2025-01-15T15:00:00.000Z"
      }
    ],
    "count": 3
  },
  "meta": {
    "operationId": "789e0123-e89b-12d3-a456-426614174006",
    "duration": "175ms"
  }
}
```

**JavaScript (Fetch):**
```javascript
const listAllKBs = async (subaccountId) => {
  const response = await fetch(`${API_BASE_URL}/${subaccountId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  return await response.json();
};
```

---

### 8. Delete Resource

**Request:**
```bash
curl -X DELETE "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/resources/550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Resource deleted successfully",
  "data": {
    "resourceId": "550e8400-e29b-41d4-a716-446655440000",
    "knowledgeBaseId": "knowledge_base_a456426614174000"
  },
  "meta": {
    "operationId": "890e1234-e89b-12d3-a456-426614174007",
    "duration": "856ms"
  }
}
```

**JavaScript (Fetch):**
```javascript
const deleteResource = async (subaccountId, resourceId) => {
  const response = await fetch(`${API_BASE_URL}/${subaccountId}/resources/${resourceId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  return await response.json();
};
```

---

### 9. Change Resource Scope (Global ↔ Local)

**Request (Change to Global):**
```bash
curl -X PATCH "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/resources/660e8400-e29b-41d4-a716-446655440001/scope" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "global"
  }'
```

**Request (Change to Local):**
```bash
curl -X PATCH "https://your-domain.com/api/knowledge-base/507f1f77bcf86cd799439011/resources/550e8400-e29b-41d4-a716-446655440000/scope" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "local",
    "agentId": "agent_abc123"
  }'
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Resource scope updated successfully",
  "data": {
    "resourceId": "660e8400-e29b-41d4-a716-446655440001",
    "oldScope": "local",
    "newScope": "global",
    "oldKnowledgeBaseId": "knowledge_base_b789426614174001",
    "newKnowledgeBaseId": "knowledge_base_a456426614174000"
  },
  "meta": {
    "operationId": "901e2345-e89b-12d3-a456-426614174008",
    "duration": "1580ms"
  }
}
```

**JavaScript (Fetch):**
```javascript
const changeResourceScope = async (subaccountId, resourceId, newScope, agentId = null) => {
  const body = { scope: newScope };
  
  if (newScope === 'local' && agentId) {
    body.agentId = agentId;
  }

  const response = await fetch(`${API_BASE_URL}/${subaccountId}/resources/${resourceId}/scope`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  return await response.json();
};
```

---

## Frontend Implementation

### Complete API Service Class (JavaScript/TypeScript)

```javascript
// knowledgeBaseService.js

class KnowledgeBaseService {
  constructor(baseURL, getAuthToken) {
    this.baseURL = baseURL;
    this.getAuthToken = getAuthToken; // Function that returns current auth token
  }

  async request(endpoint, options = {}) {
    const token = this.getAuthToken();
    const url = `${this.baseURL}${endpoint}`;
    
    const headers = {
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    };

    // Don't set Content-Type for FormData
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const config = {
      ...options,
      headers
    };

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Request failed');
      }

      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  }

  // Add text resource
  async addTextResource(subaccountId, { text, title, scope = 'global', agentId = null }) {
    const body = { type: 'text', text, title, scope };
    if (scope === 'local' && agentId) {
      body.agentId = agentId;
    }

    return this.request(`/${subaccountId}/resources`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  // Add URL resource
  async addURLResource(subaccountId, { url, scope = 'global', agentId = null, enableAutoRefresh = false }) {
    const body = { type: 'url', url, scope, enableAutoRefresh };
    if (scope === 'local' && agentId) {
      body.agentId = agentId;
    }

    return this.request(`/${subaccountId}/resources`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  // Upload document
  async uploadDocument(subaccountId, { file, scope = 'global', agentId = null }) {
    const formData = new FormData();
    formData.append('type', 'document');
    formData.append('scope', scope);
    formData.append('file', file);
    
    if (scope === 'local' && agentId) {
      formData.append('agentId', agentId);
    }

    return this.request(`/${subaccountId}/resources`, {
      method: 'POST',
      body: formData
    });
  }

  // Get global KB
  async getGlobalKB(subaccountId) {
    return this.request(`/${subaccountId}/global`, {
      method: 'GET'
    });
  }

  // Get local KB
  async getLocalKB(subaccountId, agentId) {
    return this.request(`/${subaccountId}/agents/${agentId}/local`, {
      method: 'GET'
    });
  }

  // List all KBs
  async listKnowledgeBases(subaccountId) {
    return this.request(`/${subaccountId}`, {
      method: 'GET'
    });
  }

  // Delete resource
  async deleteResource(subaccountId, resourceId) {
    return this.request(`/${subaccountId}/resources/${resourceId}`, {
      method: 'DELETE'
    });
  }

  // Change resource scope
  async changeResourceScope(subaccountId, resourceId, { scope, agentId = null }) {
    const body = { scope };
    if (scope === 'local' && agentId) {
      body.agentId = agentId;
    }

    return this.request(`/${subaccountId}/resources/${resourceId}/scope`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
  }
}

// Usage
const kbService = new KnowledgeBaseService(
  'https://your-domain.com/api/knowledge-base',
  () => localStorage.getItem('authToken')
);

export default kbService;
```

---

## React Examples

### 1. Add Text Resource Component

```jsx
import React, { useState } from 'react';
import kbService from './services/knowledgeBaseService';

function AddTextResource({ subaccountId, scope = 'global', agentId = null }) {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await kbService.addTextResource(subaccountId, {
        text,
        title,
        scope,
        agentId
      });

      alert(`Resource added successfully! ID: ${result.data.resourceId}`);
      setText('');
      setTitle('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="add-text-resource">
      <h3>Add {scope === 'global' ? 'Global' : 'Local'} Text Resource</h3>
      
      <form onSubmit={handleSubmit}>
        <div>
          <label>Title:</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Resource title"
            required
          />
        </div>

        <div>
          <label>Content:</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter knowledge base content..."
            rows={6}
            required
          />
        </div>

        {error && <div className="error">{error}</div>}

        <button type="submit" disabled={loading}>
          {loading ? 'Adding...' : 'Add Resource'}
        </button>
      </form>
    </div>
  );
}

export default AddTextResource;
```

---

### 2. File Upload Component

```jsx
import React, { useState } from 'react';
import kbService from './services/knowledgeBaseService';

function UploadDocument({ subaccountId, scope = 'global', agentId = null }) {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    
    // Validate file size (50MB limit)
    if (selectedFile && selectedFile.size > 50 * 1024 * 1024) {
      setError('File size must not exceed 50MB');
      return;
    }

    setFile(selectedFile);
    setError(null);
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file');
      return;
    }

    setLoading(true);
    setError(null);
    setProgress(0);

    try {
      // Simulate progress (you can implement real progress tracking with XMLHttpRequest)
      const progressInterval = setInterval(() => {
        setProgress(prev => Math.min(prev + 10, 90));
      }, 200);

      const result = await kbService.uploadDocument(subaccountId, {
        file,
        scope,
        agentId
      });

      clearInterval(progressInterval);
      setProgress(100);

      alert(`Document uploaded successfully! ID: ${result.data.resourceId}`);
      setFile(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="upload-document">
      <h3>Upload Document</h3>
      
      <div>
        <input
          type="file"
          onChange={handleFileChange}
          accept=".pdf,.doc,.docx,.txt"
          disabled={loading}
        />
      </div>

      {file && (
        <div className="file-info">
          <p>Selected: {file.name}</p>
          <p>Size: {(file.size / 1024 / 1024).toFixed(2)} MB</p>
        </div>
      )}

      {loading && (
        <div className="progress-bar">
          <div style={{ width: `${progress}%` }}>{progress}%</div>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <button onClick={handleUpload} disabled={loading || !file}>
        {loading ? 'Uploading...' : 'Upload'}
      </button>
    </div>
  );
}

export default UploadDocument;
```

---

### 3. Knowledge Base List Component

```jsx
import React, { useState, useEffect } from 'react';
import kbService from './services/knowledgeBaseService';

function KnowledgeBaseList({ subaccountId, type = 'global', agentId = null }) {
  const [kb, setKb] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadKnowledgeBase();
  }, [subaccountId, type, agentId]);

  const loadKnowledgeBase = async () => {
    setLoading(true);
    setError(null);

    try {
      let result;
      if (type === 'global') {
        result = await kbService.getGlobalKB(subaccountId);
      } else {
        result = await kbService.getLocalKB(subaccountId, agentId);
      }

      setKb(result.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (resourceId) => {
    if (!confirm('Are you sure you want to delete this resource?')) {
      return;
    }

    try {
      await kbService.deleteResource(subaccountId, resourceId);
      alert('Resource deleted successfully');
      loadKnowledgeBase(); // Reload
    } catch (err) {
      alert(`Failed to delete: ${err.message}`);
    }
  };

  const handleChangeScope = async (resourceId, currentScope) => {
    const newScope = currentScope === 'global' ? 'local' : 'global';
    let targetAgentId = null;

    if (newScope === 'local') {
      targetAgentId = prompt('Enter Agent ID:');
      if (!targetAgentId) return;
    }

    try {
      await kbService.changeResourceScope(subaccountId, resourceId, {
        scope: newScope,
        agentId: targetAgentId
      });
      alert('Scope changed successfully');
      loadKnowledgeBase(); // Reload
    } catch (err) {
      alert(`Failed to change scope: ${err.message}`);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div className="error">Error: {error}</div>;
  if (!kb) return <div>No knowledge base found</div>;

  // Handle empty KB (not created yet)
  if (!kb.knowledgeBaseId) {
    return (
      <div className="knowledge-base-list empty">
        <h3>No {kb.type} knowledge base yet</h3>
        <p>Add your first resource to create the knowledge base.</p>
      </div>
    );
  }

  return (
    <div className="knowledge-base-list">
      <h3>{kb.knowledgeBaseName}</h3>
      <p>Type: {kb.type}</p>
      <p>Resources: {kb.resourceCount}</p>

      <div className="resources">
        {kb.resourceCount === 0 ? (
          <div className="empty-state">
            <p>No resources yet. Add your first resource to get started.</p>
          </div>
        ) : (
          kb.resources.map(resource => (
          <div key={resource.resourceId} className="resource-item">
            <div className="resource-header">
              <span className="resource-type">{resource.type}</span>
              <h4>{resource.title}</h4>
            </div>

            <div className="resource-meta">
              <small>Created: {new Date(resource.createdAt).toLocaleDateString()}</small>
            </div>

            {resource.type === 'url' && (
              <div className="resource-url">
                <a href={resource.url} target="_blank" rel="noopener noreferrer">
                  {resource.url}
                </a>
                {resource.enableAutoRefresh && <span> (Auto-refresh enabled)</span>}
              </div>
            )}

            {resource.type === 'document' && (
              <div className="resource-file">
                <span>📄 {resource.filename}</span>
              </div>
            )}

            <div className="resource-actions">
              <button onClick={() => handleChangeScope(resource.resourceId, kb.type)}>
                {resource.type !== 'document' && (kb.type === 'global' ? 'Make Local' : 'Make Global')}
              </button>
              <button onClick={() => handleDelete(resource.resourceId)} className="danger">
                Delete
              </button>
            </div>
          </div>
        )))}
      </div>
    </div>
  );
}

export default KnowledgeBaseList;
```

---

### 4. Complete Knowledge Base Manager

```jsx
import React, { useState } from 'react';
import AddTextResource from './AddTextResource';
import UploadDocument from './UploadDocument';
import KnowledgeBaseList from './KnowledgeBaseList';

function KnowledgeBaseManager({ subaccountId, selectedAgentId = null }) {
  const [activeTab, setActiveTab] = useState('global');
  const [showAddForm, setShowAddForm] = useState(false);
  const [resourceType, setResourceType] = useState('text');

  return (
    <div className="kb-manager">
      <h2>Knowledge Base Manager</h2>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={activeTab === 'global' ? 'active' : ''}
          onClick={() => setActiveTab('global')}
        >
          Global Knowledge
        </button>
        {selectedAgentId && (
          <button
            className={activeTab === 'local' ? 'active' : ''}
            onClick={() => setActiveTab('local')}
          >
            Agent-Specific Knowledge
          </button>
        )}
      </div>

      {/* Add Resource Button */}
      <button onClick={() => setShowAddForm(!showAddForm)} className="add-btn">
        {showAddForm ? 'Cancel' : '+ Add Resource'}
      </button>

      {/* Add Form */}
      {showAddForm && (
        <div className="add-form">
          <div className="resource-type-selector">
            <label>
              <input
                type="radio"
                value="text"
                checked={resourceType === 'text'}
                onChange={(e) => setResourceType(e.target.value)}
              />
              Text
            </label>
            <label>
              <input
                type="radio"
                value="url"
                checked={resourceType === 'url'}
                onChange={(e) => setResourceType(e.target.value)}
              />
              URL
            </label>
            <label>
              <input
                type="radio"
                value="document"
                checked={resourceType === 'document'}
                onChange={(e) => setResourceType(e.target.value)}
              />
              Document
            </label>
          </div>

          {resourceType === 'text' && (
            <AddTextResource
              subaccountId={subaccountId}
              scope={activeTab}
              agentId={activeTab === 'local' ? selectedAgentId : null}
            />
          )}

          {resourceType === 'url' && (
            <AddURLResource
              subaccountId={subaccountId}
              scope={activeTab}
              agentId={activeTab === 'local' ? selectedAgentId : null}
            />
          )}

          {resourceType === 'document' && (
            <UploadDocument
              subaccountId={subaccountId}
              scope={activeTab}
              agentId={activeTab === 'local' ? selectedAgentId : null}
            />
          )}
        </div>
      )}

      {/* Knowledge Base List */}
      <KnowledgeBaseList
        subaccountId={subaccountId}
        type={activeTab}
        agentId={activeTab === 'local' ? selectedAgentId : null}
      />
    </div>
  );
}

export default KnowledgeBaseManager;
```

---

## Error Handling

### Common Error Codes

```javascript
const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RETELL_ACCOUNT_INACTIVE: 'RETELL_ACCOUNT_INACTIVE',
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
  KB_NOT_FOUND: 'KB_NOT_FOUND',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_OPERATION: 'UNSUPPORTED_OPERATION',
  INVALID_SCOPE_CHANGE: 'INVALID_SCOPE_CHANGE',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR'
};
```

### Error Handler

```javascript
function handleKBError(error) {
  const errorMap = {
    [ERROR_CODES.VALIDATION_ERROR]: 'Please check your input and try again.',
    [ERROR_CODES.RETELL_ACCOUNT_INACTIVE]: 'Your Retell account is not active. Please contact support.',
    [ERROR_CODES.AGENT_NOT_FOUND]: 'Agent not found. Please select a valid agent.',
    [ERROR_CODES.KB_NOT_FOUND]: 'Knowledge base not found.',
    [ERROR_CODES.RESOURCE_NOT_FOUND]: 'Resource not found.',
    [ERROR_CODES.FILE_TOO_LARGE]: 'File size exceeds 50MB limit.',
    [ERROR_CODES.UNSUPPORTED_OPERATION]: 'This operation is not supported for document resources.',
    [ERROR_CODES.INVALID_SCOPE_CHANGE]: 'Resource is already in the target scope.',
    [ERROR_CODES.UNAUTHORIZED]: 'Authentication failed. Please log in again.',
    [ERROR_CODES.INTERNAL_SERVER_ERROR]: 'Server error. Please try again later.'
  };

  return errorMap[error.code] || error.message || 'An unknown error occurred.';
}

// Usage
try {
  await kbService.addTextResource(subaccountId, { ... });
} catch (error) {
  const userMessage = handleKBError(error);
  showErrorToast(userMessage);
}
```

---

## Best Practices

### 1. **Loading States**
Always show loading indicators during API calls:
```javascript
const [loading, setLoading] = useState(false);

const handleSubmit = async () => {
  setLoading(true);
  try {
    await kbService.addTextResource(...);
  } finally {
    setLoading(false);
  }
};
```

### 2. **File Validation**
Validate files before uploading:
```javascript
const validateFile = (file) => {
  const maxSize = 50 * 1024 * 1024; // 50MB
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ];

  if (file.size > maxSize) {
    throw new Error('File size must not exceed 50MB');
  }

  if (!allowedTypes.includes(file.type)) {
    throw new Error('Unsupported file type');
  }

  return true;
};
```

### 3. **Caching**
Implement client-side caching for better UX:
```javascript
const cache = new Map();

async function getCachedKB(subaccountId, type, agentId = null) {
  const cacheKey = `${subaccountId}-${type}-${agentId || 'global'}`;
  
  if (cache.has(cacheKey)) {
    const { data, timestamp } = cache.get(cacheKey);
    // Cache for 5 minutes
    if (Date.now() - timestamp < 5 * 60 * 1000) {
      return data;
    }
  }

  const result = type === 'global'
    ? await kbService.getGlobalKB(subaccountId)
    : await kbService.getLocalKB(subaccountId, agentId);

  cache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}
```

### 4. **Optimistic UI Updates**
Update UI immediately, then sync with server:
```javascript
const [resources, setResources] = useState([]);

const handleDelete = async (resourceId) => {
  // Optimistic update
  const originalResources = [...resources];
  setResources(resources.filter(r => r.resourceId !== resourceId));

  try {
    await kbService.deleteResource(subaccountId, resourceId);
  } catch (error) {
    // Rollback on error
    setResources(originalResources);
    alert('Failed to delete resource');
  }
};
```

### 5. **Progress Tracking for Uploads**
```javascript
const uploadWithProgress = async (file, onProgress) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', 'document');
  formData.append('scope', 'global');

  const xhr = new XMLHttpRequest();

  return new Promise((resolve, reject) => {
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percentComplete = (e.loaded / e.total) * 100;
        onProgress(percentComplete);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 201) {
        resolve(JSON.parse(xhr.response));
      } else {
        reject(new Error('Upload failed'));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload failed')));

    xhr.open('POST', `${API_BASE_URL}/${subaccountId}/resources`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);
  });
};
```

### 6. **Debounce Search/Filter**
```javascript
import { debounce } from 'lodash';

const debouncedSearch = debounce(async (searchTerm) => {
  const kb = await kbService.getGlobalKB(subaccountId);
  const filtered = kb.data.resources.filter(r =>
    r.title.toLowerCase().includes(searchTerm.toLowerCase())
  );
  setFilteredResources(filtered);
}, 300);
```

---

## TypeScript Definitions

```typescript
// types.ts

export type ResourceType = 'text' | 'url' | 'document';
export type ScopeType = 'global' | 'local';

export interface TextResource {
  type: 'text';
  text: string;
  title: string;
  scope: ScopeType;
  agentId?: string;
}

export interface URLResource {
  type: 'url';
  url: string;
  scope: ScopeType;
  agentId?: string;
  enableAutoRefresh?: boolean;
}

export interface DocumentResource {
  type: 'document';
  file: File;
  scope: ScopeType;
  agentId?: string;
}

export interface Resource {
  resourceId: string;
  type: ResourceType;
  sourceId: string;
  title: string;
  text?: string;
  url?: string;
  filename?: string;
  fileUrl?: string;
  enableAutoRefresh?: boolean;
  createdAt: string;
  createdBy: string;
}

export interface KnowledgeBase {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  type: ScopeType;
  agentId?: string;
  resources: Resource[];
  resourceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface APIResponse<T> {
  success: boolean;
  message: string;
  data: T;
  meta: {
    operationId: string;
    duration: string;
    cached?: boolean;
  };
}

export interface APIError {
  success: false;
  message: string;
  code: string;
  errors?: Array<{
    field: string;
    message: string;
  }>;
}
```

---

## Testing Checklist

- [ ] Test adding global text resource
- [ ] Test adding local text resource
- [ ] Test adding URL resource with auto-refresh
- [ ] Test uploading document (PDF, DOCX, TXT)
- [ ] Test file size validation (> 50MB should fail)
- [ ] Test getting global KB
- [ ] Test getting local KB
- [ ] Test listing all KBs
- [ ] Test deleting resource
- [ ] Test changing scope from global to local
- [ ] Test changing scope from local to global
- [ ] Test error handling for invalid agent ID
- [ ] Test error handling for missing authentication
- [ ] Test caching (check `cached: true` in response)
- [ ] Test with expired token (should get 401)
- [ ] Test concurrent operations
- [ ] Test UI loading states
- [ ] Test UI error messages
- [ ] Test file upload progress

---

## Support & Questions

For implementation questions or issues:
1. Check the error code and message
2. Verify authentication token is valid
3. Ensure subaccountId format is correct (24-character hex)
4. Check file size limits for document uploads
5. Review the API documentation at `KNOWLEDGE_BASE_API.md`

Common gotchas:
- Document resources cannot be moved between scopes
- Local resources require `agentId` parameter
- File uploads must use `FormData` (not JSON)
- Don't set `Content-Type` header for file uploads (browser sets it automatically)
- Cache indicator in response meta shows if data is from cache

