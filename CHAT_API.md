# Chat API Documentation

## Overview
The Chat API allows you to create and manage text-based chat conversations using Retell agents. This enables interactive text conversations with AI agents, including message history tracking, transcript retrieval, and conversation management.

## Base URL
```
/api/chats
```

## Authentication
All endpoints require authentication using a Bearer token in the Authorization header:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

---

## Endpoints

### 1. Create Chat

Create a new chat conversation with a specific agent.

**Endpoint:** `POST /api/chats/:subaccountId/create`

**URL Parameters:**
- `subaccountId` (string, required) - The subaccount ID (24-character MongoDB ObjectId)

**Request Body:**
```json
{
  "agentId": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD"
}
```

**Request Body Parameters:**
- `agentId` (string, required) - The ID of the agent to use for the chat

**Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Chat created successfully",
  "data": {
    "chat_id": "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",
    "agent_id": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
    "chat_status": "ongoing",
    "start_timestamp": 1703302407333,
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

- **503 Service Unavailable** - Failed to create chat
```json
{
  "success": false,
  "message": "Failed to create chat. Please try again later.",
  "code": "CHAT_CREATION_FAILED",
  "meta": {
    "operationId": "550e8400-e29b-41d4-a716-446655440000",
    "operation": "createChat",
    "duration": "200ms"
  }
}
```

---

### 2. Send Message

Send a message in an existing chat and receive the agent's response.

**Endpoint:** `POST /api/chats/:subaccountId/:chatId/message`

**URL Parameters:**
- `subaccountId` (string, required) - The subaccount ID
- `chatId` (string, required) - The chat ID

**Request Body:**
```json
{
  "content": "hi how are you doing?"
}
```

**Request Body Parameters:**
- `content` (string, required) - The message content to send (minimum 1 character)

**Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "data": {
    "chat_id": "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",
    "messages": [
      {
        "message_id": "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",
        "role": "agent",
        "content": "hi how are you doing?",
        "created_timestamp": 1703302428855
      }
    ]
  },
  "meta": {
    "operationId": "550e8400-e29b-41d4-a716-446655440000",
    "duration": "250ms"
  }
}
```

**Error Responses:**

- **404 Not Found** - Chat not found
```json
{
  "success": false,
  "message": "Chat not found",
  "code": "CHAT_NOT_FOUND"
}
```

- **503 Service Unavailable** - Failed to send message
```json
{
  "success": false,
  "message": "Failed to send message. Please try again later.",
  "code": "MESSAGE_SEND_FAILED"
}
```

---

### 3. End Chat

End an ongoing chat conversation.

**Endpoint:** `POST /api/chats/:subaccountId/:chatId/end`

**URL Parameters:**
- `subaccountId` (string, required) - The subaccount ID
- `chatId` (string, required) - The chat ID

**Request Body:** None

**Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Chat ended successfully",
  "data": {
    "chat_id": "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",
    "chat_status": "ended",
    "end_timestamp": 1703302428855
  },
  "meta": {
    "operationId": "550e8400-e29b-41d4-a716-446655440000",
    "duration": "180ms"
  }
}
```

**Error Responses:**

- **404 Not Found** - Chat not found
```json
{
  "success": false,
  "message": "Chat not found",
  "code": "CHAT_NOT_FOUND"
}
```

- **503 Service Unavailable** - Failed to end chat
```json
{
  "success": false,
  "message": "Failed to end chat. Please try again later.",
  "code": "CHAT_END_FAILED"
}
```

---

### 4. List All Chats

Retrieve a list of all chats with minimal information (start time and message count only).

**Endpoint:** `GET /api/chats/:subaccountId/list`

**URL Parameters:**
- `subaccountId` (string, required) - The subaccount ID

**Request Body:** None

**Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Chats retrieved successfully",
  "data": [
    {
      "chat_id": "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",
      "agent_id": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
      "chat_status": "ended",
      "start_timestamp": 1703302407333,
      "end_timestamp": 1703302428855,
      "message_count": 8,
      "createdAt": "2024-10-02T10:30:00.000Z"
    },
    {
      "chat_id": "AnotherChatIdHere123456789",
      "agent_id": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
      "chat_status": "ongoing",
      "start_timestamp": 1703302500000,
      "end_timestamp": null,
      "message_count": 4,
      "createdAt": "2024-10-02T11:00:00.000Z"
    }
  ],
  "meta": {
    "operationId": "550e8400-e29b-41d4-a716-446655440000",
    "duration": "50ms",
    "count": 2,
    "cached": false
  }
}
```

**Notes:**
- Results are sorted by `start_timestamp` in descending order (newest first)
- This endpoint is cached for 1 minute to improve performance
- Returns only minimal data for quick overview

---

### 5. Get Chat Transcript

Retrieve the complete transcript and details of a specific chat.

**Endpoint:** `GET /api/chats/:subaccountId/:chatId/transcript`

**URL Parameters:**
- `subaccountId` (string, required) - The subaccount ID
- `chatId` (string, required) - The chat ID

**Request Body:** None

**Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Chat transcript retrieved successfully",
  "data": {
    "chat_id": "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",
    "agent_id": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
    "chat_status": "ended",
    "start_timestamp": 1703302407333,
    "end_timestamp": 1703302428855,
    "transcript": "Agent: hi how are you doing?\nUser: Doing pretty well. How are you?\nAgent: That's great to hear! I'm doing well too, thanks! What's up?\nUser: I don't have anything in particular.\nAgent: Got it, just checking in!\nUser: Alright. See you.\nAgent: have a nice day\n",
    "messages": [
      {
        "message_id": "Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6",
        "role": "agent",
        "content": "hi how are you doing?",
        "created_timestamp": 1703302428855
      }
    ],
    "message_count": 8,
    "chat_cost": {
      "product_costs": [
        {
          "product": "elevenlabs_tts",
          "unit_price": 1,
          "cost": 60
        }
      ],
      "combined_cost": 70
    },
    "chat_analysis": {
      "chat_summary": "The agent messages user to ask question about his purchase inquiry. The agent asked several questions regarding his preference and asked if user would like to book an appointment. The user happily agreed and scheduled an appointment next Monday 10am.",
      "user_sentiment": "Positive",
      "chat_successful": true,
      "custom_analysis_data": {}
    },
    "metadata": {},
    "retell_llm_dynamic_variables": {
      "customer_name": "John Doe"
    },
    "collected_dynamic_variables": {
      "last_node_name": "Test node"
    }
  },
  "meta": {
    "operationId": "550e8400-e29b-41d4-a716-446655440000",
    "duration": "120ms",
    "cached": false
  }
}
```

**Notes:**
- For ongoing chats, the latest data is fetched from Retell and cached
- Completed chats are cached for 5 minutes
- Includes full transcript, message history, cost analysis, and chat analytics

**Error Responses:**

- **404 Not Found** - Chat not found
```json
{
  "success": false,
  "message": "Chat not found",
  "code": "CHAT_NOT_FOUND"
}
```

---

## Example Usage

### 1. Create a Chat

#### Using cURL
```bash
curl -X POST https://your-server.com/api/chats/507f1f77bcf86cd799439011/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "agentId": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD"
  }'
```

#### Using JavaScript (Node.js)
```javascript
const axios = require('axios');

const createChat = async () => {
  try {
    const response = await axios.post(
      'https://your-server.com/api/chats/507f1f77bcf86cd799439011/create',
      {
        agentId: 'oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD'
      },
      {
        headers: {
          'Authorization': 'Bearer YOUR_JWT_TOKEN',
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Chat ID:', response.data.data.chat_id);
    console.log('Agent ID:', response.data.data.agent_id);
  } catch (error) {
    console.error('Error creating chat:', error.response?.data || error.message);
  }
};

createChat();
```

#### Using Retell SDK
```javascript
import Retell from 'retell-sdk';

const client = new Retell({
  apiKey: 'YOUR_RETELL_API_KEY',
});

const chatResponse = await client.chat.create({ 
  agent_id: 'oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD' 
});

console.log(chatResponse.chat_id);
console.log(chatResponse.agent_id);
```

---

### 2. Send a Message

#### Using cURL
```bash
curl -X POST https://your-server.com/api/chats/507f1f77bcf86cd799439011/Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "content": "hi how are you doing?"
  }'
```

#### Using JavaScript (Node.js)
```javascript
const sendMessage = async () => {
  try {
    const response = await axios.post(
      'https://your-server.com/api/chats/507f1f77bcf86cd799439011/Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6/message',
      {
        content: 'hi how are you doing?'
      },
      {
        headers: {
          'Authorization': 'Bearer YOUR_JWT_TOKEN',
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Messages:', response.data.data.messages);
  } catch (error) {
    console.error('Error sending message:', error.response?.data || error.message);
  }
};

sendMessage();
```

#### Using Retell SDK
```javascript
const response = await client.chat.createChatCompletion({
  chat_id: 'Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6',
  content: 'hi how are you doing?',
});

console.log(response.messages);
```

---

### 3. End a Chat

#### Using cURL
```bash
curl -X POST https://your-server.com/api/chats/507f1f77bcf86cd799439011/Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6/end \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Using JavaScript (Node.js)
```javascript
const endChat = async () => {
  try {
    const response = await axios.post(
      'https://your-server.com/api/chats/507f1f77bcf86cd799439011/Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6/end',
      {},
      {
        headers: {
          'Authorization': 'Bearer YOUR_JWT_TOKEN'
        }
      }
    );
    
    console.log('Chat ended:', response.data.data.chat_status);
  } catch (error) {
    console.error('Error ending chat:', error.response?.data || error.message);
  }
};

endChat();
```

#### Using Retell SDK
```javascript
await client.chat.end('Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6');
```

---

### 4. List All Chats

#### Using cURL
```bash
curl -X GET https://your-server.com/api/chats/507f1f77bcf86cd799439011/list \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Using JavaScript (Node.js)
```javascript
const listChats = async () => {
  try {
    const response = await axios.get(
      'https://your-server.com/api/chats/507f1f77bcf86cd799439011/list',
      {
        headers: {
          'Authorization': 'Bearer YOUR_JWT_TOKEN'
        }
      }
    );
    
    console.log('Chats:', response.data.data);
    console.log('Total:', response.data.meta.count);
  } catch (error) {
    console.error('Error listing chats:', error.response?.data || error.message);
  }
};

listChats();
```

#### Using Retell SDK
```javascript
const chatResponses = await client.chat.list();
console.log(chatResponses);
```

---

### 5. Get Chat Transcript

#### Using cURL
```bash
curl -X GET https://your-server.com/api/chats/507f1f77bcf86cd799439011/Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6/transcript \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

#### Using JavaScript (Node.js)
```javascript
const getChatTranscript = async () => {
  try {
    const response = await axios.get(
      'https://your-server.com/api/chats/507f1f77bcf86cd799439011/Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6/transcript',
      {
        headers: {
          'Authorization': 'Bearer YOUR_JWT_TOKEN'
        }
      }
    );
    
    console.log('Transcript:', response.data.data.transcript);
    console.log('Message count:', response.data.data.message_count);
    console.log('Chat cost:', response.data.data.chat_cost);
    console.log('Analysis:', response.data.data.chat_analysis);
  } catch (error) {
    console.error('Error getting transcript:', error.response?.data || error.message);
  }
};

getChatTranscript();
```

#### Using Retell SDK
```javascript
const chatResponse = await client.chat.retrieve('Jabr9TXYYJHfvl6Syypi88rdAHYHmcq6');
console.log(chatResponse.transcript);
console.log(chatResponse.chat_analysis);
```

---

## Rate Limits
- User rate limit: Applies to all authenticated requests
- Subaccount rate limits:
  - Create chat: 100 requests per minute
  - Send message: 200 requests per minute (higher for active conversations)
  - End chat: 100 requests per minute
  - List chats: 50 requests per minute
  - Get transcript: 100 requests per minute

---

## Caching
- **Chat list:** Cached for 1 minute
- **Chat details/transcript:** Cached for 5 minutes
- **Ongoing chats:** Always fetched fresh from Retell to ensure latest data
- Cache is automatically invalidated when:
  - A new chat is created
  - A chat is ended
  - A message is sent

---

## Data Storage

All chat data is automatically stored in MongoDB with the following information:

- Chat ID and agent ID
- Chat status (ongoing/ended)
- Start and end timestamps
- Full transcript
- All messages with timestamps
- Message count
- Cost analysis
- Chat analytics (summary, sentiment, success)
- Dynamic variables
- Metadata
- Subaccount and user information

---

## Notes

- The agent must exist in the database and be associated with the specified subaccount
- The Retell account associated with the subaccount must be active
- Chat transcripts are automatically updated when messages are sent or chats are ended
- For ongoing chats, retrieving the transcript will fetch the latest data from Retell
- All chat operations are logged with operation IDs for debugging and monitoring
- Cost analysis is provided when available (includes breakdown by service)
- Chat analysis includes AI-generated summary, sentiment analysis, and success metrics

---

## Related Endpoints

- `POST /api/database/:subaccountId/agents` - Create a new agent
- `GET /api/database/:subaccountId/agents` - List all agents
- `GET /api/database/:subaccountId/agents/:agentId` - Get agent details
- `POST /api/calls/:subaccountId/web-call` - Create a web call (voice)

---

## Workflow Example

Here's a complete workflow for creating and managing a chat:

```javascript
// 1. Create a chat
const createResponse = await axios.post(
  'https://your-server.com/api/chats/507f1f77bcf86cd799439011/create',
  { agentId: 'oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD' },
  { headers: { 'Authorization': 'Bearer YOUR_JWT_TOKEN' } }
);
const chatId = createResponse.data.data.chat_id;

// 2. Send some messages
await axios.post(
  `https://your-server.com/api/chats/507f1f77bcf86cd799439011/${chatId}/message`,
  { content: 'Hello!' },
  { headers: { 'Authorization': 'Bearer YOUR_JWT_TOKEN' } }
);

await axios.post(
  `https://your-server.com/api/chats/507f1f77bcf86cd799439011/${chatId}/message`,
  { content: 'Can you help me with something?' },
  { headers: { 'Authorization': 'Bearer YOUR_JWT_TOKEN' } }
);

// 3. Get the transcript at any time
const transcriptResponse = await axios.get(
  `https://your-server.com/api/chats/507f1f77bcf86cd799439011/${chatId}/transcript`,
  { headers: { 'Authorization': 'Bearer YOUR_JWT_TOKEN' } }
);
console.log('Transcript:', transcriptResponse.data.data.transcript);

// 4. End the chat when done
await axios.post(
  `https://your-server.com/api/chats/507f1f77bcf86cd799439011/${chatId}/end`,
  {},
  { headers: { 'Authorization': 'Bearer YOUR_JWT_TOKEN' } }
);

// 5. List all chats to see history
const listResponse = await axios.get(
  'https://your-server.com/api/chats/507f1f77bcf86cd799439011/list',
  { headers: { 'Authorization': 'Bearer YOUR_JWT_TOKEN' } }
);
console.log('All chats:', listResponse.data.data);
``` 