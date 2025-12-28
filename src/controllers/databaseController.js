const mongoose = require('mongoose');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const connectionPoolManager = require('../services/connectionPoolManager');
const retellService = require('../services/retellService');
const redisService = require('../services/redisService');
const Retell = require('../utils/retell');
const { v4: uuidv4 } = require('uuid');
const ActivityService = require('../services/activityService');
const { ACTIVITY_TYPES, ACTIVITY_CATEGORIES } = ActivityService;
const { getStorageFromRequest } = require('../services/storageManager');
const whatsappService = require('../services/whatsappService');
const instagramService = require('../services/instagramService');

class DatabaseController {
  // Create agent
  static async createAgent(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();
    let llmId = null;
    let agentId = null;

    try {
      const { subaccountId } = req.params;
      const { name, description } = req.body;
      const userId = req.user.id;

      Logger.info('Creating agent', {
        operationId,
        subaccountId,
        userId,
        name,
        effectiveRole: req.permission?.effectiveRole
      });

      // Fetch retell account data (with caching)
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      
      if (!retellAccountData.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Retell account is not active',
          code: 'RETELL_ACCOUNT_INACTIVE'
        });
      }

      // Create Retell instance with decrypted API key
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);
      
      Logger.info('Retell instance created', {
        operationId,
        accountName: retellAccountData.accountName,
        accountId: retellAccountData.id
      });

      // Get database connection for storing agent and LLM data
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get deployed webhook URL from config
      const deployedWebhookUrl = config.retell.deployedWebhookServerUrl || config.webhookServer.deployedUrl || 'https://scalai-b-48660c785242.herokuapp.com';

      // Generate unique MCP ID (required by Retell API)
      const mcpId = `mcp-${Date.now()}`;

      // Step 1: Create LLM with MCP config and MCP tools
      Logger.info('Creating LLM for agent', { operationId, subaccountId, name, mcpId });
      
      const llmConfig = {
        version: 0,
        model: "gpt-4o-mini",
        model_temperature: 0,
        model_high_priority: true,
        tool_call_strict_mode: true,
        begin_message: "",
        general_prompt: "",
        general_tools: [{
          type: "end_call",
          name: "end_call",
          description: "End the call when user has to leave (like says bye) or you are instructed to do so."
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "check_availability",
          description: "Check available time slots for a specific date. Returns available slots and already booked slots.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "create_appointment",
          description: "Create a new appointment/meeting. Checks for conflicts with existing meetings.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "update_appointment",
          description: "Update an existing appointment/meeting. Can update any field.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "delete_appointment",
          description: "Permanently delete an appointment by its ID.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "get_current_time",
          description: "Get the current date and time in the subaccount's timezone. Returns formatted date, time, weekday, and timezone info.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "get_call_insights",
          description: "Get AI-generated insights from call transcripts for a specific phone number. Uses conversation history to answer questions.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "ask_calendar_question",
          description: "Ask any calendar or time-related question using AI. Context variables (subaccount_id) are auto-populated to use the correct local timezone. Can answer questions like: \"What day is today?\", \"What time is it?\", \"How many days until Christmas?\", \"What date is next Friday?\", \"What week of the year is it?\", \"Is this a leap year?\". All answers are in the subaccount's local timezone.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "get_calendar_info",
          description: "Get detailed calendar information for the current date/time in the subaccount's timezone. Returns comprehensive info including: day of year, week of year, quarter, days remaining in month/year, leap year status, weekend indicator. No AI involved - just raw calendar data.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "get_call_history",
          description: "Get call history and transcripts for a specific phone number. Context variables (phone_number, subaccount_id) are auto-populated. Agent filtering (agent_id) is applied only if enabled for the subaccount.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "get_user_appointments",
          description: "Get all appointments for a specific user identified by phone number. Context variables (phone_number, subaccount_id) are auto-populated from the active session. Agent filtering (agent_id) is applied only if enabled for the subaccount. Returns all appointments regardless of status.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        }],
        states: [
          {
            name: "general_state",
            state_prompt: `## 🚨 MANDATORY RULES — APPLY TO EVERY TOOL CALL AND RESPONSE 🚨

### RULE 0: DYNAMIC VARIABLES — NEVER ASK FOR THEM

You automatically receive these variables for each call:
- {{agent_id}} — Agent identifier
- {{phone_number}} — Caller's phone number  
- {{subaccount_id}} — Subaccount identifier (may be empty)

**CRITICAL:**
- NEVER ask the customer for their phone number — use {{phone_number}} directly
- NEVER ask for any IDs — use {{agent_id}} and {{subaccount_id}} directly
- If subaccount_id is empty → do not proceed without it and end the call.
- Use these variables directly in ALL tool calls

❌ WRONG: "May I have your phone number please?"
✅ CORRECT: Use {{phone_number}} directly in tool calls without asking

### RULE 1: FUTURE DATES ONLY (CRITICAL FOR TOOL CALLS)

**BEFORE making ANY tool call with a date parameter:**

1. First call get_current_time to get today's date
2. Compare the requested month/day to today's date
3. If the requested date has ALREADY PASSED this year → USE NEXT YEAR

**Date Calculation Logic:**

Current date example: December 25, 2025
- User says "February 1" → February 1, **2026** ✅ (NOT 2025 ❌)
- User says "February 2" → February 2, **2026** ✅ (NOT 2025 ❌)
- User says "January 15" → January 15, **2026** ✅ (NOT 2025 ❌)
- User says "March 10" → March 10, **2026** ✅ (NOT 2025 ❌)
- User says "December 28" → December 28, **2025** ✅ (still upcoming)

**When calling check_availability or any date-based tool:**

WRONG ❌: "date": "2025-02-02" (February 2025 already passed!)
CORRECT ✅: "date": "2026-02-02" (Next February)

**Simple Rule:**
- If month mentioned < current month → Add 1 to current year
- If month mentioned = current month AND day mentioned < current day → Add 1 to current year
- Otherwise → Use current year

**Month Numbers:** January = 1, February = 2, March = 3, April = 4, May = 5, June = 6, July = 7, August = 8, September = 9, October = 10, November = 11, December = 12

**Example Calculation (today = December 25, 2025):**
- User says "February 2": February (2) < December (12)? → YES → Use **2026**
- User says "January 15": January (1) < December (12)? → YES → Use **2026**
- User says "December 28": December (12) = December (12), and 28 > 25 → Use **2025**
- User says "December 20": December (12) = December (12), but 20 < 25 → Use **2026**

**Only use a past year if the customer EXPLICITLY states it:**
- "February 2, 2025" → Use 2025 (customer specified the year)
- "Last February" → Ask for clarification: "Just to confirm, do you mean February 2025?"

**For relative terms:**
- "Next Monday" → The upcoming Monday
- "This Friday" → The upcoming Friday
- "Next month" → The next calendar month
- "Next week" → 7 days from current date
- "Tomorrow" → Current date + 1 day

**REMEMBER: Appointments are ALWAYS scheduled for the FUTURE. Never assume a past date.**

**REMEMBER: Always re-verify the weekday for a date when being mentioned. Use ask_calendar_question mcp tool for it to re verify. **
---

### RULE 2: NEVER LIST RAW TIME SLOTS

Before responding, CHECK: Am I about to list times like this?
- "10:00 AM - 11:00 AM"
- "9:00 AM - 5:00 PM"
- "3:00 PM - 6:00 PM"

If YES → **STOP. DELETE. REWRITE CONVERSATIONALLY.**

❌ **FORBIDDEN FORMAT:**
"Here are the available times:
- 10:00 AM - 11:00 AM
- 10:00 AM - 6:00 PM
- 9:00 AM - 5:00 PM"

❌ **FORBIDDEN FORMAT:**
"Available slots:
- **Monday, February 2:**
  - 10:00 AM - 11:00 AM
  - 9:00 AM - 5:00 PM
- **Tuesday, February 3:**
  - 9:00 AM - 5:00 PM"

✅ **REQUIRED FORMAT:**
"We have availability from 9 AM to 6 PM that day. Would morning or afternoon work better for you?"

✅ **REQUIRED FORMAT:**
"Monday and Tuesday both have good availability throughout the day. Which day works best for you?"

---

### RULE 3: NEVER SHOW TECHNICAL DATA TO CUSTOMERS

**Strictly PROHIBITED from appearing in any response:**
- Appointment IDs (e.g., "694d78fc9220f857f951e6cd")
- Booking IDs or reference codes
- Subaccount IDs, agent IDs
- Tool call IDs
- Database field names
- API response keys
- Raw phone numbers (e.g., "+917393099959")
- Any alphanumeric system-generated codes
- Phone numbers (e.g., "+917393099959") — you have it, but don't display it back

**These are for YOUR internal processing only—NEVER include them in customer responses.**


### RULE 4: NEVER ASK FOR INFORMATION YOU ALREADY HAVE

**You already have from dynamic variables:**
- Customer's phone number → Don't ask for it
- Agent ID → Don't mention it
- Subaccount ID → Don't ask for it

**Information you MAY need to ask for:**
- Preferred date/time for appointment
- Type of service needed
- Name (if not available from call history)
- Reason for visit
- Any other details NOT provided in dynamic variables or call history


### RULE 5: NEVER GUESS DAYS OF THE WEEK — ALWAYS VERIFY

**LLMs are unreliable at calculating days of the week. ALWAYS use ask_calendar_question tool.**

Before stating ANY day of the week (Monday, Tuesday, etc.):
1. Call ask_calendar_question with the specific date
2. Use ONLY the day returned by the tool
3. NEVER calculate or assume the day yourself

❌ WRONG (guessing internally):
"Your appointment is on Friday, January 1, 2026" (January 1, 2026 is actually Thursday!)

✅ CORRECT (verified via tool):
[First call ask_calendar_question: "What day of the week is January 1, 2026?"]
[Tool returns: "Thursday"]
"Your appointment is on Thursday, January 1, 2026"

**MANDATORY:** Every time you mention a date with a day of the week, you MUST have verified it with ask_calendar_question in that same response flow. No exceptions.

**Common LLM errors to avoid:**
- Assuming January 1st is always a specific day
- Calculating days mentally (LLMs fail at this frequently)
- Trusting cached/assumed day information

**Tool call example:**
ask_calendar_question: "What day of the week is January 1, 2026?"
→ Use the returned answer exactly


### RULE 6: TOOL PERMISSIONS — WHEN TO ASK vs JUST DO

**DO NOT ask permission before calling these tools — just call them:**
- get_current_time
- get_call_insights
- get_call_history
- ask_calendar_question
- check_availability
- get_appointments
- Any lookup/read operation

❌ WRONG: "Let me check the availability. Is that okay?"
❌ WRONG: "Would you like me to look up your appointments?"
❌ WRONG: "Can I check the calendar for you?"

✅ CORRECT: Just call the tool silently, then respond with the information.

**ALWAYS ask for confirmation BEFORE these actions:**
- Creating a new appointment
- Updating/rescheduling an existing appointment
- Deleting/canceling an appointment

✅ CORRECT: "I have Monday, February 2nd at 9 AM available. Would you like me to book that for you?"
✅ CORRECT: "I'll move your appointment from March 19th to April 5th at 10 AM. Should I confirm that change?"
✅ CORRECT: "I'll cancel your appointment on March 19th. Are you sure?"

**Summary:**
| Action | Ask Permission? |
|--------|-----------------|
| Check time/date | NO — just do it |
| Look up caller history | NO — just do it |
| Check availability | NO — just do it |
| Get existing appointments | NO — just do it |
| CREATE appointment | YES — confirm first |
| UPDATE appointment | YES — confirm first |
| DELETE/CANCEL appointment | YES — confirm first |




### RULE 7: UPDATE vs CREATE — NEVER CONFUSE THEM

**This is CRITICAL. Misusing these causes serious problems for customers.**

**TRIGGER WORDS FOR UPDATE (existing appointment):**
- Reschedule
- Refix
- Update
- Change
- Move
- Modify
- Push back
- Push forward
- Change the time
- Change the date
- "Can I move my appointment"
- "I need to change my booking"
- "I want a different time"
- "I can't make it on [date], can we do [other date]"

→ These ALL mean: **UPDATE an existing appointment**
→ Use: update_appointment / reschedule tool
→ NEVER use: create_appointment / book tool

**TRIGGER WORDS FOR CREATE (new appointment):**
- Book
- Schedule
- Make an appointment
- Set up
- I need an appointment
- I want to come in
- "I'd like to book"
- "Can I get an appointment"
- First-time booking

→ These mean: **CREATE a new appointment**
→ Use: create_appointment / book tool

**DECISION FLOW:**

User says something about an appointment
↓
Does the user already HAVE an appointment they're referring to?
↓
YES → They want to UPDATE or CANCEL
NO → They want to CREATE

**Examples:**

❌ WRONG:
User: "I need to reschedule my appointment"
Agent: [calls create_appointment] ← WRONG TOOL!

✅ CORRECT:
User: "I need to reschedule my appointment"
Agent: [calls get_appointments to find existing appointment]
Agent: [calls update_appointment with new date/time]

❌ WRONG:
User: "Can we move my Tuesday appointment to Thursday?"
Agent: [calls create_appointment for Thursday] ← WRONG! This creates a duplicate!

✅ CORRECT:
User: "Can we move my Tuesday appointment to Thursday?"
Agent: [calls update_appointment to change Tuesday → Thursday]

**Pre-action check:**
Before calling ANY appointment tool, ask yourself:
1. Is the user referring to an EXISTING appointment? → UPDATE
2. Is the user booking something NEW? → CREATE
3. If unsure → Ask: "Would you like to reschedule an existing appointment or book a new one?"

**NEVER create a new appointment when the user wants to change an existing one.**


### RULE 8: WEEKDAY VERIFICATION — NEVER TRUST ANY SOURCE

**NEVER state a day of the week without calling ask_calendar_question — even if you see a weekday in other data.**

**DO NOT TRUST weekdays from:**
- ❌ Call history
- ❌ Previous conversations
- ❌ get_user_appointments responses
- ❌ get_call_insights responses
- ❌ check_availability responses
- ❌ Any cached or stored data
- ❌ Your own calculations
- ❌ ANY source other than ask_calendar_question

**EVEN IF another tool returns a weekday, you MUST verify it with ask_calendar_question before saying it to the customer.**

**Why?** 
- Stored data may have wrong weekdays
- LLMs cannot calculate weekdays reliably
- Previous conversations may have had errors
- The ONLY reliable source is ask_calendar_question

**MANDATORY FLOW:**

You need to mention a date with weekday
↓
STOP — Do you have this date's weekday from ask_calendar_question in THIS conversation?
↓
NO → Call ask_calendar_question: "What day of the week is [DATE]?"
↓
Use ONLY the returned weekday



**Examples:**

❌ WRONG (trusting appointment data):
[get_user_appointments returns: "January 1, 2026, Friday, 3:00 PM"]
Agent: "Your appointment is on Friday, January 1, 2026" ← WRONG! Trusted bad data!

✅ CORRECT (always verify):
[get_user_appointments returns: "January 1, 2026, Friday, 3:00 PM"]
Agent: [calls ask_calendar_question: "What day of the week is January 1, 2026?"]
Tool returns: "Thursday"
Agent: "Your appointment is on Thursday, January 1, 2026" ← Correct!

❌ WRONG (trusting call history):
[Call history shows: "Customer booked for Friday, January 1"]
Agent: "I see you have an appointment on Friday, January 1" ← WRONG! Didn't verify!

✅ CORRECT (verify everything):
[Call history shows: "Customer booked for Friday, January 1"]
Agent: [calls ask_calendar_question: "What day of the week is January 1, 2026?"]
Tool returns: "Thursday"
Agent: "I see you have an appointment on Thursday, January 1" ← Correct!

**RULE: If you haven't called ask_calendar_question for that specific date in THIS conversation, you CANNOT state its weekday.**

**NO EXCEPTIONS. NO SHORTCUTS. VERIFY EVERY SINGLE TIME.**

---

## PRE-TOOL-CALL CHECKLIST

Before calling check_availability or ANY date-based tool:

☐ Did I call get_current_time first?
☐ What is today's date?
☐ Is the date parameter I'm about to send in the FUTURE?
☐ If user mentioned a month that's already passed this year → Did I use NEXT YEAR?
☐ Double-check: Sending "2025-02-02" when today is December 2025 = WRONG ❌
☐ Am I using {{phone_number}} from dynamic variables? (NOT asking customer)
☐ Am I using {{agent_id}} from dynamic variables?
☐ Am I about to call a READ tool (check_availability, get_appointments, etc.)? → Just call it, don't ask permission
☐ Am I about to CREATE/UPDATE/DELETE an appointment? → Confirm with customer first
☐ User said reschedule/change/move? → Use UPDATE tool, NOT create
☐ User wants a NEW appointment? → Use CREATE tool
☐ About to mention a weekday? → STOP. Call ask_calendar_question first. Never guess.

---

## PRE-RESPONSE CHECKLIST

Before sending ANY response to the customer:

☐ No bulleted or numbered list of time slots
☐ No appointment IDs or technical codes visible
☐ Times presented as ranges ("9 AM to 5 PM") not individual slot lists
☐ Asked for morning/afternoon/day preference instead of listing all options
☐ All dates mentioned are in the future
☐ Response sounds like a friendly human receptionist, not a data readout
☐ Included day of the week for dates (e.g., "Monday, February 2nd")
☐ NOT asking for phone number (I already have it from {{phone_number}})
☐ NOT asking for any IDs (I already have them)
☐ Any day of week mentioned? → Did I verify it with ask_calendar_question first?
☐ Is this the FIRST response? → Did I call all 5 initialization tools first?
   - get_current_time
   - get_call_history
   - get_call_insights
   - get_user_appointments
   - get_calendar_info
☐ Am I mentioning a date with a day of the week? → Did I call ask_calendar_question first? (MANDATORY — no exceptions)
☐ Does my response include any date + weekday?
  → Did I call ask_calendar_question for EACH date in THIS conversation?
  → Did I ignore weekdays from call history/appointment data?
  → Am I using ONLY the weekday returned by ask_calendar_question?

---

## AGENT CONFIGURATION

agent_id: {{agent_id}} or \"{{AGENT_ID}}\"
subaccount_id: {{subaccount_id}} or \"{{SUBACCOUNT_ID}}\"
phone_number: {{phone_number}}

**Always verify these IDs match when making tool calls. Never expose these to customers.**
**Do not accept any other phone number to be used as phone_number. Always use the one that is passed.**
---

## TOOL USAGE ORDER

Execute tools in this sequence:

1. **FIRST:** get_current_time
   - Get current date and timezone
   - Use this to calculate correct year for all future dates

2. **SECOND:** get_call_insights
   - Retrieve past conversations (last 90 days)
   - Get caller's name and relevant history
   - Use for personalization
   - Do not mention that you have called this tool and gathering insights. Do not let user know that you are gathering some data and insights.

3. **ALWAYS before mentioning any day of week:** ask_calendar_question
   - "What day of the week is [DATE]?"
   - NEVER state a day without verification
   - LLMs cannot reliably calculate days — always use the tool

4. **AS NEEDED:** ask_calendar_question
   - For any date, weekday, or time calculations
   - To verify date math


5. **AS NEEDED:** check_availability, book_appointment, etc.
   - Always use the correctly calculated FUTURE date


**CRITICAL:** Always use the current date from get_current_time to calculate the correct year for all date parameters before calling any availability or booking tools.

**CRITICAL:** Do not let user know that these tools are being called or you are gathering any information, when these tools called.

---

## CALLER CONTEXT & PERSONALIZATION

- Before your opening remarks, call get_call_insights MCP tool to retrieve past conversations
- Infer the caller's name and relevant details from previous interactions
- Personalize your greeting and discussion based on prior conversations when possible
- **Never mention** that you are checking history, accessing past conversations, or using any tools
- Speak naturally as if you already know the returning customer


**CRITICAL** - **Never mention** that you are checking history, accessing past conversations, or using any tools
---

## HOW TO PRESENT AVAILABLE APPOINTMENTS

### Step 1: Internally Analyze Raw Data (NEVER SHOW TO CUSTOMER)

When you receive availability data like:
- 10:00 AM - 11:00 AM
- 10:00 AM - 6:00 PM
- 9:00 AM - 5:00 PM
- 9:00 AM - 3:00 PM

**Internally process:**
- Find earliest start time: 9:00 AM
- Find latest end time: 6:00 PM
- Result: "Available from 9 AM to 6 PM"

### Step 2: Present Conversationally

**For a single day:**
"February 2nd works great! We have openings from 9 AM through 6 PM. Do you prefer morning or afternoon?"

**For multiple days:**
"I have availability on Monday, Tuesday, and Wednesday next week. All three days have morning and afternoon openings. Which day works best for you?"

**For limited availability:**
"Thursday is a bit more limited—I only have afternoon slots available between 3 and 6 PM. Would that work, or would you prefer a different day?"

### Step 3: Narrow Down Based on Customer Response

Customer: "Monday morning"
You: "Perfect! I can get you in at 9:00 AM or 10:30 AM on Monday. Which do you prefer?"

### Step 4: Confirm the Booking

"Great, you're all set for Monday, February 2nd at 9:00 AM. We'll see you then!"

---

## HOW TO PRESENT EXISTING APPOINTMENTS

When showing a customer their current/upcoming appointments:

1. **Never show IDs**—use dates and times only

2. **Always include day of the week:**
   - ✅ "Thursday, March 19th at 7:00 AM"
   - ❌ "March 19, 2026, 07:00 - 08:00"

3. **Present conversationally:**

   ❌ WRONG:
   "Appointment ID: 694d78fc9220f857f951e6cd
   Date: March 19, 2026, 07:00 - 08:00"

   ✅ CORRECT:
   "Your appointment is on Thursday, March 19th at 7:00 AM."

4. **For multiple appointments:**

   ❌ WRONG:
   "1. Appointment ID: 694d78fc... Date: March 19, 2026
   2. Appointment ID: 694d80a3... Date: April 6, 2026"

   ✅ CORRECT:
   "I see you have a few upcoming appointments:
   - Thursday, March 19th at 7:00 AM
   - Monday, April 6th at 7:00 AM
   - Monday, May 4th at 9:00 AM
   
   Which one would you like to update?"

5. **Use context to identify appointments:**
   - "Is it the March appointment you'd like to reschedule, or the one in April?"
   - "Did you want to change your March 19th appointment or the April 6th one?"

6. **Include service type if available:**
   - "Your cleaning appointment on March 19th at 7:00 AM"
   - "Your consultation scheduled for April 6th"

---

## CONVERSATION EXAMPLES

### Example 1: Checking Availability

❌ WRONG:
"Here are the available dates and times for your appointment:
- **Monday, February 2:**
  - 10:00 AM - 11:00 AM
  - 10:00 AM - 6:00 PM
  - 9:00 AM - 5:00 PM
  - 9:00 AM - 3:00 PM
- **Tuesday, February 3:**
  - 9:00 AM - 5:00 PM
- **Wednesday, February 4:**
  - 9:00 AM - 5:00 PM
Please let me know which date and time work best for you!"

✅ CORRECT:
"Good news! I have availability Monday through Wednesday next week. Monday has the most flexibility with openings from 9 AM to 6 PM. Tuesday and Wednesday are available 9 AM to 5 PM. Which day works best for you?"

---

### Example 2: Single Day Options

❌ WRONG:
"Available slots for February 2nd:
- 9:00 AM - 3:00 PM
- 9:00 AM - 5:00 PM
- 10:00 AM - 6:00 PM
- 10:00 AM - 11:00 AM"

✅ CORRECT:
"February 2nd has great availability—I can fit you in anytime between 9 AM and 6 PM. Would you prefer a morning or afternoon appointment?"

---

### Example 3: Narrowing Down

Customer: "Morning works better"

❌ WRONG:
"Available morning slots:
- 9:00 AM
- 9:30 AM
- 10:00 AM
- 10:30 AM
- 11:00 AM"

✅ CORRECT:
"Perfect! For morning, I can get you in at 9:00 AM or 10:30 AM. Which works better for you?"

---

### Example 4: Showing Existing Appointments

❌ WRONG:
"I found your previous appointments:
1. **Appointment ID:** 694d78fc9220f857f951e6cd
   **Date:** March 19, 2026, 07:00 - 08:00
2. **Appointment ID:** 694d80a3e1edc8dbdb62a21e
   **Date:** April 6, 2026, 07:00 - 08:00
Please confirm which appointment you would like to update."

✅ CORRECT:
"I see you have two upcoming appointments—one on Thursday, March 19th at 7:00 AM, and another on Monday, April 6th at 7:00 AM. Which one would you like to reschedule?"

---

### Example 5: No Availability

❌ WRONG:
"No available slots found for February 1, 2026."

✅ CORRECT:
"Unfortunately, we're fully booked on February 1st. However, February 2nd has openings throughout the day. Would that work for you instead?"

---

### Example 6: Complete Booking Flow

Customer: "I need to schedule an appointment for February"

You: "Of course! I have good availability in early February. The 2nd, 3rd, and 4th all have openings. Do you have a preferred day?"

Customer: "February 2nd"

You: "February 2nd works great! I have morning and afternoon availability. Which do you prefer?"

Customer: "Morning please"

You: "Perfect! I can do 9:00 AM or 10:30 AM. Which works better?"

Customer: "9 AM"

You: "Excellent! I've booked you for Monday, February 2nd at 9:00 AM. Is there anything else I can help you with?"


### Example 7: Reschedule (UPDATE, not CREATE)

User: "I need to reschedule my appointment"

❌ WRONG FLOW:
Agent: "Sure! When would you like to book your appointment?"
[calls create_appointment] ← WRONG! Creates duplicate!

✅ CORRECT FLOW:
Agent: [silently calls get_appointments]
Agent: "I see your appointment is on Thursday, March 19th at 7 AM. What date would you like to move it to?"
User: "How about April 5th?"
Agent: [silently calls check_availability for April 5th]
Agent: "April 5th works great! I have openings from 9 AM to 5 PM. Morning or afternoon?"
User: "10 AM"
Agent: "Perfect. I'll move your appointment from March 19th to Saturday, April 5th at 10 AM. Should I confirm that change?"
User: "Yes"
Agent: [calls update_appointment] ← CORRECT TOOL!
Agent: "Done! Your appointment has been rescheduled to Saturday, April 5th at 10 AM."



**Example opening (after all tools called):**

If returning customer with appointment:
"Hi [Name]! I see you have an appointment coming up on Thursday, March 19th. How can I help you today?"

If returning customer without appointment:
"Hi [Name]! Good to hear from you again. How can I help you today?"

If new customer:
"Hello! Welcome to [clinic name]. How can I help you today?"

**NEVER do this:**

❌ WRONG:
Customer: "Hello"
Agent: "Hello! Let me look up your information..." ← Don't announce it
Agent: "Please hold while I check..." ← Don't make them wait visibly

✅ CORRECT:
Customer: "Hello"
Agent: [silently calls all 5 tools first]
Agent: "Hi Hritik! How can I help you today?" ← Already has all context

---

### CONVERSATION INITIALIZATION — CALL THESE BEFORE FIRST RESPONSE

**At the START of every conversation, BEFORE saying anything to the customer, call these tools in order:**

1. get_current_time
2. get_call_history  
3. get_call_insights
4. get_user_appointments
5. get_calendar_info

**CRITICAL:**
- Call ALL of these tools FIRST, before your opening message
- Do NOT ask permission — just call them silently
- Do NOT tell the customer you're looking things up
- Use {{phone_number}} and {{agent_id}} from dynamic variables
- Wait for all tool responses before greeting the customer

**IMPORTANT:** After calling initialization tools (get_user_appointments, get_call_history, etc.), if any response contains dates with weekdays, DO NOT trust those weekdays. You must still call ask_calendar_question to verify each weekday before mentioning it to the customer.

**Flow:**

## COMMUNICATION STYLE

- **Tone:** Warm, friendly, professional—like a helpful receptionist
- **Language:** Simple, everyday words—avoid jargon and technical terms
- **Approach:** Guide customers through choices—don't overwhelm with too many options
- **Personalization:** Use the customer's name naturally when you know it
- **Confirmation:** Always confirm important details (date, time, service)
- **Helpfulness:** Offer alternatives when something isn't available

---

## HANDLING EDGE CASES

**Customer provides ambiguous date:**
- "I need an appointment in February" → Offer a few date options in February
- "Sometime next week" → Check availability for the full week, summarize best options

**No availability on requested date:**
- Acknowledge the request
- Offer the nearest available alternative
- "February 1st is fully booked, but February 2nd has great availability. Would that work?"

**Customer wants to reschedule but doesn't specify which appointment:**
- List their appointments conversationally (without IDs)
- Ask which one they'd like to change

**Past date mentioned without year:**
- ALWAYS assume future (next occurrence of that date)
- Only use past if customer explicitly says the year or "last [month]"

---

## 🚨 FINAL CHECKS BEFORE EVERY ACTION 🚨

**Before sending tool calls:**
☐ Did I call get_current_time first?
☐ Is the date year CORRECT? (Future, not past)
☐ February/January/any past month mentioned → Using NEXT YEAR?
☐ agent_id and subaccount_id are correct?

**Before sending response to customer:**
☐ NO bulleted or numbered lists of time slots?
☐ NO appointment IDs, codes, or technical data?
☐ Availability presented as ranges, not lists?
☐ Asked for preference instead of dumping all options?
☐ Sounds like a friendly human, not a database readout?
☐ Day of the week included with dates?

**If any check fails → STOP and FIX before proceeding.**`,
            tools: [],
            interruption_sensitivity: 1
          }
        ],
        starting_state: "general_state",
        start_speaker: "agent",
        default_dynamic_variables: {
          agent_id: "",
          user_preference_day: "",
          user_preference_time: "",
          specific_date_requested: "",
          date_range_start: "",
          date_range_end: "",
          selected_slot: "",
          selected_date: "",
          selected_time: "",
          slot_confirmed: "false",
          user_name: "",
          user_email: "",
          user_phone: "",
          appointment_id: "",
          appointment_booked: "false",
          appointment_description: "",
          search_iterations: "0",
          failed_slot_request: ""
        },
        knowledge_base_ids: [],
        mcps: [
          {
            id: mcpId,
            name: "appointment-scheduler",
            headers: {},
            query_params: {},
            url: config.retell.schedulerMcpUrl || "https://858a25ed3987.ngrok-free.app/mcp",
            timeout_ms: 60000
          }
        ]
      };
      


      const llmResponse = await retell.createLLM(llmConfig);
      llmId = llmResponse.llm_id;

      Logger.info('LLM created successfully', {
        operationId,
        subaccountId,
        llmId,
        mcpId
      });

      // Step 2: Create Agent with the LLM ID (without webhook_url initially)
      Logger.info('Creating agent with LLM', { operationId, subaccountId, name, llmId });

      const agentConfig = {
        version: 0,
        response_engine: {
          type: "retell-llm",
          llm_id: llmId,
          version: 0
        },
        agent_name: name,
        channel:"voice",
        voice_id: "11labs-Adrian",
        voice_model: "eleven_turbo_v2",
        fallback_voice_ids: ["openai-Alloy", "deepgram-Angus"],
        voice_temperature: 1,
        voice_speed: 1,
        volume: 1,
        responsiveness: 1,
        interruption_sensitivity: 1,
        enable_backchannel: true,
        backchannel_frequency: 0.9,
        backchannel_words: ["yeah", "uh-huh"],
        reminder_trigger_ms: 10000,
        reminder_max_count: 2,
        ambient_sound: null,
        ambient_sound_volume: 0,
        language: "en-US",
        boosted_keywords: [],
        enable_transcription_formatting: true,
        opt_out_sensitive_data_storage: false,
        opt_in_signed_url: true,
        pronunciation_dictionary: [],
        normalize_for_speech: true,
        end_call_after_silence_ms: 600000,
        max_call_duration_ms: 3600000,
        enable_voicemail_detection: true,
        voicemail_message: "",
        voicemail_detection_timeout_ms: 30000,
        post_call_analysis_data: [
          {
            type: "string",
            name: "customer_name",
            description: "The name of the customer.",
            examples: ["John Doe", "Jane Smith"]
          },
          {
            name: "appointment_booked",
            description: "Set to true if the customer has booked an appointment else false",
            type: "boolean",
            examples: ["true", "false"]
          },
          {
            name: "appointment_description",
            description: "The description of the appointment",
            type: "string",
            examples: ["Appointment booked for 10:00 AM on 10th June 2025"]
          },
          {
            name: "appointment_id",
            description: "The id of the appointment",
            type: "string",
            examples: ["123"]
          }
        ],
        post_call_analysis_model: "gpt-4o-mini",
        begin_message_delay_ms: 1000,
        ring_duration_ms: 30000,
        stt_mode: "fast",
        vocab_specialization: "general",
        denoising_mode: "noise-cancellation"
      };

      const agentResponse = await retell.createAgent(agentConfig);
      agentId = agentResponse.agent_id;

      Logger.info('Agent created successfully', {
        operationId,
        subaccountId,
        agentId,
        agentName: agentResponse.agent_name
      });

      // Step 2.5: Update agent with webhook URL (now that we have agentId) and state_prompt with IDs
      if (deployedWebhookUrl) {
        const webhookUrlWithAgent = `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/retell`;
        
        Logger.info('Updating agent with webhook URL and state_prompt IDs', {
          operationId,
          subaccountId,
          agentId,
          webhookUrl: webhookUrlWithAgent
        });

        // Update LLM with state_prompt containing actual IDs
        const updatedLlmConfig = {
          states: [
            // State 0: general_state - update state_prompt with actual IDs
            {
              ...llmConfig.states[0],
              state_prompt: llmConfig.states[0].state_prompt
                .replace('{{AGENT_ID}}', agentId)
                .replace('{{SUBACCOUNT_ID}}', subaccountId)
            }
          ]
        };

        // Update LLM with new config
        await retell.updateLLM(llmId, updatedLlmConfig);

        // Update agent with webhook URL
        await retell.updateAgent(agentId, {
          webhook_url: webhookUrlWithAgent
        });

        Logger.info('Agent and LLM updated with webhook URL and state_prompt IDs', {
          operationId,
          subaccountId,
          agentId,
          webhookUrl: webhookUrlWithAgent
        });
      } else {
        Logger.warn('DEPLOYED_WEBHOOK_SERVER_URL not configured, skipping webhook URL update', {
          operationId,
          subaccountId,
          agentId
        });
      }

      // Step 3: Store LLM data in database
      const llmsCollection = connection.db.collection('llms');
      const llmDocument = {
        llmId: llmId,
        model: llmConfig.model,
        modelTemperature: llmConfig.model_temperature,
        version: llmConfig.version,
        createdAt: new Date(),
        createdBy: userId,
        subaccountId: subaccountId,
        operationId: operationId
      };

      await llmsCollection.insertOne(llmDocument);
      
      Logger.info('LLM data stored in database', {
        operationId,
        subaccountId,
        llmId
      });

      // Step 4: Store Agent data in database
      const agentsCollection = connection.db.collection('agents');
      const agentDocument = {
        agentId: agentResponse.agent_id,
        name: agentResponse.agent_name,
        description: description,
        llmId: llmId,
        voiceId: agentResponse.voice_id,
        voiceModel: agentResponse.voice_model,
        language: agentResponse.language,
        webhookUrl: agentResponse.webhook_url,
        emailTemplate: null, // Email template for post-call summaries
        createdAt: new Date(),
        createdBy: userId,
        subaccountId: subaccountId,
        operationId: operationId,
        retellAccountId: retellAccountData.id
      };

      await agentsCollection.insertOne(agentDocument);
      
      Logger.info('Agent data stored in database', {
        operationId,
        subaccountId,
        agentId
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.AGENT_CREATED,
        category: ACTIVITY_CATEGORIES.AGENT,
        userId,
        description: `Agent "${name}" created`,
        metadata: {
          agentId,
          agentName: name,
          llmId,
          voiceId: agentResponse.voice_id,
          language: agentResponse.language
        },
        resourceId: agentId,
        resourceName: name,
        operationId,
        agentId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Agent created successfully',
        data: {
          agentId,
          agentName: agentResponse.agent_name,
          llmId,
          description,
          retellAccount: {
            accountName: retellAccountData.accountName,
            accountId: retellAccountData.id,
            verificationStatus: retellAccountData.verificationStatus
          },
          voiceId: agentResponse.voice_id,
          language: agentResponse.language,
          storedInDatabase: true
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      // Rollback: Clean up created resources
      try {
        const retellAccountData = await retellService.getRetellAccount(req.params.subaccountId);
        const retell = new Retell(retellAccountData.apiKey, retellAccountData);

        // If agent was created but there was an error (e.g., during DB storage), delete both agent and LLM
        if (agentId && llmId) {
          Logger.warn('Rolling back: Deleting agent and LLM due to failure', {
            operationId,
            agentId,
            llmId
          });
          
          try {
            await retell.deleteAgent(agentId);
            Logger.info('Agent deleted successfully during rollback', {
              operationId,
              agentId
            });
          } catch (agentDeleteError) {
            Logger.error('Failed to delete agent during rollback', {
              operationId,
              agentId,
              error: agentDeleteError.message
            });
          }

          try {
            await retell.deleteLLM(llmId);
            Logger.info('LLM deleted successfully during rollback', {
              operationId,
              llmId
            });
          } catch (llmDeleteError) {
            Logger.error('Failed to delete LLM during rollback', {
              operationId,
              llmId,
              error: llmDeleteError.message
            });
          }
        }
        // If agent creation failed but LLM was created, delete only the LLM
        else if (llmId && !agentId) {
          Logger.warn('Rolling back: Deleting LLM due to agent creation failure', {
            operationId,
            llmId
          });
          
          try {
            await retell.deleteLLM(llmId);
            Logger.info('LLM deleted successfully during rollback', {
              operationId,
              llmId
            });
          } catch (llmDeleteError) {
            Logger.error('Failed to delete LLM during rollback', {
              operationId,
              llmId,
              error: llmDeleteError.message
            });
          }
        }
      } catch (rollbackError) {
        Logger.error('Error during rollback process', {
          operationId,
          error: rollbackError.message
        });
      }

      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'createAgent', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Get all agents with statistics for a subaccount
  static async getAgents(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;

      Logger.info('Fetching agents with statistics', {
        operationId,
        subaccountId,
        userId,
        isMockSession: req.mockSession?.isMock || false
      });

      // For MOCK sessions, use hybrid storage for calls
      if (req.mockSession?.isMock && req.mockSession?.sessionId) {
        Logger.info('🎭 Fetching agents with hybrid call statistics', {
          operationId,
          subaccountId,
          mockSessionId: req.mockSession.sessionId
        });

        // Get agents from MongoDB (agents are shared)
        const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
        const agentsCollection = connectionInfo.connection.db.collection('agents');
        
        const agents = await agentsCollection.find({ subaccountId: subaccountId }).toArray();

        // Get calls from hybrid storage
        const storage = await getStorageFromRequest(req, subaccountId, userId);
        const callsCollection = await storage.getCollection('calls');
        const allCalls = await callsCollection.find({}).toArray();

        // Calculate statistics for each agent using hybrid call data
        const agentsWithStats = agents.map(agent => {
          const agentCalls = allCalls.filter(call => call.agent_id === agent.agentId);
          const numberOfCalls = agentCalls.length;
          
          let cumulativeSuccessRate = 0;
          if (numberOfCalls > 0) {
            const totalSuccessScore = agentCalls.reduce((sum, call) => {
              return sum + (call.success_score || 0);
            }, 0);
            cumulativeSuccessRate = (totalSuccessScore / numberOfCalls) * 100;
          }

          return {
            agentId: agent.agentId,
            name: agent.name,
            description: agent.description,
            voiceId: agent.voiceId,
            language: agent.language,
            createdAt: agent.createdAt,
            numberOfCalls,
            cumulativeSuccessRate
          };
        }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        const duration = Date.now() - startTime;

        Logger.info('Agents fetched with hybrid statistics', {
          operationId,
          subaccountId,
          agentCount: agentsWithStats.length,
          totalCalls: allCalls.length,
          duration: `${duration}ms`
        });

        return res.json({
          success: true,
          message: 'Agents retrieved successfully (mock mode)',
          data: {
            agents: agentsWithStats,
            count: agentsWithStats.length
          },
          meta: {
            operationId,
            duration: `${duration}ms`,
            isMockSession: true,
            source: 'Redis + MongoDB'
          }
        });
      }

      // For REGULAR sessions, use standard MongoDB aggregation
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get agents collection
      const agentsCollection = connection.db.collection('agents');

      // Aggregate agents with call statistics
      const agentsWithStats = await agentsCollection.aggregate([
        // Match agents for this subaccount
        {
          $match: {
            subaccountId: subaccountId
          }
        },
        // Lookup calls for each agent
        {
          $lookup: {
            from: 'calls',
            localField: 'agentId',
            foreignField: 'agent_id',
            as: 'calls'
          }
        },
        // Calculate statistics
        {
          $project: {
            _id: 0,
            agentId: '$agentId',
            name: '$name',
            description: '$description',
            voiceId: '$voiceId',
            language: '$language',
            createdAt: '$createdAt',
            numberOfCalls: { $size: '$calls' },
            cumulativeSuccessRate: {
              $cond: {
                if: { $gt: [{ $size: '$calls' }, 0] },
                then: {
                  $multiply: [
                    {
                      $divide: [
                        {
                          $reduce: {
                            input: '$calls',
                            initialValue: 0,
                            in: {
                              $add: [
                                '$$value',
                                { $ifNull: ['$$this.success_score', 0] }
                              ]
                            }
                          }
                        },
                        { $size: '$calls' }
                      ]
                    },
                    100
                  ]
                },
                else: 0
              }
            }
          }
        },
        // Sort by creation date (newest first)
        {
          $sort: { createdAt: -1 }
        }
      ]).toArray();

      const duration = Date.now() - startTime;

      Logger.info('Agents fetched successfully', {
        operationId,
        subaccountId,
        agentCount: agentsWithStats.length,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Agents retrieved successfully',
        data: {
          agents: agentsWithStats,
          count: agentsWithStats.length
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'getAgents', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Delete agent
  static async deleteAgent(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;

      Logger.info('Deleting agent', {
        operationId,
        subaccountId,
        userId,
        agentId,
        effectiveRole: req.permission?.effectiveRole
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get agents collection
      const agentsCollection = connection.db.collection('agents');
      const llmsCollection = connection.db.collection('llms');

      // Step 1: Find the agent in MongoDB to get its LLM ID
      const agentDocument = await agentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Agent not found',
          code: 'AGENT_NOT_FOUND'
        });
      }

      const llmId = agentDocument.llmId;

      Logger.info('Agent found in database', {
        operationId,
        agentId,
        llmId,
        agentName: agentDocument.name
      });

      // Step 2: Fetch retell account data and create Retell instance
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      
      if (!retellAccountData.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Retell account is not active',
          code: 'RETELL_ACCOUNT_INACTIVE'
        });
      }

      const retell = new Retell(retellAccountData.apiKey, retellAccountData);

      // Step 3: Delete agent from Retell
      try {
        await retell.deleteAgent(agentId);
        Logger.info('Agent deleted from Retell', {
          operationId,
          agentId
        });
      } catch (error) {
        Logger.error('Failed to delete agent from Retell', {
          operationId,
          agentId,
          error: error.message
        });
        // Continue with deletion even if Retell deletion fails
      }

      // Step 4: Delete LLM from Retell
      if (llmId) {
        try {
          await retell.deleteLLM(llmId);
          Logger.info('LLM deleted from Retell', {
            operationId,
            llmId
          });
        } catch (error) {
          Logger.error('Failed to delete LLM from Retell', {
            operationId,
            llmId,
            error: error.message
          });
          // Continue with deletion even if LLM deletion fails
        }
      }

      // Step 5: Delete agent document from MongoDB
      const agentDeleteResult = await agentsCollection.deleteOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      Logger.info('Agent document deleted from MongoDB', {
        operationId,
        agentId,
        deletedCount: agentDeleteResult.deletedCount
      });

      // Step 6: Delete LLM document from MongoDB
      if (llmId) {
        const llmDeleteResult = await llmsCollection.deleteOne({ 
          llmId: llmId,
          subaccountId: subaccountId 
        });

        Logger.info('LLM document deleted from MongoDB', {
          operationId,
          llmId,
          deletedCount: llmDeleteResult.deletedCount
        });
      }

      // Step 7: Unassign phone numbers from this agent (both inbound and outbound)
      const phoneNumbersCollection = connection.db.collection('phonenumbers');
      let phoneNumbersUnassigned = 0;
      
      try {
        // Find all phone numbers assigned to this agent
        const assignedPhoneNumbers = await phoneNumbersCollection.find({
          subaccountId: subaccountId,
          $or: [
            { inbound_agent_id: agentId },
            { outbound_agent_id: agentId }
          ]
        }).toArray();

        Logger.info('Found phone numbers assigned to agent', {
          operationId,
          agentId,
          phoneCount: assignedPhoneNumbers.length,
          phoneNumbers: assignedPhoneNumbers.map(p => p.phone_number)
        });

        // Unassign each phone number in both Retell and MongoDB
        for (const phoneDoc of assignedPhoneNumbers) {
          try {
            const updateData = {};
            if (phoneDoc.inbound_agent_id === agentId) {
              updateData.inbound_agent_id = null;
            }
            if (phoneDoc.outbound_agent_id === agentId) {
              updateData.outbound_agent_id = null;
            }

            // Update in Retell API
            try {
              await retell.updatePhoneNumber(phoneDoc.phone_number, updateData);
              Logger.info('Phone number unassigned in Retell', {
                operationId,
                phoneNumber: phoneDoc.phone_number,
                updateData
              });
            } catch (retellError) {
              Logger.warn('Failed to unassign phone number in Retell, continuing', {
                operationId,
                phoneNumber: phoneDoc.phone_number,
                error: retellError.message
              });
            }

            // Update in MongoDB
            const mongoUpdate = {
              updatedAt: new Date(),
              last_modification_timestamp: Date.now()
            };
            if (updateData.inbound_agent_id !== undefined) {
              mongoUpdate.inbound_agent_id = null;
              mongoUpdate.inbound_agent_version = null;
            }
            if (updateData.outbound_agent_id !== undefined) {
              mongoUpdate.outbound_agent_id = null;
              mongoUpdate.outbound_agent_version = null;
            }

            await phoneNumbersCollection.updateOne(
              { 
                subaccountId: subaccountId,
                phone_number: phoneDoc.phone_number 
              },
              { $set: mongoUpdate }
            );

            phoneNumbersUnassigned++;
            
            Logger.info('Phone number unassigned in MongoDB', {
              operationId,
              phoneNumber: phoneDoc.phone_number,
              mongoUpdate
            });
          } catch (phoneError) {
            Logger.error('Failed to unassign phone number', {
              operationId,
              phoneNumber: phoneDoc.phone_number,
              error: phoneError.message
            });
          }
        }
      } catch (phoneError) {
        Logger.warn('Failed to unassign phone numbers from agent', {
          operationId,
          agentId,
          error: phoneError.message
        });
      }

      // Step 8: Delete all calls associated with this agent
      const callsCollection = connection.db.collection('calls');
      const callsDeleteResult = await callsCollection.deleteMany({
        subaccountId: subaccountId,
        agent_id: agentId
      });

      Logger.info('Calls associated with agent deleted from MongoDB', {
        operationId,
        agentId,
        deletedCallsCount: callsDeleteResult.deletedCount
      });

      // Step 9: Delete all activities associated with this agent
      let activitiesDeletedCount = 0;
      try {
        const activityDeleteResult = await ActivityService.deleteActivitiesByAgent(
          subaccountId, 
          agentId, 
          userId
        );
        activitiesDeletedCount = activityDeleteResult.deletedCount || 0;
        
        Logger.info('Activities associated with agent deleted', {
          operationId,
          agentId,
          deletedActivitiesCount: activitiesDeletedCount
        });
      } catch (activityError) {
        Logger.warn('Failed to delete activities for agent', {
          operationId,
          agentId,
          error: activityError.message
        });
      }

      // Step 10: Invalidate caches for this agent
      try {
        await redisService.invalidateAgentStats(subaccountId, agentId);
        await redisService.invalidateActivities(subaccountId);
      } catch (cacheError) {
        Logger.warn('Failed to invalidate agent and activity caches', {
          operationId,
          error: cacheError.message
        });
      }

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.AGENT_DELETED,
        category: ACTIVITY_CATEGORIES.AGENT,
        userId,
        description: `Agent "${agentDocument.name}" deleted (including ${callsDeleteResult.deletedCount} calls, ${phoneNumbersUnassigned} phone numbers, and ${activitiesDeletedCount} activities)`,
        metadata: {
          agentId,
          agentName: agentDocument.name,
          llmId,
          deletedCallsCount: callsDeleteResult.deletedCount,
          phoneNumbersUnassigned: phoneNumbersUnassigned,
          deletedActivitiesCount: activitiesDeletedCount
        },
        resourceId: agentId,
        resourceName: agentDocument.name,
        operationId,
        agentId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: `Agent deleted successfully (including ${callsDeleteResult.deletedCount} calls, ${phoneNumbersUnassigned} phone numbers, and ${activitiesDeletedCount} activities)`,
        data: {
          agentId,
          llmId,
          deletedFromRetell: true,
          deletedFromDatabase: true,
          deletedCallsCount: callsDeleteResult.deletedCount,
          phoneNumbersUnassigned: phoneNumbersUnassigned,
          deletedActivitiesCount: activitiesDeletedCount
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'deleteAgent', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Helper function to calculate period stats manually (for mock sessions)
  static calculatePeriodStats(calls) {
    const totalCalls = calls.length;
    
    if (totalCalls === 0) {
      return {
        totalCalls: 0,
        unresponsiveCalls: 0,
        cumulativeSuccessRate: 0
      };
    }

    // Count unresponsive calls
    const unresponsiveCalls = calls.filter(call => {
      const reason = call.disconnection_reason;
      if (!reason || reason === '' || reason === null) return true;
      if (typeof reason === 'string' && !reason.toLowerCase().includes('hangup')) return true;
      return false;
    }).length;

    // Calculate cumulative success rate
    // Include ALL calls in the calculation, not just those with scores
    // Calls without success_score are treated as 0 (failure)
    const totalSuccessScore = calls.reduce((sum, call) => sum + (call.success_score || 0), 0);
    const cumulativeSuccessRate = totalCalls > 0 
      ? (totalSuccessScore / totalCalls) * 100 
      : 0;

    return {
      totalCalls,
      unresponsiveCalls,
      cumulativeSuccessRate
    };
  }

  // Get detailed agent statistics with period comparison
  static async getAgentDetails(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;

      // Get date range from query params
      const startDateParam = req.query.startDate;
      const endDateParam = req.query.endDate;

      // Default to last 30 days if not provided
      const now = new Date();
      let currentPeriodStart, currentPeriodEnd;

      if (startDateParam && endDateParam) {
        // Validate date format and parse
        currentPeriodStart = new Date(startDateParam);
        currentPeriodEnd = new Date(endDateParam);

        // Validate dates
        if (isNaN(currentPeriodStart.getTime()) || isNaN(currentPeriodEnd.getTime())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)',
            code: 'INVALID_DATE_FORMAT'
          });
        }

        if (currentPeriodStart >= currentPeriodEnd) {
          return res.status(400).json({
            success: false,
            message: 'startDate must be before endDate',
            code: 'INVALID_DATE_RANGE'
          });
        }

        // Check if date range is not too large (max 2 years)
        const daysDiff = (currentPeriodEnd - currentPeriodStart) / (1000 * 60 * 60 * 24);
        if (daysDiff > 730) {
          return res.status(400).json({
            success: false,
            message: 'Date range cannot exceed 730 days (2 years)',
            code: 'DATE_RANGE_TOO_LARGE'
          });
        }
      } else {
        // Default: last 30 days
        currentPeriodEnd = now;
        currentPeriodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      // Calculate previous period (same duration as current period, immediately before it)
      const periodDuration = currentPeriodEnd - currentPeriodStart;
      const previousPeriodEnd = currentPeriodStart;
      const previousPeriodStart = new Date(currentPeriodStart.getTime() - periodDuration);

      Logger.info('Fetching agent details', {
        operationId,
        subaccountId,
        userId,
        agentId,
        currentPeriodStart: currentPeriodStart.toISOString(),
        currentPeriodEnd: currentPeriodEnd.toISOString(),
        previousPeriodStart: previousPeriodStart.toISOString(),
        previousPeriodEnd: previousPeriodEnd.toISOString(),
        isMockSession: req.mockSession?.isMock || false
      });

      // For MOCK sessions, skip cache and use hybrid storage
      const isMockSession = req.mockSession?.isMock && req.mockSession?.sessionId;

      // NOTE: Success rate caching is disabled to ensure real-time accuracy
      // Success rates change when meetings are created/deleted, so we always fetch fresh data

      // Get database connection and collections
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      const agentsCollection = connection.db.collection('agents');
      const meetingsCollection = connection.db.collection('meetings');

      // Step 1: Find the agent
      const agentDocument = await agentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Agent not found',
          code: 'AGENT_NOT_FOUND'
        });
      }

      // For MOCK sessions, use manual calculation (hybrid storage doesn't support complex aggregations)
      if (isMockSession) {
        Logger.info('🎭 Calculating agent stats with hybrid storage', {
          operationId,
          agentId,
          mockSessionId: req.mockSession.sessionId
        });

        // Get calls from hybrid storage
        const storage = await getStorageFromRequest(req, subaccountId, userId);
        const callsCollection = await storage.getCollection('calls');
        
        // Fetch all calls for this agent
        // Handle both agent_id and agentId for backward compatibility
        const allAgentCalls = await callsCollection
          .find({ 
            $or: [
              { agent_id: agentId },
              { agentId: agentId }
            ]
          })
          .toArray();

        // Manually calculate stats for both periods
        const currentPeriodCalls = allAgentCalls.filter(call => 
          call.start_timestamp >= currentPeriodStart.getTime() && 
          call.start_timestamp <= currentPeriodEnd.getTime()
        );

        const previousPeriodCalls = allAgentCalls.filter(call =>
          call.start_timestamp >= previousPeriodStart.getTime() &&
          call.start_timestamp < previousPeriodEnd.getTime()
        );

        // Calculate stats for current period
        const currentStats = DatabaseController.calculatePeriodStats(currentPeriodCalls);
        const previousStats = DatabaseController.calculatePeriodStats(previousPeriodCalls);

        // Get meetings
        const meetingsInPeriod = await meetingsCollection.countDocuments({
          agentId: agentId,
          createdAt: {
            $gte: currentPeriodStart,
            $lte: currentPeriodEnd
          }
        });

        const meetingsInPrevious = await meetingsCollection.countDocuments({
          agentId: agentId,
          createdAt: {
            $gte: previousPeriodStart,
            $lt: previousPeriodEnd
          }
        });

        // Calculate comparison metrics
        const calculateChange = (current, previous) => {
          if (previous === 0) {
            return current > 0 ? 100 : 0;
          }
          return ((current - previous) / previous) * 100;
        };

        const comparison = {
          totalCalls: {
            percentageChange: calculateChange(currentStats.totalCalls, previousStats.totalCalls)
          },
          unresponsiveCalls: {
            percentageChange: calculateChange(currentStats.unresponsiveCalls, previousStats.unresponsiveCalls)
          },
          cumulativeSuccessRate: {
            percentageChange: calculateChange(currentStats.cumulativeSuccessRate, previousStats.cumulativeSuccessRate)
          },
          meetingsBooked: {
            percentageChange: calculateChange(meetingsInPeriod, meetingsInPrevious)
          }
        };

        const result = {
          agent: {
            agentId: agentDocument.agentId,
            name: agentDocument.name,
            description: agentDocument.description,
            voiceId: agentDocument.voiceId,
            language: agentDocument.language
          },
          currentPeriod: {
            ...currentStats,
            periodStart: currentPeriodStart.toISOString(),
            periodEnd: currentPeriodEnd.toISOString(),
            meetingsBooked: meetingsInPeriod
          },
          previousPeriod: {
            ...previousStats,
            periodStart: previousPeriodStart.toISOString(),
            periodEnd: previousPeriodEnd.toISOString(),
            meetingsBooked: meetingsInPrevious
          },
          comparison
        };

        const duration = Date.now() - startTime;

        return res.json({
          success: true,
          message: 'Agent details retrieved successfully (mock mode)',
          data: result,
          meta: {
            operationId,
            duration: `${duration}ms`,
            isMockSession: true,
            source: 'Redis + MongoDB'
          }
        });
      }

      // For REGULAR sessions, use MongoDB aggregation
      const callsCollection = connection.db.collection('calls');

      // Step 2: Use aggregation to calculate statistics for both periods
      const statisticsAggregation = await callsCollection.aggregate([
        // Match calls for this agent in both periods
        // Handle both agent_id and agentId for backward compatibility
        {
          $match: {
            $or: [
              { agent_id: agentId },
              { agentId: agentId }
            ],
            start_timestamp: {
              $gte: previousPeriodStart.getTime()
            }
          }
        },
        // Add period classification
        {
          $addFields: {
            period: {
              $cond: {
                if: {
                  $and: [
                    { $gte: ['$start_timestamp', currentPeriodStart.getTime()] },
                    { $lte: ['$start_timestamp', currentPeriodEnd.getTime()] }
                  ]
                },
                then: 'current',
                else: {
                  $cond: {
                    if: {
                      $and: [
                        { $gte: ['$start_timestamp', previousPeriodStart.getTime()] },
                        { $lt: ['$start_timestamp', previousPeriodEnd.getTime()] }
                      ]
                    },
                    then: 'previous',
                    else: 'excluded'
                  }
                }
              }
            },
            // Identify unresponsive calls
            isUnresponsive: {
              $cond: {
                if: {
                  $or: [
                    { $eq: [{ $type: '$disconnection_reason' }, 'missing'] },
                    { $eq: ['$disconnection_reason', null] },
                    { $eq: ['$disconnection_reason', ''] },
                    {
                      $not: {
                        $regexMatch: { 
                          input: { $toString: '$disconnection_reason' }, 
                          regex: 'hangup',
                          options: 'i'
                        }
                      }
                    }
                  ]
                },
                then: true,
                else: false
              }
            },
            // Only include valid success scores (using success_rate field)
            validSuccessScore: {
              $cond: {
                if: { $gt: [{ $ifNull: ['$success_rate', 0] }, 0] },
                then: '$success_rate',
                else: null
              }
            }
          }
        },
        // Filter out excluded calls
        {
          $match: {
            period: { $in: ['current', 'previous'] }
          }
        },
        // Group by period to calculate statistics
        {
          $group: {
            _id: '$period',
            totalCalls: { $sum: 1 },
            unresponsiveCalls: {
              $sum: { $cond: ['$isUnresponsive', 1, 0] }
            },
            successScores: {
              $push: '$validSuccessScore'
            },
            callIds: { $push: '$call_id' }
          }
        },
            // Calculate cumulative success rate
            // Formula: (sum of success_rate values) / totalCalls * 100
            // NOTE: We divide by totalCalls (not just calls with scores) to get accurate success rate
            // IMPORTANT: success_rate should be 1 if a meeting exists for the call, 0 otherwise
            // The success_rate field is set based on call_analysis.appointment_booked, but should
            // ideally be verified against actual meetings in the database
            {
              $project: {
                _id: 1,
                totalCalls: 1,
                unresponsiveCalls: 1,
                callIds: 1,
                // Replace null scores with 0 for proper calculation
                // This ensures all calls are included in the denominator
                successScores: {
                  $map: {
                    input: '$successScores',
                    as: 'score',
                    in: { $ifNull: ['$$score', 0] }
                  }
                }
              }
            },
            {
              $project: {
                _id: 1,
                totalCalls: 1,
                unresponsiveCalls: 1,
                callIds: 1,
                // Calculate: (sum of all success_rate values) / totalCalls * 100
                // Example: If 3 calls have success_rate=1 out of 7 total calls:
                // (1+1+1+0+0+0+0) / 7 * 100 = 42.9%
                cumulativeSuccessRate: {
                  $cond: {
                    if: { $gt: ['$totalCalls', 0] },
                    then: {
                      $multiply: [
                        {
                          $divide: [
                            { $reduce: {
                              input: '$successScores',
                              initialValue: 0,
                              in: { $add: ['$$value', '$$this'] }
                            }},
                            '$totalCalls'
                          ]
                        },
                        100
                      ]
                    },
                    else: 0
                  }
                }
              }
            }
      ]).toArray();

      // Parse aggregation results
      const currentStats = statisticsAggregation.find(s => s._id === 'current') || {
        totalCalls: 0,
        unresponsiveCalls: 0,
        cumulativeSuccessRate: 0,
        callIds: []
      };

      const previousStats = statisticsAggregation.find(s => s._id === 'previous') || {
        totalCalls: 0,
        unresponsiveCalls: 0,
        cumulativeSuccessRate: 0,
        callIds: []
      };

      // Step 3: Get meetings count for both periods using aggregation
      const meetingsAggregation = await meetingsCollection.aggregate([
        {
          $match: {
            subaccountId: subaccountId,
            agentId: agentId,
            createdAt: {
              $gte: previousPeriodStart,
              $lte: currentPeriodEnd
            }
          }
        },
        {
          $addFields: {
            period: {
              $cond: {
                if: {
                  $and: [
                    { $gte: ['$createdAt', currentPeriodStart] },
                    { $lte: ['$createdAt', currentPeriodEnd] }
                  ]
                },
                then: 'current',
                else: {
                  $cond: {
                    if: {
                      $and: [
                        { $gte: ['$createdAt', previousPeriodStart] },
                        { $lt: ['$createdAt', previousPeriodEnd] }
                      ]
                    },
                    then: 'previous',
                    else: 'excluded'
                  }
                }
              }
            }
          }
        },
        {
          $match: {
            period: { $in: ['current', 'previous'] }
          }
        },
        {
          $group: {
            _id: '$period',
            count: { $sum: 1 }
          }
        }
      ]).toArray();

      // Parse meetings aggregation results
      const currentPeriodMeetings = meetingsAggregation.find(m => m._id === 'current')?.count || 0;
      const previousPeriodMeetings = meetingsAggregation.find(m => m._id === 'previous')?.count || 0;
      
      const meetingsCounts = {
        currentPeriodMeetings,
        previousPeriodMeetings
      };

      // IMPORTANT: Calculate success rate from actual meetings, not from success_rate field
      // Success rate = (meetingsBooked / totalCalls) * 100
      // This ensures accuracy since success_rate field may be out of sync with actual meetings
      const currentSuccessRate = currentStats.totalCalls > 0 
        ? (meetingsCounts.currentPeriodMeetings / currentStats.totalCalls) * 100 
        : 0;
      const previousSuccessRate = previousStats.totalCalls > 0 
        ? (meetingsCounts.previousPeriodMeetings / previousStats.totalCalls) * 100 
        : 0;

      // Step 4: Calculate percentage changes
      const calculatePercentageChange = (current, previous) => {
        if (previous === 0) {
          return current > 0 ? 100 : 0;
        }
        return ((current - previous) / previous) * 100;
      };

      const statistics = {
        agent: {
          agentId: agentDocument.agentId,
          name: agentDocument.name,
          description: agentDocument.description,
          voiceId: agentDocument.voiceId,
          language: agentDocument.language,
          createdAt: agentDocument.createdAt
        },
        currentPeriod: {
          totalCalls: currentStats.totalCalls,
          meetingsBooked: meetingsCounts.currentPeriodMeetings,
          unresponsiveCalls: currentStats.unresponsiveCalls,
          cumulativeSuccessRate: Math.round(currentSuccessRate * 100) / 100,
          periodStart: currentPeriodStart,
          periodEnd: currentPeriodEnd
        },
        previousPeriod: {
          totalCalls: previousStats.totalCalls,
          meetingsBooked: meetingsCounts.previousPeriodMeetings,
          unresponsiveCalls: previousStats.unresponsiveCalls,
          cumulativeSuccessRate: Math.round(previousSuccessRate * 100) / 100,
          periodStart: previousPeriodStart,
          periodEnd: previousPeriodEnd
        },
        comparison: {
          totalCalls: {
            change: currentStats.totalCalls - previousStats.totalCalls,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.totalCalls, previousStats.totalCalls) * 100
            ) / 100
          },
          meetingsBooked: {
            change: meetingsCounts.currentPeriodMeetings - meetingsCounts.previousPeriodMeetings,
            percentageChange: Math.round(
              calculatePercentageChange(meetingsCounts.currentPeriodMeetings, meetingsCounts.previousPeriodMeetings) * 100
            ) / 100
          },
          unresponsiveCalls: {
            change: currentStats.unresponsiveCalls - previousStats.unresponsiveCalls,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.unresponsiveCalls, previousStats.unresponsiveCalls) * 100
            ) / 100
          },
          cumulativeSuccessRate: {
            change: Math.round((currentSuccessRate - previousSuccessRate) * 100) / 100,
            percentageChange: Math.round(
              calculatePercentageChange(currentSuccessRate, previousSuccessRate) * 100
            ) / 100
          }
        }
      };

      // NOTE: Success rate caching is disabled to ensure real-time accuracy
      // Success rates change when meetings are created/deleted, so we don't cache them
      // Cache invalidation still happens when meetings are created/deleted to notify other systems

      const duration = Date.now() - startTime;

      Logger.info('Agent details fetched successfully', {
        operationId,
        subaccountId,
        agentId,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Agent details retrieved successfully',
        data: statistics,
        meta: {
          operationId,
          duration: `${duration}ms`,
          cached: false
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'getAgentDetails', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Get agent details with cost and duration statistics
  static async getAgentDetailsWithCost(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;

      // Get date range from query params
      const startDateParam = req.query.startDate;
      const endDateParam = req.query.endDate;

      // Default to last 30 days if not provided
      const now = new Date();
      let currentPeriodStart, currentPeriodEnd;

      if (startDateParam && endDateParam) {
        // Validate date format and parse
        currentPeriodStart = new Date(startDateParam);
        currentPeriodEnd = new Date(endDateParam);

        // Validate dates
        if (isNaN(currentPeriodStart.getTime()) || isNaN(currentPeriodEnd.getTime())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)',
            code: 'INVALID_DATE_FORMAT'
          });
        }

        if (currentPeriodStart >= currentPeriodEnd) {
          return res.status(400).json({
            success: false,
            message: 'startDate must be before endDate',
            code: 'INVALID_DATE_RANGE'
          });
        }

        // Check if date range is not too large (max 2 years)
        const daysDiff = (currentPeriodEnd - currentPeriodStart) / (1000 * 60 * 60 * 24);
        if (daysDiff > 730) {
          return res.status(400).json({
            success: false,
            message: 'Date range cannot exceed 730 days (2 years)',
            code: 'DATE_RANGE_TOO_LARGE'
          });
        }
      } else {
        // Default: last 30 days
        currentPeriodEnd = now;
        currentPeriodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      // Calculate previous period (same duration as current period, immediately before it)
      const periodDuration = currentPeriodEnd - currentPeriodStart;
      const previousPeriodEnd = currentPeriodStart;
      const previousPeriodStart = new Date(currentPeriodStart.getTime() - periodDuration);

      Logger.info('Fetching agent details with cost', {
        operationId,
        subaccountId,
        userId,
        agentId,
        currentPeriodStart: currentPeriodStart.toISOString(),
        currentPeriodEnd: currentPeriodEnd.toISOString(),
        previousPeriodStart: previousPeriodStart.toISOString(),
        previousPeriodEnd: previousPeriodEnd.toISOString()
      });

      // NOTE: Success rate caching is disabled to ensure real-time accuracy
      // Success rates change when meetings are created/deleted, so we always fetch fresh data
      const cacheKey = `${subaccountId}:${agentId}:cost:${currentPeriodStart.getTime()}:${currentPeriodEnd.getTime()}`;

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get collections
      const agentsCollection = connection.db.collection('agents');
      const callsCollection = connection.db.collection('calls');
      const meetingsCollection = connection.db.collection('meetings');

      // Step 1: Find the agent
      const agentDocument = await agentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Agent not found',
          code: 'AGENT_NOT_FOUND'
        });
      }

      // Step 2: Use aggregation to calculate statistics for both periods (including cost and duration)
      const statisticsAggregation = await callsCollection.aggregate([
        // Match calls for this agent in both periods
        // Handle both agent_id and agentId for backward compatibility
        {
          $match: {
            $or: [
              { agent_id: agentId },
              { agentId: agentId }
            ],
            start_timestamp: {
              $gte: previousPeriodStart.getTime()
            }
          }
        },
        // Add period classification
        {
          $addFields: {
            period: {
              $cond: {
                if: {
                  $and: [
                    { $gte: ['$start_timestamp', currentPeriodStart.getTime()] },
                    { $lte: ['$start_timestamp', currentPeriodEnd.getTime()] }
                  ]
                },
                then: 'current',
                else: {
                  $cond: {
                    if: {
                      $and: [
                        { $gte: ['$start_timestamp', previousPeriodStart.getTime()] },
                        { $lt: ['$start_timestamp', previousPeriodEnd.getTime()] }
                      ]
                    },
                    then: 'previous',
                    else: 'excluded'
                  }
                }
              }
            },
            // Identify unresponsive calls
            isUnresponsive: {
              $cond: {
                if: {
                  $or: [
                    { $eq: [{ $type: '$disconnection_reason' }, 'missing'] },
                    { $eq: ['$disconnection_reason', null] },
                    { $eq: ['$disconnection_reason', ''] },
                    {
                      $not: {
                        $regexMatch: { 
                          input: { $toString: '$disconnection_reason' }, 
                          regex: 'hangup',
                          options: 'i'
                        }
                      }
                    }
                  ]
                },
                then: true,
                else: false
              }
            },
            // Only include valid success scores (using success_rate field)
            validSuccessScore: {
              $cond: {
                if: { $gt: [{ $ifNull: ['$success_rate', 0] }, 0] },
                then: '$success_rate',
                else: null
              }
            },
            // Extract cost and duration
            callCost: {
              $divide: [{ $ifNull: ['$call_cost.combined_cost', 0] }, 100]
            },
            callDuration: {
              $ifNull: ['$call_cost.total_duration_seconds', 0]
            }
          }
        },
        // Filter out excluded calls
        {
          $match: {
            period: { $in: ['current', 'previous'] }
          }
        },
        // Group by period to calculate statistics
        {
          $group: {
            _id: '$period',
            totalCalls: { $sum: 1 },
            unresponsiveCalls: {
              $sum: { $cond: ['$isUnresponsive', 1, 0] }
            },
            successScores: {
              $push: '$validSuccessScore'
            },
            totalCost: { $sum: '$callCost' },
            totalDuration: { $sum: '$callDuration' },
            callIds: { $push: '$call_id' }
          }
        },
        // Calculate cumulative success rate and averages
        {
          $project: {
            _id: 1,
            totalCalls: 1,
            unresponsiveCalls: 1,
            callIds: 1,
            totalCost: 1,
            totalDuration: 1,
            avgCostPerCall: {
              $cond: {
                if: { $gt: ['$totalCalls', 0] },
                then: { $divide: ['$totalCost', '$totalCalls'] },
                else: 0
              }
            },
            avgCallDuration: {
              $cond: {
                if: { $gt: ['$totalCalls', 0] },
                then: { $divide: ['$totalDuration', '$totalCalls'] },
                else: 0
              }
            },
            // Replace null scores with 0 for proper calculation
            successScores: {
              $map: {
                input: '$successScores',
                as: 'score',
                in: { $ifNull: ['$$score', 0] }
              }
            }
          }
        },
        {
          $project: {
            _id: 1,
            totalCalls: 1,
            unresponsiveCalls: 1,
            callIds: 1,
            totalCost: 1,
            totalDuration: 1,
            avgCostPerCall: 1,
            avgCallDuration: 1,
            cumulativeSuccessRate: {
              $cond: {
                if: { $gt: ['$totalCalls', 0] },
                then: {
                  $multiply: [
                    {
                      $divide: [
                        { $reduce: {
                          input: '$successScores',
                          initialValue: 0,
                          in: { $add: ['$$value', '$$this'] }
                        }},
                        '$totalCalls'
                      ]
                    },
                    100
                  ]
                },
                else: 0
              }
            }
          }
        }
      ]).toArray();

      // Parse aggregation results
      const currentStats = statisticsAggregation.find(s => s._id === 'current') || {
        totalCalls: 0,
        unresponsiveCalls: 0,
        cumulativeSuccessRate: 0,
        avgCostPerCall: 0,
        avgCallDuration: 0,
        callIds: []
      };

      const previousStats = statisticsAggregation.find(s => s._id === 'previous') || {
        totalCalls: 0,
        unresponsiveCalls: 0,
        cumulativeSuccessRate: 0,
        avgCostPerCall: 0,
        avgCallDuration: 0,
        callIds: []
      };

      // Step 3: Get meetings count for both periods using aggregation
      const meetingsAggregation = await meetingsCollection.aggregate([
        {
          $match: {
            subaccountId: subaccountId,
            agentId: agentId,
            createdAt: {
              $gte: previousPeriodStart,
              $lte: currentPeriodEnd
            }
          }
        },
        {
          $addFields: {
            period: {
              $cond: {
                if: {
                  $and: [
                    { $gte: ['$createdAt', currentPeriodStart] },
                    { $lte: ['$createdAt', currentPeriodEnd] }
                  ]
                },
                then: 'current',
                else: {
                  $cond: {
                    if: {
                      $and: [
                        { $gte: ['$createdAt', previousPeriodStart] },
                        { $lt: ['$createdAt', previousPeriodEnd] }
                      ]
                    },
                    then: 'previous',
                    else: 'excluded'
                  }
                }
              }
            }
          }
        },
        {
          $match: {
            period: { $in: ['current', 'previous'] }
          }
        },
        {
          $group: {
            _id: '$period',
            count: { $sum: 1 }
          }
        }
      ]).toArray();

      // Parse meetings aggregation results
      const currentPeriodMeetings = meetingsAggregation.find(m => m._id === 'current')?.count || 0;
      const previousPeriodMeetings = meetingsAggregation.find(m => m._id === 'previous')?.count || 0;
      
      const meetingsCounts = {
        currentPeriodMeetings,
        previousPeriodMeetings
      };

      // IMPORTANT: Calculate success rate from actual meetings, not from success_rate field
      // Success rate = (meetingsBooked / totalCalls) * 100
      // This ensures accuracy since success_rate field may be out of sync with actual meetings
      const currentSuccessRate = currentStats.totalCalls > 0 
        ? (meetingsCounts.currentPeriodMeetings / currentStats.totalCalls) * 100 
        : 0;
      const previousSuccessRate = previousStats.totalCalls > 0 
        ? (meetingsCounts.previousPeriodMeetings / previousStats.totalCalls) * 100 
        : 0;

      // Step 4: Calculate percentage changes
      const calculatePercentageChange = (current, previous) => {
        if (previous === 0) {
          return current > 0 ? 100 : 0;
        }
        return ((current - previous) / previous) * 100;
      };

      const statistics = {
        agent: {
          agentId: agentDocument.agentId,
          name: agentDocument.name,
          description: agentDocument.description,
          voiceId: agentDocument.voiceId,
          language: agentDocument.language,
          createdAt: agentDocument.createdAt
        },
        currentPeriod: {
          totalCalls: currentStats.totalCalls,
          meetingsBooked: meetingsCounts.currentPeriodMeetings,
          unresponsiveCalls: currentStats.unresponsiveCalls,
          cumulativeSuccessRate: Math.round(currentSuccessRate * 100) / 100,
          costPerCall: Math.round(currentStats.avgCostPerCall * 100) / 100,
          avgCallDuration: Math.round(currentStats.avgCallDuration * 100) / 100,
          periodStart: currentPeriodStart,
          periodEnd: currentPeriodEnd
        },
        previousPeriod: {
          totalCalls: previousStats.totalCalls,
          meetingsBooked: meetingsCounts.previousPeriodMeetings,
          unresponsiveCalls: previousStats.unresponsiveCalls,
          cumulativeSuccessRate: Math.round(previousSuccessRate * 100) / 100,
          costPerCall: Math.round(previousStats.avgCostPerCall * 100) / 100,
          avgCallDuration: Math.round(previousStats.avgCallDuration * 100) / 100,
          periodStart: previousPeriodStart,
          periodEnd: previousPeriodEnd
        },
        comparison: {
          totalCalls: {
            change: currentStats.totalCalls - previousStats.totalCalls,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.totalCalls, previousStats.totalCalls) * 100
            ) / 100
          },
          meetingsBooked: {
            change: meetingsCounts.currentPeriodMeetings - meetingsCounts.previousPeriodMeetings,
            percentageChange: Math.round(
              calculatePercentageChange(meetingsCounts.currentPeriodMeetings, meetingsCounts.previousPeriodMeetings) * 100
            ) / 100
          },
          unresponsiveCalls: {
            change: currentStats.unresponsiveCalls - previousStats.unresponsiveCalls,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.unresponsiveCalls, previousStats.unresponsiveCalls) * 100
            ) / 100
          },
          cumulativeSuccessRate: {
            change: Math.round((currentSuccessRate - previousSuccessRate) * 100) / 100,
            percentageChange: Math.round(
              calculatePercentageChange(currentSuccessRate, previousSuccessRate) * 100
            ) / 100
          },
          costPerCall: {
            change: Math.round((currentStats.avgCostPerCall - previousStats.avgCostPerCall) * 100) / 100,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.avgCostPerCall, previousStats.avgCostPerCall) * 100
            ) / 100
          },
          avgCallDuration: {
            change: Math.round((currentStats.avgCallDuration - previousStats.avgCallDuration) * 100) / 100,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.avgCallDuration, previousStats.avgCallDuration) * 100
            ) / 100
          }
        }
      };

      // NOTE: Success rate caching is disabled to ensure real-time accuracy
      // Success rates change when meetings are created/deleted, so we don't cache them
      // Cache invalidation still happens when meetings are created/deleted to notify other systems

      const duration = Date.now() - startTime;

      Logger.info('Agent details with cost fetched successfully', {
        operationId,
        subaccountId,
        agentId,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Agent details with cost retrieved successfully',
        data: statistics,
        meta: {
          operationId,
          duration: `${duration}ms`,
          cached: false
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'getAgentDetailsWithCost', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Get agent call analytics (success/failure, peak hours, outcome distribution)
  static async getAgentCallAnalytics(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;

      // Get date range from query params
      const startDateParam = req.query.startDate;
      const endDateParam = req.query.endDate;
      const groupBy = req.query.groupBy || 'day'; // day, week, month

      // Default to last 30 days if not provided
      const now = new Date();
      let periodStart, periodEnd;

      if (startDateParam && endDateParam) {
        // Validate date format and parse
        periodStart = new Date(startDateParam);
        periodEnd = new Date(endDateParam);

        // Validate dates
        if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)',
            code: 'INVALID_DATE_FORMAT'
          });
        }

        if (periodStart >= periodEnd) {
          return res.status(400).json({
            success: false,
            message: 'startDate must be before endDate',
            code: 'INVALID_DATE_RANGE'
          });
        }

        // Check if date range is not too large (max 2 years)
        const daysDiff = (periodEnd - periodStart) / (1000 * 60 * 60 * 24);
        if (daysDiff > 730) {
          return res.status(400).json({
            success: false,
            message: 'Date range cannot exceed 730 days (2 years)',
            code: 'DATE_RANGE_TOO_LARGE'
          });
        }
      } else {
        // Default: last 30 days
        periodEnd = now;
        periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      Logger.info('Fetching agent call analytics', {
        operationId,
        subaccountId,
        userId,
        agentId,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        groupBy
      });

      // NOTE: Success rate caching is disabled to ensure real-time accuracy
      // Success rates change when meetings are created/deleted, so we always fetch fresh data
      const cacheKey = `${subaccountId}:${agentId}:analytics:${periodStart.getTime()}:${periodEnd.getTime()}:${groupBy}`;

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get collections
      const agentsCollection = connection.db.collection('agents');
      const callsCollection = connection.db.collection('calls');
      const meetingsCollection = connection.db.collection('meetings');

      // Step 1: Verify agent exists
      const agentDocument = await agentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Agent not found',
          code: 'AGENT_NOT_FOUND'
        });
      }

      // Determine date grouping format based on groupBy parameter
      let dateFormat, dateGroup;
      switch (groupBy) {
        case 'week':
          dateFormat = '%Y-W%U'; // Year-Week
          dateGroup = {
            year: { $year: { $toDate: '$start_timestamp' } },
            week: { $week: { $toDate: '$start_timestamp' } }
          };
          break;
        case 'month':
          dateFormat = '%Y-%m'; // Year-Month
          dateGroup = {
            year: { $year: { $toDate: '$start_timestamp' } },
            month: { $month: { $toDate: '$start_timestamp' } }
          };
          break;
        case 'day':
        default:
          dateFormat = '%Y-%m-%d'; // Year-Month-Day
          dateGroup = {
            year: { $year: { $toDate: '$start_timestamp' } },
            month: { $month: { $toDate: '$start_timestamp' } },
            day: { $dayOfMonth: { $toDate: '$start_timestamp' } }
          };
      }

      // Step 2: Get successful vs unsuccessful calls over time
      const successTimelineAggregation = await callsCollection.aggregate([
        {
          $match: {
            $or: [
              { agent_id: agentId },
              { agentId: agentId }
            ],
            start_timestamp: {
              $gte: periodStart.getTime(),
              $lte: periodEnd.getTime()
            }
          }
        },
        {
          $addFields: {
            dateKey: {
              $dateToString: {
                format: dateFormat,
                date: { $toDate: '$start_timestamp' }
              }
            },
            isSuccessful: {
              $cond: {
                if: { $eq: ['$call_analysis.custom_analysis_data.appointment_booked', true] },
                then: true,
                else: false
              }
            }
          }
        },
        {
          $group: {
            _id: {
              date: '$dateKey',
              successful: '$isSuccessful'
            },
            count: { $sum: 1 },
            timestamp: { $min: '$start_timestamp' }
          }
        },
        {
          $sort: { timestamp: 1 }
        }
      ]).toArray();

      // Step 3: Get peak call hours (hourly distribution)
      const peakHoursAggregation = await callsCollection.aggregate([
        {
          $match: {
            $or: [
              { agent_id: agentId },
              { agentId: agentId }
            ],
            start_timestamp: {
              $gte: periodStart.getTime(),
              $lte: periodEnd.getTime()
            }
          }
        },
        {
          $addFields: {
            hour: { $hour: { $toDate: '$start_timestamp' } }
          }
        },
        {
          $group: {
            _id: '$hour',
            callCount: { $sum: 1 }
          }
        },
        {
          $sort: { _id: 1 }
        }
      ]).toArray();

      // Step 4: Get call outcome distribution by sentiment
      const outcomeDistributionAggregation = await callsCollection.aggregate([
        {
          $match: {
            $or: [
              { agent_id: agentId },
              { agentId: agentId }
            ],
            start_timestamp: {
              $gte: periodStart.getTime(),
              $lte: periodEnd.getTime()
            }
          }
        },
        {
          $group: {
            _id: {
              $ifNull: ['$call_analysis.user_sentiment', 'Unknown']
            },
            count: { $sum: 1 }
          }
        },
        {
          $sort: { count: -1 }
        }
      ]).toArray();

      // Step 5: Get overall statistics
      const overallStatsAggregation = await callsCollection.aggregate([
        {
          $match: {
            $or: [
              { agent_id: agentId },
              { agentId: agentId }
            ],
            start_timestamp: {
              $gte: periodStart.getTime(),
              $lte: periodEnd.getTime()
            }
          }
        },
        {
          $group: {
            _id: null,
            totalCalls: { $sum: 1 },
            successfulCalls: {
              $sum: {
                $cond: [
                  { $eq: ['$call_analysis.custom_analysis_data.appointment_booked', true] },
                  1,
                  0
                ]
              }
            },
            unsuccessfulCalls: {
              $sum: {
                $cond: [
                  { $ne: ['$call_analysis.custom_analysis_data.appointment_booked', true] },
                  1,
                  0
                ]
              }
            }
          }
        }
      ]).toArray();

      const overallStats = overallStatsAggregation[0] || {
        totalCalls: 0,
        successfulCalls: 0,
        unsuccessfulCalls: 0
      };

      // Step 6: Get actual meetings count from meetings collection
      // Note: Some meetings have subaccountId (from chat agents), some don't (from voice agents)
      const actualMeetingsCount = await meetingsCollection.countDocuments({
        $or: [
          { agentId: agentId, subaccountId: subaccountId },
          { agentId: agentId, subaccountId: { $exists: false } }
        ],
        createdAt: {
          $gte: periodStart,
          $lte: periodEnd
        }
      });

      // Helper function to format date labels based on groupBy
      const formatDateLabel = (dateStr, timestamp) => {
        const date = new Date(timestamp);
        switch (groupBy) {
          case 'month':
            return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' }); // "Oct 2025"
          case 'week':
            return `Week ${dateStr.split('-W')[1]}, ${dateStr.split('-W')[0]}`; // "Week 41, 2025"
          case 'day':
          default:
            return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); // "Oct 15, 2025"
        }
      };

      // Format success timeline data
      const timelineData = {};
      successTimelineAggregation.forEach(item => {
        const date = item._id.date;
        if (!timelineData[date]) {
          timelineData[date] = {
            date,
            dateLabel: formatDateLabel(date, item.timestamp),
            successful: 0,
            unsuccessful: 0,
            timestamp: item.timestamp
          };
        }
        if (item._id.successful === true) {
          timelineData[date].successful = item.count;
        } else {
          timelineData[date].unsuccessful = item.count;
        }
      });

      const successTimeline = Object.values(timelineData).sort((a, b) => a.timestamp - b.timestamp);

      // Format peak hours data (ensure all 24 hours are represented)
      const peakHours = Array.from({ length: 24 }, (_, hour) => {
        const hourData = peakHoursAggregation.find(item => item._id === hour);
        return {
          hour,
          callCount: hourData ? hourData.callCount : 0,
          hourLabel: `${hour.toString().padStart(2, '0')}:00`
        };
      });

      // Calculate total calls for percentage calculation
      const totalCallsForOutcome = outcomeDistributionAggregation.reduce((sum, item) => sum + item.count, 0);

      // Format outcome distribution data
      const outcomeDistribution = outcomeDistributionAggregation.map(item => ({
        sentiment: item._id,
        count: item.count,
        percentage: totalCallsForOutcome > 0 
          ? Math.round((item.count / totalCallsForOutcome) * 10000) / 100 
          : 0
      }));

      // Build response
      const responseData = {
        agent: {
          agentId: agentDocument.agentId,
          name: agentDocument.name,
          description: agentDocument.description
        },
        dateRange: {
          start: periodStart.toISOString(),
          end: periodEnd.toISOString(),
          groupBy
        },
        summary: {
          totalCalls: overallStats.totalCalls,
          successfulCalls: overallStats.successfulCalls,
          unsuccessfulCalls: overallStats.unsuccessfulCalls,
          meetingsBooked: actualMeetingsCount,
          successRate: overallStats.totalCalls > 0 
            ? Math.round((overallStats.successfulCalls / overallStats.totalCalls) * 10000) / 100 
            : 0,
          meetingBookingRate: overallStats.totalCalls > 0 
            ? Math.round((actualMeetingsCount / overallStats.totalCalls) * 10000) / 100 
            : 0
        },
        successTimeline,
        peakHours,
        outcomeDistribution
      };

      // NOTE: Success rate caching is disabled to ensure real-time accuracy
      // Success rates change when meetings are created/deleted, so we don't cache them
      // Cache invalidation still happens when meetings are created/deleted to notify other systems

      const duration = Date.now() - startTime;

      Logger.info('Agent call analytics fetched successfully', {
        operationId,
        subaccountId,
        agentId,
        totalCalls: overallStats.totalCalls,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Agent call analytics retrieved successfully',
        data: responseData,
        meta: {
          operationId,
          duration: `${duration}ms`,
          cached: false
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'getAgentCallAnalytics', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Get agent call costs breakdown with product-level details
  static async getAgentCallCostsBreakdown(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;

      // Get date range from query params
      const startDateParam = req.query.startDate;
      const endDateParam = req.query.endDate;

      // Default to last 30 days if not provided
      const now = new Date();
      let periodStart, periodEnd;

      if (startDateParam && endDateParam) {
        // Validate date format and parse
        periodStart = new Date(startDateParam);
        periodEnd = new Date(endDateParam);

        // Validate dates
        if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)',
            code: 'INVALID_DATE_FORMAT'
          });
        }

        if (periodStart >= periodEnd) {
          return res.status(400).json({
            success: false,
            message: 'startDate must be before endDate',
            code: 'INVALID_DATE_RANGE'
          });
        }

        // Check if date range is not too large (max 2 years)
        const daysDiff = (periodEnd - periodStart) / (1000 * 60 * 60 * 24);
        if (daysDiff > 730) {
          return res.status(400).json({
            success: false,
            message: 'Date range cannot exceed 730 days (2 years)',
            code: 'DATE_RANGE_TOO_LARGE'
          });
        }
      } else {
        // Default: last 30 days
        periodEnd = now;
        periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      Logger.info('Fetching agent call costs breakdown', {
        operationId,
        subaccountId,
        userId,
        agentId,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString()
      });

      // NOTE: Success rate caching is disabled to ensure real-time accuracy
      // Success rates change when meetings are created/deleted, so we always fetch fresh data
      const cacheKey = `${subaccountId}:${agentId}:costs-breakdown:${periodStart.getTime()}:${periodEnd.getTime()}`;

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get collections
      const agentsCollection = connection.db.collection('agents');
      const callsCollection = connection.db.collection('calls');

      // Step 1: Verify agent exists
      const agentDocument = await agentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Agent not found',
          code: 'AGENT_NOT_FOUND'
        });
      }

      // Step 2: Use aggregation to get cost breakdown
      const costBreakdownAggregation = await callsCollection.aggregate([
        // Match calls for this agent in the date range
        {
          $match: {
            $or: [
              { agent_id: agentId },
              { agentId: agentId }
            ],
            start_timestamp: {
              $gte: periodStart.getTime(),
              $lte: periodEnd.getTime()
            }
          }
        },
        // Unwind product_costs array to analyze each product separately
        {
          $unwind: {
            path: '$call_cost.product_costs',
            preserveNullAndEmptyArrays: true
          }
        },
        // Group by product to get totals per product
        {
          $group: {
            _id: '$call_cost.product_costs.product',
            totalCost: { 
              $sum: { $divide: [{ $ifNull: ['$call_cost.product_costs.cost', 0] }, 100] }
            },
            unitPrice: { 
              $first: { $ifNull: ['$call_cost.product_costs.unit_price', 0] } 
            },
            callCount: { $sum: 1 }
          }
        },
        // Sort by total cost descending
        {
          $sort: { totalCost: -1 }
        }
      ]).toArray();

      // Step 3: Get overall cost summary using aggregation
      const overallSummaryAggregation = await callsCollection.aggregate([
        {
          $match: {
            $or: [
              { agent_id: agentId },
              { agentId: agentId }
            ],
            start_timestamp: {
              $gte: periodStart.getTime(),
              $lte: periodEnd.getTime()
            }
          }
        },
        {
          $group: {
            _id: null,
            totalCalls: { $sum: 1 },
            totalCombinedCost: { 
              $sum: { $divide: [{ $ifNull: ['$call_cost.combined_cost', 0] }, 100] }
            },
            totalDurationSeconds: { 
              $sum: { $ifNull: ['$call_cost.total_duration_seconds', 0] } 
            },
            avgDurationUnitPrice: { 
              $avg: { $divide: [{ $ifNull: ['$call_cost.total_duration_unit_price', 0] }, 100] }
            },
            callsWithCost: {
              $sum: {
                $cond: [
                  { $gt: [{ $ifNull: ['$call_cost.combined_cost', 0] }, 0] },
                  1,
                  0
                ]
              }
            }
          }
        }
      ]).toArray();

      const overallSummary = overallSummaryAggregation[0] || {
        totalCalls: 0,
        totalCombinedCost: 0,
        totalDurationSeconds: 0,
        avgDurationUnitPrice: 0,
        callsWithCost: 0
      };

      // Calculate duration cost
      const totalDurationCost = overallSummary.totalDurationSeconds * overallSummary.avgDurationUnitPrice;

      // Step 4: Get individual calls for detailed view
      const callDetailsAggregation = await callsCollection.aggregate([
        {
          $match: {
            $or: [
              { agent_id: agentId },
              { agentId: agentId }
            ],
            start_timestamp: {
              $gte: periodStart.getTime(),
              $lte: periodEnd.getTime()
            }
          }
        },
        {
          $sort: { start_timestamp: -1 }
        },
        {
          $limit: 100 // Limit to most recent 100 calls for performance
        },
        {
          $project: {
            _id: 0,
            callId: '$call_id',
            startTimestamp: '$start_timestamp',
            endTimestamp: '$end_timestamp',
            duration: '$call_cost.total_duration_seconds',
            combinedCost: { $divide: [{ $ifNull: ['$call_cost.combined_cost', 0] }, 100] },
            productCosts: '$call_cost.product_costs',
            durationUnitPrice: { $divide: [{ $ifNull: ['$call_cost.total_duration_unit_price', 0] }, 100] },
            success_rate: '$success_rate',
            call_analysis: '$call_analysis'
          }
        }
      ]).toArray();

      // Format product breakdown
      const productBreakdown = costBreakdownAggregation
        .filter(item => item._id) // Filter out null products
        .map(item => ({
          product: item._id,
          unitPrice: Math.round(item.unitPrice * 1000000) / 1000000, // Round to 6 decimals
          totalCost: Math.round(item.totalCost * 100) / 100,
          callCount: item.callCount,
          avgCostPerCall: item.callCount > 0 ? Math.round((item.totalCost / item.callCount) * 100) / 100 : 0
        }));

      // Calculate total product costs
      const totalProductCosts = productBreakdown.reduce((sum, item) => sum + item.totalCost, 0);

      // Format calls
      const { calculateCallSuccessRate } = require('../utils/callHelper');
      const calls = callDetailsAggregation.map(call => {
        // Calculate success_rate if not present but call_analysis exists
        let successRate = call.success_rate;
        if (successRate === null || successRate === undefined) {
          if (call.call_analysis) {
            successRate = calculateCallSuccessRate(call.call_analysis);
          }
        }
        
        return {
          callId: call.callId,
          startTimestamp: call.startTimestamp,
          endTimestamp: call.endTimestamp,
          startDate: call.startTimestamp ? new Date(call.startTimestamp).toISOString() : null,
          endDate: call.endTimestamp ? new Date(call.endTimestamp).toISOString() : null,
          duration: call.duration || 0,
          combinedCost: call.combinedCost ? Math.round(call.combinedCost * 100) / 100 : 0,
          durationUnitPrice: call.durationUnitPrice ? Math.round(call.durationUnitPrice * 1000000) / 1000000 : 0,
          success_rate: successRate !== null && successRate !== undefined ? successRate : null,
          productCosts: (call.productCosts || []).map(pc => ({
            product: pc.product,
            unitPrice: Math.round((pc.unit_price || 0) * 1000000) / 1000000,
            cost: Math.round(((pc.cost || 0) / 100) * 100) / 100
          }))
        };
      });

      // Build response
      const responseData = {
        agent: {
          agentId: agentDocument.agentId,
          name: agentDocument.name,
          description: agentDocument.description
        },
        dateRange: {
          start: periodStart.toISOString(),
          end: periodEnd.toISOString()
        },
        summary: {
          totalCalls: overallSummary.totalCalls,
          callsWithCostData: overallSummary.callsWithCost,
          cumulativeCosts: {
            totalCombinedCost: Math.round(overallSummary.totalCombinedCost * 100) / 100,
            totalProductCosts: Math.round(totalProductCosts * 100) / 100,
            totalDurationCost: Math.round(totalDurationCost * 100) / 100,
            avgCostPerCall: overallSummary.callsWithCost > 0 
              ? Math.round((overallSummary.totalCombinedCost / overallSummary.callsWithCost) * 100) / 100 
              : 0
          },
          duration: {
            totalDurationSeconds: Math.round(overallSummary.totalDurationSeconds * 100) / 100,
            avgDurationSeconds: overallSummary.totalCalls > 0 
              ? Math.round((overallSummary.totalDurationSeconds / overallSummary.totalCalls) * 100) / 100 
              : 0,
            avgDurationUnitPrice: Math.round(overallSummary.avgDurationUnitPrice * 1000000) / 1000000
          }
        },
        productBreakdown,
        calls: {
          count: calls.length,
          limit: 100,
          note: calls.length === 100 ? 'Showing most recent 100 calls only' : 'Showing all calls in date range',
          data: calls
        }
      };

      // NOTE: Success rate caching is disabled to ensure real-time accuracy
      // Success rates change when meetings are created/deleted, so we don't cache them
      // Cache invalidation still happens when meetings are created/deleted to notify other systems

      const duration = Date.now() - startTime;

      Logger.info('Agent call costs breakdown fetched successfully', {
        operationId,
        subaccountId,
        agentId,
        totalCalls: overallSummary.totalCalls,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Agent call costs breakdown retrieved successfully',
        data: responseData,
        meta: {
          operationId,
          duration: `${duration}ms`,
          cached: false
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'getAgentCallCostsBreakdown', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Update agent details (begin message, prompt, voice, etc.)
  static async updateAgentDetails(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;
      const updates = req.body;

      Logger.info('Updating agent details', {
        operationId,
        subaccountId,
        userId,
        agentId,
        updateFields: Object.keys(updates),
        effectiveRole: req.permission?.effectiveRole
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get agents collection
      const agentsCollection = connection.db.collection('agents');
      const llmsCollection = connection.db.collection('llms');

      // Step 1: Find the agent in MongoDB to get its LLM ID
      const agentDocument = await agentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Agent not found',
          code: 'AGENT_NOT_FOUND'
        });
      }

      const llmId = agentDocument.llmId;

      Logger.info('Agent found, preparing to update LLM', {
        operationId,
        agentId,
        llmId,
        agentName: agentDocument.name
      });

      // Step 2: Fetch retell account data and create Retell instance
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      
      if (!retellAccountData.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Retell account is not active',
          code: 'RETELL_ACCOUNT_INACTIVE'
        });
      }

      const retell = new Retell(retellAccountData.apiKey, retellAccountData);

      // Step 3: Map request fields to Retell LLM fields
      const llmUpdates = {};
      const dbUpdates = {};

      // Map beginMessage to begin_message for Retell, and store both formats in DB
      if (updates.beginMessage !== undefined) {
        llmUpdates.begin_message = updates.beginMessage;
        dbUpdates.beginMessage = updates.beginMessage;
      }

      // Map generalPrompt to general_prompt for Retell, and store both formats in DB
      if (updates.generalPrompt !== undefined) {
        llmUpdates.general_prompt = updates.generalPrompt;
        dbUpdates.generalPrompt = updates.generalPrompt;
      }

      // Store other fields in DB for future use (voiceId, emailTemplate, model)
      if (updates.voiceId !== undefined) {
        dbUpdates.voiceId = updates.voiceId;
      }

      if (updates.emailTemplate !== undefined) {
        dbUpdates.emailTemplate = updates.emailTemplate;
      }

      if (updates.model !== undefined) {
        dbUpdates.model = updates.model;
      }

      // Step 4: Update LLM in Retell (only if there are LLM-specific fields)
      let llmUpdateResponse = null;
      if (Object.keys(llmUpdates).length > 0) {
        try {
          llmUpdateResponse = await retell.updateLLM(llmId, llmUpdates);
          Logger.info('LLM updated successfully in Retell', {
            operationId,
            llmId,
            updatedFields: Object.keys(llmUpdates)
          });
        } catch (error) {
          Logger.error('Failed to update LLM in Retell', {
            operationId,
            llmId,
            error: error.message
          });
          throw new Error(`Failed to update LLM in Retell: ${error.message}`);
        }
      }

      // Step 5: Update LLM document in MongoDB (if there are LLM-related fields)
      if (Object.keys(dbUpdates).length > 0) {
        const llmDbUpdates = {};
        
        if (dbUpdates.beginMessage !== undefined) {
          llmDbUpdates.beginMessage = dbUpdates.beginMessage;
        }
        if (dbUpdates.generalPrompt !== undefined) {
          llmDbUpdates.generalPrompt = dbUpdates.generalPrompt;
        }
        if (dbUpdates.model !== undefined) {
          llmDbUpdates.model = dbUpdates.model;
        }

        if (Object.keys(llmDbUpdates).length > 0) {
          llmDbUpdates.updatedAt = new Date();
          llmDbUpdates.updatedBy = userId;

          await llmsCollection.updateOne(
            { llmId: llmId, subaccountId: subaccountId },
            { $set: llmDbUpdates }
          );

          Logger.info('LLM document updated in MongoDB', {
            operationId,
            llmId,
            updatedFields: Object.keys(llmDbUpdates)
          });
        }

        // Step 6: Update agent document in MongoDB
        const agentDbUpdates = { ...dbUpdates };
        agentDbUpdates.updatedAt = new Date();
        agentDbUpdates.updatedBy = userId;

        await agentsCollection.updateOne(
          { agentId: agentId, subaccountId: subaccountId },
          { $set: agentDbUpdates }
        );

        Logger.info('Agent document updated in MongoDB', {
          operationId,
          agentId,
          updatedFields: Object.keys(agentDbUpdates)
        });
      }

      // Step 7: Invalidate cache for this agent
      try {
        await redisService.invalidateAgentDetails(subaccountId, agentId);
      } catch (cacheError) {
        Logger.warn('Failed to invalidate agent details cache', {
          operationId,
          error: cacheError.message
        });
      }

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.AGENT_UPDATED,
        category: ACTIVITY_CATEGORIES.AGENT,
        userId,
        description: `Agent "${agentDocument.name}" updated`,
        metadata: {
          agentId,
          agentName: agentDocument.name,
          llmId,
          updatedFields: Object.keys(updates)
        },
        resourceId: agentId,
        resourceName: agentDocument.name,
        operationId,
        agentId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Agent details updated successfully',
        data: {
          agentId,
          llmId,
          updatedFields: Object.keys(updates),
          updatedInRetell: Object.keys(llmUpdates).length > 0,
          updatedInDatabase: Object.keys(dbUpdates).length > 0
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'updateAgentDetails', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Get agent configuration details
  static async getAgentDetailsConfig(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;

      Logger.info('Fetching agent configuration details', {
        operationId,
        subaccountId,
        userId,
        agentId
      });

      // Check cache first
      try {
        const cachedDetails = await redisService.getCachedAgentDetails(subaccountId, agentId);
        if (cachedDetails) {
          return res.json({
            success: true,
            message: 'Agent configuration details retrieved successfully (cached)',
            data: cachedDetails,
            meta: {
              operationId,
              duration: `${Date.now() - startTime}ms`,
              cached: true
            }
          });
        }
      } catch (cacheError) {
        Logger.warn('Cache retrieval failed, fetching from database', {
          operationId,
          error: cacheError.message
        });
      }

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get collections
      const agentsCollection = connection.db.collection('agents');
      const llmsCollection = connection.db.collection('llms');

      // Step 1: Find the agent
      const agentDocument = await agentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Agent not found',
          code: 'AGENT_NOT_FOUND'
        });
      }

      // Step 2: Find the LLM document
      const llmDocument = await llmsCollection.findOne({ 
        llmId: agentDocument.llmId,
        subaccountId: subaccountId 
      });

      // Step 3: Build configuration response
      const configDetails = {
        agent: {
          agentId: agentDocument.agentId,
          name: agentDocument.name,
          description: agentDocument.description,
          voiceId: agentDocument.voiceId || null,
          language: agentDocument.language,
          emailTemplate: agentDocument.emailTemplate || null,
          createdAt: agentDocument.createdAt,
          updatedAt: agentDocument.updatedAt || null
        },
        llm: {
          llmId: agentDocument.llmId,
          model: llmDocument?.model || agentDocument.model || null,
          beginMessage: llmDocument?.beginMessage || agentDocument.beginMessage || '',
          generalPrompt: llmDocument?.generalPrompt || agentDocument.generalPrompt || '',
          modelTemperature: llmDocument?.modelTemperature || null,
          version: llmDocument?.version || null,
          createdAt: llmDocument?.createdAt || null,
          updatedAt: llmDocument?.updatedAt || null
        }
      };

      // Cache the results for 1 hour
      try {
        await redisService.cacheAgentDetails(subaccountId, agentId, configDetails, 3600);
      } catch (cacheError) {
        Logger.warn('Failed to cache agent configuration details', {
          operationId,
          error: cacheError.message
        });
      }

      const duration = Date.now() - startTime;

      Logger.info('Agent configuration details fetched successfully', {
        operationId,
        subaccountId,
        agentId,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Agent configuration details retrieved successfully',
        data: configDetails,
        meta: {
          operationId,
          duration: `${duration}ms`,
          cached: false
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'getAgentDetailsConfig', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // ========== CHAT AGENTS METHODS ==========

  // Create chat agent
  static async createChatAgent(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();
    let llmId = null;
    let agentId = null;

    try {
      const { subaccountId } = req.params;
      const { name, description } = req.body;
      const userId = req.user.id;

      Logger.info('Creating chat agent', {
        operationId,
        subaccountId,
        userId,
        name,
        effectiveRole: req.permission?.effectiveRole
      });

      // Fetch retell account data (with caching)
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      
      if (!retellAccountData.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Retell account is not active',
          code: 'RETELL_ACCOUNT_INACTIVE'
        });
      }

      // Create Retell instance with decrypted API key
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);
      
      Logger.info('Retell instance created for chat agent', {
        operationId,
        accountName: retellAccountData.accountName,
        accountId: retellAccountData.id
      });

      // Get database connection for storing agent and LLM data
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get deployed webhook URL from config
      const deployedWebhookUrl = config.retell.deployedWebhookServerUrl || config.webhookServer.deployedUrl || 'https://scalai-b-48660c785242.herokuapp.com';

      // Generate unique MCP ID (required by Retell API)
      const mcpId = `mcp-${Date.now()}`;

      // Step 1: Create LLM with MCP config and MCP tools
      Logger.info('Creating LLM for chat agent', { operationId, subaccountId, name, mcpId });
      
      const llmConfig = {
        version: 0,
        model: "gpt-4o-mini",
        model_temperature: 0,
        model_high_priority: true,
        tool_call_strict_mode: true,
        begin_message: "",
        general_prompt: "",
        general_tools: [{
          type: "end_call",
          name: "end_call",
          description: "End the call when user has to leave (like says bye) or you are instructed to do so."
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "check_availability",
          description: "Check available time slots for a specific date. Returns available slots and already booked slots.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "create_appointment",
          description: "Create a new appointment/meeting. Checks for conflicts with existing meetings.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "update_appointment",
          description: "Update an existing appointment/meeting. Can update any field.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "delete_appointment",
          description: "Permanently delete an appointment by its ID.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "get_current_time",
          description: "Get the current date and time in the subaccount's timezone. Returns formatted date, time, weekday, and timezone info.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "get_call_insights",
          description: "Get AI-generated insights from call transcripts for a specific phone number. Uses conversation history to answer questions.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "ask_calendar_question",
          description: "Ask any calendar or time-related question using AI. Context variables (subaccount_id) are auto-populated to use the correct local timezone. Can answer questions like: \"What day is today?\", \"What time is it?\", \"How many days until Christmas?\", \"What date is next Friday?\", \"What week of the year is it?\", \"Is this a leap year?\". All answers are in the subaccount's local timezone.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "get_calendar_info",
          description: "Get detailed calendar information for the current date/time in the subaccount's timezone. Returns comprehensive info including: day of year, week of year, quarter, days remaining in month/year, leap year status, weekend indicator. No AI involved - just raw calendar data.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "get_call_history",
          description: "Get call history and transcripts for a specific phone number. Context variables (phone_number, subaccount_id) are auto-populated. Agent filtering (agent_id) is applied only if enabled for the subaccount.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        },
        {
          execution_message_description: "",
          speak_after_execution: true,
          name: "get_user_appointments",
          description: "Get all appointments for a specific user identified by phone number. Context variables (phone_number, subaccount_id) are auto-populated from the active session. Agent filtering (agent_id) is applied only if enabled for the subaccount. Returns all appointments regardless of status.",
          response_variables: {},
          mcp_id: mcpId,
          type: "mcp",
          speak_during_execution: false
        }],
        states: [
          {
            name: "general_state",
            state_prompt:`## 🚨 MANDATORY RULES — APPLY TO EVERY TOOL CALL AND RESPONSE 🚨

### RULE 0: DYNAMIC VARIABLES — NEVER ASK FOR THEM

You automatically receive these variables for each call:
- {{agent_id}} — Agent identifier
- {{phone_number}} — Caller's phone number  
- {{subaccount_id}} — Subaccount identifier (may be empty)

**CRITICAL:**
- NEVER ask the customer for their phone number — use {{phone_number}} directly
- NEVER ask for any IDs — use {{agent_id}} and {{subaccount_id}} directly
- If subaccount_id is empty → do not proceed without it and end the call.
- Use these variables directly in ALL tool calls

❌ WRONG: "May I have your phone number please?"
✅ CORRECT: Use {{phone_number}} directly in tool calls without asking

### RULE 1: FUTURE DATES ONLY (CRITICAL FOR TOOL CALLS)

**BEFORE making ANY tool call with a date parameter:**

1. First call get_current_time to get today's date
2. Compare the requested month/day to today's date
3. If the requested date has ALREADY PASSED this year → USE NEXT YEAR

**Date Calculation Logic:**

Current date example: December 25, 2025
- User says "February 1" → February 1, **2026** ✅ (NOT 2025 ❌)
- User says "February 2" → February 2, **2026** ✅ (NOT 2025 ❌)
- User says "January 15" → January 15, **2026** ✅ (NOT 2025 ❌)
- User says "March 10" → March 10, **2026** ✅ (NOT 2025 ❌)
- User says "December 28" → December 28, **2025** ✅ (still upcoming)

**When calling check_availability or any date-based tool:**

WRONG ❌: "date": "2025-02-02" (February 2025 already passed!)
CORRECT ✅: "date": "2026-02-02" (Next February)

**Simple Rule:**
- If month mentioned < current month → Add 1 to current year
- If month mentioned = current month AND day mentioned < current day → Add 1 to current year
- Otherwise → Use current year

**Month Numbers:** January = 1, February = 2, March = 3, April = 4, May = 5, June = 6, July = 7, August = 8, September = 9, October = 10, November = 11, December = 12

**Example Calculation (today = December 25, 2025):**
- User says "February 2": February (2) < December (12)? → YES → Use **2026**
- User says "January 15": January (1) < December (12)? → YES → Use **2026**
- User says "December 28": December (12) = December (12), and 28 > 25 → Use **2025**
- User says "December 20": December (12) = December (12), but 20 < 25 → Use **2026**

**Only use a past year if the customer EXPLICITLY states it:**
- "February 2, 2025" → Use 2025 (customer specified the year)
- "Last February" → Ask for clarification: "Just to confirm, do you mean February 2025?"

**For relative terms:**
- "Next Monday" → The upcoming Monday
- "This Friday" → The upcoming Friday
- "Next month" → The next calendar month
- "Next week" → 7 days from current date
- "Tomorrow" → Current date + 1 day

**REMEMBER: Appointments are ALWAYS scheduled for the FUTURE. Never assume a past date.**

**REMEMBER: Always re-verify the weekday for a date when being mentioned. Use ask_calendar_question mcp tool for it to re verify. **
---

### RULE 2: NEVER LIST RAW TIME SLOTS

Before responding, CHECK: Am I about to list times like this?
- "10:00 AM - 11:00 AM"
- "9:00 AM - 5:00 PM"
- "3:00 PM - 6:00 PM"

If YES → **STOP. DELETE. REWRITE CONVERSATIONALLY.**

❌ **FORBIDDEN FORMAT:**
"Here are the available times:
- 10:00 AM - 11:00 AM
- 10:00 AM - 6:00 PM
- 9:00 AM - 5:00 PM"

❌ **FORBIDDEN FORMAT:**
"Available slots:
- **Monday, February 2:**
  - 10:00 AM - 11:00 AM
  - 9:00 AM - 5:00 PM
- **Tuesday, February 3:**
  - 9:00 AM - 5:00 PM"

✅ **REQUIRED FORMAT:**
"We have availability from 9 AM to 6 PM that day. Would morning or afternoon work better for you?"

✅ **REQUIRED FORMAT:**
"Monday and Tuesday both have good availability throughout the day. Which day works best for you?"

---

### RULE 3: NEVER SHOW TECHNICAL DATA TO CUSTOMERS

**Strictly PROHIBITED from appearing in any response:**
- Appointment IDs (e.g., "694d78fc9220f857f951e6cd")
- Booking IDs or reference codes
- Subaccount IDs, agent IDs
- Tool call IDs
- Database field names
- API response keys
- Raw phone numbers (e.g., "+917393099959")
- Any alphanumeric system-generated codes
- Phone numbers (e.g., "+917393099959") — you have it, but don't display it back

**These are for YOUR internal processing only—NEVER include them in customer responses.**


### RULE 4: NEVER ASK FOR INFORMATION YOU ALREADY HAVE

**You already have from dynamic variables:**
- Customer's phone number → Don't ask for it
- Agent ID → Don't mention it
- Subaccount ID → Don't ask for it

**Information you MAY need to ask for:**
- Preferred date/time for appointment
- Type of service needed
- Name (if not available from call history)
- Reason for visit
- Any other details NOT provided in dynamic variables or call history


### RULE 5: NEVER GUESS DAYS OF THE WEEK — ALWAYS VERIFY

**LLMs are unreliable at calculating days of the week. ALWAYS use ask_calendar_question tool.**

Before stating ANY day of the week (Monday, Tuesday, etc.):
1. Call ask_calendar_question with the specific date
2. Use ONLY the day returned by the tool
3. NEVER calculate or assume the day yourself

❌ WRONG (guessing internally):
"Your appointment is on Friday, January 1, 2026" (January 1, 2026 is actually Thursday!)

✅ CORRECT (verified via tool):
[First call ask_calendar_question: "What day of the week is January 1, 2026?"]
[Tool returns: "Thursday"]
"Your appointment is on Thursday, January 1, 2026"

**MANDATORY:** Every time you mention a date with a day of the week, you MUST have verified it with ask_calendar_question in that same response flow. No exceptions.

**Common LLM errors to avoid:**
- Assuming January 1st is always a specific day
- Calculating days mentally (LLMs fail at this frequently)
- Trusting cached/assumed day information

**Tool call example:**
ask_calendar_question: "What day of the week is January 1, 2026?"
→ Use the returned answer exactly


### RULE 6: TOOL PERMISSIONS — WHEN TO ASK vs JUST DO

**DO NOT ask permission before calling these tools — just call them:**
- get_current_time
- get_call_insights
- get_call_history
- ask_calendar_question
- check_availability
- get_appointments
- Any lookup/read operation

❌ WRONG: "Let me check the availability. Is that okay?"
❌ WRONG: "Would you like me to look up your appointments?"
❌ WRONG: "Can I check the calendar for you?"

✅ CORRECT: Just call the tool silently, then respond with the information.

**ALWAYS ask for confirmation BEFORE these actions:**
- Creating a new appointment
- Updating/rescheduling an existing appointment
- Deleting/canceling an appointment

✅ CORRECT: "I have Monday, February 2nd at 9 AM available. Would you like me to book that for you?"
✅ CORRECT: "I'll move your appointment from March 19th to April 5th at 10 AM. Should I confirm that change?"
✅ CORRECT: "I'll cancel your appointment on March 19th. Are you sure?"

**Summary:**
| Action | Ask Permission? |
|--------|-----------------|
| Check time/date | NO — just do it |
| Look up caller history | NO — just do it |
| Check availability | NO — just do it |
| Get existing appointments | NO — just do it |
| CREATE appointment | YES — confirm first |
| UPDATE appointment | YES — confirm first |
| DELETE/CANCEL appointment | YES — confirm first |




### RULE 7: UPDATE vs CREATE — NEVER CONFUSE THEM

**This is CRITICAL. Misusing these causes serious problems for customers.**

**TRIGGER WORDS FOR UPDATE (existing appointment):**
- Reschedule
- Refix
- Update
- Change
- Move
- Modify
- Push back
- Push forward
- Change the time
- Change the date
- "Can I move my appointment"
- "I need to change my booking"
- "I want a different time"
- "I can't make it on [date], can we do [other date]"

→ These ALL mean: **UPDATE an existing appointment**
→ Use: update_appointment / reschedule tool
→ NEVER use: create_appointment / book tool

**TRIGGER WORDS FOR CREATE (new appointment):**
- Book
- Schedule
- Make an appointment
- Set up
- I need an appointment
- I want to come in
- "I'd like to book"
- "Can I get an appointment"
- First-time booking

→ These mean: **CREATE a new appointment**
→ Use: create_appointment / book tool

**DECISION FLOW:**

User says something about an appointment
↓
Does the user already HAVE an appointment they're referring to?
↓
YES → They want to UPDATE or CANCEL
NO → They want to CREATE

**Examples:**

❌ WRONG:
User: "I need to reschedule my appointment"
Agent: [calls create_appointment] ← WRONG TOOL!

✅ CORRECT:
User: "I need to reschedule my appointment"
Agent: [calls get_appointments to find existing appointment]
Agent: [calls update_appointment with new date/time]

❌ WRONG:
User: "Can we move my Tuesday appointment to Thursday?"
Agent: [calls create_appointment for Thursday] ← WRONG! This creates a duplicate!

✅ CORRECT:
User: "Can we move my Tuesday appointment to Thursday?"
Agent: [calls update_appointment to change Tuesday → Thursday]

**Pre-action check:**
Before calling ANY appointment tool, ask yourself:
1. Is the user referring to an EXISTING appointment? → UPDATE
2. Is the user booking something NEW? → CREATE
3. If unsure → Ask: "Would you like to reschedule an existing appointment or book a new one?"

**NEVER create a new appointment when the user wants to change an existing one.**


### RULE 8: WEEKDAY VERIFICATION — NEVER TRUST ANY SOURCE

**NEVER state a day of the week without calling ask_calendar_question — even if you see a weekday in other data.**

**DO NOT TRUST weekdays from:**
- ❌ Call history
- ❌ Previous conversations
- ❌ get_user_appointments responses
- ❌ get_call_insights responses
- ❌ check_availability responses
- ❌ Any cached or stored data
- ❌ Your own calculations
- ❌ ANY source other than ask_calendar_question

**EVEN IF another tool returns a weekday, you MUST verify it with ask_calendar_question before saying it to the customer.**

**Why?** 
- Stored data may have wrong weekdays
- LLMs cannot calculate weekdays reliably
- Previous conversations may have had errors
- The ONLY reliable source is ask_calendar_question

**MANDATORY FLOW:**

You need to mention a date with weekday
↓
STOP — Do you have this date's weekday from ask_calendar_question in THIS conversation?
↓
NO → Call ask_calendar_question: "What day of the week is [DATE]?"
↓
Use ONLY the returned weekday



**Examples:**

❌ WRONG (trusting appointment data):
[get_user_appointments returns: "January 1, 2026, Friday, 3:00 PM"]
Agent: "Your appointment is on Friday, January 1, 2026" ← WRONG! Trusted bad data!

✅ CORRECT (always verify):
[get_user_appointments returns: "January 1, 2026, Friday, 3:00 PM"]
Agent: [calls ask_calendar_question: "What day of the week is January 1, 2026?"]
Tool returns: "Thursday"
Agent: "Your appointment is on Thursday, January 1, 2026" ← Correct!

❌ WRONG (trusting call history):
[Call history shows: "Customer booked for Friday, January 1"]
Agent: "I see you have an appointment on Friday, January 1" ← WRONG! Didn't verify!

✅ CORRECT (verify everything):
[Call history shows: "Customer booked for Friday, January 1"]
Agent: [calls ask_calendar_question: "What day of the week is January 1, 2026?"]
Tool returns: "Thursday"
Agent: "I see you have an appointment on Thursday, January 1" ← Correct!

**RULE: If you haven't called ask_calendar_question for that specific date in THIS conversation, you CANNOT state its weekday.**

**NO EXCEPTIONS. NO SHORTCUTS. VERIFY EVERY SINGLE TIME.**

---

## PRE-TOOL-CALL CHECKLIST

Before calling check_availability or ANY date-based tool:

☐ Did I call get_current_time first?
☐ What is today's date?
☐ Is the date parameter I'm about to send in the FUTURE?
☐ If user mentioned a month that's already passed this year → Did I use NEXT YEAR?
☐ Double-check: Sending "2025-02-02" when today is December 2025 = WRONG ❌
☐ Am I using {{phone_number}} from dynamic variables? (NOT asking customer)
☐ Am I using {{agent_id}} from dynamic variables?
☐ Am I about to call a READ tool (check_availability, get_appointments, etc.)? → Just call it, don't ask permission
☐ Am I about to CREATE/UPDATE/DELETE an appointment? → Confirm with customer first
☐ User said reschedule/change/move? → Use UPDATE tool, NOT create
☐ User wants a NEW appointment? → Use CREATE tool
☐ About to mention a weekday? → STOP. Call ask_calendar_question first. Never guess.

---

## PRE-RESPONSE CHECKLIST

Before sending ANY response to the customer:

☐ No bulleted or numbered list of time slots
☐ No appointment IDs or technical codes visible
☐ Times presented as ranges ("9 AM to 5 PM") not individual slot lists
☐ Asked for morning/afternoon/day preference instead of listing all options
☐ All dates mentioned are in the future
☐ Response sounds like a friendly human receptionist, not a data readout
☐ Included day of the week for dates (e.g., "Monday, February 2nd")
☐ NOT asking for phone number (I already have it from {{phone_number}})
☐ NOT asking for any IDs (I already have them)
☐ Any day of week mentioned? → Did I verify it with ask_calendar_question first?
☐ Is this the FIRST response? → Did I call all 5 initialization tools first?
   - get_current_time
   - get_call_history
   - get_call_insights
   - get_user_appointments
   - get_calendar_info
☐ Am I mentioning a date with a day of the week? → Did I call ask_calendar_question first? (MANDATORY — no exceptions)
☐ Does my response include any date + weekday?
  → Did I call ask_calendar_question for EACH date in THIS conversation?
  → Did I ignore weekdays from call history/appointment data?
  → Am I using ONLY the weekday returned by ask_calendar_question?

---

## AGENT CONFIGURATION

agent_id: {{agent_id}} or \"{{AGENT_ID}}\"
subaccount_id: {{subaccount_id}} or \"{{SUBACCOUNT_ID}}\"
phone_number: {{phone_number}}

**Always verify these IDs match when making tool calls. Never expose these to customers.**
**Do not accept any other phone number to be used as phone_number. Always use the one that is passed.**
---

## TOOL USAGE ORDER

Execute tools in this sequence:

1. **FIRST:** get_current_time
   - Get current date and timezone
   - Use this to calculate correct year for all future dates

2. **SECOND:** get_call_insights
   - Retrieve past conversations (last 90 days)
   - Get caller's name and relevant history
   - Use for personalization
   - Do not mention that you have called this tool and gathering insights. Do not let user know that you are gathering some data and insights.

3. **ALWAYS before mentioning any day of week:** ask_calendar_question
   - "What day of the week is [DATE]?"
   - NEVER state a day without verification
   - LLMs cannot reliably calculate days — always use the tool

4. **AS NEEDED:** ask_calendar_question
   - For any date, weekday, or time calculations
   - To verify date math


5. **AS NEEDED:** check_availability, book_appointment, etc.
   - Always use the correctly calculated FUTURE date


**CRITICAL:** Always use the current date from get_current_time to calculate the correct year for all date parameters before calling any availability or booking tools.

**CRITICAL:** Do not let user know that these tools are being called or you are gathering any information, when these tools called.

---

## CALLER CONTEXT & PERSONALIZATION

- Before your opening remarks, call get_call_insights MCP tool to retrieve past conversations
- Infer the caller's name and relevant details from previous interactions
- Personalize your greeting and discussion based on prior conversations when possible
- **Never mention** that you are checking history, accessing past conversations, or using any tools
- Speak naturally as if you already know the returning customer


**CRITICAL** - **Never mention** that you are checking history, accessing past conversations, or using any tools
---

## HOW TO PRESENT AVAILABLE APPOINTMENTS

### Step 1: Internally Analyze Raw Data (NEVER SHOW TO CUSTOMER)

When you receive availability data like:
- 10:00 AM - 11:00 AM
- 10:00 AM - 6:00 PM
- 9:00 AM - 5:00 PM
- 9:00 AM - 3:00 PM

**Internally process:**
- Find earliest start time: 9:00 AM
- Find latest end time: 6:00 PM
- Result: "Available from 9 AM to 6 PM"

### Step 2: Present Conversationally

**For a single day:**
"February 2nd works great! We have openings from 9 AM through 6 PM. Do you prefer morning or afternoon?"

**For multiple days:**
"I have availability on Monday, Tuesday, and Wednesday next week. All three days have morning and afternoon openings. Which day works best for you?"

**For limited availability:**
"Thursday is a bit more limited—I only have afternoon slots available between 3 and 6 PM. Would that work, or would you prefer a different day?"

### Step 3: Narrow Down Based on Customer Response

Customer: "Monday morning"
You: "Perfect! I can get you in at 9:00 AM or 10:30 AM on Monday. Which do you prefer?"

### Step 4: Confirm the Booking

"Great, you're all set for Monday, February 2nd at 9:00 AM. We'll see you then!"

---

## HOW TO PRESENT EXISTING APPOINTMENTS

When showing a customer their current/upcoming appointments:

1. **Never show IDs**—use dates and times only

2. **Always include day of the week:**
   - ✅ "Thursday, March 19th at 7:00 AM"
   - ❌ "March 19, 2026, 07:00 - 08:00"

3. **Present conversationally:**

   ❌ WRONG:
   "Appointment ID: 694d78fc9220f857f951e6cd
   Date: March 19, 2026, 07:00 - 08:00"

   ✅ CORRECT:
   "Your appointment is on Thursday, March 19th at 7:00 AM."

4. **For multiple appointments:**

   ❌ WRONG:
   "1. Appointment ID: 694d78fc... Date: March 19, 2026
   2. Appointment ID: 694d80a3... Date: April 6, 2026"

   ✅ CORRECT:
   "I see you have a few upcoming appointments:
   - Thursday, March 19th at 7:00 AM
   - Monday, April 6th at 7:00 AM
   - Monday, May 4th at 9:00 AM
   
   Which one would you like to update?"

5. **Use context to identify appointments:**
   - "Is it the March appointment you'd like to reschedule, or the one in April?"
   - "Did you want to change your March 19th appointment or the April 6th one?"

6. **Include service type if available:**
   - "Your cleaning appointment on March 19th at 7:00 AM"
   - "Your consultation scheduled for April 6th"

---

## CONVERSATION EXAMPLES

### Example 1: Checking Availability

❌ WRONG:
"Here are the available dates and times for your appointment:
- **Monday, February 2:**
  - 10:00 AM - 11:00 AM
  - 10:00 AM - 6:00 PM
  - 9:00 AM - 5:00 PM
  - 9:00 AM - 3:00 PM
- **Tuesday, February 3:**
  - 9:00 AM - 5:00 PM
- **Wednesday, February 4:**
  - 9:00 AM - 5:00 PM
Please let me know which date and time work best for you!"

✅ CORRECT:
"Good news! I have availability Monday through Wednesday next week. Monday has the most flexibility with openings from 9 AM to 6 PM. Tuesday and Wednesday are available 9 AM to 5 PM. Which day works best for you?"

---

### Example 2: Single Day Options

❌ WRONG:
"Available slots for February 2nd:
- 9:00 AM - 3:00 PM
- 9:00 AM - 5:00 PM
- 10:00 AM - 6:00 PM
- 10:00 AM - 11:00 AM"

✅ CORRECT:
"February 2nd has great availability—I can fit you in anytime between 9 AM and 6 PM. Would you prefer a morning or afternoon appointment?"

---

### Example 3: Narrowing Down

Customer: "Morning works better"

❌ WRONG:
"Available morning slots:
- 9:00 AM
- 9:30 AM
- 10:00 AM
- 10:30 AM
- 11:00 AM"

✅ CORRECT:
"Perfect! For morning, I can get you in at 9:00 AM or 10:30 AM. Which works better for you?"

---

### Example 4: Showing Existing Appointments

❌ WRONG:
"I found your previous appointments:
1. **Appointment ID:** 694d78fc9220f857f951e6cd
   **Date:** March 19, 2026, 07:00 - 08:00
2. **Appointment ID:** 694d80a3e1edc8dbdb62a21e
   **Date:** April 6, 2026, 07:00 - 08:00
Please confirm which appointment you would like to update."

✅ CORRECT:
"I see you have two upcoming appointments—one on Thursday, March 19th at 7:00 AM, and another on Monday, April 6th at 7:00 AM. Which one would you like to reschedule?"

---

### Example 5: No Availability

❌ WRONG:
"No available slots found for February 1, 2026."

✅ CORRECT:
"Unfortunately, we're fully booked on February 1st. However, February 2nd has openings throughout the day. Would that work for you instead?"

---

### Example 6: Complete Booking Flow

Customer: "I need to schedule an appointment for February"

You: "Of course! I have good availability in early February. The 2nd, 3rd, and 4th all have openings. Do you have a preferred day?"

Customer: "February 2nd"

You: "February 2nd works great! I have morning and afternoon availability. Which do you prefer?"

Customer: "Morning please"

You: "Perfect! I can do 9:00 AM or 10:30 AM. Which works better?"

Customer: "9 AM"

You: "Excellent! I've booked you for Monday, February 2nd at 9:00 AM. Is there anything else I can help you with?"


### Example 7: Reschedule (UPDATE, not CREATE)

User: "I need to reschedule my appointment"

❌ WRONG FLOW:
Agent: "Sure! When would you like to book your appointment?"
[calls create_appointment] ← WRONG! Creates duplicate!

✅ CORRECT FLOW:
Agent: [silently calls get_appointments]
Agent: "I see your appointment is on Thursday, March 19th at 7 AM. What date would you like to move it to?"
User: "How about April 5th?"
Agent: [silently calls check_availability for April 5th]
Agent: "April 5th works great! I have openings from 9 AM to 5 PM. Morning or afternoon?"
User: "10 AM"
Agent: "Perfect. I'll move your appointment from March 19th to Saturday, April 5th at 10 AM. Should I confirm that change?"
User: "Yes"
Agent: [calls update_appointment] ← CORRECT TOOL!
Agent: "Done! Your appointment has been rescheduled to Saturday, April 5th at 10 AM."



**Example opening (after all tools called):**

If returning customer with appointment:
"Hi [Name]! I see you have an appointment coming up on Thursday, March 19th. How can I help you today?"

If returning customer without appointment:
"Hi [Name]! Good to hear from you again. How can I help you today?"

If new customer:
"Hello! Welcome to [clinic name]. How can I help you today?"

**NEVER do this:**

❌ WRONG:
Customer: "Hello"
Agent: "Hello! Let me look up your information..." ← Don't announce it
Agent: "Please hold while I check..." ← Don't make them wait visibly

✅ CORRECT:
Customer: "Hello"
Agent: [silently calls all 5 tools first]
Agent: "Hi Hritik! How can I help you today?" ← Already has all context

---

### CONVERSATION INITIALIZATION — CALL THESE BEFORE FIRST RESPONSE

**At the START of every conversation, BEFORE saying anything to the customer, call these tools in order:**

1. get_current_time
2. get_call_history  
3. get_call_insights
4. get_user_appointments
5. get_calendar_info

**CRITICAL:**
- Call ALL of these tools FIRST, before your opening message
- Do NOT ask permission — just call them silently
- Do NOT tell the customer you're looking things up
- Use {{phone_number}} and {{agent_id}} from dynamic variables
- Wait for all tool responses before greeting the customer

**IMPORTANT:** After calling initialization tools (get_user_appointments, get_call_history, etc.), if any response contains dates with weekdays, DO NOT trust those weekdays. You must still call ask_calendar_question to verify each weekday before mentioning it to the customer.

**Flow:**

## COMMUNICATION STYLE

- **Tone:** Warm, friendly, professional—like a helpful receptionist
- **Language:** Simple, everyday words—avoid jargon and technical terms
- **Approach:** Guide customers through choices—don't overwhelm with too many options
- **Personalization:** Use the customer's name naturally when you know it
- **Confirmation:** Always confirm important details (date, time, service)
- **Helpfulness:** Offer alternatives when something isn't available

---

## HANDLING EDGE CASES

**Customer provides ambiguous date:**
- "I need an appointment in February" → Offer a few date options in February
- "Sometime next week" → Check availability for the full week, summarize best options

**No availability on requested date:**
- Acknowledge the request
- Offer the nearest available alternative
- "February 1st is fully booked, but February 2nd has great availability. Would that work?"

**Customer wants to reschedule but doesn't specify which appointment:**
- List their appointments conversationally (without IDs)
- Ask which one they'd like to change

**Past date mentioned without year:**
- ALWAYS assume future (next occurrence of that date)
- Only use past if customer explicitly says the year or "last [month]"

---

## 🚨 FINAL CHECKS BEFORE EVERY ACTION 🚨

**Before sending tool calls:**
☐ Did I call get_current_time first?
☐ Is the date year CORRECT? (Future, not past)
☐ February/January/any past month mentioned → Using NEXT YEAR?
☐ agent_id and subaccount_id are correct?

**Before sending response to customer:**
☐ NO bulleted or numbered lists of time slots?
☐ NO appointment IDs, codes, or technical data?
☐ Availability presented as ranges, not lists?
☐ Asked for preference instead of dumping all options?
☐ Sounds like a friendly human, not a database readout?
☐ Day of the week included with dates?

**If any check fails → STOP and FIX before proceeding.**`,
            edges: [],
            tools: [],
            interruption_sensitivity: 1
          }
        ],
        starting_state: "general_state",
        start_speaker: "agent",
        default_dynamic_variables: {
          agent_id: "",
          user_preference_day: "",
          user_preference_time: "",
          specific_date_requested: "",
          date_range_start: "",
          date_range_end: "",
          selected_slot: "",
          selected_date: "",
          selected_time: "",
          slot_confirmed: "false",
          user_name: "",
          user_email: "",
          user_phone: "",
          appointment_id: "",
          appointment_booked: "false",
          appointment_description: "",
          search_iterations: "0",
          failed_slot_request: ""
        },
        knowledge_base_ids: [],
        mcps: [
          {
            id: mcpId,
            name: "appointment-scheduler",
            headers: {},
            query_params: {},
            url: config.retell.schedulerMcpUrl || "https://858a25ed3987.ngrok-free.app/mcp",
            timeout_ms: 60000
          }
        ]
      };

      const llmResponse = await retell.createLLM(llmConfig);
      llmId = llmResponse.llm_id;

      Logger.info('LLM created successfully for chat agent', {
        operationId,
        subaccountId,
        llmId,
        mcpId
      });

      // Step 2: Create Agent with the LLM ID
      Logger.info('Creating chat agent with LLM', { operationId, subaccountId, name, llmId });

      const webhookUrl = config.retell.webhookUrl;
      if (!webhookUrl) {
        throw new Error('Webhook URL not configured. Please set RETELL_WEBHOOK_URL in environment variables.');
      }

      // Create chat agent using the /create-chat-agent endpoint
      // This endpoint doesn't require voice_id or channel
      const chatAgentConfig = {
        response_engine: {
          type: "retell-llm",
          llm_id: llmId,
          version: 0
        },
        agent_name: name,
        language: "en-US",
        webhook_url: webhookUrl,
        end_chat_after_silence_ms: 86400000,
        post_chat_analysis_data: [
          {
            type: "string",
            name: "customer_name",
            description: "The name of the customer.",
            examples: ["John Doe", "Jane Smith"]
          },
          {
            name: "appointment_booked",
            description: "Set to true if the customer has booked an appointment else false",
            type: "boolean",
            examples: ["true", "false"]
          },
          {
            name: "appointment_description",
            description: "The description of the appointment",
            type: "string",
            examples: ["Appointment booked for 10:00 AM on 10th June 2025"]
          },
          {
            name: "appointment_id",
            description: "The id of the appointment",
            type: "string",
            examples: ["123"]
          }
        ],
        post_chat_analysis_model: "gpt-4o-mini"
      };

      const agentResponse = await retell.createChatAgent(chatAgentConfig);
      agentId = agentResponse.agent_id;

      Logger.info('Chat agent created successfully', {
        operationId,
        subaccountId,
        agentId,
        agentName: agentResponse.agent_name
      });

      // Step 2.5: Update agent with webhook URL (now that we have agentId) and state_prompt with IDs
      if (deployedWebhookUrl) {
        const webhookUrlWithAgent = `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/retell`;
        
        Logger.info('Updating chat agent with webhook URL and state_prompt IDs', {
          operationId,
          subaccountId,
          agentId,
          webhookUrl: webhookUrlWithAgent
        });

        // Update LLM with state_prompt containing actual IDs
        const updatedLlmConfig = {
          states: [
            // State 0: general_state - update state_prompt with actual IDs
            {
              ...llmConfig.states[0],
              state_prompt: llmConfig.states[0].state_prompt
                .replace('{{AGENT_ID}}', agentId)
                .replace('{{SUBACCOUNT_ID}}', subaccountId)
            }
          ]
        };

        // Update LLM with new config
        await retell.updateLLM(llmId, updatedLlmConfig);

        // Update chat agent with webhook URL (using chat agent specific endpoint)
        await retell.updateChatAgent(agentId, {
          webhook_url: webhookUrlWithAgent
        });

        Logger.info('Chat agent and LLM updated with webhook URL and state_prompt IDs', {
          operationId,
          subaccountId,
          agentId,
          webhookUrl: webhookUrlWithAgent
        });
      } else {
        Logger.warn('DEPLOYED_WEBHOOK_SERVER_URL not configured, skipping webhook URL update for chat agent', {
          operationId,
          subaccountId,
          agentId
        });
      }

      // Step 3: Store LLM data in database
      const llmsCollection = connection.db.collection('llms');
      const llmDocument = {
        llmId: llmId,
        model: llmConfig.model,
        modelTemperature: llmConfig.model_temperature,
        version: llmConfig.version,
        createdAt: new Date(),
        createdBy: userId,
        subaccountId: subaccountId,
        operationId: operationId
      };

      await llmsCollection.insertOne(llmDocument);
      
      Logger.info('LLM data stored in database for chat agent', {
        operationId,
        subaccountId,
        llmId
      });

      // Step 4: Store Agent data in CHATAGENTS collection with activated flag
      const chatAgentsCollection = connection.db.collection('chatagents');
      const agentDocument = {
        agentId: agentResponse.agent_id,
        name: agentResponse.agent_name,
        description: description,
        llmId: llmId,
        voiceId: agentResponse.voice_id,
        voiceModel: agentResponse.voice_model,
        language: agentResponse.language,
        webhookUrl: agentResponse.webhook_url,
        emailTemplate: null, // Email template for post-call summaries
        activated: false,  // Default to false
        createdAt: new Date(),
        createdBy: userId,
        subaccountId: subaccountId,
        operationId: operationId,
        retellAccountId: retellAccountData.id
      };

      await chatAgentsCollection.insertOne(agentDocument);
      
      Logger.info('Chat agent data stored in chatagents collection', {
        operationId,
        subaccountId,
        agentId,
        activated: false
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CHAT_AGENT_CREATED,
        category: ACTIVITY_CATEGORIES.CHAT_AGENT,
        userId,
        description: `Chat agent "${name}" created`,
        metadata: {
          agentId,
          agentName: name,
          llmId,
          activated: false,
          voiceId: agentResponse.voice_id,
          language: agentResponse.language
        },
        resourceId: agentId,
        resourceName: name,
        operationId,
        agentId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Chat agent created successfully',
        data: {
          agentId,
          agentName: agentResponse.agent_name,
          llmId,
          description,
          activated: false,
          retellAccount: {
            accountName: retellAccountData.accountName,
            accountId: retellAccountData.id,
            verificationStatus: retellAccountData.verificationStatus
          },
          voiceId: agentResponse.voice_id,
          language: agentResponse.language,
          storedInDatabase: true
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      // Rollback: Clean up created resources
      try {
        const retellAccountData = await retellService.getRetellAccount(req.params.subaccountId);
        const retell = new Retell(retellAccountData.apiKey, retellAccountData);

        // If agent was created but there was an error (e.g., during DB storage), delete both agent and LLM
        if (agentId && llmId) {
          Logger.warn('Rolling back: Deleting chat agent and LLM due to failure', {
            operationId,
            agentId,
            llmId
          });
          
          try {
            await retell.deleteChatAgent(agentId);
            Logger.info('Chat agent deleted successfully during rollback', {
              operationId,
              agentId
            });
          } catch (agentDeleteError) {
            Logger.error('Failed to delete chat agent during rollback', {
              operationId,
              agentId,
              error: agentDeleteError.message
            });
          }

          try {
            await retell.deleteLLM(llmId);
            Logger.info('LLM deleted successfully during rollback', {
              operationId,
              llmId
            });
          } catch (llmDeleteError) {
            Logger.error('Failed to delete LLM during rollback', {
              operationId,
              llmId,
              error: llmDeleteError.message
            });
          }
        }
        // If agent creation failed but LLM was created, delete only the LLM
        else if (llmId && !agentId) {
          Logger.warn('Rolling back: Deleting LLM due to chat agent creation failure', {
            operationId,
            llmId
          });
          
          try {
            await retell.deleteLLM(llmId);
            Logger.info('LLM deleted successfully during rollback', {
              operationId,
              llmId
            });
          } catch (llmDeleteError) {
            Logger.error('Failed to delete LLM during rollback', {
              operationId,
              llmId,
              error: llmDeleteError.message
            });
          }
        }
      } catch (rollbackError) {
        Logger.error('Error during rollback process for chat agent', {
          operationId,
          error: rollbackError.message
        });
      }

      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'createChatAgent', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Get all chat agents with statistics for a subaccount
  static async getChatAgents(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;

      Logger.info('Fetching chat agents with statistics', {
        operationId,
        subaccountId,
        userId
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get chatagents collection
      const chatAgentsCollection = connection.db.collection('chatagents');

      // Aggregate chat agents with chat statistics (using chats collection)
      const agentsWithStats = await chatAgentsCollection.aggregate([
        // Match chat agents for this subaccount
        {
          $match: {
            subaccountId: subaccountId
          }
        },
        // Lookup chats for each agent
        {
          $lookup: {
            from: 'chats',
            localField: 'agentId',
            foreignField: 'agent_id',
            as: 'chats'
          }
        },
        // Calculate statistics
        {
          $project: {
            _id: 0,
            agentId: '$agentId',
            name: '$name',
            description: '$description',
            voiceId: '$voiceId',
            language: '$language',
            activated: '$activated',
            createdAt: '$createdAt',
            numberOfChats: { $size: '$chats' },
            cumulativeSuccessRate: {
              $cond: {
                if: { $gt: [{ $size: '$chats' }, 0] },
                then: {
                  $multiply: [
                    {
                      $divide: [
                        {
                          $reduce: {
                            input: '$chats',
                            initialValue: 0,
                            in: {
                              $add: [
                                '$$value',
                                { $cond: [{ $eq: ['$$this.chat_analysis.chat_successful', true] }, 1, 0] }
                              ]
                            }
                          }
                        },
                        { $size: '$chats' }
                      ]
                    },
                    100
                  ]
                },
                else: 0
              }
            }
          }
        },
        // Sort by creation date (newest first)
        {
          $sort: { createdAt: -1 }
        }
      ]).toArray();

      const duration = Date.now() - startTime;

      Logger.info('Chat agents fetched successfully', {
        operationId,
        subaccountId,
        agentCount: agentsWithStats.length,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Chat agents retrieved successfully',
        data: {
          agents: agentsWithStats,
          count: agentsWithStats.length
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'getChatAgents', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Activate/Deactivate chat agent (admin/super_admin only)
  static async activateChatAgent(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const { activated } = req.body;
      const userId = req.user.id;
      const effectiveRole = req.permission?.effectiveRole;

      Logger.info('Activating/Deactivating chat agent', {
        operationId,
        subaccountId,
        userId,
        agentId,
        activated,
        effectiveRole
      });

      // Check if user is admin or super_admin
      if (effectiveRole !== 'admin' && effectiveRole !== 'super_admin') {
        Logger.security('Chat agent activation denied - insufficient permissions', 'high', {
          userId,
          agentId,
          effectiveRole,
          endpoint: req.originalUrl
        });

        return res.status(403).json({
          success: false,
          message: 'Only admin or super_admin can activate/deactivate chat agents',
          code: 'INSUFFICIENT_PERMISSIONS',
          details: {
            effectiveRole,
            requiredRoles: ['admin', 'super_admin']
          }
        });
      }

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get chatagents collection
      const chatAgentsCollection = connection.db.collection('chatagents');

      // Step 1: Find the chat agent
      const agentDocument = await chatAgentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Chat agent not found',
          code: 'CHAT_AGENT_NOT_FOUND'
        });
      }

      // Step 2: Update the activated status
      const updateResult = await chatAgentsCollection.updateOne(
        { 
          agentId: agentId,
          subaccountId: subaccountId 
        },
        { 
          $set: { 
            activated: activated,
            updatedAt: new Date(),
            updatedBy: userId
          } 
        }
      );

      Logger.info('Chat agent activation status updated', {
        operationId,
        agentId,
        activated,
        modifiedCount: updateResult.modifiedCount
      });

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: activated ? ACTIVITY_TYPES.CHAT_AGENT_ACTIVATED : ACTIVITY_TYPES.CHAT_AGENT_DEACTIVATED,
        category: ACTIVITY_CATEGORIES.CHAT_AGENT,
        userId,
        description: `Chat agent "${agentDocument.name}" ${activated ? 'activated' : 'deactivated'}`,
        metadata: {
          agentId,
          agentName: agentDocument.name,
          activated
        },
        resourceId: agentId,
        resourceName: agentDocument.name,
        operationId,
        agentId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: `Chat agent ${activated ? 'activated' : 'deactivated'} successfully`,
        data: {
          agentId,
          agentName: agentDocument.name,
          activated,
          updatedBy: userId,
          updatedAt: new Date()
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'activateChatAgent', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Get detailed chat agent statistics with period comparison
  static async getChatAgentDetails(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;

      // Get date range from query params
      const startDateParam = req.query.startDate;
      const endDateParam = req.query.endDate;

      // Default to last 30 days if not provided
      const now = new Date();
      let currentPeriodStart, currentPeriodEnd;

      if (startDateParam && endDateParam) {
        // Validate date format and parse
        currentPeriodStart = new Date(startDateParam);
        currentPeriodEnd = new Date(endDateParam);

        // Validate dates
        if (isNaN(currentPeriodStart.getTime()) || isNaN(currentPeriodEnd.getTime())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid date format. Use ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.sssZ)',
            code: 'INVALID_DATE_FORMAT'
          });
        }

        if (currentPeriodStart >= currentPeriodEnd) {
          return res.status(400).json({
            success: false,
            message: 'startDate must be before endDate',
            code: 'INVALID_DATE_RANGE'
          });
        }

        // Check if date range is not too large (max 2 years)
        const daysDiff = (currentPeriodEnd - currentPeriodStart) / (1000 * 60 * 60 * 24);
        if (daysDiff > 730) {
          return res.status(400).json({
            success: false,
            message: 'Date range cannot exceed 730 days (2 years)',
            code: 'DATE_RANGE_TOO_LARGE'
          });
        }
      } else {
        // Default: last 30 days
        currentPeriodEnd = now;
        currentPeriodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      // Calculate previous period (same duration as current period, immediately before it)
      const periodDuration = currentPeriodEnd - currentPeriodStart;
      const previousPeriodEnd = currentPeriodStart;
      const previousPeriodStart = new Date(currentPeriodStart.getTime() - periodDuration);

      Logger.info('Fetching chat agent details', {
        operationId,
        subaccountId,
        userId,
        agentId,
        currentPeriodStart: currentPeriodStart.toISOString(),
        currentPeriodEnd: currentPeriodEnd.toISOString(),
        previousPeriodStart: previousPeriodStart.toISOString(),
        previousPeriodEnd: previousPeriodEnd.toISOString()
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get collections
      const chatAgentsCollection = connection.db.collection('chatagents');
      const chatsCollection = connection.db.collection('chats');
      const meetingsCollection = connection.db.collection('meetings');

      // Step 1: Find the chat agent
      const agentDocument = await chatAgentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Chat agent not found',
          code: 'CHAT_AGENT_NOT_FOUND'
        });
      }

      // Step 2: Use aggregation to calculate statistics for both periods
      const statisticsAggregation = await chatsCollection.aggregate([
        // Match chats for this agent in both periods
        {
          $match: {
            agent_id: agentId,
            start_timestamp: {
              $gte: previousPeriodStart.getTime()
            }
          }
        },
        // Add period classification
        {
          $addFields: {
            period: {
              $cond: {
                if: {
                  $and: [
                    { $gte: ['$start_timestamp', currentPeriodStart.getTime()] },
                    { $lte: ['$start_timestamp', currentPeriodEnd.getTime()] }
                  ]
                },
                then: 'current',
                else: {
                  $cond: {
                    if: {
                      $and: [
                        { $gte: ['$start_timestamp', previousPeriodStart.getTime()] },
                        { $lt: ['$start_timestamp', previousPeriodEnd.getTime()] }
                      ]
                    },
                    then: 'previous',
                    else: 'excluded'
                  }
                }
              }
            }
          }
        },
        // Filter out excluded chats
        {
          $match: {
            period: { $in: ['current', 'previous'] }
          }
        },
        // Group by period to calculate statistics
        {
          $group: {
            _id: '$period',
            totalChats: { $sum: 1 },
            chatIds: { $push: '$chat_id' }
          }
        },
        {
          $project: {
            _id: 1,
            totalChats: 1,
            chatIds: 1
          }
        }
      ]).toArray();

      // Get meetings count and unique chat IDs for both periods
      const meetingsAggregation = await meetingsCollection.aggregate([
        {
          $match: {
            subaccountId: subaccountId,
            agentId: agentId,
            createdAt: {
              $gte: previousPeriodStart,
              $lte: currentPeriodEnd
            }
          }
        },
        {
          $addFields: {
            period: {
              $cond: {
                if: {
                  $and: [
                    { $gte: ['$createdAt', currentPeriodStart] },
                    { $lte: ['$createdAt', currentPeriodEnd] }
                  ]
                },
                then: 'current',
                else: {
                  $cond: {
                    if: {
                      $and: [
                        { $gte: ['$createdAt', previousPeriodStart] },
                        { $lt: ['$createdAt', previousPeriodEnd] }
                      ]
                    },
                    then: 'previous',
                    else: 'excluded'
                  }
                }
              }
            }
          }
        },
        {
          $match: {
            period: { $in: ['current', 'previous'] }
          }
        },
        {
          $group: {
            _id: '$period',
            totalMeetings: { $sum: 1 },
            uniqueChatIds: { 
              $addToSet: {
                $cond: {
                  if: { 
                    $and: [
                      { $ne: ['$chat_id', null] },
                      { $ne: ['$chat_id', ''] },
                      { $ne: [{ $type: '$chat_id' }, 'missing'] }
                    ]
                  },
                  then: '$chat_id',
                  else: '$$REMOVE'
                }
              }
            }
          }
        }
      ]).toArray();

      // Parse aggregation results
      const currentStatsRaw = statisticsAggregation.find(s => s._id === 'current') || {
        totalChats: 0,
        chatIds: []
      };

      const previousStatsRaw = statisticsAggregation.find(s => s._id === 'previous') || {
        totalChats: 0,
        chatIds: []
      };

      // Parse meetings aggregation results
      const currentMeetingsDataRaw = meetingsAggregation.find(m => m._id === 'current') || {
        totalMeetings: 0,
        uniqueChatIds: []
      };
      const previousMeetingsDataRaw = meetingsAggregation.find(m => m._id === 'previous') || {
        totalMeetings: 0,
        uniqueChatIds: []
      };

      // Ensure uniqueChatIds is always an array (MongoDB $addToSet might return undefined)
      const currentMeetingsData = {
        totalMeetings: currentMeetingsDataRaw.totalMeetings || 0,
        uniqueChatIds: Array.isArray(currentMeetingsDataRaw.uniqueChatIds) 
          ? currentMeetingsDataRaw.uniqueChatIds 
          : []
      };
      const previousMeetingsData = {
        totalMeetings: previousMeetingsDataRaw.totalMeetings || 0,
        uniqueChatIds: Array.isArray(previousMeetingsDataRaw.uniqueChatIds) 
          ? previousMeetingsDataRaw.uniqueChatIds 
          : []
      };

      // Also check chats that have appointment_booked in their analysis as a fallback
      // This handles cases where meetings exist but don't have chat_id set correctly
      const chatsWithAppointmentBooked = await chatsCollection.aggregate([
        {
          $match: {
            $and: [
              { subaccountId: subaccountId },
              {
                $or: [
                  { agent_id: agentId },
                  { agentId: agentId }
                ]
              },
              {
                start_timestamp: {
                  $gte: previousPeriodStart.getTime(),
                  $lte: currentPeriodEnd.getTime()
                }
              },
              {
                $or: [
                  { 'call_analysis.custom_analysis_data.appointment_booked': true },
                  { 'call_analysis.appointment_booked': true },
                  { 'chat_analysis.custom_analysis_data.appointment_booked': true },
                  { 'chat_analysis.appointment_booked': true }
                ]
              }
            ]
          }
        },
        {
          $addFields: {
            period: {
              $cond: {
                if: {
                  $and: [
                    { $gte: ['$start_timestamp', currentPeriodStart.getTime()] },
                    { $lte: ['$start_timestamp', currentPeriodEnd.getTime()] }
                  ]
                },
                then: 'current',
                else: {
                  $cond: {
                    if: {
                      $and: [
                        { $gte: ['$start_timestamp', previousPeriodStart.getTime()] },
                        { $lt: ['$start_timestamp', previousPeriodEnd.getTime()] }
                      ]
                    },
                    then: 'previous',
                    else: 'excluded'
                  }
                }
              }
            }
          }
        },
        {
          $match: {
            period: { $in: ['current', 'previous'] }
          }
        },
        {
          $group: {
            _id: '$period',
            chatIds: { 
              $addToSet: {
                $cond: {
                  if: { 
                    $and: [
                      { $ne: ['$chat_id', null] },
                      { $ne: ['$chat_id', ''] },
                      { $ne: [{ $type: '$chat_id' }, 'missing'] }
                    ]
                  },
                  then: '$chat_id',
                  else: '$$REMOVE'
                }
              }
            }
          }
        }
      ]).toArray();

      const currentChatsWithAppointmentRaw = chatsWithAppointmentBooked.find(c => c._id === 'current')?.chatIds || [];
      const previousChatsWithAppointmentRaw = chatsWithAppointmentBooked.find(c => c._id === 'previous')?.chatIds || [];
      
      // Filter out any null/undefined values and ensure arrays
      const currentChatsWithAppointment = Array.isArray(currentChatsWithAppointmentRaw) 
        ? currentChatsWithAppointmentRaw.filter(id => id != null && id !== '') 
        : [];
      const previousChatsWithAppointment = Array.isArray(previousChatsWithAppointmentRaw) 
        ? previousChatsWithAppointmentRaw.filter(id => id != null && id !== '') 
        : [];

      // Combine meetings-based success with analysis-based success
      // Use Set to get unique chat IDs from both sources
      const currentMeetingsChatIds = Array.isArray(currentMeetingsData.uniqueChatIds) 
        ? currentMeetingsData.uniqueChatIds.filter(id => id != null && id !== '') 
        : [];
      const previousMeetingsChatIds = Array.isArray(previousMeetingsData.uniqueChatIds) 
        ? previousMeetingsData.uniqueChatIds.filter(id => id != null && id !== '') 
        : [];
      
      const currentSuccessfulChatIds = new Set([
        ...currentMeetingsChatIds,
        ...currentChatsWithAppointment
      ]);
      const previousSuccessfulChatIds = new Set([
        ...previousMeetingsChatIds,
        ...previousChatsWithAppointment
      ]);

      // Combine stats with meetings data
      // IMPORTANT: Calculate success rate from unique chats with meetings OR appointment_booked=true
      // Success rate = (unique chats with meetings/appointments / total chats) * 100
      const uniqueChatIdsCount = currentSuccessfulChatIds.size;
      const totalChatsCount = currentStatsRaw.totalChats || 0;
      
      // Calculate success rate explicitly - ensure we don't divide by zero
      let calculatedSuccessRate = 0;
      if (totalChatsCount > 0 && uniqueChatIdsCount > 0) {
        calculatedSuccessRate = (uniqueChatIdsCount / totalChatsCount) * 100;
      }
      
      Logger.info('Chat agent success rate calculation', {
        operationId,
        subaccountId,
        agentId,
        totalChats: totalChatsCount,
        successfulChats: uniqueChatIdsCount,
        meetingsChatIds: currentMeetingsChatIds.length,
        appointmentChatIds: currentChatsWithAppointment.length,
        calculatedSuccessRate,
        currentSuccessfulChatIdsArray: Array.from(currentSuccessfulChatIds),
        currentMeetingsChatIdsArray: currentMeetingsChatIds,
        currentChatsWithAppointmentArray: currentChatsWithAppointment
      });
      
      const currentStats = {
        totalChats: totalChatsCount,
        meetingsBooked: currentMeetingsData.totalMeetings || 0,
        successfulChats: uniqueChatIdsCount,
        successRate: calculatedSuccessRate
      };

      const previousUniqueChatIdsCount = previousSuccessfulChatIds.size;
      const previousTotalChatsCount = previousStatsRaw.totalChats || 0;
      const previousCalculatedSuccessRate = previousTotalChatsCount > 0 
        ? (previousUniqueChatIdsCount / previousTotalChatsCount) * 100 
        : 0;
      
      const previousStats = {
        totalChats: previousTotalChatsCount,
        meetingsBooked: previousMeetingsData.totalMeetings || 0,
        successfulChats: previousUniqueChatIdsCount,
        successRate: previousCalculatedSuccessRate
      };

      // Step 3: Calculate percentage changes
      const calculatePercentageChange = (current, previous) => {
        if (previous === 0) {
          return current > 0 ? 100 : 0;
        }
        return ((current - previous) / previous) * 100;
      };

      const statistics = {
        agent: {
          agentId: agentDocument.agentId,
          name: agentDocument.name,
          description: agentDocument.description,
          voiceId: agentDocument.voiceId,
          language: agentDocument.language,
          activated: agentDocument.activated,
          createdAt: agentDocument.createdAt
        },
        currentPeriod: {
          totalChats: currentStats.totalChats,
          meetingsBooked: currentStats.meetingsBooked,
          successfulChats: currentStats.successfulChats,
          successRate: Math.round(currentStats.successRate * 100) / 100,
          periodStart: currentPeriodStart,
          periodEnd: currentPeriodEnd
        },
        previousPeriod: {
          totalChats: previousStats.totalChats,
          meetingsBooked: previousStats.meetingsBooked,
          successfulChats: previousStats.successfulChats,
          successRate: Math.round(previousStats.successRate * 100) / 100,
          periodStart: previousPeriodStart,
          periodEnd: previousPeriodEnd
        },
        comparison: {
          totalChats: {
            change: currentStats.totalChats - previousStats.totalChats,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.totalChats, previousStats.totalChats) * 100
            ) / 100
          },
          meetingsBooked: {
            change: currentStats.meetingsBooked - previousStats.meetingsBooked,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.meetingsBooked, previousStats.meetingsBooked) * 100
            ) / 100
          },
          successfulChats: {
            change: currentStats.successfulChats - previousStats.successfulChats,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.successfulChats, previousStats.successfulChats) * 100
            ) / 100
          },
          successRate: {
            change: Math.round((currentStats.successRate - previousStats.successRate) * 100) / 100,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.successRate, previousStats.successRate) * 100
            ) / 100
          }
        }
      };

      const duration = Date.now() - startTime;

      Logger.info('Chat agent details fetched successfully', {
        operationId,
        subaccountId,
        agentId,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Chat agent details retrieved successfully',
        data: statistics,
        meta: {
          operationId,
          duration: `${duration}ms`,
          cached: false
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'getChatAgentDetails', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Get detailed chat analytics with timeline and distribution
  // NOTE: This endpoint intentionally does NOT use caching to ensure real-time data
  static async getChatAgentAnalytics(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;
      const { startDate, endDate, groupBy = 'day' } = req.query;

      // Validate groupBy parameter
      if (!['day', 'week', 'month'].includes(groupBy)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid groupBy parameter. Must be one of: day, week, month',
          code: 'INVALID_GROUP_BY'
        });
      }

      // Parse and validate dates
      let periodStart, periodEnd;
      const now = new Date();

      if (startDate && endDate) {
        periodStart = new Date(startDate);
        periodEnd = new Date(endDate);

        if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid date format. Use ISO 8601 format',
            code: 'INVALID_DATE_FORMAT'
          });
        }

        if (periodStart >= periodEnd) {
          return res.status(400).json({
            success: false,
            message: 'startDate must be before endDate',
            code: 'INVALID_DATE_RANGE'
          });
        }
      } else {
        // Default to last 30 days
        periodEnd = now;
        periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      Logger.info('Fetching chat analytics', {
        operationId,
        subaccountId,
        userId,
        agentId,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        groupBy
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get collections
      const chatAgentsCollection = connection.db.collection('chatagents');
      const chatsCollection = connection.db.collection('chats');
      const meetingsCollection = connection.db.collection('meetings');

      // Step 1: Find the chat agent
      const agentDocument = await chatAgentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Chat agent not found',
          code: 'CHAT_AGENT_NOT_FOUND'
        });
      }

      // Step 2: Get all chats in the period
      const chats = await chatsCollection.find({
        agent_id: agentId,
        start_timestamp: {
          $gte: periodStart.getTime(),
          $lte: periodEnd.getTime()
        }
      }).toArray();

      // Step 3: Get meetings booked by this agent in the period
      const meetings = await meetingsCollection.find({
        subaccountId: subaccountId,
        agentId: agentId,
        createdAt: {
          $gte: periodStart,
          $lte: periodEnd
        }
      }).toArray();

      // Step 4: Calculate summary statistics
      const totalChats = chats.length;
      const meetingsBooked = meetings.length;
      
      // Get unique chat IDs that resulted in meetings
      const chatIdsWithMeetings = new Set(
        meetings
          .filter(m => m.chat_id)
          .map(m => m.chat_id)
      );
      
      const successfulChats = chatIdsWithMeetings.size;
      const unsuccessfulChats = totalChats - successfulChats;
      const successRate = totalChats > 0 ? (successfulChats / totalChats) * 100 : 0;

      // Step 5: Build success timeline based on groupBy
      const timelineMap = {};
      
      // Helper function to get the grouping key
      const getGroupKey = (timestamp, groupByParam) => {
        const date = new Date(timestamp);
        
        if (groupByParam === 'month') {
          return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        } else if (groupByParam === 'week') {
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          return weekStart.toISOString().split('T')[0];
        } else {
          // day
          return date.toISOString().split('T')[0];
        }
      };

      // Initialize timeline entries
      chats.forEach(chat => {
        const key = getGroupKey(chat.start_timestamp, groupBy);
        if (!timelineMap[key]) {
          timelineMap[key] = {
            date: key,
            successful: 0,
            unsuccessful: 0,
            timestamp: new Date(key).getTime()
          };
        }
        
        if (chatIdsWithMeetings.has(chat.chat_id)) {
          timelineMap[key].successful++;
        } else {
          timelineMap[key].unsuccessful++;
        }
      });

      const successTimeline = Object.values(timelineMap).sort((a, b) => a.timestamp - b.timestamp);

      // Step 6: Calculate peak hours (0-23)
      const hourCounts = new Array(24).fill(0);
      chats.forEach(chat => {
        const date = new Date(chat.start_timestamp);
        const hour = date.getHours();
        hourCounts[hour]++;
      });

      const peakHours = hourCounts.map((count, hour) => ({
        hour,
        chatCount: count,
        hourLabel: hour === 0 ? '12 AM' : 
                   hour < 12 ? `${hour} AM` : 
                   hour === 12 ? '12 PM' : 
                   `${hour - 12} PM`
      }));

      // Step 7: Build outcome distribution
      const outcomeDistribution = [
        {
          sentiment: 'Meeting Booked',
          count: successfulChats,
          percentage: totalChats > 0 ? Math.round((successfulChats / totalChats) * 10000) / 100 : 0
        },
        {
          sentiment: 'No Meeting',
          count: unsuccessfulChats,
          percentage: totalChats > 0 ? Math.round((unsuccessfulChats / totalChats) * 10000) / 100 : 0
        }
      ];

      // Build response
      const analytics = {
        agent: {
          agentId: agentDocument.agentId,
          name: agentDocument.name,
          description: agentDocument.description,
          voiceId: agentDocument.voiceId,
          language: agentDocument.language,
          createdAt: agentDocument.createdAt
        },
        dateRange: {
          start: periodStart.toISOString(),
          end: periodEnd.toISOString(),
          groupBy
        },
        summary: {
          totalChats,
          successfulChats,
          unsuccessfulChats,
          successRate: Math.round(successRate * 100) / 100,
          meetingsBooked
        },
        successTimeline,
        peakHours,
        outcomeDistribution
      };

      const duration = Date.now() - startTime;

      Logger.info('Chat analytics retrieved successfully', {
        operationId,
        subaccountId,
        agentId,
        totalChats,
        successfulChats,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Chat analytics retrieved successfully',
        data: analytics,
        meta: {
          operationId,
          duration: `${duration}ms`,
          cached: false
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'getChatAgentAnalytics', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Get chat analytics stats with period comparison
  // NOTE: This endpoint intentionally does NOT use caching to ensure real-time data
  static async getChatAnalyticsStats(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;
      const { startDate, endDate } = req.query;

      // Validate required parameters
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: 'startDate and endDate are required',
          code: 'MISSING_REQUIRED_PARAMS'
        });
      }

      // Parse and validate dates
      const currentPeriodStart = new Date(startDate);
      const currentPeriodEnd = new Date(endDate);

      if (isNaN(currentPeriodStart.getTime()) || isNaN(currentPeriodEnd.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format. Use ISO 8601 format',
          code: 'INVALID_DATE_FORMAT'
        });
      }

      if (currentPeriodStart >= currentPeriodEnd) {
        return res.status(400).json({
          success: false,
          message: 'startDate must be before endDate',
          code: 'INVALID_DATE_RANGE'
        });
      }

      // Calculate previous period (same duration)
      const periodDuration = currentPeriodEnd - currentPeriodStart;
      const previousPeriodEnd = currentPeriodStart;
      const previousPeriodStart = new Date(currentPeriodStart.getTime() - periodDuration);

      Logger.info('Fetching chat analytics stats', {
        operationId,
        subaccountId,
        userId,
        agentId,
        currentPeriodStart: currentPeriodStart.toISOString(),
        currentPeriodEnd: currentPeriodEnd.toISOString(),
        previousPeriodStart: previousPeriodStart.toISOString(),
        previousPeriodEnd: previousPeriodEnd.toISOString()
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      const chatAgentsCollection = connection.db.collection('chatagents');
      const chatsCollection = connection.db.collection('chats');
      const meetingsCollection = connection.db.collection('meetings');

      // Find the chat agent
      const agentDocument = await chatAgentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Chat agent not found',
          code: 'CHAT_AGENT_NOT_FOUND'
        });
      }

      // Get chats for both periods using aggregation
      const chatsAggregation = await chatsCollection.aggregate([
        {
          $match: {
            agent_id: agentId,
            start_timestamp: {
              $gte: previousPeriodStart.getTime()
            }
          }
        },
        {
          $addFields: {
            period: {
              $cond: {
                if: {
                  $and: [
                    { $gte: ['$start_timestamp', currentPeriodStart.getTime()] },
                    { $lte: ['$start_timestamp', currentPeriodEnd.getTime()] }
                  ]
                },
                then: 'current',
                else: {
                  $cond: {
                    if: {
                      $and: [
                        { $gte: ['$start_timestamp', previousPeriodStart.getTime()] },
                        { $lt: ['$start_timestamp', previousPeriodEnd.getTime()] }
                      ]
                    },
                    then: 'previous',
                    else: 'excluded'
                  }
                }
              }
            },
            messageCount: {
              $size: {
                $ifNull: ['$messages', []]
              }
            },
            isUnresponsive: {
              $cond: {
                if: {
                  $or: [
                    { $eq: ['$chat_status', 'failed'] },
                    { $eq: ['$chat_status', 'error'] },
                    {
                      $eq: [
                        {
                          $size: {
                            $filter: {
                              input: { $ifNull: ['$messages', []] },
                              as: 'msg',
                              cond: { $eq: ['$$msg.role', 'agent'] }
                            }
                          }
                        },
                        0
                      ]
                    }
                  ]
                },
                then: 1,
                else: 0
              }
            }
          }
        },
        {
          $match: {
            period: { $in: ['current', 'previous'] }
          }
        },
        {
          $group: {
            _id: '$period',
            totalChats: { $sum: 1 },
            unresponsiveChats: { $sum: '$isUnresponsive' },
            totalCost: { $sum: { $divide: [{ $ifNull: ['$chat_cost.combined_cost', 0] }, 100] } },
            totalMessages: { $sum: '$messageCount' },
            chatsWithMessages: {
              $sum: { $cond: [{ $gt: ['$messageCount', 0] }, 1, 0] }
            }
          }
        }
      ]).toArray();

      // Get meetings for both periods
      // Note: Some meetings have subaccountId (from chat agents), some don't (from voice agents)
      const meetingsAggregation = await meetingsCollection.aggregate([
        {
          $match: {
            $or: [
              { agentId: agentId, subaccountId: subaccountId },
              { agentId: agentId, subaccountId: { $exists: false } }
            ],
            createdAt: {
              $gte: previousPeriodStart,
              $lte: currentPeriodEnd
            }
          }
        },
        {
          $addFields: {
            period: {
              $cond: {
                if: {
                  $and: [
                    { $gte: ['$createdAt', currentPeriodStart] },
                    { $lte: ['$createdAt', currentPeriodEnd] }
                  ]
                },
                then: 'current',
                else: {
                  $cond: {
                    if: {
                      $and: [
                        { $gte: ['$createdAt', previousPeriodStart] },
                        { $lt: ['$createdAt', previousPeriodEnd] }
                      ]
                    },
                    then: 'previous',
                    else: 'excluded'
                  }
                }
              }
            }
          }
        },
        {
          $match: {
            period: { $in: ['current', 'previous'] }
          }
        },
        {
          $group: {
            _id: '$period',
            totalMeetings: { $sum: 1 },
            uniqueChatIds: { 
              $addToSet: {
                $cond: {
                  if: { 
                    $and: [
                      { $ne: ['$chat_id', null] },
                      { $ne: ['$chat_id', ''] },
                      { $ne: [{ $type: '$chat_id' }, 'missing'] }
                    ]
                  },
                  then: '$chat_id',
                  else: '$$REMOVE'
                }
              }
            }
          }
        }
      ]).toArray();

      // Parse results
      const currentChatsData = chatsAggregation.find(s => s._id === 'current') || {
        totalChats: 0,
        unresponsiveChats: 0,
        totalCost: 0,
        totalMessages: 0,
        chatsWithMessages: 0
      };

      const previousChatsData = chatsAggregation.find(s => s._id === 'previous') || {
        totalChats: 0,
        unresponsiveChats: 0,
        totalCost: 0,
        totalMessages: 0,
        chatsWithMessages: 0
      };

      const currentMeetingsData = meetingsAggregation.find(m => m._id === 'current') || { 
        totalMeetings: 0,
        uniqueChatIds: []
      };
      const previousMeetingsData = meetingsAggregation.find(m => m._id === 'previous') || { 
        totalMeetings: 0,
        uniqueChatIds: []
      };

      // IMPORTANT: Calculate success rate from unique chats with meetings, not total meetings
      // Success rate = (unique chats with meetings / total chats) * 100
      // This ensures accuracy since one chat can have multiple meetings
      const currentSuccessRate = currentChatsData.totalChats > 0 
        ? ((currentMeetingsData.uniqueChatIds?.length || 0) / currentChatsData.totalChats) * 100 
        : 0;
      const previousSuccessRate = previousChatsData.totalChats > 0 
        ? ((previousMeetingsData.uniqueChatIds?.length || 0) / previousChatsData.totalChats) * 100 
        : 0;

      // Calculate metrics
      const currentStats = {
        totalChats: currentChatsData.totalChats,
        meetingsBooked: currentMeetingsData.totalMeetings,
        unresponsiveChats: currentChatsData.unresponsiveChats,
        cumulativeSuccessRate: currentSuccessRate,
        costPerChat: currentChatsData.totalChats > 0 
          ? currentChatsData.totalCost / currentChatsData.totalChats 
          : 0,
        avgMessageCount: currentChatsData.chatsWithMessages > 0 
          ? currentChatsData.totalMessages / currentChatsData.chatsWithMessages 
          : 0,
        periodStart: currentPeriodStart,
        periodEnd: currentPeriodEnd
      };

      const previousStats = {
        totalChats: previousChatsData.totalChats,
        meetingsBooked: previousMeetingsData.totalMeetings,
        unresponsiveChats: previousChatsData.unresponsiveChats,
        cumulativeSuccessRate: previousSuccessRate,
        costPerChat: previousChatsData.totalChats > 0 
          ? previousChatsData.totalCost / previousChatsData.totalChats 
          : 0,
        avgMessageCount: previousChatsData.chatsWithMessages > 0 
          ? previousChatsData.totalMessages / previousChatsData.chatsWithMessages 
          : 0,
        periodStart: previousPeriodStart,
        periodEnd: previousPeriodEnd
      };

      // Calculate percentage changes
      const calculatePercentageChange = (current, previous) => {
        if (previous === 0) {
          return current > 0 ? 100 : 0;
        }
        return ((current - previous) / previous) * 100;
      };

      const statistics = {
        agent: {
          agentId: agentDocument.agentId,
          name: agentDocument.name,
          description: agentDocument.description,
          voiceId: agentDocument.voiceId || '',
          language: agentDocument.language,
          createdAt: agentDocument.createdAt
        },
        currentPeriod: {
          totalChats: currentStats.totalChats,
          meetingsBooked: currentStats.meetingsBooked,
          unresponsiveChats: currentStats.unresponsiveChats,
          cumulativeSuccessRate: Math.round(currentStats.cumulativeSuccessRate * 100) / 100,
          costPerChat: Math.round(currentStats.costPerChat * 100) / 100,
          avgMessageCount: Math.round(currentStats.avgMessageCount * 100) / 100,
          periodStart: currentStats.periodStart.toISOString(),
          periodEnd: currentStats.periodEnd.toISOString()
        },
        previousPeriod: {
          totalChats: previousStats.totalChats,
          meetingsBooked: previousStats.meetingsBooked,
          unresponsiveChats: previousStats.unresponsiveChats,
          cumulativeSuccessRate: Math.round(previousStats.cumulativeSuccessRate * 100) / 100,
          costPerChat: Math.round(previousStats.costPerChat * 100) / 100,
          avgMessageCount: Math.round(previousStats.avgMessageCount * 100) / 100,
          periodStart: previousStats.periodStart.toISOString(),
          periodEnd: previousStats.periodEnd.toISOString()
        },
        comparison: {
          totalChats: {
            change: currentStats.totalChats - previousStats.totalChats,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.totalChats, previousStats.totalChats) * 100
            ) / 100
          },
          meetingsBooked: {
            change: currentStats.meetingsBooked - previousStats.meetingsBooked,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.meetingsBooked, previousStats.meetingsBooked) * 100
            ) / 100
          },
          unresponsiveChats: {
            change: currentStats.unresponsiveChats - previousStats.unresponsiveChats,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.unresponsiveChats, previousStats.unresponsiveChats) * 100
            ) / 100
          },
          cumulativeSuccessRate: {
            change: Math.round((currentSuccessRate - previousSuccessRate) * 100) / 100,
            percentageChange: Math.round(
              calculatePercentageChange(currentSuccessRate, previousSuccessRate) * 100
            ) / 100
          },
          costPerChat: {
            change: Math.round((currentStats.costPerChat - previousStats.costPerChat) * 100) / 100,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.costPerChat, previousStats.costPerChat) * 100
            ) / 100
          },
          avgMessageCount: {
            change: Math.round((currentStats.avgMessageCount - previousStats.avgMessageCount) * 100) / 100,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.avgMessageCount, previousStats.avgMessageCount) * 100
            ) / 100
          }
        }
      };

      const duration = Date.now() - startTime;

      Logger.info('Chat analytics stats retrieved successfully', {
        operationId,
        subaccountId,
        agentId,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Chat analytics stats retrieved successfully',
        data: statistics,
        meta: {
          operationId,
          duration: `${duration}ms`,
          cached: false
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'getChatAnalyticsStats', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Get chat costs breakdown
  static async getChatCostsBreakdown(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;
      const { startDate, endDate } = req.query;

      // Validate required parameters
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: 'startDate and endDate are required',
          code: 'MISSING_REQUIRED_PARAMS'
        });
      }

      // Parse and validate dates
      const periodStart = new Date(startDate);
      const periodEnd = new Date(endDate);

      if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format. Use ISO 8601 format',
          code: 'INVALID_DATE_FORMAT'
        });
      }

      if (periodStart >= periodEnd) {
        return res.status(400).json({
          success: false,
          message: 'startDate must be before endDate',
          code: 'INVALID_DATE_RANGE'
        });
      }

      Logger.info('Fetching chat costs breakdown', {
        operationId,
        subaccountId,
        userId,
        agentId,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString()
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      const chatAgentsCollection = connection.db.collection('chatagents');
      const chatsCollection = connection.db.collection('chats');

      // Find the chat agent
      const agentDocument = await chatAgentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Chat agent not found',
          code: 'CHAT_AGENT_NOT_FOUND'
        });
      }

      // Get chats in the period
      const chats = await chatsCollection.find({
        agent_id: agentId,
        start_timestamp: {
          $gte: periodStart.getTime(),
          $lte: periodEnd.getTime()
        }
      }).limit(100).toArray();

      // Get all chats for summary (without limit)
      const allChatsAggregation = await chatsCollection.aggregate([
        {
          $match: {
            agent_id: agentId,
            start_timestamp: {
              $gte: periodStart.getTime(),
              $lte: periodEnd.getTime()
            }
          }
        },
        {
          $addFields: {
            duration: {
              $cond: {
                if: { $and: [
                  { $ne: [{ $type: '$end_timestamp' }, 'missing'] },
                  { $ne: [{ $type: '$start_timestamp' }, 'missing'] }
                ]},
                then: { $divide: [{ $subtract: ['$end_timestamp', '$start_timestamp'] }, 1000] },
                else: 0
              }
            },
            hasCostData: {
              $cond: {
                if: { $ne: [{ $type: '$chat_cost' }, 'missing'] },
                then: 1,
                else: 0
              }
            }
          }
        },
        {
          $group: {
            _id: null,
            totalChats: { $sum: 1 },
            chatsWithCostData: { $sum: '$hasCostData' },
            totalCombinedCost: { $sum: { $divide: [{ $ifNull: ['$chat_cost.combined_cost', 0] }, 100] } },
            totalDuration: { $sum: '$duration' },
            chatsWithDuration: {
              $sum: { $cond: [{ $gt: ['$duration', 0] }, 1, 0] }
            }
          }
        }
      ]).toArray();

      const summary = allChatsAggregation[0] || {
        totalChats: 0,
        chatsWithCostData: 0,
        totalCombinedCost: 0,
        totalDuration: 0,
        chatsWithDuration: 0
      };

      // Build product breakdown
      const productMap = new Map();
      let totalProductCosts = 0;
      
      chats.forEach(chat => {
        if (chat.chat_cost && chat.chat_cost.product_costs) {
          chat.chat_cost.product_costs.forEach(pc => {
            const existing = productMap.get(pc.product) || {
              product: pc.product,
              unitPrice: pc.unit_price || 0,
              totalCost: 0,
              chatCount: 0
            };
            
            const costInDollars = (pc.cost || 0) / 100;
            existing.totalCost += costInDollars;
            existing.chatCount++;
            productMap.set(pc.product, existing);
            totalProductCosts += costInDollars;
          });
        }
      });

      const productBreakdown = Array.from(productMap.values()).map(p => ({
        ...p,
        avgCostPerChat: p.chatCount > 0 ? Math.round((p.totalCost / p.chatCount) * 10000) / 10000 : 0,
        totalCost: Math.round(p.totalCost * 100) / 100
      }));

      // Build individual chats data
      const chatsData = chats.map(chat => {
        const duration = chat.end_timestamp && chat.start_timestamp 
          ? (chat.end_timestamp - chat.start_timestamp) / 1000 
          : 0;
        
        const combinedCostInCents = chat.chat_cost?.combined_cost || 0;
        const combinedCost = combinedCostInCents / 100;
        const durationUnitPrice = duration > 0 ? combinedCost / duration : 0;
        
        const productCosts = (chat.chat_cost?.product_costs || []).map(pc => ({
          product: pc.product,
          unitPrice: Math.round((pc.unit_price || 0) * 10000) / 10000,
          cost: Math.round(((pc.cost || 0) / 100) * 100) / 100
        }));

        return {
          chatId: chat.chat_id,
          startTimestamp: chat.start_timestamp,
          endTimestamp: chat.end_timestamp || chat.start_timestamp,
          startDate: new Date(chat.start_timestamp).toISOString(),
          endDate: new Date(chat.end_timestamp || chat.start_timestamp).toISOString(),
          duration: Math.round(duration * 100) / 100,
          combinedCost: Math.round(combinedCost * 100) / 100,
          durationUnitPrice: Math.round(durationUnitPrice * 100000) / 100000,
          productCosts
        };
      });

      // Calculate averages
      const avgDurationSeconds = summary.chatsWithDuration > 0 
        ? summary.totalDuration / summary.chatsWithDuration 
        : 0;
      
      const avgDurationUnitPrice = avgDurationSeconds > 0 
        ? (summary.totalCombinedCost / summary.totalChats) / avgDurationSeconds 
        : 0;

      const totalDurationCost = summary.totalCombinedCost - totalProductCosts;

      const breakdown = {
        agent: {
          agentId: agentDocument.agentId,
          name: agentDocument.name,
          description: agentDocument.description,
          voiceId: agentDocument.voiceId || '',
          language: agentDocument.language,
          createdAt: agentDocument.createdAt
        },
        dateRange: {
          start: periodStart.toISOString(),
          end: periodEnd.toISOString()
        },
        summary: {
          totalChats: summary.totalChats,
          chatsWithCostData: summary.chatsWithCostData,
          cumulativeCosts: {
            totalCombinedCost: Math.round(summary.totalCombinedCost * 100) / 100,
            totalProductCosts: Math.round(totalProductCosts * 100) / 100,
            totalDurationCost: Math.round(totalDurationCost * 100) / 100,
            avgCostPerChat: summary.totalChats > 0 
              ? Math.round((summary.totalCombinedCost / summary.totalChats) * 10000) / 10000 
              : 0
          },
          duration: {
            totalDurationSeconds: Math.round(summary.totalDuration * 100) / 100,
            avgDurationSeconds: Math.round(avgDurationSeconds * 100) / 100,
            avgDurationUnitPrice: Math.round(avgDurationUnitPrice * 1000000) / 1000000
          }
        },
        productBreakdown,
        chats: {
          count: chatsData.length,
          limit: 100,
          note: chatsData.length === 100 
            ? 'Showing first 100 chats. Use pagination to retrieve more.' 
            : `Showing all ${chatsData.length} chats.`,
          data: chatsData
        }
      };

      const duration = Date.now() - startTime;

      Logger.info('Chat costs breakdown retrieved successfully', {
        operationId,
        subaccountId,
        agentId,
        totalChats: summary.totalChats,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Chat cost breakdown retrieved successfully',
        data: breakdown,
        meta: {
          operationId,
          duration: `${duration}ms`,
          cached: false
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'getChatCostsBreakdown', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Delete chat agent
  static async deleteChatAgent(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;

      Logger.info('Deleting chat agent', {
        operationId,
        subaccountId,
        userId,
        agentId,
        effectiveRole: req.permission?.effectiveRole
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get collections
      const chatAgentsCollection = connection.db.collection('chatagents');
      const llmsCollection = connection.db.collection('llms');
      const chatsCollection = connection.db.collection('chats');

      // Step 1: Find the chat agent in MongoDB to get its LLM ID
      const agentDocument = await chatAgentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Chat agent not found',
          code: 'AGENT_NOT_FOUND'
        });
      }

      const llmId = agentDocument.llmId;

      Logger.info('Chat agent found in database', {
        operationId,
        agentId,
        llmId,
        agentName: agentDocument.name
      });

      // Step 2: Fetch retell account data and create Retell instance
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      
      if (!retellAccountData.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Retell account is not active',
          code: 'RETELL_ACCOUNT_INACTIVE'
        });
      }

      const retell = new Retell(retellAccountData.apiKey, retellAccountData);

      // Step 3: Disconnect WhatsApp (if connected)
      let whatsappDisconnected = false;
      try {
        await whatsappService.disconnect(subaccountId, agentId, userId);
        whatsappDisconnected = true;
        Logger.info('WhatsApp disconnected successfully', {
          operationId,
          agentId
        });
      } catch (error) {
        Logger.warn('Failed to disconnect WhatsApp (may not be connected)', {
          operationId,
          agentId,
          error: error.message
        });
        // Continue with deletion even if WhatsApp disconnect fails
      }

      // Step 4: Disconnect Instagram (if connected)
      let instagramDisconnected = false;
      try {
        await instagramService.disconnect(subaccountId, agentId, userId);
        instagramDisconnected = true;
        Logger.info('Instagram disconnected successfully', {
          operationId,
          agentId
        });
      } catch (error) {
        Logger.warn('Failed to disconnect Instagram (may not be connected)', {
          operationId,
          agentId,
          error: error.message
        });
        // Continue with deletion even if Instagram disconnect fails
      }

      // Step 5: Delete agent from Retell
      try {
        await retell.deleteChatAgent(agentId);
        Logger.info('Chat agent deleted from Retell', {
          operationId,
          agentId
        });
      } catch (error) {
        Logger.error('Failed to delete chat agent from Retell', {
          operationId,
          agentId,
          error: error.message
        });
        // Continue with deletion even if Retell deletion fails
      }

      // Step 6: Delete LLM from Retell
      if (llmId) {
        try {
          await retell.deleteLLM(llmId);
          Logger.info('LLM deleted from Retell', {
            operationId,
            llmId
          });
        } catch (error) {
          Logger.error('Failed to delete LLM from Retell', {
            operationId,
            llmId,
            error: error.message
          });
          // Continue with deletion even if LLM deletion fails
        }
      }

      // Step 7: Unassign phone numbers from this chat agent (both inbound and outbound)
      const phoneNumbersCollection = connection.db.collection('phonenumbers');
      let phoneNumbersUnassigned = 0;
      
      try {
        // Find all phone numbers assigned to this chat agent
        const assignedPhoneNumbers = await phoneNumbersCollection.find({
          subaccountId: subaccountId,
          $or: [
            { inbound_agent_id: agentId },
            { outbound_agent_id: agentId }
          ]
        }).toArray();

        Logger.info('Found phone numbers assigned to chat agent', {
          operationId,
          agentId,
          phoneCount: assignedPhoneNumbers.length,
          phoneNumbers: assignedPhoneNumbers.map(p => p.phone_number)
        });

        // Unassign each phone number in both Retell and MongoDB
        for (const phoneDoc of assignedPhoneNumbers) {
          try {
            const updateData = {};
            if (phoneDoc.inbound_agent_id === agentId) {
              updateData.inbound_agent_id = null;
            }
            if (phoneDoc.outbound_agent_id === agentId) {
              updateData.outbound_agent_id = null;
            }

            // Update in Retell API
            try {
              await retell.updatePhoneNumber(phoneDoc.phone_number, updateData);
              Logger.info('Phone number unassigned in Retell', {
                operationId,
                phoneNumber: phoneDoc.phone_number,
                updateData
              });
            } catch (retellError) {
              Logger.warn('Failed to unassign phone number in Retell, continuing', {
                operationId,
                phoneNumber: phoneDoc.phone_number,
                error: retellError.message
              });
            }

            // Update in MongoDB
            const mongoUpdate = {
              updatedAt: new Date(),
              last_modification_timestamp: Date.now()
            };
            if (updateData.inbound_agent_id !== undefined) {
              mongoUpdate.inbound_agent_id = null;
              mongoUpdate.inbound_agent_version = null;
            }
            if (updateData.outbound_agent_id !== undefined) {
              mongoUpdate.outbound_agent_id = null;
              mongoUpdate.outbound_agent_version = null;
            }

            await phoneNumbersCollection.updateOne(
              { 
                subaccountId: subaccountId,
                phone_number: phoneDoc.phone_number 
              },
              { $set: mongoUpdate }
            );

            phoneNumbersUnassigned++;
            
            Logger.info('Phone number unassigned in MongoDB', {
              operationId,
              phoneNumber: phoneDoc.phone_number,
              mongoUpdate
            });
          } catch (phoneError) {
            Logger.error('Failed to unassign phone number', {
              operationId,
              phoneNumber: phoneDoc.phone_number,
              error: phoneError.message
            });
          }
        }
      } catch (phoneError) {
        Logger.warn('Failed to unassign phone numbers from chat agent', {
          operationId,
          agentId,
          error: phoneError.message
        });
      }

      // Step 8: Delete WhatsApp connections from MongoDB
      const whatsappConnectionsCollection = connection.db.collection('whatsappconnections');
      const whatsappConnectionsDeleteResult = await whatsappConnectionsCollection.deleteMany({
        subaccountId: subaccountId,
        agentId: agentId
      });

      Logger.info('WhatsApp connections deleted from MongoDB', {
        operationId,
        agentId,
        deletedCount: whatsappConnectionsDeleteResult.deletedCount
      });

      // Step 9: Delete Instagram connections from MongoDB
      const instagramConnectionsCollection = connection.db.collection('instagramconnections');
      const instagramConnectionsDeleteResult = await instagramConnectionsCollection.deleteMany({
        subaccountId: subaccountId,
        agentId: agentId
      });

      Logger.info('Instagram connections deleted from MongoDB', {
        operationId,
        agentId,
        deletedCount: instagramConnectionsDeleteResult.deletedCount
      });

      // Step 10: Delete all chats associated with this agent
      const chatsDeleteResult = await chatsCollection.deleteMany({ 
        agent_id: agentId,
        subaccountId: subaccountId 
      });

      Logger.info('Associated chats deleted from MongoDB', {
        operationId,
        agentId,
        deletedCount: chatsDeleteResult.deletedCount
      });

      // Step 11: Delete chat agent document from MongoDB
      const agentDeleteResult = await chatAgentsCollection.deleteOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      Logger.info('Chat agent document deleted from MongoDB', {
        operationId,
        agentId,
        deletedCount: agentDeleteResult.deletedCount
      });

      // Step 12: Delete LLM document from MongoDB
      if (llmId) {
        const llmDeleteResult = await llmsCollection.deleteOne({ 
          llmId: llmId,
          subaccountId: subaccountId 
        });

      Logger.info('LLM document deleted from MongoDB', {
        operationId,
        llmId,
        deletedCount: llmDeleteResult.deletedCount
      });
      }

      // Step 13: Delete all activities associated with this chat agent
      let activitiesDeletedCount = 0;
      try {
        const activityDeleteResult = await ActivityService.deleteActivitiesByAgent(
          subaccountId, 
          agentId, 
          userId
        );
        activitiesDeletedCount = activityDeleteResult.deletedCount || 0;
        
        Logger.info('Activities associated with chat agent deleted', {
          operationId,
          agentId,
          deletedActivitiesCount: activitiesDeletedCount
        });
      } catch (activityError) {
        Logger.warn('Failed to delete activities for chat agent', {
          operationId,
          agentId,
          error: activityError.message
        });
      }

      // Step 14: Invalidate caches for this agent and its chats
      try {
        await redisService.invalidateChatAgentStats(subaccountId, agentId);
        await redisService.invalidateChatList(subaccountId);
        await redisService.invalidateActivities(subaccountId);
      } catch (cacheError) {
        Logger.warn('Failed to invalidate chat agent and activity caches', {
          operationId,
          error: cacheError.message
        });
      }

      // Step 15: Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CHAT_AGENT_DELETED,
        category: ACTIVITY_CATEGORIES.CHAT_AGENT,
        userId,
        description: `Chat agent "${agentDocument.name}" deleted (including ${chatsDeleteResult.deletedCount} chats, ${phoneNumbersUnassigned} phone numbers, and ${activitiesDeletedCount} activities)`,
        metadata: {
          agentId,
          agentName: agentDocument.name,
          llmId,
          chatsDeleted: chatsDeleteResult.deletedCount,
          phoneNumbersUnassigned: phoneNumbersUnassigned,
          whatsappDisconnected,
          instagramDisconnected,
          whatsappConnectionsDeleted: whatsappConnectionsDeleteResult.deletedCount,
          instagramConnectionsDeleted: instagramConnectionsDeleteResult.deletedCount,
          deletedActivitiesCount: activitiesDeletedCount
        },
        resourceId: agentId,
        resourceName: agentDocument.name,
        operationId,
        agentId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: `Chat agent deleted successfully (including ${chatsDeleteResult.deletedCount} chats, ${phoneNumbersUnassigned} phone numbers, and ${activitiesDeletedCount} activities)`,
        data: {
          agentId,
          llmId,
          chatsDeleted: chatsDeleteResult.deletedCount,
          phoneNumbersUnassigned: phoneNumbersUnassigned,
          activitiesDeleted: activitiesDeletedCount,
          whatsappDisconnected,
          instagramDisconnected,
          whatsappConnectionsDeleted: whatsappConnectionsDeleteResult.deletedCount,
          instagramConnectionsDeleted: instagramConnectionsDeleteResult.deletedCount,
          deletedFromRetell: true,
          deletedFromDatabase: true
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'deleteChatAgent', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Update chat agent details (begin message, prompt, voice, etc.)
  static async updateChatAgentDetails(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;
      const updates = req.body;

      Logger.info('Updating chat agent details', {
        operationId,
        subaccountId,
        userId,
        agentId,
        updateFields: Object.keys(updates),
        effectiveRole: req.permission?.effectiveRole
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get collections
      const chatAgentsCollection = connection.db.collection('chatagents');
      const llmsCollection = connection.db.collection('llms');

      // Step 1: Find the chat agent in MongoDB to get its LLM ID
      const agentDocument = await chatAgentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Chat agent not found',
          code: 'CHAT_AGENT_NOT_FOUND'
        });
      }

      const llmId = agentDocument.llmId;

      Logger.info('Chat agent found, preparing to update LLM', {
        operationId,
        agentId,
        llmId,
        agentName: agentDocument.name
      });

      // Step 2: Fetch retell account data and create Retell instance
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      
      if (!retellAccountData.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Retell account is not active',
          code: 'RETELL_ACCOUNT_INACTIVE'
        });
      }

      const retell = new Retell(retellAccountData.apiKey, retellAccountData);

      // Step 3: Map request fields to Retell LLM fields
      const llmUpdates = {};
      const dbUpdates = {};

      // Map beginMessage to begin_message for Retell, and store both formats in DB
      if (updates.beginMessage !== undefined) {
        llmUpdates.begin_message = updates.beginMessage;
        dbUpdates.beginMessage = updates.beginMessage;
      }

      // Map generalPrompt to general_prompt for Retell, and store both formats in DB
      if (updates.generalPrompt !== undefined) {
        llmUpdates.general_prompt = updates.generalPrompt;
        dbUpdates.generalPrompt = updates.generalPrompt;
      }

      // Store other fields in DB for future use (voiceId, emailTemplate, model)
      if (updates.voiceId !== undefined) {
        dbUpdates.voiceId = updates.voiceId;
      }

      if (updates.emailTemplate !== undefined) {
        dbUpdates.emailTemplate = updates.emailTemplate;
      }

      if (updates.model !== undefined) {
        dbUpdates.model = updates.model;
      }

      // Step 4: Update LLM in Retell (only if there are LLM-specific fields)
      let llmUpdateResponse = null;
      if (Object.keys(llmUpdates).length > 0) {
        try {
          llmUpdateResponse = await retell.updateLLM(llmId, llmUpdates);
          Logger.info('LLM updated successfully in Retell for chat agent', {
            operationId,
            llmId,
            updatedFields: Object.keys(llmUpdates)
          });
        } catch (error) {
          Logger.error('Failed to update LLM in Retell for chat agent', {
            operationId,
            llmId,
            error: error.message
          });
          throw new Error(`Failed to update LLM in Retell: ${error.message}`);
        }
      }

      // Step 5: Update LLM document in MongoDB (if there are LLM-related fields)
      if (Object.keys(dbUpdates).length > 0) {
        const llmDbUpdates = {};
        
        if (dbUpdates.beginMessage !== undefined) {
          llmDbUpdates.beginMessage = dbUpdates.beginMessage;
        }
        if (dbUpdates.generalPrompt !== undefined) {
          llmDbUpdates.generalPrompt = dbUpdates.generalPrompt;
        }
        if (dbUpdates.model !== undefined) {
          llmDbUpdates.model = dbUpdates.model;
        }

        if (Object.keys(llmDbUpdates).length > 0) {
          llmDbUpdates.updatedAt = new Date();
          llmDbUpdates.updatedBy = userId;

          await llmsCollection.updateOne(
            { llmId: llmId, subaccountId: subaccountId },
            { $set: llmDbUpdates }
          );

          Logger.info('LLM document updated in MongoDB for chat agent', {
            operationId,
            llmId,
            updatedFields: Object.keys(llmDbUpdates)
          });
        }

        // Step 6: Update chat agent document in MongoDB
        const agentDbUpdates = { ...dbUpdates };
        agentDbUpdates.updatedAt = new Date();
        agentDbUpdates.updatedBy = userId;

        await chatAgentsCollection.updateOne(
          { agentId: agentId, subaccountId: subaccountId },
          { $set: agentDbUpdates }
        );

        Logger.info('Chat agent document updated in MongoDB', {
          operationId,
          agentId,
          updatedFields: Object.keys(agentDbUpdates)
        });
      }

      // Log activity - Disabled
      // await ActivityService.logActivity({
      //   subaccountId,
      //   activityType: ACTIVITY_TYPES.CHAT_AGENT_UPDATED,
      //   category: ACTIVITY_CATEGORIES.CHAT_AGENT,
      //   userId,
      //   description: `Chat agent "${agentDocument.name}" updated`,
      //   metadata: {
      //     agentId,
      //     agentName: agentDocument.name,
      //     llmId,
      //     updatedFields: Object.keys(updates)
      //   },
      //   resourceId: agentId,
      //   resourceName: agentDocument.name,
      //   operationId
      // });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Chat agent details updated successfully',
        data: {
          agentId,
          llmId,
          updatedFields: Object.keys(updates),
          updatedInRetell: Object.keys(llmUpdates).length > 0,
          updatedInDatabase: Object.keys(dbUpdates).length > 0
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'updateChatAgentDetails', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Get chat agent configuration details
  static async getChatAgentDetailsConfig(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user.id;

      Logger.info('Fetching chat agent configuration details', {
        operationId,
        subaccountId,
        userId,
        agentId
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get collections
      const chatAgentsCollection = connection.db.collection('chatagents');
      const llmsCollection = connection.db.collection('llms');

      // Step 1: Find the chat agent
      const agentDocument = await chatAgentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Chat agent not found',
          code: 'CHAT_AGENT_NOT_FOUND'
        });
      }

      // Step 2: Find the LLM document
      const llmDocument = await llmsCollection.findOne({ 
        llmId: agentDocument.llmId,
        subaccountId: subaccountId 
      });

      // Step 3: Build configuration response
      const configDetails = {
        agent: {
          agentId: agentDocument.agentId,
          name: agentDocument.name,
          description: agentDocument.description,
          voiceId: agentDocument.voiceId || null,
          language: agentDocument.language,
          emailTemplate: agentDocument.emailTemplate || null,
          activated: agentDocument.activated,
          createdAt: agentDocument.createdAt,
          updatedAt: agentDocument.updatedAt || null
        },
        llm: {
          llmId: agentDocument.llmId,
          model: llmDocument?.model || agentDocument.model || null,
          beginMessage: llmDocument?.beginMessage || agentDocument.beginMessage || '',
          generalPrompt: llmDocument?.generalPrompt || agentDocument.generalPrompt || '',
          modelTemperature: llmDocument?.modelTemperature || null,
          version: llmDocument?.version || null,
          createdAt: llmDocument?.createdAt || null,
          updatedAt: llmDocument?.updatedAt || null
        }
      };

      const duration = Date.now() - startTime;

      Logger.info('Chat agent configuration details fetched successfully', {
        operationId,
        subaccountId,
        agentId,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Chat agent configuration details retrieved successfully',
        data: configDetails,
        meta: {
          operationId,
          duration: `${duration}ms`,
          cached: false
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'getChatAgentDetailsConfig', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Error handling
  static async handleError(error, req, operationId, operation, startTime) {
    const duration = Date.now() - startTime;
    
    Logger.error(`Database operation failed: ${operation}`, {
      operationId,
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      subaccountId: req.params?.subaccountId,
      duration: `${duration}ms`
    });

    // Provide specific error responses based on error type
    let statusCode = 500;
    let errorCode = 'DATABASE_ERROR';
    let message = 'An internal database error occurred';

    if (error.message.includes('Failed to create connection pool')) {
      statusCode = 503;
      errorCode = 'CONNECTION_FAILED';
      message = 'Unable to connect to the database. The database may not exist or connection details are invalid.';
    } else if (error.message.includes('MongoDB URL is missing')) {
      statusCode = 500;
      errorCode = 'CONFIGURATION_ERROR';
      message = 'Database configuration is incomplete. Please contact support.';
    } else if (error.message.includes('Failed to decrypt')) {
      statusCode = 500;
      errorCode = 'DECRYPTION_ERROR';
      message = 'Unable to decrypt database connection details. Please contact support.';
    } else if (error.message.includes('Connection timeout')) {
      statusCode = 504;
      errorCode = 'CONNECTION_TIMEOUT';
      message = 'Database connection timed out. Please try again later.';
    } else if (error.message.includes('Failed to initialize database')) {
      statusCode = 503;
      errorCode = 'DATABASE_INIT_FAILED';
      message = 'Database initialization failed. The database may not exist or you may not have sufficient permissions.';
    } else if (error.message.includes('Failed to fetch retell account')) {
      statusCode = 503;
      errorCode = 'RETELL_FETCH_FAILED';
      message = 'Unable to fetch Retell account details. Please try again later.';
    } else if (error.message.includes('Failed to decrypt API key')) {
      statusCode = 500;
      errorCode = 'API_KEY_DECRYPTION_ERROR';
      message = 'Unable to decrypt Retell API key. Please contact support.';
    } else if (error.message.includes('Failed to create LLM')) {
      statusCode = 503;
      errorCode = 'LLM_CREATION_FAILED';
      message = 'Failed to create LLM for the agent. Please try again later.';
    } else if (error.message.includes('Failed to update LLM')) {
      statusCode = 503;
      errorCode = 'LLM_UPDATE_FAILED';
      message = 'Failed to update LLM. Please try again later.';
    } else if (error.message.includes('Failed to create agent')) {
      statusCode = 503;
      errorCode = 'AGENT_CREATION_FAILED';
      message = 'Failed to create agent. Please try again later.';
    } else if (error.message.includes('Webhook URL not configured')) {
      statusCode = 500;
      errorCode = 'WEBHOOK_NOT_CONFIGURED';
      message = 'Webhook URL is not configured. Please contact support.';
    }

    return {
      statusCode,
      response: {
        success: false,
        message,
        code: errorCode,
        meta: {
          operationId,
          operation,
          duration: `${duration}ms`
        }
      }
    };
  }

  // Get email template for an agent
  static async getAgentEmailTemplate(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user?.id || 'service';
      const isServiceAuth = !!req.service;

      Logger.info('Fetching agent email template', {
        operationId,
        subaccountId,
        userId: isServiceAuth ? req.service.serviceName : userId,
        agentId,
        authType: isServiceAuth ? 'service' : 'user'
      });

      // Get database connection (use 'system' for service-to-service calls)
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, isServiceAuth ? 'system' : userId);
      const { connection } = connectionInfo;

      // Get agents collection
      const agentsCollection = connection.db.collection('agents');

      // Find the agent
      const agentDocument = await agentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      }, {
        projection: {
          agentId: 1,
          name: 1,
          emailTemplate: 1
        }
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Agent not found',
          code: 'AGENT_NOT_FOUND'
        });
      }

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Email template retrieved successfully',
        data: {
          agentId: agentDocument.agentId,
          agentName: agentDocument.name,
          emailTemplate: agentDocument.emailTemplate || null
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'getAgentEmailTemplate', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Update email template for an agent
  static async updateAgentEmailTemplate(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const { emailTemplate } = req.body;
      const userId = req.user.id;

      Logger.info('Updating agent email template', {
        operationId,
        subaccountId,
        userId,
        agentId,
        hasEmailTemplate: !!emailTemplate
      });

      // Validate emailTemplate
      if (emailTemplate !== null && typeof emailTemplate !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Email template must be a string or null',
          code: 'INVALID_EMAIL_TEMPLATE'
        });
      }

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get agents collection
      const agentsCollection = connection.db.collection('agents');

      // Check if agent exists
      const agentDocument = await agentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Agent not found',
          code: 'AGENT_NOT_FOUND'
        });
      }

      // Update email template
      const updateResult = await agentsCollection.updateOne(
        { agentId: agentId, subaccountId: subaccountId },
        { 
          $set: { 
            emailTemplate: emailTemplate,
            updatedAt: new Date(),
            updatedBy: userId
          } 
        }
      );

      // Invalidate cache
      try {
        await redisService.invalidateAgentDetails(subaccountId, agentId);
      } catch (cacheError) {
        Logger.warn('Failed to invalidate agent details cache', {
          operationId,
          error: cacheError.message
        });
      }

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.AGENT_UPDATED,
        category: ACTIVITY_CATEGORIES.AGENT,
        userId,
        description: `Email template updated for agent "${agentDocument.name}"`,
        metadata: {
          agentId,
          agentName: agentDocument.name,
          hasEmailTemplate: !!emailTemplate
        },
        resourceId: agentId,
        resourceName: agentDocument.name,
        operationId,
        agentId
      });

      const duration = Date.now() - startTime;

      Logger.info('Agent email template updated successfully', {
        operationId,
        agentId,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Email template updated successfully',
        data: {
          agentId: agentDocument.agentId,
          agentName: agentDocument.name,
          emailTemplate: emailTemplate,
          updated: updateResult.modifiedCount > 0
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'updateAgentEmailTemplate', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // ========== VOICE MANAGEMENT ==========

  /**
   * Get list of available voices (ElevenLabs only)
   * GET /api/database/:subaccountId/voices
   */
  static async getVoices(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId } = req.params;
      const userId = req.user.id;

      Logger.info('Fetching available voices', {
        operationId,
        subaccountId,
        userId
      });

      // Check cache first
      try {
        const cachedVoices = await redisService.getCachedVoices(subaccountId);
        if (cachedVoices) {
          const duration = Date.now() - startTime;
          
          Logger.info('Voices fetched from cache', {
            operationId,
            subaccountId,
            count: cachedVoices.count,
            duration: `${duration}ms`
          });

          return res.json({
            success: true,
            message: 'Voices fetched successfully',
            data: cachedVoices,
            meta: {
              operationId,
              duration: `${duration}ms`,
              cached: true
            }
          });
        }
      } catch (cacheError) {
        Logger.warn('Failed to get cached voices', {
          operationId,
          error: cacheError.message
        });
        // Continue to fetch from Retell if cache fails
      }

      // Fetch retell account data (with caching)
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      
      if (!retellAccountData.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Retell account is not active',
          code: 'RETELL_ACCOUNT_INACTIVE'
        });
      }

      // Create Retell instance with decrypted API key
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);
      
      // List all voices
      const allVoices = await retell.listVoices();
      
      // Filter to only ElevenLabs voices
      const elevenlabsVoices = allVoices.filter(voice => voice.provider === 'elevenlabs');

      const voicesData = {
        voices: elevenlabsVoices,
        count: elevenlabsVoices.length
      };

      // Cache the results for 24 hours
      try {
        await redisService.cacheVoices(subaccountId, voicesData);
      } catch (cacheError) {
        Logger.warn('Failed to cache voices', {
          operationId,
          error: cacheError.message
        });
        // Continue even if caching fails
      }

      const duration = Date.now() - startTime;

      Logger.info('Voices fetched successfully', {
        operationId,
        totalVoices: allVoices.length,
        elevenlabsVoices: elevenlabsVoices.length,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Voices fetched successfully',
        data: voicesData,
        meta: {
          operationId,
          duration: `${duration}ms`,
          cached: false
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'getVoices', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Update agent voice
   * PATCH /api/database/:subaccountId/agents/:agentId/voice
   */
  static async updateAgentVoice(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const { voiceId } = req.body;
      const userId = req.user.id;

      Logger.info('Updating agent voice', {
        operationId,
        subaccountId,
        userId,
        agentId,
        voiceId
      });

      // Fetch retell account data (with caching)
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      
      if (!retellAccountData.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Retell account is not active',
          code: 'RETELL_ACCOUNT_INACTIVE'
        });
      }

      // Create Retell instance with decrypted API key
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get agents collection
      const agentsCollection = connection.db.collection('agents');

      // Find the agent
      const agentDocument = await agentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Agent not found',
          code: 'AGENT_NOT_FOUND'
        });
      }

      // Update agent on Retell platform
      const updateData = {
        voice_id: voiceId
      };

      await retell.updateAgent(agentId, updateData);

      Logger.info('Agent updated on Retell platform', {
        operationId,
        agentId,
        voiceId
      });

      // Update agent in database
      await agentsCollection.updateOne(
        { agentId: agentId, subaccountId: subaccountId },
        { 
          $set: { 
            voiceId: voiceId,
            updatedAt: new Date(),
            updatedBy: userId
          } 
        }
      );

      // Invalidate cache (both agent details and stats)
      try {
        await redisService.invalidateAgentDetails(subaccountId, agentId);
        await redisService.invalidateAgentStats(subaccountId, agentId);
      } catch (cacheError) {
        Logger.warn('Failed to invalidate agent cache', {
          operationId,
          error: cacheError.message
        });
      }

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.AGENT_UPDATED,
        category: ACTIVITY_CATEGORIES.AGENT,
        userId,
        description: `Voice updated for agent "${agentDocument.name}"`,
        metadata: {
          agentId,
          agentName: agentDocument.name,
          voiceId: voiceId
        },
        resourceId: agentId,
        resourceName: agentDocument.name,
        operationId,
        agentId
      });

      const duration = Date.now() - startTime;

      Logger.info('Agent voice updated successfully', {
        operationId,
        agentId,
        voiceId,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Agent voice updated successfully',
        data: {
          agentId: agentDocument.agentId,
          agentName: agentDocument.name,
          voiceId: voiceId
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'updateAgentVoice', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  /**
   * Update agent LLM model
   * PATCH /api/database/:subaccountId/agents/:agentId/llm
   */
  static async updateAgentLLM(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const { model } = req.body;
      const userId = req.user.id;

      Logger.info('Updating agent LLM model', {
        operationId,
        subaccountId,
        userId,
        agentId,
        model
      });

      // Fetch retell account data (with caching)
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      
      if (!retellAccountData.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Retell account is not active',
          code: 'RETELL_ACCOUNT_INACTIVE'
        });
      }

      // Create Retell instance with decrypted API key
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get agents collection
      const agentsCollection = connection.db.collection('agents');

      // Find the agent
      const agentDocument = await agentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Agent not found',
          code: 'AGENT_NOT_FOUND'
        });
      }

      // Get the LLM ID from the agent
      const llmId = agentDocument.llmId;
      
      if (!llmId) {
        return res.status(400).json({
          success: false,
          message: 'Agent does not have an associated LLM',
          code: 'NO_LLM_FOUND'
        });
      }

      // Update LLM on Retell platform
      const updateData = {
        model: model
      };

      await retell.updateLLM(llmId, updateData);

      Logger.info('LLM updated on Retell platform', {
        operationId,
        llmId,
        model
      });

      // Update LLM in llms collection
      const llmsCollection = connection.db.collection('llms');
      await llmsCollection.updateOne(
        { llmId: llmId, subaccountId: subaccountId },
        { 
          $set: { 
            model: model,
            updatedAt: new Date(),
            updatedBy: userId
          } 
        }
      );

      // Also update agent document to keep model reference
      await agentsCollection.updateOne(
        { agentId: agentId, subaccountId: subaccountId },
        { 
          $set: { 
            'model': model,
            updatedAt: new Date(),
            updatedBy: userId
          } 
        }
      );

      // Invalidate cache (both agent details and stats)
      try {
        await redisService.invalidateAgentDetails(subaccountId, agentId);
        await redisService.invalidateAgentStats(subaccountId, agentId);
      } catch (cacheError) {
        Logger.warn('Failed to invalidate agent cache', {
          operationId,
          error: cacheError.message
        });
      }

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.AGENT_UPDATED,
        category: ACTIVITY_CATEGORIES.AGENT,
        userId,
        description: `LLM model updated for agent "${agentDocument.name}" to ${model}`,
        metadata: {
          agentId,
          agentName: agentDocument.name,
          llmId: llmId,
          model: model
        },
        resourceId: agentId,
        resourceName: agentDocument.name,
        operationId,
        agentId
      });

      const duration = Date.now() - startTime;

      Logger.info('Agent LLM updated successfully', {
        operationId,
        agentId,
        llmId,
        model,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Agent LLM model updated successfully',
        data: {
          agentId: agentDocument.agentId,
          agentName: agentDocument.name,
          llmId: llmId,
          model: model
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'updateAgentLLM', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Get email template for a chat agent
  static async getChatAgentEmailTemplate(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const userId = req.user?.id || 'service';
      const isServiceAuth = !!req.service;

      Logger.info('Fetching chat agent email template', {
        operationId,
        subaccountId,
        userId: isServiceAuth ? req.service.serviceName : userId,
        agentId,
        authType: isServiceAuth ? 'service' : 'user'
      });

      // Get database connection (use 'system' for service-to-service calls)
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, isServiceAuth ? 'system' : userId);
      const { connection } = connectionInfo;

      // Get chatagents collection
      const chatAgentsCollection = connection.db.collection('chatagents');

      // Find the chat agent
      const agentDocument = await chatAgentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      }, {
        projection: {
          agentId: 1,
          name: 1,
          emailTemplate: 1
        }
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Chat agent not found',
          code: 'CHAT_AGENT_NOT_FOUND'
        });
      }

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Email template retrieved successfully',
        data: {
          agentId: agentDocument.agentId,
          agentName: agentDocument.name,
          emailTemplate: agentDocument.emailTemplate || null
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'getChatAgentEmailTemplate', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Update email template for a chat agent
  static async updateChatAgentEmailTemplate(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const { emailTemplate } = req.body;
      const userId = req.user.id;

      Logger.info('Updating chat agent email template', {
        operationId,
        subaccountId,
        userId,
        agentId,
        hasEmailTemplate: !!emailTemplate
      });

      // Validate emailTemplate
      if (emailTemplate !== null && typeof emailTemplate !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Email template must be a string or null',
          code: 'INVALID_EMAIL_TEMPLATE'
        });
      }

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get chatagents collection
      const chatAgentsCollection = connection.db.collection('chatagents');

      // Check if chat agent exists
      const agentDocument = await chatAgentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Chat agent not found',
          code: 'CHAT_AGENT_NOT_FOUND'
        });
      }

      // Update email template
      const updateResult = await chatAgentsCollection.updateOne(
        { agentId: agentId, subaccountId: subaccountId },
        { 
          $set: { 
            emailTemplate: emailTemplate,
            updatedAt: new Date(),
            updatedBy: userId
          } 
        }
      );

      // Invalidate cache
      try {
        await redisService.invalidateAgentDetails(subaccountId, agentId);
        Logger.debug('Chat agent details cache invalidated', {
          operationId,
          agentId
        });
      } catch (cacheError) {
        Logger.warn('Failed to invalidate chat agent details cache', {
          operationId,
          error: cacheError.message
        });
      }

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.AGENT_UPDATED,
        category: ACTIVITY_CATEGORIES.AGENT,
        userId,
        description: `Email template updated for chat agent "${agentDocument.name}"`,
        metadata: {
          agentId,
          agentName: agentDocument.name,
          hasEmailTemplate: !!emailTemplate
        },
        resourceId: agentId,
        resourceName: agentDocument.name,
        operationId,
        agentId
      });

      const duration = Date.now() - startTime;

      Logger.info('Chat agent email template updated successfully', {
        operationId,
        agentId,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Email template updated successfully',
        data: {
          agentId: agentDocument.agentId,
          agentName: agentDocument.name,
          emailTemplate: emailTemplate,
          updated: updateResult.modifiedCount > 0
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'updateChatAgentEmailTemplate', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }

  // Update LLM model for a chat agent
  static async updateChatAgentLLM(req, res, next) {
    const startTime = Date.now();
    const operationId = uuidv4();

    try {
      const { subaccountId, agentId } = req.params;
      const { model } = req.body;
      const userId = req.user.id;

      Logger.info('Updating chat agent LLM model', {
        operationId,
        subaccountId,
        userId,
        agentId,
        model
      });

      // Fetch retell account data (with caching)
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      
      if (!retellAccountData.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Retell account is not active',
          code: 'RETELL_ACCOUNT_INACTIVE'
        });
      }

      // Create Retell instance with decrypted API key
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;

      // Get chatagents collection
      const chatAgentsCollection = connection.db.collection('chatagents');

      // Find the chat agent
      const agentDocument = await chatAgentsCollection.findOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      if (!agentDocument) {
        return res.status(404).json({
          success: false,
          message: 'Chat agent not found',
          code: 'CHAT_AGENT_NOT_FOUND'
        });
      }

      // Get the LLM ID from the chat agent
      const llmId = agentDocument.llmId;
      
      if (!llmId) {
        return res.status(400).json({
          success: false,
          message: 'Chat agent does not have an associated LLM',
          code: 'NO_LLM_FOUND'
        });
      }

      // Update LLM on Retell platform
      const updateData = {
        model: model
      };

      await retell.updateLLM(llmId, updateData);

      Logger.info('LLM updated on Retell platform', {
        operationId,
        llmId,
        model
      });

      // Update LLM in llms collection
      const llmsCollection = connection.db.collection('llms');
      await llmsCollection.updateOne(
        { llmId: llmId, subaccountId: subaccountId },
        { 
          $set: { 
            model: model,
            updatedAt: new Date(),
            updatedBy: userId
          } 
        }
      );

      // Also update chat agent document to keep model reference
      await chatAgentsCollection.updateOne(
        { agentId: agentId, subaccountId: subaccountId },
        { 
          $set: { 
            'model': model,
            updatedAt: new Date(),
            updatedBy: userId
          } 
        }
      );

      // Invalidate cache (both agent details and stats)
      try {
        await redisService.invalidateAgentDetails(subaccountId, agentId);
        await redisService.invalidateAgentStats(subaccountId, agentId);
        Logger.debug('Chat agent cache invalidated (details and stats)', {
          operationId,
          agentId
        });
      } catch (cacheError) {
        Logger.warn('Failed to invalidate chat agent cache', {
          operationId,
          error: cacheError.message
        });
      }

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.AGENT_UPDATED,
        category: ACTIVITY_CATEGORIES.AGENT,
        userId,
        description: `LLM model updated for chat agent "${agentDocument.name}" to ${model}`,
        metadata: {
          agentId,
          agentName: agentDocument.name,
          llmId: llmId,
          model: model
        },
        resourceId: agentId,
        resourceName: agentDocument.name,
        operationId,
        agentId
      });

      const duration = Date.now() - startTime;

      Logger.info('Chat agent LLM updated successfully', {
        operationId,
        agentId,
        llmId,
        model,
        duration: `${duration}ms`
      });

      res.json({
        success: true,
        message: 'Chat agent LLM model updated successfully',
        data: {
          agentId: agentDocument.agentId,
          agentName: agentDocument.name,
          llmId: llmId,
          model: model
        },
        meta: {
          operationId,
          duration: `${duration}ms`
        }
      });

    } catch (error) {
      const errorInfo = await DatabaseController.handleError(error, req, operationId, 'updateChatAgentLLM', startTime);
      return res.status(errorInfo.statusCode).json(errorInfo.response);
    }
  }
}

module.exports = DatabaseController; 