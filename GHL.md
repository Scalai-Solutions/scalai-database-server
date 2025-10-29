# GoHighLevel Appointment Creation - Complete Flow Guide

## Table of Contents
1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Complete Sequential Flow](#complete-sequential-flow)
4. [API Endpoints Reference](#api-endpoints-reference)
5. [Request/Response Structure](#request-response-structure)
6. [Error Handling](#error-handling)
7. [Testing Guidelines](#testing-guidelines)

---

## Overview

This document provides a complete sequential flow for creating appointments in GoHighLevel (GHL) using the API. The process includes calendar creation, contact creation/management, and appointment booking - all through API calls.

---

## Prerequisites

### 1. API Key (MANDATORY)
- **Where to find**: GoHighLevel Dashboard → Settings → Company Settings (or Business Info)
- **Type**: 
  - Location-level API Key (for single sub-account access)
  - Agency-level API Key (for multi-location access - requires Agency Pro plan)
- **Format**: Bearer token authentication
- **Access Level**: 
  - Basic API access (Starter/Unlimited plans) - 200K requests/day
  - Advanced API access (Agency Pro plan) - 200K requests/day + Agency-level features
- **Security**: Store securely, never expose in frontend code or public repositories

### 2. Location ID (MANDATORY)
- **What it is**: Unique identifier for your sub-account/location in GoHighLevel
- **Where to find**: 
  - Dashboard URL when logged into sub-account
  - API response when listing locations
  - Settings section of your sub-account
- **Format**: String (24 characters alphanumeric)
  - Example: `"0007BWpSzSwfiuSl0tR2"`
- **Required for**: All API calls are scoped to a specific location

### 3. Team/User ID (REQUIRED for calendar creation)
- **What it is**: User ID of the team member who will be assigned to the calendar
- **Where to find**: 
  - Settings → Team/Users section
  - API: GET /users/ endpoint
- **Format**: String (alphanumeric)
- **Purpose**: Each calendar must be assigned to at least one user/team member

### 4. Contact Information (REQUIRED)
You'll need to either:
- **Use existing Contact ID** - if contact already exists in GHL
- **Create new contact** with:
  - firstName (string, required)
  - lastName (string, required)
  - email OR phone (at least one required)
  - locationId (string, required)

### 5. Calendar Details (REQUIRED for creation)
- **name**: Calendar name/title (string, required)
- **slug**: URL-friendly identifier (string, required, must be unique globally)
- **description**: Calendar description (string, optional)
- **appoinmentPerSlot**: Number of appointments allowed per time slot (integer)
- **appoinmentPerDay**: Maximum appointments per day (integer)
- **slotDuration**: Duration of each slot in minutes (integer)
- **slotInterval**: Interval between slots in minutes (integer)
- **slotBuffer**: Buffer time after appointments in minutes (integer)

### 6. Appointment Details (REQUIRED)
- **calendarId**: ID of the calendar (from calendar creation or existing calendar)
- **contactId**: ID of the contact (from contact creation or existing contact)
- **startTime**: ISO 8601 format with timezone offset
  - Format: `YYYY-MM-DDTHH:MM:SS±HH:MM`
  - Example: `"2025-10-25T15:00:00-04:00"`
- **endTime**: ISO 8601 format with timezone offset
  - Must be after startTime
  - Example: `"2025-10-25T16:00:00-04:00"`
- **timezone**: IANA timezone string
  - Examples: `"America/New_York"`, `"Europe/London"`, `"Asia/Kolkata"`, `"America/Chicago"`
  - Must match the offset in startTime/endTime

### 7. Development/Testing Tools (RECOMMENDED)
- **API Testing Tool**: Postman, Insomnia, or cURL
- **JSON Validator**: To validate request payloads
- **Timezone Reference**: IANA timezone database for correct timezone strings
- **ISO 8601 Converter**: For date/time formatting

---

## Complete Sequential Flow

This is the complete end-to-end flow for creating an appointment in GoHighLevel using the API. Follow these steps in order.

---

### **STEP 0: Initial Setup & Authentication**

**Objective**: Configure API authentication and gather required IDs

**Actions Required**:
1. Obtain your API Key from GoHighLevel Settings
2. Get your Location ID (sub-account ID)
3. Get User/Team ID for calendar assignment
4. Store API Key securely

**Authentication Header Format**:
- Header Name: `Authorization`
- Header Value: `Bearer YOUR_API_KEY`
- Additional Headers:
  - `Content-Type: application/json`
  - `Version: 2021-07-28` (API version)

**What You Need**:
- API Key
- Location ID
- At least one User ID

**Next Step**: If you don't have a calendar, proceed to Step 1. If calendar exists, skip to Step 2.

---

### **STEP 1: Create Calendar (If needed)**

**Objective**: Create a new calendar in GoHighLevel where appointments will be booked

**API Endpoint**: 
- Method: `POST`
- URL: `https://services.leadconnectorhq.com/calendars/`

**Required Headers**:
- `Authorization: Bearer YOUR_API_KEY`
- `Content-Type: application/json`
- `Version: 2021-07-28`

**Request Body Structure**:

**Required Fields**:
- `locationId` (string): Your location/sub-account ID
- `name` (string): Calendar display name (e.g., "Sales Consultation")
- `slug` (string): URL-friendly unique identifier (e.g., "sales-consultation")
  - Must be globally unique across all GHL accounts
  - Only lowercase letters, numbers, and hyphens
  - Cannot start or end with hyphen
- `teamMembers` (array): Array of team member objects
  - Each object contains: `userId` (string) and `meetingLocation` (string)

**Important Optional Fields**:
- `description` (string): Calendar description
- `appoinmentPerSlot` (integer): Max appointments per slot (default: 1)
- `appoinmentPerDay` (integer): Max appointments per day
- `slotDuration` (integer): Duration of each slot in minutes (e.g., 30, 60)
- `slotInterval` (integer): Time between slot starts in minutes (e.g., 15, 30)
- `slotBuffer` (integer): Buffer time after appointments in minutes
- `preBuffer` (integer): Buffer time before appointments in minutes
- `allowBookingAfter` (integer): Minimum hours notice required for booking
- `allowBookingFor` (integer): How many days in advance bookings allowed
- `allowCancellation` (boolean): Allow customers to cancel appointments
- `allowReschedule` (boolean): Allow customers to reschedule
- `eventColor` (string): Color for calendar events (hex code)
- `meetingLocation` (string): Default meeting location/link

**Working Hours Structure** (optional but recommended):
- `availabilities` (array): Define when calendar is available
  - Each object contains:
    - `date` (string): Specific date or "all" for recurring
    - `hours` (array): Array of time ranges
      - `openHour` (integer): Opening hour (0-23)
      - `openMinute` (integer): Opening minute (0-59)
      - `closeHour` (integer): Closing hour (0-23)
      - `closeMinute` (integer): Closing minute (0-59)
    - `deleted` (boolean): Whether this availability is active

**Example Request Body** (minimal):
```json
{
  "locationId": "your_location_id",
  "name": "Sales Consultation",
  "slug": "sales-consultation-unique",
  "description": "30-minute sales consultation call",
  "teamMembers": [
    {
      "userId": "user_id_here",
      "meetingLocation": "https://zoom.us/j/123456789"
    }
  ],
  "slotDuration": 30,
  "slotInterval": 30,
  "appoinmentPerSlot": 1,
  "allowBookingAfter": 24,
  "allowBookingFor": 30
}
```

**Response**:
- Success Status: `201 Created`
- Returns: Calendar object with `id` field
- **Save the Calendar ID** - you'll need this for creating appointments

**What to Save**:
- `calendar.id` - This is your Calendar ID for appointments

**Common Issues**:
- Slug already exists: Use a different, unique slug
- Missing teamMembers: Must assign at least one user
- Invalid userId: Verify user exists in the location

**Next Step**: Proceed to Step 2 to create or verify contact

---

### **STEP 2: Create or Get Contact**

**Objective**: Ensure the contact exists in GoHighLevel before creating appointment

You have two options:
- **Option A**: Check if contact already exists
- **Option B**: Create new contact

---

#### **Option A: Search for Existing Contact**

**API Endpoint**: 
- Method: `GET`
- URL: `https://services.leadconnectorhq.com/contacts/{contactId}`
  OR
- URL: `https://services.leadconnectorhq.com/contacts/search?email={email}&locationId={locationId}`

**Required Headers**:
- `Authorization: Bearer YOUR_API_KEY`
- `Content-Type: application/json`

**Query Parameters** (for search):
- `email` (string): Contact's email address
- `phone` (string): Contact's phone in E.164 format (+13145557878)
- `locationId` (string): Your location ID

**Response**:
- Success Status: `200 OK`
- Returns: Contact object with `id` field

**If Contact Found**:
- Save the `contact.id`
- Skip to Step 3

**If Contact Not Found**:
- Proceed to Option B

---

#### **Option B: Create New Contact**

**API Endpoint**: 
- Method: `POST`
- URL: `https://services.leadconnectorhq.com/contacts/`

**Required Headers**:
- `Authorization: Bearer YOUR_API_KEY`
- `Content-Type: application/json`
- `Version: 2021-07-28`

**Request Body Structure**:

**Required Fields**:
- `locationId` (string): Your location ID
- `firstName` (string): Contact's first name
- `lastName` (string): Contact's last name
- `email` OR `phone` (string): At least one is required
  - Phone must be in E.164 format: `+13145557878`
  - Email must be valid format

**Optional but Useful Fields**:
- `phone` (string): Phone number in E.164 format
- `email` (string): Email address
- `address1` (string): Street address
- `city` (string): City
- `state` (string): State/Province
- `country` (string): Country code (e.g., "US", "IN", "GB")
- `postalCode` (string): Postal/ZIP code
- `website` (string): Website URL
- `timezone` (string): Contact's timezone (IANA format)
- `tags` (array of strings): Tags for contact organization
- `source` (string): Lead source
- `customField` (object): Custom field key-value pairs
- `companyName` (string): Company name

**Example Request Body**:
```json
{
  "locationId": "your_location_id",
  "firstName": "John",
  "lastName": "Doe",
  "email": "[email protected]",
  "phone": "+13145557878",
  "address1": "123 Main St",
  "city": "New York",
  "state": "NY",
  "country": "US",
  "postalCode": "10001",
  "timezone": "America/New_York",
  "tags": ["lead", "interested"],
  "source": "website"
}
```

**Response**:
- Success Status: `200 OK` or `201 Created`
- Returns: Contact object with `contact.id` field

**What to Save**:
- `contact.id` - This is your Contact ID for appointments

**Important Notes**:
- Phone numbers MUST be in E.164 format (+country code + number)
- Duplicate contacts may not be created depending on location settings
- If contact exists, API may return existing contact ID

**Next Step**: Proceed to Step 3 to verify calendar information

---

### **STEP 3: Get Calendar Information (Verification)**

**Objective**: Verify the calendar exists and is properly configured

**API Endpoint**: 
- Method: `GET`
- URL: `https://services.leadconnectorhq.com/calendars/?locationId={locationId}`
  OR for specific calendar:
- URL: `https://services.leadconnectorhq.com/calendars/{calendarId}`

**Required Headers**:
- `Authorization: Bearer YOUR_API_KEY`
- `Content-Type: application/json`

**Query Parameters** (for list):
- `locationId` (string): Your location ID

**Response**:
- Success Status: `200 OK`
- Returns: Array of calendar objects (for list) or single calendar object

**What to Verify**:
- Calendar ID exists
- Calendar is active (not deleted)
- Calendar has team members assigned
- Calendar has availability configured

**What to Note**:
- Calendar name and description
- Slot duration and interval
- Available hours
- Buffer times
- Team members assigned

**Next Step**: Optionally check availability (Step 4) or proceed to create appointment (Step 5)

---

### **STEP 4: Check Calendar Availability (Optional but Recommended)**

**Objective**: Find available time slots before attempting to book

**API Endpoint**: 
- Method: `GET`
- URL: `https://services.leadconnectorhq.com/calendars/{calendarId}/free-slots`

**Required Headers**:
- `Authorization: Bearer YOUR_API_KEY`
- `Content-Type: application/json`

**Query Parameters**:
- `startDate` (string): Start date in YYYY-MM-DD format (e.g., "2025-10-25")
- `endDate` (string): End date in YYYY-MM-DD format (e.g., "2025-10-26")
- `timezone` (string): IANA timezone (e.g., "America/New_York")
- `userId` (string, optional): Specific user's availability

**Example Request**:
```
GET /calendars/BqTwX8QFwXzpegMve9EQ/free-slots?startDate=2025-10-25&endDate=2025-10-26&timezone=America/New_York
```

**Response**:
- Success Status: `200 OK`
- Returns: Object with available slots grouped by date

**Response Structure**:
```json
{
  "2025-10-25": [
    {
      "startTime": "2025-10-25T09:00:00-04:00",
      "endTime": "2025-10-25T09:30:00-04:00"
    },
    {
      "startTime": "2025-10-25T09:30:00-04:00",
      "endTime": "2025-10-25T10:00:00-04:00"
    }
  ]
}
```

**What This Tells You**:
- Exact available time slots
- Prevents booking conflicts
- Helps choose valid startTime/endTime for appointment

**Next Step**: Proceed to Step 5 to create the appointment

---

### **STEP 5: Create Appointment**

**Objective**: Book the appointment with the contact on the calendar

**API Endpoint**: 
- Method: `POST`
- URL: `https://services.leadconnectorhq.com/calendars/events/appointments`

**Alternative Endpoint (Legacy V1 API)**:
- URL: `https://rest.gohighlevel.com/v1/appointments/`

**Required Headers**:
- `Authorization: Bearer YOUR_API_KEY`
- `Content-Type: application/json`
- `Version: 2021-07-28`

**Request Body Structure**:

**Required Fields** (V2 API):
- `calendarId` (string): Calendar ID from Step 1 or existing calendar
- `contactId` (string): Contact ID from Step 2
- `startTime` (string): Appointment start time in ISO 8601 format
  - Format: `YYYY-MM-DDTHH:MM:SS±HH:MM`
  - Example: `"2025-10-25T15:00:00-04:00"`
  - MUST include timezone offset
  - MUST match timezone in selectedTimezone
- `endTime` (string): Appointment end time in ISO 8601 format
  - Must be after startTime
  - Must align with calendar slot duration

**Important Optional Fields**:
- `title` (string): Appointment title/subject (default: "Appointment")
- `appointmentStatus` (string): Status of appointment
  - Values: `"confirmed"`, `"pending"`, `"cancelled"`, `"showed"`, `"noshow"`, `"invalid"`
  - Default: `"confirmed"`
- `address` (string): Meeting location (URL for virtual, address for in-person)
- `assignedUserId` (string): Specific team member assigned to appointment
- `notes` (string): Internal notes about the appointment
- `ignoreDateRange` (boolean): Override calendar date range restrictions
- `toNotify` (boolean): Send notification emails/SMS (default: true)

**Example Request Body** (V2 API):
```json
{
  "calendarId": "BqTwX8QFwXzpegMve9EQ",
  "contactId": "9NkT25Vor1v4aQatFsv2",
  "startTime": "2025-10-25T15:00:00-04:00",
  "endTime": "2025-10-25T15:30:00-04:00",
  "title": "Sales Consultation",
  "appointmentStatus": "confirmed",
  "address": "https://zoom.us/j/123456789",
  "notes": "First-time consultation",
  "toNotify": true
}
```

**Alternative Request Format** (V1 API - Legacy):

**Required Fields**:
- `calendarId` (string): Calendar ID
- `selectedSlot` (string): ISO 8601 datetime with timezone offset
- `selectedTimezone` (string): IANA timezone string
- `firstName` (string): Contact first name
- `lastName` (string): Contact last name
- `phone` OR `email` (string): Contact information

**Example V1 Request Body**:
```json
{
  "calendarId": "BqTwX8QFwXzpegMve9EQ",
  "selectedSlot": "2025-10-25T15:00:00-04:00",
  "selectedTimezone": "America/New_York",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+13145557878",
  "email": "[email protected]"
}
```

**Response**:
- Success Status: `200 OK` or `201 Created`
- Returns: Appointment object with details

**Response Structure**:
```json
{
  "id": "appointment_id_here",
  "calendarId": "BqTwX8QFwXzpegMve9EQ",
  "contactId": "9NkT25Vor1v4aQatFsv2",
  "startTime": "2025-10-25T15:00:00-04:00",
  "endTime": "2025-10-25T15:30:00-04:00",
  "title": "Sales Consultation",
  "appointmentStatus": "confirmed",
  "address": "https://zoom.us/j/123456789"
}
```

**What to Save**:
- `appointment.id` - For future updates or cancellations
- Full appointment object for records

**Important Notes**:
- startTime/endTime must fall within calendar's available hours
- Timezone offset in times must match selectedTimezone
- Contact must exist before creating appointment (use contactId from Step 2)
- Calendar must have availability for the requested time
- Phone numbers must be in E.164 format

**Next Step**: Appointment is created! Optionally verify or update (Step 6)

---

### **STEP 6: Verify Appointment (Optional)**

**Objective**: Confirm the appointment was created successfully

**API Endpoint**: 
- Method: `GET`
- URL: `https://services.leadconnectorhq.com/calendars/events/appointments/{appointmentId}`

**Required Headers**:
- `Authorization: Bearer YOUR_API_KEY`
- `Content-Type: application/json`

**Response**:
- Success Status: `200 OK`
- Returns: Full appointment object

**What to Verify**:
- Appointment ID matches
- startTime and endTime are correct
- Contact is correctly linked
- Status is as expected
- Notifications were sent (if enabled)

---

### **STEP 7: Update or Cancel Appointment (Optional)**

**Objective**: Modify or cancel an existing appointment

#### **Update Appointment**

**API Endpoint**: 
- Method: `PUT`
- URL: `https://services.leadconnectorhq.com/calendars/events/appointments/{appointmentId}`

**Required Headers**:
- `Authorization: Bearer YOUR_API_KEY`
- `Content-Type: application/json`

**Request Body**: Similar to create, but all fields optional (only send fields to update)

**Example Update Body**:
```json
{
  "startTime": "2025-10-25T16:00:00-04:00",
  "endTime": "2025-10-25T16:30:00-04:00",
  "appointmentStatus": "confirmed",
  "notes": "Updated meeting time per customer request"
}
```

#### **Cancel/Delete Appointment**

**API Endpoint**: 
- Method: `DELETE`
- URL: `https://services.leadconnectorhq.com/calendars/events/appointments/{appointmentId}`

**Required Headers**:
- `Authorization: Bearer YOUR_API_KEY`

**Response**:
- Success Status: `200 OK` or `204 No Content`

---

## Summary of Complete Flow

**For First-Time Setup (No Calendar)**:
1. Get API Key, Location ID, User ID
2. Create Calendar → Get Calendar ID
3. Create Contact → Get Contact ID
4. Check Availability (optional)
5. Create Appointment
6. Verify Appointment

**For Subsequent Appointments (Calendar Exists)**:
1. Get API Key, Location ID, Calendar ID
2. Create/Get Contact → Get Contact ID
3. Check Availability (optional)
4. Create Appointment
5. Verify Appointment

**Quick Checklist**:
- [ ] API Key obtained and stored securely
- [ ] Location ID identified
- [ ] Calendar created or Calendar ID obtained
- [ ] Contact created or Contact ID obtained
- [ ] DateTime formatted correctly (ISO 8601 with timezone)
- [ ] Timezone matches offset in datetime
- [ ] Calendar availability verified
- [ ] Appointment created successfully
- [ ] Response stored for future reference

---

## Request/Response Structure

### Authentication

All API requests must include authentication header:
- **Header Name**: `Authorization`
- **Header Value**: `Bearer YOUR_API_KEY`
- **Additional Headers**:
  - `Content-Type: application/json`
  - `Version: 2021-07-28`

---

### 1. Create Calendar Request

**HTTP Method**: POST  
**Endpoint**: `https://services.leadconnectorhq.com/calendars/`

**Request Body Example**:
```json
{
  "locationId": "your_location_id",
  "name": "Sales Consultation",
  "slug": "sales-consultation-2025",
  "description": "30-minute sales consultation call",
  "teamMembers": [
    {
      "userId": "user_id_here",
      "meetingLocation": "https://zoom.us/j/123456789"
    }
  ],
  "slotDuration": 30,
  "slotInterval": 30,
  "slotBuffer": 0,
  "preBuffer": 0,
  "appoinmentPerSlot": 1,
  "appoinmentPerDay": 10,
  "allowBookingAfter": 24,
  "allowBookingFor": 30,
  "enableRecurring": false,
  "allowCancellation": true,
  "allowReschedule": true,
  "eventColor": "#039be5",
  "meetingLocation": "https://zoom.us/j/123456789"
}
```

**Success Response** (201 Created):
```json
{
  "id": "calendar_id_created",
  "locationId": "your_location_id",
  "name": "Sales Consultation",
  "slug": "sales-consultation-2025",
  "description": "30-minute sales consultation call",
  "teamMembers": [
    {
      "userId": "user_id_here",
      "meetingLocation": "https://zoom.us/j/123456789"
    }
  ],
  "slotDuration": 30,
  "slotInterval": 30,
  "isActive": true,
  "createdAt": "2025-10-23T10:00:00Z"
}
```

---

### 2. Create Contact Request

**HTTP Method**: POST  
**Endpoint**: `https://services.leadconnectorhq.com/contacts/`

**Request Body Example** (Full):
```json
{
  "locationId": "your_location_id",
  "firstName": "John",
  "lastName": "Doe",
  "email": "[email protected]",
  "phone": "+13145557878",
  "address1": "123 Main Street",
  "city": "New York",
  "state": "NY",
  "country": "US",
  "postalCode": "10001",
  "website": "https://example.com",
  "timezone": "America/New_York",
  "source": "website",
  "tags": ["lead", "interested"],
  "customField": {
    "company_size": "50-100",
    "industry": "Technology"
  }
}
```

**Minimum Request Body**:
```json
{
  "locationId": "your_location_id",
  "firstName": "John",
  "lastName": "Doe",
  "email": "[email protected]"
}
```

**Success Response** (200 OK):
```json
{
  "contact": {
    "id": "contact_id_created",
    "locationId": "your_location_id",
    "firstName": "John",
    "lastName": "Doe",
    "email": "[email protected]",
    "phone": "+13145557878",
    "address1": "123 Main Street",
    "city": "New York",
    "state": "NY",
    "country": "US",
    "postalCode": "10001",
    "timezone": "America/New_York",
    "tags": ["lead", "interested"],
    "dateAdded": "2025-10-23T10:00:00Z"
  }
}
```

---

### 3. Get Calendars Request

**HTTP Method**: GET  
**Endpoint**: `https://services.leadconnectorhq.com/calendars/?locationId=your_location_id`

**Query Parameters**:
- `locationId` (required): Your location/sub-account ID

**Success Response** (200 OK):
```json
{
  "calendars": [
    {
      "id": "calendar_id_1",
      "name": "Sales Consultation",
      "description": "30-minute sales call",
      "slug": "sales-consultation",
      "slotDuration": 30,
      "slotInterval": 30,
      "appoinmentPerSlot": 1,
      "teamMembers": [
        {
          "userId": "user_id_here",
          "meetingLocation": "https://zoom.us/j/123"
        }
      ],
      "isActive": true
    },
    {
      "id": "calendar_id_2",
      "name": "Technical Demo",
      "description": "45-minute product demo",
      "slug": "technical-demo",
      "slotDuration": 45,
      "isActive": true
    }
  ],
  "count": 2
}
```

---

### 4. Check Availability Request

**HTTP Method**: GET  
**Endpoint**: `https://services.leadconnectorhq.com/calendars/{calendarId}/free-slots`

**Query Parameters**:
- `startDate` (required): Start date in YYYY-MM-DD format (e.g., "2025-10-25")
- `endDate` (required): End date in YYYY-MM-DD format (e.g., "2025-10-26")
- `timezone` (required): IANA timezone (e.g., "America/New_York")
- `userId` (optional): Specific user ID to check availability

**Example Request**:
```
GET /calendars/BqTwX8QFwXzpegMve9EQ/free-slots?startDate=2025-10-25&endDate=2025-10-26&timezone=America/New_York
```

**Success Response** (200 OK):
```json
{
  "2025-10-25": [
    {
      "startTime": "2025-10-25T09:00:00-04:00",
      "endTime": "2025-10-25T09:30:00-04:00"
    },
    {
      "startTime": "2025-10-25T09:30:00-04:00",
      "endTime": "2025-10-25T10:00:00-04:00"
    },
    {
      "startTime": "2025-10-25T10:00:00-04:00",
      "endTime": "2025-10-25T10:30:00-04:00"
    },
    {
      "startTime": "2025-10-25T14:00:00-04:00",
      "endTime": "2025-10-25T14:30:00-04:00"
    }
  ],
  "2025-10-26": [
    {
      "startTime": "2025-10-26T09:00:00-04:00",
      "endTime": "2025-10-26T09:30:00-04:00"
    }
  ]
}
```

---

### 5. Create Appointment Request

**HTTP Method**: POST  
**Endpoint**: `https://services.leadconnectorhq.com/calendars/events/appointments`

**Request Body Example** (V2 API):
```json
{
  "calendarId": "BqTwX8QFwXzpegMve9EQ",
  "contactId": "9NkT25Vor1v4aQatFsv2",
  "startTime": "2025-10-25T15:00:00-04:00",
  "endTime": "2025-10-25T15:30:00-04:00",
  "title": "Sales Consultation",
  "appointmentStatus": "confirmed",
  "address": "https://zoom.us/j/123456789",
  "assignedUserId": "user_id_here",
  "notes": "First-time consultation with potential enterprise client",
  "toNotify": true,
  "ignoreDateRange": false
}
```

**Minimum Request Body**:
```json
{
  "calendarId": "BqTwX8QFwXzpegMve9EQ",
  "contactId": "9NkT25Vor1v4aQatFsv2",
  "startTime": "2025-10-25T15:00:00-04:00",
  "endTime": "2025-10-25T15:30:00-04:00"
}
```

**Success Response** (200 OK):
```json
{
  "id": "appointment_id_created",
  "calendarId": "BqTwX8QFwXzpegMve9EQ",
  "contactId": "9NkT25Vor1v4aQatFsv2",
  "startTime": "2025-10-25T15:00:00-04:00",
  "endTime": "2025-10-25T15:30:00-04:00",
  "title": "Sales Consultation",
  "appointmentStatus": "confirmed",
  "address": "https://zoom.us/j/123456789",
  "assignedUserId": "user_id_here",
  "notes": "First-time consultation with potential enterprise client",
  "dateAdded": "2025-10-23T10:30:00Z",
  "dateUpdated": "2025-10-23T10:30:00Z"
}
```

**Alternative Request Format** (V1 API - Legacy):
```json
{
  "calendarId": "BqTwX8QFwXzpegMve9EQ",
  "selectedSlot": "2025-10-25T15:00:00-04:00",
  "selectedTimezone": "America/New_York",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+13145557878",
  "email": "[email protected]",
  "customField": {
    "notes": "Interested in enterprise plan"
  }
}
```

---

### 6. Get Appointment Request

**HTTP Method**: GET  
**Endpoint**: `https://services.leadconnectorhq.com/calendars/events/appointments/{appointmentId}`

**Success Response** (200 OK):
```json
{
  "id": "appointment_id",
  "locationId": "your_location_id",
  "calendarId": "BqTwX8QFwXzpegMve9EQ",
  "contactId": "9NkT25Vor1v4aQatFsv2",
  "startTime": "2025-10-25T15:00:00-04:00",
  "endTime": "2025-10-25T15:30:00-04:00",
  "title": "Sales Consultation",
  "appointmentStatus": "confirmed",
  "address": "https://zoom.us/j/123456789",
  "assignedUserId": "user_id_here",
  "notes": "First-time consultation",
  "dateAdded": "2025-10-23T10:30:00Z",
  "dateUpdated": "2025-10-23T10:30:00Z"
}
```

---

### 7. Update Appointment Request

**HTTP Method**: PUT  
**Endpoint**: `https://services.leadconnectorhq.com/calendars/events/appointments/{appointmentId}`

**Request Body Example** (Partial Update):
```json
{
  "startTime": "2025-10-25T16:00:00-04:00",
  "endTime": "2025-10-25T16:30:00-04:00",
  "notes": "Rescheduled per customer request"
}
```

**Success Response** (200 OK):
```json
{
  "id": "appointment_id",
  "calendarId": "BqTwX8QFwXzpegMve9EQ",
  "contactId": "9NkT25Vor1v4aQatFsv2",
  "startTime": "2025-10-25T16:00:00-04:00",
  "endTime": "2025-10-25T16:30:00-04:00",
  "title": "Sales Consultation",
  "appointmentStatus": "confirmed",
  "notes": "Rescheduled per customer request",
  "dateUpdated": "2025-10-23T12:00:00Z"
}
```

---

### 8. Delete Appointment Request

**HTTP Method**: DELETE  
**Endpoint**: `https://services.leadconnectorhq.com/calendars/events/appointments/{appointmentId}`

**Success Response** (200 OK or 204 No Content):
```json
{
  "success": true,
  "message": "Appointment deleted successfully"
}
```

---



## API Endpoints Reference

### Base URLs
- **API V2 (OAuth)**: `https://services.leadconnectorhq.com`
- **API V1 (Legacy)**: `https://rest.gohighlevel.com/v1`

### Authentication
All requests require the `Authorization` header:
```
Authorization: Bearer YOUR_API_KEY
```

### Contact Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/contacts/` | Create new contact |
| GET | `/contacts/{contactId}` | Get contact by ID |
| PUT | `/contacts/{contactId}` | Update contact |
| DELETE | `/contacts/{contactId}` | Delete contact |
| GET | `/contacts/search` | Search contacts |

### Calendar Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/calendars/` | Get all calendars |
| GET | `/calendars/{calendarId}` | Get calendar by ID |
| GET | `/calendars/{calendarId}/free-slots` | Get available time slots |
| POST | `/calendars/events/appointments` | Create appointment |
| PUT | `/calendars/events/appointments/{appointmentId}` | Update appointment |
| GET | `/calendars/events/appointments/{appointmentId}` | Get appointment |
| DELETE | `/calendars/events/appointments/{appointmentId}` | Delete appointment |

---

## Error Handling

### Common HTTP Status Codes

| Status Code | Meaning | Action |
|-------------|---------|--------|
| 200 | Success | Request completed successfully |
| 201 | Created | Resource created successfully |
| 400 | Bad Request | Check request body and parameters |
| 401 | Unauthorized | Verify API key |
| 403 | Forbidden | Check API permissions/scopes |
| 404 | Not Found | Verify resource ID exists |
| 422 | Unprocessable Entity | Validation error in request |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Retry request or contact support |

### Rate Limits
- **Daily Limit**: 200,000 API requests per day per Marketplace app per location
- **Monitor Usage**: Check response headers for limit information

### Error Response Format
```json
{
  "success": false,
  "message": "Error description",
  "errors": [
    {
      "field": "calendarId",
      "message": "Calendar ID is required"
    }
  ]
}
```

### Common Errors and Solutions

#### 1. Invalid Date Format
**Error**: `"selectedSlot is invalid"`
**Solution**: Ensure date is in ISO 8601 format with timezone offset
```javascript
// Correct format
"2025-10-25T15:00:00-04:00"

// Wrong formats
"2025-10-25 15:00:00"
"10/25/2025 3:00 PM"
```

#### 2. Timezone Mismatch
**Error**: `"Selected timezone doesn't match"`
**Solution**: Ensure timezone in `selectedTimezone` matches the offset in `selectedSlot`
```javascript
// Correct
selectedSlot: "2025-10-25T15:00:00-04:00"
selectedTimezone: "America/New_York" // -04:00 in EDT

// Wrong
selectedSlot: "2025-10-25T15:00:00-04:00"
selectedTimezone: "Europe/London" // Different timezone
```

#### 3. Contact Not Found
**Error**: `"Contact ID not found"`
**Solution**: Create contact first or verify contact ID exists
```javascript
// Always verify or create contact before appointment
const contactId = await createContact(contactData);
```

#### 4. Calendar Not Found
**Error**: `"Calendar not found"`
**Solution**: Use the calendars list endpoint to get valid calendar IDs
```javascript
const calendars = await getCalendars();
const calendarId = calendars.calendars[0].id;
```

#### 5. Duplicate Contact
**Error**: Contact creation fails silently
**Solution**: Use search/upsert endpoint or handle duplicates
```javascript
// Search first, then create if not exists
const existingContact = await searchContact(email);
if (!existingContact) {
  contactId = await createContact(data);
}
```

---

## Testing Guidelines

### Pre-Testing Checklist

Before you begin testing, ensure you have:
- [ ] Valid API Key
- [ ] Location ID
- [ ] At least one User ID (for calendar creation)
- [ ] API testing tool (Postman, Insomnia, or cURL)
- [ ] Test contact information
- [ ] Valid timezone string

---

### 1. Test Authentication

**Purpose**: Verify your API key works

**Test Action**:
- Make a simple GET request to list calendars
- Endpoint: `GET /calendars/?locationId=YOUR_LOCATION_ID`
- Expected: 200 OK response with list of calendars (or empty array)

**Success Criteria**:
- Response status: 200 OK
- No authentication errors (401 Unauthorized)

**If Failed**:
- Verify API key is correct
- Check that Bearer prefix is included
- Confirm API key has necessary permissions

---

### 2. Test Calendar Creation

**Purpose**: Verify calendar can be created via API

**Test Endpoint**: `POST /calendars/`

**Test Request Body**:
```json
{
  "locationId": "YOUR_LOCATION_ID",
  "name": "Test Calendar API",
  "slug": "test-calendar-api-unique-123",
  "description": "Test calendar created via API",
  "teamMembers": [
    {
      "userId": "YOUR_USER_ID",
      "meetingLocation": "https://zoom.us/test"
    }
  ],
  "slotDuration": 30,
  "slotInterval": 30,
  "appoinmentPerSlot": 1
}
```

**Success Criteria**:
- Response status: 201 Created
- Response contains calendar ID
- Calendar appears in GHL dashboard

**Common Issues**:
- Slug already exists: Change slug to unique value
- Invalid userId: Verify user exists in location
- Missing required fields: Add all required fields

**What to Save**: Calendar ID from response

---

### 3. Test Contact Creation

**Purpose**: Verify contact can be created

**Test Endpoint**: `POST /contacts/`

**Test Request Body**:
```json
{
  "locationId": "YOUR_LOCATION_ID",
  "firstName": "Test",
  "lastName": "User",
  "email": "[email protected]",
  "phone": "+11234567890"
}
```

**Success Criteria**:
- Response status: 200 OK or 201 Created
- Response contains contact ID
- Contact appears in GHL contacts list

**Common Issues**:
- Duplicate contact: May return existing contact
- Invalid phone format: Must be E.164 format (+country+number)
- Invalid email: Check email format

**What to Save**: Contact ID from response

---

### 4. Test Get Calendars

**Purpose**: Verify you can retrieve calendar list

**Test Endpoint**: `GET /calendars/?locationId=YOUR_LOCATION_ID`

**Success Criteria**:
- Response status: 200 OK
- Response contains array of calendars
- Your test calendar appears in list

---

### 5. Test Check Availability

**Purpose**: Verify you can get available time slots

**Test Endpoint**: `GET /calendars/CALENDAR_ID/free-slots`

**Query Parameters**:
- startDate: Tomorrow's date (YYYY-MM-DD)
- endDate: Day after tomorrow (YYYY-MM-DD)
- timezone: America/New_York (or your timezone)

**Success Criteria**:
- Response status: 200 OK
- Response contains available slots by date
- Slots match calendar configuration

---

### 6. Test Appointment Creation

**Purpose**: Create a test appointment

**Test Endpoint**: `POST /calendars/events/appointments`

**Test Request Body**:
```json
{
  "calendarId": "CALENDAR_ID_FROM_STEP_2",
  "contactId": "CONTACT_ID_FROM_STEP_3",
  "startTime": "2025-10-26T10:00:00-04:00",
  "endTime": "2025-10-26T10:30:00-04:00",
  "title": "Test Appointment",
  "appointmentStatus": "confirmed"
}
```

**Success Criteria**:
- Response status: 200 OK or 201 Created
- Response contains appointment ID
- Appointment appears in GHL calendar
- Notification sent (if toNotify was true)

**Common Issues**:
- Invalid time format: Ensure ISO 8601 with timezone offset
- Time not available: Check calendar availability first
- Contact doesn't exist: Verify contact ID is correct
- Timezone mismatch: Ensure timezone offset matches timezone

**What to Save**: Appointment ID from response

---

### 7. Test Get Appointment

**Purpose**: Verify appointment was created correctly

**Test Endpoint**: `GET /calendars/events/appointments/APPOINTMENT_ID`

**Success Criteria**:
- Response status: 200 OK
- All appointment details match what you created
- Times are correct
- Contact is correctly linked

---

### 8. Test Update Appointment

**Purpose**: Verify appointment can be modified

**Test Endpoint**: `PUT /calendars/events/appointments/APPOINTMENT_ID`

**Test Request Body**:
```json
{
  "startTime": "2025-10-26T11:00:00-04:00",
  "endTime": "2025-10-26T11:30:00-04:00",
  "notes": "Updated via API test"
}
```

**Success Criteria**:
- Response status: 200 OK
- Appointment times updated in response
- Changes visible in GHL dashboard

---

### 9. Test Delete Appointment

**Purpose**: Verify appointment can be deleted

**Test Endpoint**: `DELETE /calendars/events/appointments/APPOINTMENT_ID`

**Success Criteria**:
- Response status: 200 OK or 204 No Content
- Appointment removed from GHL calendar
- Contact still exists (not deleted)

---

### Testing with Postman

**Setup Steps**:
1. Create new Postman Collection named "GHL Appointment API"
2. Add environment variables:
   - `api_key`: Your API key
   - `location_id`: Your location ID
   - `base_url`: https://services.leadconnectorhq.com

**Collection-Level Headers**:
- Authorization: Bearer {{api_key}}
- Content-Type: application/json
- Version: 2021-07-28

**Request Organization**:
1. Authentication Test
2. Create Calendar
3. Create Contact
4. Get Calendars
5. Check Availability
6. Create Appointment
7. Get Appointment
8. Update Appointment
9. Delete Appointment

---

### Testing with cURL

**Test Create Contact**:
```
curl -X POST https://services.leadconnectorhq.com/contacts/ \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"locationId":"YOUR_LOCATION_ID","firstName":"Test","lastName":"User","email":"[email protected]","phone":"+11234567890"}'
```

**Test Create Appointment**:
```
curl -X POST https://services.leadconnectorhq.com/calendars/events/appointments \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"calendarId":"CALENDAR_ID","contactId":"CONTACT_ID","startTime":"2025-10-26T10:00:00-04:00","endTime":"2025-10-26T10:30:00-04:00","title":"Test Appointment","appointmentStatus":"confirmed"}'
```

---

### Validation Checklist Before Production

- [ ] API key stored securely (not in code)
- [ ] Location ID is correct
- [ ] Calendar created and has availability configured
- [ ] Contact creation works with all required fields
- [ ] DateTime format is correct (ISO 8601 with timezone)
- [ ] Timezone offset matches timezone string
- [ ] Phone numbers in E.164 format
- [ ] Email validation working
- [ ] Error handling implemented
- [ ] Rate limits monitored (200K/day)
- [ ] Appointment notifications working
- [ ] Calendar appears correctly in GHL
- [ ] All test appointments cleaned up

---

### Troubleshooting Common Test Failures

**401 Unauthorized**:
- Check API key is correct
- Verify Bearer prefix in Authorization header
- Confirm API key has required permissions

**400 Bad Request**:
- Validate JSON format (use JSON validator)
- Check all required fields are present
- Verify data types match requirements

**404 Not Found**:
- Verify endpoint URL is correct
- Check resource IDs exist (calendar ID, contact ID)
- Confirm using correct API version

**422 Unprocessable Entity**:
- Check datetime format (must be ISO 8601)
- Verify timezone offset matches timezone string
- Ensure email/phone format is valid
- Confirm calendar has availability for requested time

**429 Too Many Requests**:
- Reduce request frequency
- Monitor rate limit headers in response
- Implement exponential backoff

---

## Additional Resources

### Official Documentation
- **API Documentation**: https://marketplace.gohighlevel.com/docs/
- **Developer Support**: https://developers.gohighlevel.com/
- **Developer Slack**: https://developers.gohighlevel.com/join-dev-community
- **Support Portal**: https://help.gohighlevel.com/

### Useful Timezone Resources
- IANA Timezone List: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
- Timezone Converter: https://www.timeanddate.com/worldclock/converter.html

### Date/Time Format Tools
- ISO 8601 Format: https://www.iso.org/iso-8601-date-and-time-format.html
- Online ISO Converter: https://www.timestamp-converter.com/

---

## Final Summary

### Complete Flow Overview

**End-to-End Process**:
1. Setup authentication (API Key, Location ID, User ID)
2. Create calendar via API (if needed)
3. Create or get contact
4. Check calendar availability (optional but recommended)
5. Create appointment
6. Verify appointment created successfully

### Quick Reference: All Steps

| Step | Action | Endpoint | Method | Required Info |
|------|--------|----------|--------|---------------|
| 0 | Get API Key | GHL Dashboard | Manual | API Key, Location ID, User ID |
| 1 | Create Calendar | /calendars/ | POST | name, slug, teamMembers, locationId |
| 2A | Search Contact | /contacts/search | GET | email or phone, locationId |
| 2B | Create Contact | /contacts/ | POST | firstName, lastName, email/phone, locationId |
| 3 | List Calendars | /calendars/ | GET | locationId |
| 4 | Check Availability | /calendars/{id}/free-slots | GET | startDate, endDate, timezone |
| 5 | Create Appointment | /calendars/events/appointments | POST | calendarId, contactId, startTime, endTime |
| 6 | Get Appointment | /calendars/events/appointments/{id} | GET | appointmentId |
| 7 | Update Appointment | /calendars/events/appointments/{id} | PUT | appointmentId, fields to update |
| 8 | Delete Appointment | /calendars/events/appointments/{id} | DELETE | appointmentId |

### Required Information Summary

**For Complete Flow**:
1. **API Key** - From GHL Settings → Company Settings
2. **Location ID** - Your sub-account identifier
3. **User ID** - Team member for calendar assignment
4. **Calendar Details** - Name, slug (unique), slot duration, team members
5. **Contact Details** - First name, last name, email OR phone
6. **Appointment Time** - Start time and end time in ISO 8601 format with timezone

### Data Format Requirements

**Phone Numbers**:
- Format: E.164 (+country code + number)
- Example: +13145557878
- No spaces, dashes, or parentheses

**Email Addresses**:
- Must be valid email format
- Example: [email protected]

**Date/Time**:
- Format: ISO 8601 with timezone offset
- Format pattern: YYYY-MM-DDTHH:MM:SS±HH:MM
- Example: 2025-10-25T15:00:00-04:00
- Must include timezone offset that matches timezone string

**Timezone**:
- Format: IANA timezone database string
- Examples: America/New_York, Europe/London, Asia/Kolkata, America/Chicago
- Must match the offset in startTime/endTime

**Calendar Slug**:
- Must be globally unique across all GHL
- Only lowercase letters, numbers, and hyphens
- Cannot start or end with hyphen
- Example: sales-consultation-2025

### Key Reminders

**Authentication**:
- Always use Bearer token: `Authorization: Bearer YOUR_API_KEY`
- Include Content-Type: application/json
- Include API Version: Version: 2021-07-28

**Rate Limits**:
- 200,000 requests per day per location
- Monitor rate limit headers in responses
- Implement retry logic with exponential backoff

**Best Practices**:
- Store API keys securely (never in frontend code)
- Validate data before sending to API
- Check calendar availability before creating appointments
- Handle errors gracefully with appropriate messages
- Log API responses for debugging
- Test in development environment first
- Use descriptive calendar names and slugs
- Keep contact information updated

**Common Pitfalls to Avoid**:
- Using duplicate calendar slugs (must be globally unique)
- Wrong datetime format (must be ISO 8601 with timezone)
- Timezone mismatch (offset must match timezone string)
- Invalid phone format (must be E.164)
- Missing required fields in requests
- Not checking calendar availability first
- Hardcoding API keys in code
- Exceeding rate limits

### Success Criteria

**Calendar Created Successfully**:
- ✓ Received 201 Created response
- ✓ Calendar ID returned in response
- ✓ Calendar visible in GHL dashboard
- ✓ Team members assigned correctly
- ✓ Availability configured

**Contact Created Successfully**:
- ✓ Received 200 OK or 201 Created response
- ✓ Contact ID returned in response
- ✓ Contact visible in GHL contacts list
- ✓ All fields saved correctly

**Appointment Created Successfully**:
- ✓ Received 200 OK or 201 Created response
- ✓ Appointment ID returned in response
- ✓ Appointment visible in GHL calendar
- ✓ Correct date and time displayed
- ✓ Contact linked correctly
- ✓ Notifications sent (if enabled)
- ✓ Meeting location set (if provided)

### Support Resources

**Official Documentation**:
- Main API Docs: https://marketplace.gohighlevel.com/docs/
- Developer Portal: https://developers.gohighlevel.com/
- Support Portal: https://help.gohighlevel.com/

**Community Support**:
- Developer Slack: https://developers.gohighlevel.com/join-dev-community
- Monthly Developer Council: https://www.gohighlevel.com/events
- GitHub Issues: For API feature requests

**Additional Resources**:
- IANA Timezone Database: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
- ISO 8601 Format: https://www.iso.org/iso-8601-date-and-time-format.html
- E.164 Phone Format: https://en.wikipedia.org/wiki/E.164

### Next Steps After Setup

1. **Test the Complete Flow**: Run through all steps in test environment
2. **Implement Error Handling**: Add proper error handling for all API calls
3. **Add Logging**: Log all API requests and responses for debugging
4. **Monitor Performance**: Track API response times and errors
5. **Set Up Webhooks**: Configure webhooks for real-time appointment updates
6. **Optimize**: Batch operations where possible to reduce API calls
7. **Document**: Keep internal documentation of your implementation
8. **Scale**: Plan for handling multiple locations and calendars

---

**Document Version**: 2.0  
**Last Updated**: October 2025  
**API Version**: 2021-07-28  
**Includes**: Calendar Creation, Contact Management, Appointment Booking