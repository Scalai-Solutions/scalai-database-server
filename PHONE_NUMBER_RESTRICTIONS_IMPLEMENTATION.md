# Phone Number Restrictions Implementation

## Overview
Implemented phone number assignment restrictions to ensure:
1. Each agent can have only **1 inbound** and **1 outbound** phone number at a time
2. A phone number can only be assigned to **one agent** at a time for each direction (inbound/outbound)

## Backend Implementation

### File: `src/services/twilioService.js`

#### Added Validation in `updatePhoneNumber()` Method

The method now validates before updating phone numbers in Retell:

1. **Agent Inbound Limit Check**
   - Prevents assigning a new inbound number if the agent already has one
   - Error code: `AGENT_INBOUND_LIMIT_REACHED`
   - Status code: 400
   - Message includes the currently assigned number

2. **Phone Number Inbound Conflict Check**
   - Prevents assigning a phone number that's already assigned to another agent for inbound
   - Error code: `PHONE_NUMBER_INBOUND_CONFLICT`
   - Status code: 409

3. **Agent Outbound Limit Check**
   - Prevents assigning a new outbound number if the agent already has one
   - Error code: `AGENT_OUTBOUND_LIMIT_REACHED`
   - Status code: 400
   - Message includes the currently assigned number

4. **Phone Number Outbound Conflict Check**
   - Prevents assigning a phone number that's already assigned to another agent for outbound
   - Error code: `PHONE_NUMBER_OUTBOUND_CONFLICT`
   - Status code: 409

#### Validation Logic

```javascript
// Get MongoDB connection for validation
const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
const { connection } = connectionInfo;
const phoneNumbersCollection = connection.db.collection('phonenumbers');

// Validation: Check restrictions before updating
if (updateData.inbound_agent_id !== undefined && updateData.inbound_agent_id !== null) {
  // Check if this agent already has another inbound number
  const existingInboundForAgent = await phoneNumbersCollection.findOne({
    subaccountId,
    inbound_agent_id: updateData.inbound_agent_id,
    phone_number: { $ne: phoneNumber } // Exclude the current phone number being updated
  });

  if (existingInboundForAgent) {
    const error = new Error(
      `This agent already has an inbound phone number assigned (${existingInboundForAgent.phone_number_pretty || existingInboundForAgent.phone_number}). Please remove the existing assignment first.`
    );
    error.statusCode = 400;
    error.code = 'AGENT_INBOUND_LIMIT_REACHED';
    throw error;
  }

  // Check if this phone number is already assigned to another agent for inbound
  const existingInboundAssignment = await phoneNumbersCollection.findOne({
    subaccountId,
    phone_number: phoneNumber,
    inbound_agent_id: { $ne: null, $ne: updateData.inbound_agent_id }
  });

  if (existingInboundAssignment) {
    const error = new Error(
      `This phone number is already assigned for inbound calls to another agent. Please remove that assignment first.`
    );
    error.statusCode = 409;
    error.code = 'PHONE_NUMBER_INBOUND_CONFLICT';
    throw error;
  }
}

if (updateData.outbound_agent_id !== undefined && updateData.outbound_agent_id !== null) {
  // Check if this agent already has another outbound number
  const existingOutboundForAgent = await phoneNumbersCollection.findOne({
    subaccountId,
    outbound_agent_id: updateData.outbound_agent_id,
    phone_number: { $ne: phoneNumber }
  });

  if (existingOutboundForAgent) {
    const error = new Error(
      `This agent already has an outbound phone number assigned (${existingOutboundForAgent.phone_number_pretty || existingOutboundForAgent.phone_number}). Please remove the existing assignment first.`
    );
    error.statusCode = 400;
    error.code = 'AGENT_OUTBOUND_LIMIT_REACHED';
    throw error;
  }

  // Check if this phone number is already assigned to another agent for outbound
  const existingOutboundAssignment = await phoneNumbersCollection.findOne({
    subaccountId,
    phone_number: phoneNumber,
    outbound_agent_id: { $ne: null, $ne: updateData.outbound_agent_id }
  });

  if (existingOutboundAssignment) {
    const error = new Error(
      `This phone number is already assigned for outbound calls to another agent. Please remove that assignment first.`
    );
    error.statusCode = 409;
    error.code = 'PHONE_NUMBER_OUTBOUND_CONFLICT';
    throw error;
  }
}
```

### File: `src/controllers/connectorController.js`

#### Enhanced Error Handling in `updatePhoneNumber()` Method

```javascript
catch (error) {
  Logger.error('Failed to update phone number', {
    error: error.message,
    stack: error.stack,
    subaccountId: req.params.subaccountId,
    phoneNumber: req.params.phoneNumber,
    response: error.response?.data,
    errorCode: error.code  // Log error code for debugging
  });

  // Use custom error codes and status codes if available
  const statusCode = error.statusCode || error.response?.status || 500;
  const errorCode = error.code || 'UPDATE_FAILED';
  
  return res.status(statusCode).json({
    success: false,
    message: error.message || 'Failed to update phone number',
    error: error.message,
    details: error.response?.data,
    code: errorCode
  });
}
```

## API Endpoint

### PUT `/api/connectors/:subaccountId/phone-numbers/:phoneNumber`

Update phone number agent assignment.

#### Request Body
```json
{
  "inbound_agent_id": "agent_id_123",
  "outbound_agent_id": "agent_id_456",
  "nickname": "Main Office Line"
}
```

#### Success Response (200 OK)
```json
{
  "success": true,
  "data": {
    "phone_number": "+14157774444",
    "phone_number_pretty": "+1 (415) 777-4444",
    "inbound_agent_id": "agent_id_123",
    "outbound_agent_id": "agent_id_456",
    "inbound_agent_version": 1,
    "outbound_agent_version": 1,
    "area_code": 415,
    "nickname": "Main Office Line",
    "inbound_webhook_url": null,
    "last_modification_timestamp": 1703413636133
  },
  "message": "Phone number updated successfully"
}
```

#### Error Responses

##### Agent Inbound Limit Reached (400)
```json
{
  "success": false,
  "message": "This agent already has an inbound phone number assigned (+1 415-123-4567). Please remove the existing assignment first.",
  "error": "This agent already has an inbound phone number assigned (+1 415-123-4567). Please remove the existing assignment first.",
  "code": "AGENT_INBOUND_LIMIT_REACHED"
}
```

##### Agent Outbound Limit Reached (400)
```json
{
  "success": false,
  "message": "This agent already has an outbound phone number assigned (+1 415-123-4567). Please remove the existing assignment first.",
  "error": "This agent already has an outbound phone number assigned (+1 415-123-4567). Please remove the existing assignment first.",
  "code": "AGENT_OUTBOUND_LIMIT_REACHED"
}
```

##### Phone Number Inbound Conflict (409)
```json
{
  "success": false,
  "message": "This phone number is already assigned for inbound calls to another agent. Please remove that assignment first.",
  "error": "This phone number is already assigned for inbound calls to another agent. Please remove that assignment first.",
  "code": "PHONE_NUMBER_INBOUND_CONFLICT"
}
```

##### Phone Number Outbound Conflict (409)
```json
{
  "success": false,
  "message": "This phone number is already assigned for outbound calls to another agent. Please remove that assignment first.",
  "error": "This phone number is already assigned for outbound calls to another agent. Please remove that assignment first.",
  "code": "PHONE_NUMBER_OUTBOUND_CONFLICT"
}
```

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `AGENT_INBOUND_LIMIT_REACHED` | 400 | Agent already has an inbound phone number assigned |
| `AGENT_OUTBOUND_LIMIT_REACHED` | 400 | Agent already has an outbound phone number assigned |
| `PHONE_NUMBER_INBOUND_CONFLICT` | 409 | Phone number already assigned to another agent for inbound |
| `PHONE_NUMBER_OUTBOUND_CONFLICT` | 409 | Phone number already assigned to another agent for outbound |

## Validation Rules

1. **One Inbound Number Per Agent**: An agent can have at most one phone number assigned for inbound calls
2. **One Outbound Number Per Agent**: An agent can have at most one phone number assigned for outbound calls
3. **Exclusive Inbound Assignment**: A phone number can only be assigned to one agent for inbound calls at a time
4. **Exclusive Outbound Assignment**: A phone number can only be assigned to one agent for outbound calls at a time
5. **Unassigning is Always Allowed**: Setting `inbound_agent_id` or `outbound_agent_id` to `null` always succeeds

## Implementation Details

### Query Optimization
- The validation queries use MongoDB indexes on `subaccountId`, `inbound_agent_id`, `outbound_agent_id`, and `phone_number`
- Validation happens before the Retell API call to fail fast
- The MongoDB connection is reused for both validation and the subsequent update

### Edge Cases Handled
1. **Self-Assignment**: Assigning the same phone number to the same agent (update) is allowed
2. **Null Values**: Setting to `null` bypasses all restrictions
3. **Partial Updates**: Only validating the field being updated (inbound or outbound)
4. **Pretty Format**: Error messages include the pretty-formatted phone number when available

## Testing

### Test Cases

1. **Assign First Inbound Number**
   ```bash
   curl -X PUT http://localhost:3002/api/connectors/:subaccountId/phone-numbers/:phoneNumber \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"inbound_agent_id": "agent_123"}'
   ```
   Expected: Success

2. **Assign Second Inbound Number (Should Fail)**
   ```bash
   curl -X PUT http://localhost:3002/api/connectors/:subaccountId/phone-numbers/:phoneNumber2 \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"inbound_agent_id": "agent_123"}'
   ```
   Expected: 400 `AGENT_INBOUND_LIMIT_REACHED`

3. **Assign Already Assigned Number (Should Fail)**
   ```bash
   curl -X PUT http://localhost:3002/api/connectors/:subaccountId/phone-numbers/:phoneNumber \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"inbound_agent_id": "agent_456"}'
   ```
   Expected: 409 `PHONE_NUMBER_INBOUND_CONFLICT`

4. **Unassign and Reassign**
   ```bash
   # Unassign
   curl -X PUT http://localhost:3002/api/connectors/:subaccountId/phone-numbers/:phoneNumber \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"inbound_agent_id": null}'
   
   # Reassign to different agent
   curl -X PUT http://localhost:3002/api/connectors/:subaccountId/phone-numbers/:phoneNumber \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"inbound_agent_id": "agent_456"}'
   ```
   Expected: Both succeed

## Logging

All validation errors are logged with:
- Error message
- Error code
- Stack trace
- Request parameters (subaccountId, phoneNumber)
- Update data

Example log:
```javascript
Logger.error('Failed to update phone number', {
  error: 'This agent already has an inbound phone number assigned...',
  errorCode: 'AGENT_INBOUND_LIMIT_REACHED',
  subaccountId: '507f1f77bcf86cd799439011',
  phoneNumber: '+14157774444',
  updateData: { inbound_agent_id: 'agent_123' }
});
```

