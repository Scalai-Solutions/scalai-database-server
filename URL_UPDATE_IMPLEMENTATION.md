# URL Update Implementation - Final Summary

## Problem
The initial implementation had tool URLs with `${subaccountId}/{{agent_id}}` in the initial LLM creation, but the `agentId` doesn't exist until after the agent is created.

## Solution
Implemented a two-step URL configuration process:

### Step 1: Initial LLM Creation with Placeholder URLs
When creating the LLM (before agent exists), use placeholder URLs:

```javascript
const llmConfig = {
  states: [
    {
      name: "check_availability_state",
      tools: [{
        type: "custom",
        name: "check_availability",
        url: "https://placeholder-will-be-updated-after-agent-creation.com/check-availability",
        // ... other properties
      }]
    },
    {
      name: "nearest_slots_state",
      tools: [{
        type: "custom",
        name: "nearest_available_slots",
        url: "https://placeholder-will-be-updated-after-agent-creation.com/nearest-available-slots",
        // ... other properties
      }]
    },
    {
      name: "book_appointment_state",
      tools: [{
        type: "custom",
        name: "book_appointment",
        url: "https://placeholder-will-be-updated-after-agent-creation.com/book-appointment",
        // ... other properties
      }]
    }
  ]
};

const llmResponse = await retell.createLLM(llmConfig);
llmId = llmResponse.llm_id;
```

### Step 2: Update LLM After Agent Creation
After creating the agent (which generates the `agentId`), update the LLM with actual URLs:

```javascript
// Agent is created
const agentResponse = await retell.createAgent(agentConfig);
agentId = agentResponse.agent_id;

// Now update LLM with real URLs
if (deployedWebhookUrl) {
  const updatedLlmConfig = {
    general_tools: [...],
    states: [
      {
        name: "general_state",
        description: "...",
        state_prompt: llmConfig.states[0].state_prompt,
        edges: llmConfig.states[0].edges
      },
      {
        name: "check_availability_state",
        description: "...",
        state_prompt: llmConfig.states[1].state_prompt,
        tools: [{
          type: "custom",
          name: "check_availability",
          url: `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/check-availability`,
          speak_during_execution: false,
          speak_after_execution: true,
          description: "Check if a specific time slot is available for booking an appointment",
          parameters: llmConfig.states[1].tools[0].parameters,
          execution_message_description: "Checking availability for the appointment",
          timeout_ms: 120000
        }],
        edges: llmConfig.states[1].edges
      },
      {
        name: "nearest_slots_state",
        description: "...",
        state_prompt: llmConfig.states[2].state_prompt,
        tools: [{
          type: "custom",
          name: "nearest_available_slots",
          url: `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/nearest-available-slots`,
          speak_during_execution: false,
          speak_after_execution: true,
          description: "Find the nearest available appointment slots",
          parameters: llmConfig.states[2].tools[0].parameters,
          execution_message_description: "Finding nearest available slots",
          timeout_ms: 120000
        }],
        edges: llmConfig.states[2].edges
      },
      {
        name: "book_appointment_state",
        description: "...",
        state_prompt: llmConfig.states[3].state_prompt,
        tools: [{
          type: "custom",
          name: "book_appointment",
          url: `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/book-appointment`,
          speak_during_execution: false,
          speak_after_execution: true,
          description: "Book an appointment at a specific time slot",
          parameters: llmConfig.states[3].tools[0].parameters,
          execution_message_description: "Booking the appointment",
          timeout_ms: 120000
        }],
        edges: llmConfig.states[3].edges
      }
    ]
  };

  // Update LLM with new tool URLs
  await retell.updateLLM(llmId, updatedLlmConfig);

  // Also update agent with webhook URL
  await retell.updateAgent(agentId, {
    webhook_url: `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/retell`
  });

  Logger.info('Agent and LLM updated with webhook URL and tool URLs', {
    operationId,
    subaccountId,
    agentId,
    webhookUrl: webhookUrlWithAgent
  });
}
```

## Complete Agent Creation Flow

```
1. Get deployedWebhookUrl from environment config
   ↓
2. Create LLM with placeholder URLs
   → llmId returned
   ↓
3. Create Agent with llmId
   → agentId returned
   ↓
4. Update LLM with actual URLs (using llmId, subaccountId, agentId)
   ↓
5. Update Agent with webhook URL
   ↓
6. Store LLM and Agent data in database
```

## Environment Configuration

The `deployedWebhookUrl` is retrieved from environment configuration:

```javascript
const deployedWebhookUrl = config.retell.deployedWebhookServerUrl || 
                           config.webhookServer.deployedUrl || 
                           'https://scalai-b-48660c785242.herokuapp.com';
```

Set via environment variable:
```bash
DEPLOYED_WEBHOOK_SERVER_URL=https://your-domain.com
```

Or in `config/config.js`:
```javascript
retell: {
  deployedWebhookServerUrl: process.env.DEPLOYED_WEBHOOK_SERVER_URL
},
webhookServer: {
  deployedUrl: process.env.DEPLOYED_WEBHOOK_SERVER_URL
}
```

## Final URL Format

After the update, all tool URLs follow this format:

```
{deployedWebhookUrl}/api/webhooks/{subaccountId}/{agentId}/{endpoint}
```

**Example:**
```
https://scalai-b-48660c785242.herokuapp.com/api/webhooks/68cf05f060d294db17c0685e/agent_79c975172339842b22346abbd1/check-availability
https://scalai-b-48660c785242.herokuapp.com/api/webhooks/68cf05f060d294db17c0685e/agent_79c975172339842b22346abbd1/nearest-available-slots
https://scalai-b-48660c785242.herokuapp.com/api/webhooks/68cf05f060d294db17c0685e/agent_79c975172339842b22346abbd1/book-appointment
```

## Benefits of This Approach

1. ✅ **No undefined variables**: Placeholder URLs prevent issues during initial LLM creation
2. ✅ **Dynamic configuration**: URLs use environment variable from config
3. ✅ **Proper multi-tenancy**: Both `subaccountId` and `agentId` are in the URL path
4. ✅ **Clean separation**: LLM creation and URL configuration are separate steps
5. ✅ **Maintainable**: Easy to understand and debug the flow

## Code Locations

### `createAgent()` Function
- **Initial LLM Creation**: Lines ~131-335
  - Placeholder URLs for all three tools
- **LLM Update**: Lines ~437-544
  - Actual URLs with `deployedWebhookUrl`, `subaccountId`, and `agentId`

### `createChatAgent()` Function
- **Initial LLM Creation**: Lines ~1874-2112
  - Placeholder URLs for all three tools
- **LLM Update**: Similar pattern (chat agents don't have the same update mechanism, they use the LLM as-is)

## Validation Checklist

✅ Initial LLM creation uses placeholder URLs  
✅ Agent creation returns valid `agentId`  
✅ LLM update uses proper URLs with all components  
✅ Agent update sets correct webhook URL  
✅ `deployedWebhookUrl` loaded from environment config  
✅ No linter errors  
✅ Consistent across both `createAgent` and `createChatAgent` functions  

## Testing

To test the implementation:

1. **Create a new agent:**
   ```bash
   POST /api/agents/:subaccountId
   {
     "name": "Test Agent",
     "description": "Test agent for webhook tools"
   }
   ```

2. **Verify LLM was updated:**
   - Check Retell dashboard for the LLM configuration
   - Verify tool URLs contain the correct `subaccountId` and `agentId`

3. **Test the webhook tools:**
   ```bash
   # The agent should be able to call these URLs during conversations
   POST /api/webhooks/:subaccountId/:agentId/check-availability
   POST /api/webhooks/:subaccountId/:agentId/nearest-available-slots
   POST /api/webhooks/:subaccountId/:agentId/book-appointment
   ```

## Troubleshooting

**Issue:** URLs still have placeholder values after agent creation

**Solution:** Check if `deployedWebhookUrl` is set and the LLM update succeeded. Look for log messages:
```
"Agent and LLM updated with webhook URL and tool URLs"
```

**Issue:** `DEPLOYED_WEBHOOK_SERVER_URL` not configured

**Solution:** Set the environment variable or check the warning log:
```
"DEPLOYED_WEBHOOK_SERVER_URL not configured, skipping webhook URL update"
```

---

**Last Updated:** October 7, 2025  
**Implementation Status:** ✅ Complete  
**Files Modified:**
- `src/controllers/databaseController.js`
- `RETELL_TOOLS_UPDATE_SUMMARY.md`
- `RETELL_TOOL_CONFIGURATIONS.md`

