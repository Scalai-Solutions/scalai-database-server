# Retell Tool Configurations - Quick Reference

This document provides the exact tool configurations for Retell AI agents as implemented in the system.

## Tool 1: Check Availability

**Purpose:** Check if a specific time slot is available for booking an appointment.

**Configuration:**
```json
{
  "name": "check_availability",
  "description": "Check if a specific time slot is available for booking an appointment",
  "url": "https://your-domain.com/api/webhooks/{subaccountId}/{agentId}/check-availability",
  "method": "POST",
  "parameters": {
    "type": "object",
    "properties": {
      "date": {
        "type": "string",
        "description": "Date in YYYY-MM-DD format"
      },
      "startTime": {
        "type": "string",
        "description": "Start time in HH:mm format (24-hour)"
      },
      "endTime": {
        "type": "string",
        "description": "End time in HH:mm format (24-hour)"
      }
    },
    "required": ["date", "startTime", "endTime"]
  }
}
```

**Example Request:**
```json
{
  "date": "2025-10-08",
  "startTime": "09:00",
  "endTime": "10:00"
}
```

**Example Response - Available:**
```json
{
  "success": true,
  "available": true,
  "date": "2025-10-08",
  "startTime": "09:00",
  "endTime": "10:00",
  "message": "Time slot is available"
}
```

**Example Response - Not Available:**
```json
{
  "success": true,
  "available": false,
  "date": "2025-10-08",
  "startTime": "09:00",
  "endTime": "10:00",
  "message": "Time slot has a conflict"
}
```

---

## Tool 2: Find Nearest Available Slots

**Purpose:** Find the nearest available appointment slots starting from a given date.

**Configuration:**
```json
{
  "name": "nearest_available_slots",
  "description": "Find the nearest available appointment slots",
  "url": "https://your-domain.com/api/webhooks/{subaccountId}/{agentId}/nearest-available-slots",
  "method": "POST",
  "parameters": {
    "type": "object",
    "properties": {
      "startDate": {
        "type": "string",
        "description": "Starting date to search from (YYYY-MM-DD)"
      },
      "count": {
        "type": "number",
        "description": "Number of available slots to return (default: 5)"
      },
      "durationMinutes": {
        "type": "number",
        "description": "Duration of each slot in minutes (default: 60)"
      }
    },
    "required": ["startDate"]
  }
}
```

**Example Request:**
```json
{
  "startDate": "2025-10-08",
  "count": 3,
  "durationMinutes": 60
}
```

**Example Response:**
```json
{
  "success": true,
  "message": "Found 3 available slot(s)",
  "slots": [
    {
      "date": "2025-10-27",
      "startTime": "09:00",
      "endTime": "10:00"
    },
    {
      "date": "2025-11-03",
      "startTime": "09:00",
      "endTime": "10:00"
    },
    {
      "date": "2025-11-10",
      "startTime": "09:00",
      "endTime": "10:00"
    }
  ]
}
```

---

## Tool 3: Book Appointment

**Purpose:** Book an appointment at a specific time slot.

**Configuration:**
```json
{
  "name": "book_appointment",
  "description": "Book an appointment at a specific time slot",
  "url": "https://your-domain.com/api/webhooks/{subaccountId}/{agentId}/book-appointment",
  "method": "POST",
  "parameters": {
    "type": "object",
    "properties": {
      "date": {
        "type": "string",
        "description": "Appointment date (YYYY-MM-DD)"
      },
      "startTime": {
        "type": "string",
        "description": "Start time (HH:mm, 24-hour format)"
      },
      "endTime": {
        "type": "string",
        "description": "End time (HH:mm, 24-hour format)"
      },
      "title": {
        "type": "string",
        "description": "Meeting title"
      },
      "description": {
        "type": "string",
        "description": "Meeting description"
      },
      "customerName": {
        "type": "string",
        "description": "Customer's name"
      },
      "customerEmail": {
        "type": "string",
        "description": "Customer's email address"
      },
      "customerPhone": {
        "type": "string",
        "description": "Customer's phone number"
      },
      "notes": {
        "type": "string",
        "description": "Additional notes"
      }
    },
    "required": ["date", "startTime", "endTime", "title"]
  }
}
```

**Example Request:**
```json
{
  "date": "2025-10-27",
  "startTime": "09:00",
  "endTime": "10:00",
  "title": "Initial Consultation",
  "description": "First meeting to discuss requirements",
  "customerName": "Jane Smith",
  "customerEmail": "jane@example.com",
  "customerPhone": "+1234567890",
  "notes": "Customer prefers morning slots"
}
```

**Example Response - Success:**
```json
{
  "success": true,
  "message": "Appointment booked successfully",
  "meeting": {
    "id": "68e54098bb346859b30d31fa",
    "date": "2025-10-27",
    "startTime": "09:00",
    "endTime": "10:00",
    "startDateTime": "2025-10-27T03:30:00.000Z",
    "endDateTime": "2025-10-27T04:30:00.000Z",
    "title": "Initial Consultation",
    "status": "confirmed"
  }
}
```

**Example Response - Conflict:**
```json
{
  "success": false,
  "message": "Time slot has a conflict with another meeting",
  "date": "2025-10-27",
  "startTime": "09:00",
  "endTime": "10:00"
}
```

---

## URL Structure

All three tools follow the same URL pattern:

```
{deployedWebhookUrl}/api/webhooks/{subaccountId}/{agentId}/{endpoint}
```

**Components:**
- `deployedWebhookUrl`: The base URL of your webhook server, dynamically loaded from:
  - Environment variable: `DEPLOYED_WEBHOOK_SERVER_URL`
  - Config path: `config.retell.deployedWebhookServerUrl` or `config.webhookServer.deployedUrl`
  - Fallback: `https://scalai-b-48660c785242.herokuapp.com`
- `subaccountId`: MongoDB ObjectId of the subaccount
- `agentId`: Retell agent ID (e.g., `agent_79c975172339842b22346abbd1`)
  - **Important:** During initial LLM creation, placeholder URLs are used since `agentId` doesn't exist yet
  - After agent is created, LLM is updated via `retell.updateLLM()` with proper URLs containing the actual `agentId`
- `endpoint`: One of:
  - `check-availability`
  - `nearest-available-slots`
  - `book-appointment`

**URL Update Process:**

1. **Initial LLM Creation** - Placeholder URLs:
   ```
   https://placeholder-will-be-updated-after-agent-creation.com/check-availability
   https://placeholder-will-be-updated-after-agent-creation.com/nearest-available-slots
   https://placeholder-will-be-updated-after-agent-creation.com/book-appointment
   ```

2. **After Agent Creation** - Real URLs (via LLM Update):
   ```
   ${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/check-availability
   ${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/nearest-available-slots
   ${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/book-appointment
   ```

**Example URLs:**
```
https://scalai-b-48660c785242.herokuapp.com/api/webhooks/68cf05f060d294db17c0685e/agent_79c975172339842b22346abbd1/check-availability
https://scalai-b-48660c785242.herokuapp.com/api/webhooks/68cf05f060d294db17c0685e/agent_79c975172339842b22346abbd1/nearest-available-slots
https://scalai-b-48660c785242.herokuapp.com/api/webhooks/68cf05f060d294db17c0685e/agent_79c975172339842b22346abbd1/book-appointment
```

---

## Important Notes

### Parameter Naming Convention
- **Use camelCase** for all parameters (e.g., `startTime`, not `start_time`)
- **Date format**: YYYY-MM-DD (e.g., `2025-10-08`)
- **Time format**: HH:mm in 24-hour format (e.g., `09:00`, `14:30`)

### Authentication
- No authentication headers required in tool configuration
- Authentication handled at the API gateway level using `subaccountId` and `agentId` in URL

### Timezone Handling
- All times are processed in the calendar's configured timezone
- The agent prompt specifies `Europe/Madrid` timezone
- No timezone parameter required in API calls (handled server-side)

### Required Fields
- **check_availability**: `date`, `startTime`, `endTime`
- **nearest_available_slots**: `startDate` (count and durationMinutes are optional with defaults)
- **book_appointment**: `date`, `startTime`, `endTime`, `title`

### Optional Fields
- **nearest_available_slots**: `count` (default: 5), `durationMinutes` (default: 60)
- **book_appointment**: `description`, `customerName`, `customerEmail`, `customerPhone`, `notes`

---

## Agent Conversation Flow

1. **General State** → User expresses interest in booking
2. **Check Availability State** → Agent checks if specific slot is available (if user mentions a time)
3. **Nearest Slots State** → Agent finds available slots (if user doesn't have a specific time)
4. **Book Appointment State** → Agent collects customer details and books the appointment

### Dynamic Variables
- `{{agent_id}}`: The Retell agent ID (automatically populated)
- `{{current_time_Europe/Madrid}}`: Current time in Madrid timezone
- `{{current_calendar_Europe/Madrid}}`: Current date in Madrid timezone

---

## Testing with cURL

### Check Availability
```bash
curl -X POST "https://your-domain.com/api/webhooks/68cf05f060d294db17c0685e/agent_79c975172339842b22346abbd1/check-availability" \
  -H "Content-Type: application/json" \
  -d '{"date": "2025-10-08", "startTime": "09:00", "endTime": "10:00"}'
```

### Find Nearest Slots
```bash
curl -X POST "https://your-domain.com/api/webhooks/68cf05f060d294db17c0685e/agent_79c975172339842b22346abbd1/nearest-available-slots" \
  -H "Content-Type: application/json" \
  -d '{"startDate": "2025-10-08", "count": 3, "durationMinutes": 60}'
```

### Book Appointment
```bash
curl -X POST "https://your-domain.com/api/webhooks/68cf05f060d294db17c0685e/agent_79c975172339842b22346abbd1/book-appointment" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2025-10-27",
    "startTime": "09:00",
    "endTime": "10:00",
    "title": "Consultation Call",
    "customerName": "John Doe",
    "customerEmail": "john@example.com",
    "customerPhone": "+1234567890"
  }'
```

---

## Implementation Status

✅ All three tools configured in `createAgent()` function  
✅ All three tools configured in `createChatAgent()` function  
✅ URLs include `subaccountId` and `agentId` in path  
✅ Parameters follow camelCase convention  
✅ State prompts updated with correct instructions  
✅ Edge parameters updated to match tool parameters  
✅ No linter errors  

---

## Related Documentation

- **RETELL_TOOLS_UPDATE_SUMMARY.md** - Detailed changelog of updates made
- **Webhook Tool API Documentation** - Full API specification (provided in user's documentation)
- **src/controllers/databaseController.js** - Implementation file

---

Last Updated: October 7, 2025

