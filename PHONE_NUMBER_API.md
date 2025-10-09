# Phone Number Management API

This document describes the Phone Number Management API endpoints for managing phone numbers in the system.

## Overview

Phone numbers are automatically stored in MongoDB when successfully imported to Retell during the Twilio setup process. These APIs allow you to:
- View all phone numbers for a subaccount
- Update phone number agent assignments (inbound/outbound)
- Delete phone numbers from all systems (MongoDB, Retell, and Twilio)

## Data Storage

Phone numbers are stored in the `phonenumbers` MongoDB collection with the following structure:

```json
{
  "_id": "ObjectId",
  "subaccountId": "string",
  "phone_number": "+14157774444",
  "phone_number_type": "retell-twilio",
  "phone_number_pretty": "+1 (415) 777-4444",
  "inbound_agent_id": "string | null",
  "outbound_agent_id": "string | null",
  "inbound_agent_version": "number | null",
  "outbound_agent_version": "number | null",
  "area_code": 415,
  "nickname": "string | null",
  "inbound_webhook_url": "string | null",
  "last_modification_timestamp": 1703413636133,
  "termination_uri": "string",
  "sip_credentials": {
    "username": "string"
  },
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

## API Endpoints

### 1. Get All Phone Numbers

Retrieve all phone numbers for a specific subaccount.

**Endpoint:** `GET /api/connectors/:subaccountId/phone-numbers`

**Authentication:** Required (Bearer Token)

**Rate Limit:** 100 requests per minute per subaccount

**Path Parameters:**
- `subaccountId` (string, required): The subaccount ID (24-character hex string)

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "subaccountId": "507f191e810c19729de860ea",
      "phone_number": "+14157774444",
      "phone_number_type": "retell-twilio",
      "phone_number_pretty": "+1 (415) 777-4444",
      "inbound_agent_id": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
      "outbound_agent_id": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
      "inbound_agent_version": 1,
      "outbound_agent_version": 1,
      "area_code": 415,
      "nickname": "Frontdesk Number",
      "inbound_webhook_url": "https://example.com/inbound-webhook",
      "last_modification_timestamp": 1703413636133,
      "termination_uri": "scalai51879ppx.pstn.twilio.com",
      "sip_credentials": {
        "username": "scalai_user"
      },
      "createdAt": "2024-10-09T18:20:12.000Z",
      "updatedAt": "2024-10-09T18:20:12.000Z"
    }
  ],
  "count": 1
}
```

**Error Responses:**
- `400 Bad Request`: Invalid subaccount ID format
- `401 Unauthorized`: Missing or invalid authentication token
- `500 Internal Server Error`: Failed to retrieve phone numbers

**Example cURL:**
```bash
curl -X GET "https://your-api.com/api/connectors/507f191e810c19729de860ea/phone-numbers" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### 2. Update Phone Number Agent Assignment

Update the inbound/outbound agent assignment for a phone number in both Retell and MongoDB.

**Endpoint:** `PUT /api/connectors/:subaccountId/phone-numbers/:phoneNumber`

**Authentication:** Required (Bearer Token)

**Rate Limit:** 50 requests per minute per subaccount

**Path Parameters:**
- `subaccountId` (string, required): The subaccount ID (24-character hex string)
- `phoneNumber` (string, required): The phone number in E.164 format (e.g., +14157774444)

**Request Body:**
```json
{
  "inbound_agent_id": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
  "outbound_agent_id": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
  "nickname": "voone_+14157774444"
}
```

**Body Parameters:**
- `inbound_agent_id` (string, optional): Retell agent ID for inbound calls (can be null to remove)
- `outbound_agent_id` (string, optional): Retell agent ID for outbound calls (can be null to remove)
- `nickname` (string, optional): Friendly name for the phone number (can be null)

**Note:** At least one field must be provided.

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "phone_number": "+14157774444",
    "phone_number_type": "retell-twilio",
    "phone_number_pretty": "+1 (415) 777-4444",
    "inbound_agent_id": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
    "outbound_agent_id": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
    "inbound_agent_version": 2,
    "outbound_agent_version": 2,
    "area_code": 415,
    "nickname": "voone_+14157774444",
    "inbound_webhook_url": "https://example.com/inbound-webhook",
    "last_modification_timestamp": 1703413636133
  },
  "message": "Phone number updated successfully"
}
```

**Error Responses:**
- `400 Bad Request`: Invalid subaccount ID or phone number format, or no fields provided
- `401 Unauthorized`: Missing or invalid authentication token
- `404 Not Found`: Phone number not found in Retell
- `500 Internal Server Error`: Failed to update phone number

**Example cURL:**
```bash
curl -X PUT "https://your-api.com/api/connectors/507f191e810c19729de860ea/phone-numbers/+14157774444" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "inbound_agent_id": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
    "outbound_agent_id": "oBeDLoLOeuAbiuaMFXRtDOLriTJ5tSxD",
    "nickname": "voone_+14157774444"
  }'
```

---

### 3. Delete Phone Number

Delete a phone number from all systems: MongoDB, Retell, and Twilio.

**Endpoint:** `DELETE /api/connectors/:subaccountId/phone-numbers/:phoneNumber`

**Authentication:** Required (Bearer Token)

**Rate Limit:** 20 requests per minute per subaccount

**Path Parameters:**
- `subaccountId` (string, required): The subaccount ID (24-character hex string)
- `phoneNumber` (string, required): The phone number in E.164 format (e.g., +14157774444)

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "phoneNumber": "+14157774444",
    "results": {
      "retell": {
        "success": true
      },
      "twilio": {
        "success": true
      },
      "mongodb": {
        "success": true,
        "deletedCount": 1
      }
    },
    "success": true
  },
  "message": "Phone number deletion completed"
}
```

**Partial Success Response:**
If deletion fails in one or more systems but succeeds in others:
```json
{
  "success": true,
  "data": {
    "phoneNumber": "+14157774444",
    "results": {
      "retell": {
        "success": false,
        "error": "Phone number not found"
      },
      "twilio": {
        "success": true
      },
      "mongodb": {
        "success": true,
        "deletedCount": 1
      }
    },
    "success": true
  },
  "message": "Phone number deletion completed"
}
```

**Error Responses:**
- `400 Bad Request`: Invalid subaccount ID or phone number format
- `401 Unauthorized`: Missing or invalid authentication token
- `500 Internal Server Error`: Failed to delete phone number from all systems

**Example cURL:**
```bash
curl -X DELETE "https://your-api.com/api/connectors/507f191e810c19729de860ea/phone-numbers/+14157774444" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## Integration with Twilio Setup

Phone numbers are automatically stored in MongoDB when successfully imported to Retell during the Twilio setup process. The import happens in the following flow:

1. User purchases a phone number via Twilio API
2. Twilio is configured with SIP trunk and credentials
3. Phone number is imported to Retell via their API
4. **Upon successful import, the phone number details are stored in MongoDB**

The following information is automatically captured:
- Phone number details from Retell response
- Termination URI (SIP address without `sip:` prefix)
- SIP credentials username (password is not stored)
- Subaccount association

---

## Phone Number Format

All phone numbers must be in **E.164 format**:
- Must start with `+` followed by country code
- Contains only digits after the `+`
- Examples:
  - ✅ `+14157774444` (US number)
  - ✅ `+442071234567` (UK number)
  - ❌ `14157774444` (missing +)
  - ❌ `+1 (415) 777-4444` (contains formatting)

---

## Activity Logging

All phone number management operations are logged to the activity tracking system with the following activity types:

- `connector_list_phone_numbers`: When phone numbers are retrieved
- `connector_update_phone_number`: When a phone number is updated
- `connector_delete_phone_number`: When a phone number is deleted

Activity logs include metadata about the operation, such as:
- Phone number
- Changes made
- Results of multi-system operations (for deletes)

---

## Error Handling

The API uses consistent error response format:

```json
{
  "success": false,
  "message": "Human-readable error message",
  "error": "Technical error details",
  "code": "ERROR_CODE",
  "details": ["Additional validation errors if applicable"]
}
```

Common error codes:
- `VALIDATION_ERROR`: Invalid input data
- `INTERNAL_ERROR`: Server-side error
- `UPDATE_FAILED`: Failed to update in Retell or MongoDB
- `DELETE_FAILED`: Failed to delete from one or more systems

---

## Notes

1. **Termination URI**: The `sip:` prefix is automatically removed from termination URIs before storing in MongoDB and sending to Retell API.

2. **SIP Credentials**: Only the username is stored in MongoDB for reference. Passwords are not persisted for security reasons.

3. **Graceful Degradation**: The delete operation attempts to remove the phone number from all systems (Retell, Twilio, MongoDB) and reports individual results. The operation succeeds if at least one system deletion succeeds.

4. **Retell API Key**: All operations require a valid Retell API key to be configured for the subaccount. If the key is not configured, operations will fail.

5. **Permissions**: All endpoints require proper JWT authentication and RBAC permissions for the subaccount.

