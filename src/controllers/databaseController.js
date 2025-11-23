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

      // Step 1: Create LLM
      Logger.info('Creating LLM for agent', { operationId, subaccountId, name });
      
      const llmConfig = {
        version: 0,
        model: "gpt-4o-mini",
        model_temperature: 0,
        model_high_priority: true,
        tool_call_strict_mode: true,
        begin_message: "",
        general_prompt: "You are an intelligent appointment scheduling assistant that helps users book meetings efficiently.",
        general_tools: [],
        states: [
          {
            name: "general_state",
            description: "Initial conversation and intent detection state",
            state_prompt: `Your agent_id is {{agent_id}}. You are in Europe/Madrid timezone. 
      Current time: {{current_time_Europe/Madrid}}
      Current date: {{current_calendar_Europe/Madrid}}
      
      You are an intelligent appointment scheduling assistant. Your goal is to help users book appointments efficiently.
      
      INITIAL ASSESSMENT:
      - Identify if the user wants to schedule an appointment
      - Listen for scheduling triggers (callback requests, service interest, appointment mentions)
      - Be proactive but not pushy
      - If user shows interest, understand their initial preferences
      
      TRANSITION RULES:
      - If user mentions a specific date/time → transition to date_clarification_state
      - If user asks for availability without specifics → transition to preference_gathering_state
      - If user needs help understanding options → transition to preference_gathering_state
      - Default to preference_gathering_state if user wants to schedule but provides no details
      - If user explicitly wants to end the call or says goodbye → use end_call tool
      
      YOUR ULTIMATE GOAL IS TO BOOK A MEETING - be helpful and guide the conversation towards scheduling.`,
            tools: [
              {
                type: "end_call",
                name: "end_call",
                description: "End the call ONLY if user explicitly wants to end or says goodbye before scheduling"
              }
            ],
            edges: [
              {
                destination_state_name: "preference_gathering_state",
                description: "User expresses interest in scheduling but provides no specific preferences"
              },
              {
                destination_state_name: "date_clarification_state",
                description: "User mentions a specific date, time, or day of week that needs clarification"
              }
            ]
          },
          {
            name: "preference_gathering_state",
            description: "Collect user's scheduling preferences intelligently",
            state_prompt: `Current date: {{current_calendar_Europe/Madrid}}
      Current time: {{current_time_Europe/Madrid}}
      
      Gather user's scheduling preferences intelligently:
      
      QUESTIONS TO ASK (choose relevant ones based on context):
      1. "Do you have any preferred days or times in mind?"
      2. "Are you looking for something this week, next week, or later?"
      3. "Do you prefer mornings (8am-12pm), afternoons (12pm-5pm), or evenings (5pm-8pm)?"
      4. "Are there any days that don't work for you?"
      5. "How urgent is this appointment - do you need something as soon as possible?"
      
      INTELLIGENCE RULES:
      - If user says a weekday (e.g., "Friday") → Note it and transition to date_clarification_state
      - If user says "next week" → Calculate actual date range (next Monday to Sunday)
      - If user says "ASAP" or "earliest available" → Note urgency and search from today
      - If user gives a date range → Note both start and end dates
      - Store preferences in context for later use
      
      TRANSITION RULES:
      - Specific date/time mentioned → date_clarification_state
      - General preferences gathered (or user wants to see what's available) → intelligent_search_state
      - User is vague and wants to see all options → intelligent_search_state`,
            edges: [
              {
                destination_state_name: "intelligent_search_state",
                description: "Preferences gathered or user wants to see available options"
              },
              {
                destination_state_name: "date_clarification_state",
                description: "User provides specific date/time during preference gathering"
              }
            ]
          },
          {
            name: "date_clarification_state",
            description: "Disambiguate and validate date/time requests",
            state_prompt: `Current date: {{current_calendar_Europe/Madrid}}
      Current time: {{current_time_Europe/Madrid}}
      You are in Europe/Madrid timezone.
      
      CLARIFICATION LOGIC for ambiguous dates:
      
      For weekday mentions (Monday, Tuesday, etc.):
      - Calculate if it's this week or next week
      - Ask: "Do you mean this [Day] ([specific date]) or next [Day] ([specific date])?"
      - Example: If today is Wednesday and user says "Friday", clarify "this Friday November 22nd or next Friday November 29th?"
      
      For relative dates:
      - "Tomorrow" → Calculate and confirm exact date
      - "Next week" → Clarify the date range (next Monday to Sunday)
      - "In 2 weeks" → Calculate and confirm exact date
      - "End of month" → Calculate last days of current month
      
      IMPORTANT:
      - Always confirm the interpreted date with user
      - Check that date is not in the past
      - Be explicit about dates to avoid confusion
      - Store clarified date/time for next state
      
      TRANSITION RULES:
      - If specific time slot is clarified (date + time) → check_availability_state
      - If only date is clarified (no specific time) → intelligent_search_state
      - If date range is clarified → intelligent_search_state`,
            edges: [
              {
                destination_state_name: "check_availability_state",
                description: "Specific date and time slot has been clarified and confirmed"
              },
              {
                destination_state_name: "intelligent_search_state",
                description: "Date clarified but no specific time, need to search for slots"
              }
            ]
          },
          {
            name: "check_availability_state",
            description: "Verify if a specific slot is available",
            state_prompt: `You are in Europe/Madrid timezone.
      Current time: {{current_time_Europe/Madrid}}
      Current date: {{current_calendar_Europe/Madrid}}
      
      Check availability for the specific slot requested using check_availability function.
      
      FUNCTION USAGE:
      - IMMEDIATELY call check_availability with the exact date and time the user requested
      - Date format: YYYY-MM-DD
      - Time format: HH:mm (24-hour)
      - All times must be in Europe/Madrid timezone
      - Do NOT ask permission - just call the function immediately
      
      RESPONSE HANDLING:
      After receiving function result, respond AND transition in the SAME turn:
      
      If slot is AVAILABLE:
      - Say: "Great! That slot on [day], [date] at [time] is available."
      - IMMEDIATELY transition to slot_confirmation_state in the same response
      
      If slot is NOT AVAILABLE:
      - Say: "Unfortunately, that specific time isn't available. Let me find some nearby alternatives for you."
      - IMMEDIATELY transition to fallback_search_state in the same response
      
      CRITICAL: Always transition immediately after receiving the function result. Never wait for more user input.`,
            tools: [
              {
                type: "custom",
                name: "check_availability",
                url: "https://placeholder-will-be-updated-after-agent-creation.com/check-availability",
                speak_during_execution: false,
                speak_after_execution: true,
                description: "Check if a specific time slot is available for booking an appointment",
                parameters: {
                  type: "object",
                  properties: {
                    date: {
                      type: "string",
                      description: "Date in YYYY-MM-DD format"
                    },
                    startTime: {
                      type: "string",
                      description: "Start time in HH:mm format (24-hour)"
                    },
                    endTime: {
                      type: "string",
                      description: "End time in HH:mm format (24-hour)"
                    }
                  },
                  required: ["date", "startTime", "endTime"]
                },
                execution_message_description: "Checking availability for the appointment",
                timeout_ms: 120000
              }
            ],
            edges: [
              {
                destination_state_name: "slot_confirmation_state",
                description: "The requested slot is available"
              },
              {
                destination_state_name: "fallback_search_state",
                description: "The requested slot is not available, need to find alternatives"
              }
            ]
          },
          {
            name: "intelligent_search_state",
            description: "Smart search for available slots based on preferences",
            state_prompt: `You are in Europe/Madrid timezone.
      Current time: {{current_time_Europe/Madrid}}
      Current date: {{current_calendar_Europe/Madrid}}
      
      Perform intelligent slot search using nearest_available_slots function based on gathered preferences.
      
      SEARCH STRATEGY:
      
      1. For SPECIFIC DAY requests (e.g., "this Friday"):
         - Start search from that specific date
         - If no slots found, inform user and search nearby days (day before, day after, week later)
      
      2. For DATE RANGE requests:
         - Start from beginning of range
         - Search in chunks (function returns 30 days of data)
         - If range is longer than 30 days, you may need multiple searches
      
      3. For ASAP/URGENT requests:
         - Start from today's date
         - Find the earliest available slots
      
      4. For TIME PREFERENCE requests (morning/afternoon/evening):
         - Search for slots and mentally filter based on time preference
         - Morning: 8am-12pm, Afternoon: 12pm-5pm, Evening: 5pm-8pm
      
      PROGRESSIVE SEARCH:
      - Initial search: Use startDate based on user preference
      - If no results: Extend search by 30 days (call function again with new startDate)
      - Maximum 3 searches (90 days total) before suggesting user call directly
      
      IMPORTANT: 
      - NEVER mention the function name "nearest_available_slots" to the user
      - Present results naturally: "I found these available times..." not "The function returned..."
      - Group and organize results intelligently before presenting
      - After presenting slots, WAIT for user to select one - don't book yet
      
      TRANSITION:
      - After presenting slots and receiving function results → IMMEDIATELY transition to slot_selection_state
      - If no slots found after searching → fallback_search_state`,
            tools: [
              {
                type: "custom",
                name: "nearest_available_slots",
                url: "https://placeholder-will-be-updated-after-agent-creation.com/nearest-available-slots",
                speak_during_execution: false,
                speak_after_execution: true,
                description: "Find the nearest available appointment slots within 30 days from start date",
                parameters: {
                  type: "object",
                  properties: {
                    startDate: {
                      type: "string",
                      description: "Starting date to search from (YYYY-MM-DD)"
                    },
                    count: {
                      type: "number",
                      description: "Number of available slots to return (default: 5)"
                    },
                    durationMinutes: {
                      type: "number",
                      description: "Duration of each slot in minutes (default: 60)"
                    }
                  },
                  required: ["startDate"]
                },
                execution_message_description: "Finding available time slots for you",
                timeout_ms: 120000
              }
            ],
            edges: [
              {
                destination_state_name: "slot_selection_state",
                description: "Available slots found, present them to user for selection"
              },
              {
                destination_state_name: "fallback_search_state",
                description: "No slots found in initial search, need to expand search parameters"
              }
            ]
          },
          {
            name: "slot_selection_state",
            description: "Help user choose from available slots",
            state_prompt: `Current date: {{current_calendar_Europe/Madrid}}
      Current time: {{current_time_Europe/Madrid}}
      
      Present available slots intelligently to help user make a selection.
      
      PRESENTATION STRATEGY:
      
      If 1-3 slots available:
      - List all options clearly: "I have [day, date at time], [day, date at time], and [day, date at time]. Which works best for you?"
      
      If 4-8 slots available:
      - Group by day if multiple days
      - "I have several options: On [day] I have [times], on [day] I have [times]..."
      - "Would you like to hear all options or focus on a specific day?"
      
      If many slots (9+):
      - Prioritize based on any stated preferences
      - "I have many slots available. The earliest is [slot]. I also have options on [preferred days if mentioned]."
      - "Would you like me to list all times or focus on specific days?"
      
      USER RESPONSE HANDLING:
      - If user selects a specific slot → Note the selection and transition to slot_confirmation_state to confirm
      - If user wants different options → Ask what they'd prefer and transition back to intelligent_search_state
      - If user is unsure → Ask clarifying questions: "Do you prefer morning or afternoon?" 
      
      IMPORTANT:
      - DO NOT say "I will book" or "Let me book" yet - just acknowledge their selection
      - Say something like: "Great choice! Let me confirm that with you..." then transition to slot_confirmation_state
      - The actual booking happens later after confirmation
      
      REMEMBER:
      - Be conversational and helpful
      - Store the selected slot details for the next state
      - If user mentions a slot not in your list, transition to check_availability_state to verify it`,
            edges: [
              {
                destination_state_name: "slot_confirmation_state",
                description: "User has selected a specific slot from the options"
              },
              {
                destination_state_name: "intelligent_search_state",
                description: "User wants to see different options or change search parameters"
              },
              {
                destination_state_name: "check_availability_state",
                description: "User mentions a specific slot not in the presented options"
              }
            ]
          },
          {
            name: "fallback_search_state",
            description: "Handle cases when initial searches fail or slots unavailable",
            state_prompt: `Current date: {{current_calendar_Europe/Madrid}}
      Current time: {{current_time_Europe/Madrid}}
      
      Handle situations when requested slots are not available or initial search found no results.
      
      FALLBACK STRATEGIES based on context:
      
      1. If SPECIFIC SLOT was unavailable:
         - "That exact time isn't available, but let me find the closest alternatives."
         - Search same day different times
         - Search adjacent days same time
         - Search within +/- 3 days of requested date
      
      2. If SPECIFIC DAY had no slots:
         - "I don't have any openings on [requested day], but let me check nearby days."
         - Check day before and day after
         - Check same day next week
         - Expand to +/- 1 week if needed
      
      3. If NO SLOTS found in date range:
         - "I haven't found availability in that timeframe. Let me expand the search."
         - Extend search by 30 days forward
         - Can search up to 90 days total (3 iterations)
      
      SEARCH EXPANSION using nearest_available_slots:
      - Call with progressively wider date ranges
      - Iteration 1: Original request + nearby days
      - Iteration 2: Extend by 2 weeks
      - Iteration 3: Extend by 30 days
      - If still nothing after 90 days, apologize and suggest calling directly
      
      COMMUNICATION:
      - Always explain what you're doing
      - "I couldn't find slots on Friday, but Saturday has several openings"
      - "The closest available to your 2pm request is 3pm on the same day"
      - Never mention technical details or function names
      
      TRANSITION:
      - Slots found → slot_selection_state
      - No slots after maximum search → apologize and offer phone contact
      - User accepts alternative → slot_confirmation_state`,
            tools: [
              {
                type: "custom",
                name: "nearest_available_slots",
                url: "https://placeholder-will-be-updated-after-agent-creation.com/nearest-available-slots",
                speak_during_execution: false,
                speak_after_execution: true,
                description: "Find the nearest available appointment slots within 30 days from start date",
                parameters: {
                  type: "object",
                  properties: {
                    startDate: {
                      type: "string",
                      description: "Starting date to search from (YYYY-MM-DD)"
                    },
                    count: {
                      type: "number",
                      description: "Number of available slots to return (default: 5)"
                    },
                    durationMinutes: {
                      type: "number",
                      description: "Duration of each slot in minutes (default: 60)"
                    }
                  },
                  required: ["startDate"]
                },
                execution_message_description: "Searching for alternative time slots",
                timeout_ms: 120000
              }
            ],
            edges: [
              {
                destination_state_name: "slot_selection_state",
                description: "Alternative slots found, present them to user"
              },
              {
                destination_state_name: "slot_confirmation_state",
                description: "User accepts a suggested alternative slot"
              }
            ]
          },
          {
            name: "slot_confirmation_state",
            description: "Confirm slot selection before booking",
            state_prompt: `Current date: {{current_calendar_Europe/Madrid}}
      Current time: {{current_time_Europe/Madrid}}
      
      Confirm the selected slot with the user before proceeding to book.
      
      CONFIRMATION SCRIPT:
      "Perfect! Just to confirm, you'd like to book an appointment on [Day], [Date] at [Time]. Is that correct?"
      
      WHEN USER CONFIRMS (says "yes", "correct", "book it", "that's right", etc.):
      1. IMMEDIATELY call check_availability function
      2. After receiving the function result:
         - If available=true: Say ONLY "Excellent! Let me get your details." and IMMEDIATELY transition to booking_details_state in the SAME response WITHOUT waiting for user input
         - If available=false: Say "That slot just became unavailable. Let me find alternatives." and transition to fallback_search_state
      
      CRITICAL: After check_availability returns available=true, you MUST transition to booking_details_state immediately. DO NOT ask another question or wait for user response.
      
      If user wants to change BEFORE confirming:
      - "No problem, let me show you other options."
      - Transition back to intelligent_search_state
      
      Store confirmed slot details (date, startTime, endTime) in dynamic variables for booking.`,
            tools: [
              {
                type: "custom",
                name: "check_availability",
                url: "https://placeholder-will-be-updated-after-agent-creation.com/check-availability",
                speak_during_execution: false,
                speak_after_execution: false,
                description: "Silently double-check if the slot is still available",
                parameters: {
                  type: "object",
                  properties: {
                    date: {
                      type: "string",
                      description: "Date in YYYY-MM-DD format"
                    },
                    startTime: {
                      type: "string",
                      description: "Start time in HH:mm format (24-hour)"
                    },
                    endTime: {
                      type: "string",
                      description: "End time in HH:mm format (24-hour)"
                    }
                  },
                  required: ["date", "startTime", "endTime"]
                },
                execution_message_description: "Setting that up for you",
                timeout_ms: 120000
              }
            ],
            edges: [
              {
                destination_state_name: "booking_details_state",
                description: "User confirmed and slot is still available"
              },
              {
                destination_state_name: "intelligent_search_state",
                description: "User wants to change the selected slot"
              },
              {
                destination_state_name: "fallback_search_state",
                description: "Slot is no longer available, need alternatives"
              }
            ]
          },
          {
            name: "booking_details_state",
            description: "Collect user details and complete booking",
            state_prompt: `You are in Europe/Madrid timezone.
      Current time: {{current_time_Europe/Madrid}}
      Current date: {{current_calendar_Europe/Madrid}}
      
      You are now in the booking phase. Your goal is to collect details and complete the booking.
      
      STEP-BY-STEP PROCESS:
      
      1. NAME COLLECTION:
         - Ask: "May I have your full name please?"
         - Get spelling if unclear: "Could you spell that for me?"
         - Confirm: "Let me confirm - that's [SPELL LETTER BY LETTER: A... S... H... O... K]. Is that correct?"
         - Speak naturally without dashes, just pause between letters
      
      2. EMAIL COLLECTION:
         - Ask: "What's the best email address to send your confirmation to?"
         - Confirm: "Let me spell that back: [SPELL EMAIL COMPLETELY]"
         - For common domains say: "at gmail dot com" or "at outlook dot com"
      
      3. PHONE COLLECTION:
         - Ask: "And could I have a phone number to reach you?"
         - Confirm: "That's [SAY EACH DIGIT: 6... 5... 5... 1... 2... 3... 4... 5... 6... 7]. Correct?"
      
      4. BOOKING EXECUTION:
         - Once ALL THREE details are confirmed (name, email, phone), IMMEDIATELY call book_appointment function
         - Use the previously confirmed date and time slot
         - Include meeting title like "Appointment with [customer name]"
      
      5. AFTER BOOKING SUCCESS:
         - Set appointment_booked=true, appointment_description=[summary], appointment_id=[id from response]
         - Say: "Perfect! Your appointment is all set for [DATE] at [TIME]. You'll receive a confirmation email at [EMAIL] shortly."
         - Ask: "Is there anything else I can help you with today?"
         - If user says no → use end_call tool
         - If user wants another appointment → transition to preference_gathering_state
      
      ERROR HANDLING:
      - If booking fails → transition to error_recovery_state
      
      CRITICAL: Move through details collection efficiently. Once you have all 3 details, call book_appointment IMMEDIATELY.`,
            tools: [
              {
                type: "custom",
                name: "book_appointment",
                url: "https://placeholder-will-be-updated-after-agent-creation.com/book-appointment",
                speak_during_execution: false,
                speak_after_execution: true,
                description: "Book an appointment at the confirmed time slot",
                parameters: {
                  type: "object",
                  properties: {
                    date: {
                      type: "string",
                      description: "Appointment date (YYYY-MM-DD)"
                    },
                    startTime: {
                      type: "string",
                      description: "Start time (HH:mm, 24-hour format)"
                    },
                    endTime: {
                      type: "string",
                      description: "End time (HH:mm, 24-hour format)"
                    },
                    title: {
                      type: "string",
                      description: "Meeting title"
                    },
                    description: {
                      type: "string",
                      description: "Meeting description"
                    },
                    customerName: {
                      type: "string",
                      description: "Customer's name"
                    },
                    customerEmail: {
                      type: "string",
                      description: "Customer's email address"
                    },
                    customerPhone: {
                      type: "string",
                      description: "Customer's phone number"
                    },
                    notes: {
                      type: "string",
                      description: "Additional notes"
                    }
                  },
                  required: ["date", "startTime", "endTime", "title"]
                },
                execution_message_description: "Booking your appointment",
                timeout_ms: 120000
              },
              {
                type: "end_call",
                name: "end_call",
                description: "End the call ONLY after successful booking and user confirms they don't need anything else"
              }
            ],
            edges: [
              {
                destination_state_name: "error_recovery_state",
                description: "Booking failed, need to handle error"
              },
              {
                destination_state_name: "preference_gathering_state",
                description: "User wants to book another appointment"
              }
            ]
          },
          {
            name: "error_recovery_state",
            description: "Handle errors gracefully and recover",
            state_prompt: `Current date: {{current_calendar_Europe/Madrid}}
      Current time: {{current_time_Europe/Madrid}}
      
      Handle any errors that occur during the booking process gracefully.
      
      ERROR TYPES AND RESPONSES:
      
      1. BOOKING FAILURE:
         - "I apologize, but I encountered an issue while booking that appointment. Let me find another slot for you."
         - Transition back to intelligent_search_state with saved preferences
      
      2. SYSTEM UNAVAILABLE:
         - "I'm having trouble accessing the booking system right now. Could you please try again in a few moments, or feel free to call us directly at [provide phone if available]."
         - Ask if they'd like to try again
      
      3. INVALID DATA:
         - "I think there might have been an issue with the information. Let me collect that again."
         - Re-collect only the problematic information
         - Return to booking_details_state
      
      4. NETWORK/TIMEOUT:
         - "The system is taking longer than expected. Let me try once more."
         - Retry once, then provide alternative contact method if fails
      
      RECOVERY ACTIONS:
      - Always maintain positive, helpful tone
      - Preserve all previously collected information
      - Offer alternatives (different slot, call directly, try again)
      - Never leave user without a path forward
      - If user explicitly wants to end call or give up, use end_call tool
      
      TRANSITIONS:
      - For slot-related issues → intelligent_search_state
      - For data collection issues → booking_details_state
      - For temporary issues → retry current action once
      - If user wants to end call → use end_call tool`,
            tools: [
              {
                type: "end_call",
                name: "end_call",
                description: "End the call ONLY if user explicitly wants to give up or end the call after multiple errors"
              }
            ],
            edges: [
              {
                destination_state_name: "intelligent_search_state",
                description: "Need to find a new slot after booking failure"
              },
              {
                destination_state_name: "booking_details_state",
                description: "Need to re-collect information"
              }
            ]
          }
        ],
        starting_state: "general_state",
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
        knowledge_base_ids: []
      };
      

      const llmResponse = await retell.createLLM(llmConfig);
      llmId = llmResponse.llm_id;

      Logger.info('LLM created successfully', {
        operationId,
        subaccountId,
        llmId
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

      // Step 2.5: Update agent with webhook URL (now that we have agentId) and tool URLs
      if (deployedWebhookUrl) {
        const webhookUrlWithAgent = `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/retell`;
        
        Logger.info('Updating agent with webhook URL and tool URLs', {
          operationId,
          subaccountId,
          agentId,
          webhookUrl: webhookUrlWithAgent
        });

        // Update LLM with tool URLs that include subaccountId and agentId
        const updatedLlmConfig = {
          general_tools: llmConfig.general_tools,
          states: [
            // State 0: general_state (has end_call tool)
            llmConfig.states[0],
            // State 1: preference_gathering_state (no tools)
            llmConfig.states[1],
            // State 2: date_clarification_state (no tools)
            llmConfig.states[2],
            // State 3: check_availability_state (has custom tools - update URLs)
            {
              ...llmConfig.states[3],
              tools: llmConfig.states[3].tools.map(tool => 
                tool.type === "custom" 
                  ? { ...tool, url: `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/check-availability` }
                  : tool
              )
            },
            // State 4: intelligent_search_state (has custom tools - update URLs)
            {
              ...llmConfig.states[4],
              tools: llmConfig.states[4].tools.map(tool => 
                tool.type === "custom" 
                  ? { ...tool, url: `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/nearest-available-slots` }
                  : tool
              )
            },
            // State 5: slot_selection_state (no tools)
            llmConfig.states[5],
            // State 6: fallback_search_state (has custom tools - update URLs)
            {
              ...llmConfig.states[6],
              tools: llmConfig.states[6].tools.map(tool => 
                tool.type === "custom" 
                  ? { ...tool, url: `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/nearest-available-slots` }
                  : tool
              )
            },
            // State 7: slot_confirmation_state (has custom tools - update URLs)
            {
              ...llmConfig.states[7],
              tools: llmConfig.states[7].tools.map(tool => 
                tool.type === "custom" 
                  ? { ...tool, url: `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/check-availability` }
                  : tool
              )
            },
            // State 8: booking_details_state (has custom tools - update URLs, and end_call)
            {
              ...llmConfig.states[8],
              tools: llmConfig.states[8].tools.map(tool => 
                tool.type === "custom" 
                  ? { ...tool, url: `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/book-appointment` }
                  : tool
              )
            },
            // State 9: error_recovery_state (has end_call tool)
            llmConfig.states[9]
          ]
        };

        // Update LLM with new tool URLs
        await retell.updateLLM(llmId, updatedLlmConfig);

        // Update agent with webhook URL
        await retell.updateAgent(agentId, {
          webhook_url: webhookUrlWithAgent
        });

        Logger.info('Agent and LLM updated with webhook URL and tool URLs', {
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
        operationId
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

      // Step 7: Delete all calls associated with this agent
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

      // Step 8: Invalidate cache for this agent
      try {
        await redisService.invalidateAgentStats(subaccountId, agentId);
      } catch (cacheError) {
        Logger.warn('Failed to invalidate agent statistics cache', {
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
        description: `Agent "${agentDocument.name}" deleted (including ${callsDeleteResult.deletedCount} associated calls)`,
        metadata: {
          agentId,
          agentName: agentDocument.name,
          llmId,
          deletedCallsCount: callsDeleteResult.deletedCount
        },
        resourceId: agentId,
        resourceName: agentDocument.name,
        operationId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: `Agent and ${callsDeleteResult.deletedCount} associated call(s) deleted successfully`,
        data: {
          agentId,
          llmId,
          deletedFromRetell: true,
          deletedFromDatabase: true,
          deletedCallsCount: callsDeleteResult.deletedCount
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
    const callsWithScores = calls.filter(call => call.success_score && call.success_score > 0);
    const totalSuccessScore = callsWithScores.reduce((sum, call) => sum + (call.success_score || 0), 0);
    const cumulativeSuccessRate = callsWithScores.length > 0 
      ? (totalSuccessScore / callsWithScores.length) * 100 
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

      // Check cache first (only for non-mock sessions)
      if (!isMockSession) {
        const cacheKey = `${subaccountId}:${agentId}:${currentPeriodStart.getTime()}:${currentPeriodEnd.getTime()}`;
        try {
          const cachedStats = await redisService.getCachedAgentStats(cacheKey, cacheKey);
          if (cachedStats) {
            return res.json({
              success: true,
              message: 'Agent details retrieved successfully (cached)',
              data: cachedStats,
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
      }

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
            // Only include valid success scores
            validSuccessScore: {
              $cond: {
                if: { $gt: [{ $ifNull: ['$success_score', 0] }, 0] },
                then: '$success_score',
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
        {
          $project: {
            _id: 1,
            totalCalls: 1,
            unresponsiveCalls: 1,
            callIds: 1,
            successScores: {
              $filter: {
                input: '$successScores',
                as: 'score',
                cond: { $ne: ['$$score', null] }
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
            cumulativeSuccessRate: {
              $cond: {
                if: { $gt: [{ $size: '$successScores' }, 0] },
                then: {
                  $divide: [
                    { $reduce: {
                      input: '$successScores',
                      initialValue: 0,
                      in: { $add: ['$$value', '$$this'] }
                    }},
                    { $size: '$successScores' }
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
              $gte: previousPeriodStart
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
          cumulativeSuccessRate: Math.round(currentStats.cumulativeSuccessRate * 100) / 100,
          periodStart: currentPeriodStart,
          periodEnd: currentPeriodEnd
        },
        previousPeriod: {
          totalCalls: previousStats.totalCalls,
          meetingsBooked: meetingsCounts.previousPeriodMeetings,
          unresponsiveCalls: previousStats.unresponsiveCalls,
          cumulativeSuccessRate: Math.round(previousStats.cumulativeSuccessRate * 100) / 100,
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
            change: Math.round((currentStats.cumulativeSuccessRate - previousStats.cumulativeSuccessRate) * 100) / 100,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.cumulativeSuccessRate, previousStats.cumulativeSuccessRate) * 100
            ) / 100
          }
        }
      };

      // Cache the results for 5 minutes
      try {
        await redisService.cacheAgentStats(cacheKey, cacheKey, statistics, 300);
      } catch (cacheError) {
        Logger.warn('Failed to cache agent statistics', {
          operationId,
          error: cacheError.message
        });
      }

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

      // Check cache first (cache key includes date range and cost indicator)
      const cacheKey = `${subaccountId}:${agentId}:cost:${currentPeriodStart.getTime()}:${currentPeriodEnd.getTime()}`;
      try {
        const cachedStats = await redisService.getCachedAgentStats(cacheKey, cacheKey);
        if (cachedStats) {
          return res.json({
            success: true,
            message: 'Agent details with cost retrieved successfully (cached)',
            data: cachedStats,
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
            // Only include valid success scores
            validSuccessScore: {
              $cond: {
                if: { $gt: [{ $ifNull: ['$success_score', 0] }, 0] },
                then: '$success_score',
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
            successScores: {
              $filter: {
                input: '$successScores',
                as: 'score',
                cond: { $ne: ['$$score', null] }
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
                if: { $gt: [{ $size: '$successScores' }, 0] },
                then: {
                  $divide: [
                    { $reduce: {
                      input: '$successScores',
                      initialValue: 0,
                      in: { $add: ['$$value', '$$this'] }
                    }},
                    { $size: '$successScores' }
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
              $gte: previousPeriodStart
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
          cumulativeSuccessRate: Math.round(currentStats.cumulativeSuccessRate * 100) / 100,
          costPerCall: Math.round(currentStats.avgCostPerCall * 100) / 100,
          avgCallDuration: Math.round(currentStats.avgCallDuration * 100) / 100,
          periodStart: currentPeriodStart,
          periodEnd: currentPeriodEnd
        },
        previousPeriod: {
          totalCalls: previousStats.totalCalls,
          meetingsBooked: meetingsCounts.previousPeriodMeetings,
          unresponsiveCalls: previousStats.unresponsiveCalls,
          cumulativeSuccessRate: Math.round(previousStats.cumulativeSuccessRate * 100) / 100,
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
            change: Math.round((currentStats.cumulativeSuccessRate - previousStats.cumulativeSuccessRate) * 100) / 100,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.cumulativeSuccessRate, previousStats.cumulativeSuccessRate) * 100
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

      // Cache the results for 5 minutes
      try {
        await redisService.cacheAgentStats(cacheKey, cacheKey, statistics, 300);
      } catch (cacheError) {
        Logger.warn('Failed to cache agent statistics with cost', {
          operationId,
          error: cacheError.message
        });
      }

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

      // Check cache first
      const cacheKey = `${subaccountId}:${agentId}:analytics:${periodStart.getTime()}:${periodEnd.getTime()}:${groupBy}`;
      try {
        const cachedData = await redisService.getCachedAgentStats(cacheKey, cacheKey);
        if (cachedData) {
          return res.json({
            success: true,
            message: 'Agent call analytics retrieved successfully (cached)',
            data: cachedData,
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
          successRate: overallStats.totalCalls > 0 
            ? Math.round((overallStats.successfulCalls / overallStats.totalCalls) * 10000) / 100 
            : 0
        },
        successTimeline,
        peakHours,
        outcomeDistribution
      };

      // Cache the results for 5 minutes
      try {
        await redisService.cacheAgentStats(cacheKey, cacheKey, responseData, 300);
      } catch (cacheError) {
        Logger.warn('Failed to cache agent call analytics', {
          operationId,
          error: cacheError.message
        });
      }

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

      // Check cache first
      const cacheKey = `${subaccountId}:${agentId}:costs-breakdown:${periodStart.getTime()}:${periodEnd.getTime()}`;
      try {
        const cachedData = await redisService.getCachedAgentStats(cacheKey, cacheKey);
        if (cachedData) {
          return res.json({
            success: true,
            message: 'Agent call costs breakdown retrieved successfully (cached)',
            data: cachedData,
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

      // Cache the results for 5 minutes
      try {
        await redisService.cacheAgentStats(cacheKey, cacheKey, responseData, 300);
      } catch (cacheError) {
        Logger.warn('Failed to cache agent call costs breakdown', {
          operationId,
          error: cacheError.message
        });
      }

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
        operationId
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

      // Step 1: Create LLM (same as normal agent)
      Logger.info('Creating LLM for chat agent', { operationId, subaccountId, name });
      
      // Use the same comprehensive 10-state configuration as voice agents
      const llmConfig = {
        version: 0,
        model: "gpt-4o-mini",
        model_temperature: 0,
        model_high_priority: true,
        tool_call_strict_mode: true,
        begin_message: "",
        general_prompt: "You are an intelligent appointment scheduling assistant that helps users book meetings efficiently.",
        general_tools: [],
        states: [
          {
            name: "general_state",
            description: "Initial conversation and intent detection state",
            state_prompt: `Your agent_id is {{agent_id}}. You are in Europe/Madrid timezone. 
      Current time: {{current_time_Europe/Madrid}}
      Current date: {{current_calendar_Europe/Madrid}}
      
      You are an intelligent appointment scheduling assistant. Your goal is to help users book appointments efficiently.
      
      INITIAL ASSESSMENT:
      - Identify if the user wants to schedule an appointment
      - Listen for scheduling triggers (callback requests, service interest, appointment mentions)
      - Be proactive but not pushy
      - If user shows interest, understand their initial preferences
      
      TRANSITION RULES:
      - If user mentions a specific date/time → transition to date_clarification_state
      - If user asks for availability without specifics → transition to preference_gathering_state
      - If user needs help understanding options → transition to preference_gathering_state
      - Default to preference_gathering_state if user wants to schedule but provides no details
      - If user explicitly wants to end the call or says goodbye → use end_call tool
      
      YOUR ULTIMATE GOAL IS TO BOOK A MEETING - be helpful and guide the conversation towards scheduling.`,
            tools: [
          {
            type: "end_call",
            name: "end_call",
                description: "End the call ONLY if user explicitly wants to end or says goodbye before scheduling"
              }
            ],
            edges: [
              {
                destination_state_name: "preference_gathering_state",
                description: "User expresses interest in scheduling but provides no specific preferences"
              },
              {
                destination_state_name: "date_clarification_state",
                description: "User mentions a specific date, time, or day of week that needs clarification"
              }
            ]
          },
          {
            name: "preference_gathering_state",
            description: "Collect user's scheduling preferences intelligently",
            state_prompt: `Current date: {{current_calendar_Europe/Madrid}}
      Current time: {{current_time_Europe/Madrid}}
      
      Gather user's scheduling preferences intelligently:
      
      QUESTIONS TO ASK (choose relevant ones based on context):
      1. "Do you have any preferred days or times in mind?"
      2. "Are you looking for something this week, next week, or later?"
      3. "Do you prefer mornings (8am-12pm), afternoons (12pm-5pm), or evenings (5pm-8pm)?"
      4. "Are there any days that don't work for you?"
      5. "How urgent is this appointment - do you need something as soon as possible?"
      
      INTELLIGENCE RULES:
      - If user says a weekday (e.g., "Friday") → Note it and transition to date_clarification_state
      - If user says "next week" → Calculate actual date range (next Monday to Sunday)
      - If user says "ASAP" or "earliest available" → Note urgency and search from today
      - If user gives a date range → Note both start and end dates
      - Store preferences in context for later use
      
      TRANSITION RULES:
      - Specific date/time mentioned → date_clarification_state
      - General preferences gathered (or user wants to see what's available) → intelligent_search_state
      - User is vague and wants to see all options → intelligent_search_state`,
            edges: [
              {
                destination_state_name: "intelligent_search_state",
                description: "Preferences gathered or user wants to see available options"
              },
              {
                destination_state_name: "date_clarification_state",
                description: "User provides specific date/time during preference gathering"
              }
            ]
          },
          {
            name: "date_clarification_state",
            description: "Disambiguate and validate date/time requests",
            state_prompt: `Current date: {{current_calendar_Europe/Madrid}}
      Current time: {{current_time_Europe/Madrid}}
      You are in Europe/Madrid timezone.
      
      CLARIFICATION LOGIC for ambiguous dates:
      
      For weekday mentions (Monday, Tuesday, etc.):
      - Calculate if it's this week or next week
      - Ask: "Do you mean this [Day] ([specific date]) or next [Day] ([specific date])?"
      - Example: If today is Wednesday and user says "Friday", clarify "this Friday November 22nd or next Friday November 29th?"
      
      For relative dates:
      - "Tomorrow" → Calculate and confirm exact date
      - "Next week" → Clarify the date range (next Monday to Sunday)
      - "In 2 weeks" → Calculate and confirm exact date
      - "End of month" → Calculate last days of current month
      
      IMPORTANT:
      - Always confirm the interpreted date with user
      - Check that date is not in the past
      - Be explicit about dates to avoid confusion
      - Store clarified date/time for next state
      
      TRANSITION RULES:
      - If specific time slot is clarified (date + time) → check_availability_state
      - If only date is clarified (no specific time) → intelligent_search_state
      - If date range is clarified → intelligent_search_state`,
            edges: [
              {
                destination_state_name: "check_availability_state",
                description: "Specific date and time slot has been clarified and confirmed"
              },
              {
                destination_state_name: "intelligent_search_state",
                description: "Date clarified but no specific time, need to search for slots"
              }
            ]
          },
          {
            name: "check_availability_state",
            description: "Verify if a specific slot is available",
            state_prompt: `You are in Europe/Madrid timezone.
      Current time: {{current_time_Europe/Madrid}}
      Current date: {{current_calendar_Europe/Madrid}}
      
      Check availability for the specific slot requested using check_availability function.
      
      FUNCTION USAGE:
      - IMMEDIATELY call check_availability with the exact date and time the user requested
      - Date format: YYYY-MM-DD
      - Time format: HH:mm (24-hour)
      - All times must be in Europe/Madrid timezone
      - Do NOT ask permission - just call the function immediately
      
      RESPONSE HANDLING:
      After receiving function result, respond AND transition in the SAME turn:
      
      If slot is AVAILABLE:
      - Say: "Great! That slot on [day], [date] at [time] is available."
      - IMMEDIATELY transition to slot_confirmation_state in the same response
      
      If slot is NOT AVAILABLE:
      - Say: "Unfortunately, that specific time isn't available. Let me find some nearby alternatives for you."
      - IMMEDIATELY transition to fallback_search_state in the same response
      
      CRITICAL: Always transition immediately after receiving the function result. Never wait for more user input.`,
            tools: [
              {
                type: "custom",
                name: "check_availability",
                url: "https://placeholder-will-be-updated-after-agent-creation.com/check-availability",
                speak_during_execution: false,
                speak_after_execution: true,
                description: "Check if a specific time slot is available for booking an appointment",
                parameters: {
                  type: "object",
                  properties: {
                    date: {
                      type: "string",
                      description: "Date in YYYY-MM-DD format"
                    },
                    startTime: {
                      type: "string",
                      description: "Start time in HH:mm format (24-hour)"
                    },
                    endTime: {
                      type: "string",
                      description: "End time in HH:mm format (24-hour)"
                    }
                  },
                  required: ["date", "startTime", "endTime"]
                },
                execution_message_description: "Checking availability for the appointment",
                timeout_ms: 120000
              }
            ],
            edges: [
              {
                destination_state_name: "slot_confirmation_state",
                description: "The requested slot is available"
              },
              {
                destination_state_name: "fallback_search_state",
                description: "The requested slot is not available, need to find alternatives"
              }
            ]
          },
          {
            name: "intelligent_search_state",
            description: "Smart search for available slots based on preferences",
            state_prompt: `You are in Europe/Madrid timezone.
      Current time: {{current_time_Europe/Madrid}}
      Current date: {{current_calendar_Europe/Madrid}}
      
      Perform intelligent slot search using nearest_available_slots function based on gathered preferences.
      
      SEARCH STRATEGY:
      
      1. For SPECIFIC DAY requests (e.g., "this Friday"):
         - Start search from that specific date
         - If no slots found, inform user and search nearby days (day before, day after, week later)
      
      2. For DATE RANGE requests:
         - Start from beginning of range
         - Search in chunks (function returns 30 days of data)
         - If range is longer than 30 days, you may need multiple searches
      
      3. For ASAP/URGENT requests:
         - Start from today's date
         - Find the earliest available slots
      
      4. For TIME PREFERENCE requests (morning/afternoon/evening):
         - Search for slots and mentally filter based on time preference
         - Morning: 8am-12pm, Afternoon: 12pm-5pm, Evening: 5pm-8pm
      
      PROGRESSIVE SEARCH:
      - Initial search: Use startDate based on user preference
      - If no results: Extend search by 30 days (call function again with new startDate)
      - Maximum 3 searches (90 days total) before suggesting user call directly
      
      IMPORTANT: 
      - NEVER mention the function name "nearest_available_slots" to the user
      - Present results naturally: "I found these available times..." not "The function returned..."
      - Group and organize results intelligently before presenting
      - After presenting slots, WAIT for user to select one - don't book yet
      
      TRANSITION:
      - After presenting slots and receiving function results → IMMEDIATELY transition to slot_selection_state
      - If no slots found after searching → fallback_search_state`,
            tools: [
              {
                type: "custom",
                name: "nearest_available_slots",
                url: "https://placeholder-will-be-updated-after-agent-creation.com/nearest-available-slots",
                speak_during_execution: false,
                speak_after_execution: true,
                description: "Find the nearest available appointment slots within 30 days from start date",
                parameters: {
                  type: "object",
                  properties: {
                    startDate: {
                      type: "string",
                      description: "Starting date to search from (YYYY-MM-DD)"
                    },
                    count: {
                      type: "number",
                      description: "Number of available slots to return (default: 5)"
                    },
                    durationMinutes: {
                      type: "number",
                      description: "Duration of each slot in minutes (default: 60)"
                    }
                  },
                  required: ["startDate"]
                },
                execution_message_description: "Finding available time slots for you",
                timeout_ms: 120000
              }
            ],
            edges: [
              {
                destination_state_name: "slot_selection_state",
                description: "Available slots found, present them to user for selection"
              },
              {
                destination_state_name: "fallback_search_state",
                description: "No slots found in initial search, need to expand search parameters"
              }
            ]
          },
          {
            name: "slot_selection_state",
            description: "Help user choose from available slots",
            state_prompt: `Current date: {{current_calendar_Europe/Madrid}}
      Current time: {{current_time_Europe/Madrid}}
      
      Present available slots intelligently to help user make a selection.
      
      PRESENTATION STRATEGY:
      
      If 1-3 slots available:
      - List all options clearly: "I have [day, date at time], [day, date at time], and [day, date at time]. Which works best for you?"
      
      If 4-8 slots available:
      - Group by day if multiple days
      - "I have several options: On [day] I have [times], on [day] I have [times]..."
      - "Would you like to hear all options or focus on a specific day?"
      
      If many slots (9+):
      - Prioritize based on any stated preferences
      - "I have many slots available. The earliest is [slot]. I also have options on [preferred days if mentioned]."
      - "Would you like me to list all times or focus on specific days?"
      
      USER RESPONSE HANDLING:
      - If user selects a specific slot → Note the selection and transition to slot_confirmation_state to confirm
      - If user wants different options → Ask what they'd prefer and transition back to intelligent_search_state
      - If user is unsure → Ask clarifying questions: "Do you prefer morning or afternoon?" 
      
      IMPORTANT:
      - DO NOT say "I will book" or "Let me book" yet - just acknowledge their selection
      - Say something like: "Great choice! Let me confirm that with you..." then transition to slot_confirmation_state
      - The actual booking happens later after confirmation
      
      REMEMBER:
      - Be conversational and helpful
      - Store the selected slot details for the next state
      - If user mentions a slot not in your list, transition to check_availability_state to verify it`,
            edges: [
              {
                destination_state_name: "slot_confirmation_state",
                description: "User has selected a specific slot from the options"
              },
              {
                destination_state_name: "intelligent_search_state",
                description: "User wants to see different options or change search parameters"
              },
              {
                destination_state_name: "check_availability_state",
                description: "User mentions a specific slot not in the presented options"
              }
            ]
          },
          {
            name: "fallback_search_state",
            description: "Handle cases when initial searches fail or slots unavailable",
            state_prompt: `Current date: {{current_calendar_Europe/Madrid}}
      Current time: {{current_time_Europe/Madrid}}
      
      Handle situations when requested slots are not available or initial search found no results.
      
      FALLBACK STRATEGIES based on context:
      
      1. If SPECIFIC SLOT was unavailable:
         - "That exact time isn't available, but let me find the closest alternatives."
         - Search same day different times
         - Search adjacent days same time
         - Search within +/- 3 days of requested date
      
      2. If SPECIFIC DAY had no slots:
         - "I don't have any openings on [requested day], but let me check nearby days."
         - Check day before and day after
         - Check same day next week
         - Expand to +/- 1 week if needed
      
      3. If NO SLOTS found in date range:
         - "I haven't found availability in that timeframe. Let me expand the search."
         - Extend search by 30 days forward
         - Can search up to 90 days total (3 iterations)
      
      SEARCH EXPANSION using nearest_available_slots:
      - Call with progressively wider date ranges
      - Iteration 1: Original request + nearby days
      - Iteration 2: Extend by 2 weeks
      - Iteration 3: Extend by 30 days
      - If still nothing after 90 days, apologize and suggest calling directly
      
      COMMUNICATION:
      - Always explain what you're doing
      - "I couldn't find slots on Friday, but Saturday has several openings"
      - "The closest available to your 2pm request is 3pm on the same day"
      - Never mention technical details or function names
      
      TRANSITION:
      - Slots found → slot_selection_state
      - No slots after maximum search → apologize and offer phone contact
      - User accepts alternative → slot_confirmation_state`,
            tools: [
              {
                type: "custom",
                name: "nearest_available_slots",
                url: "https://placeholder-will-be-updated-after-agent-creation.com/nearest-available-slots",
                speak_during_execution: false,
                speak_after_execution: true,
                description: "Find the nearest available appointment slots within 30 days from start date",
                parameters: {
                  type: "object",
                  properties: {
                    startDate: {
                      type: "string",
                      description: "Starting date to search from (YYYY-MM-DD)"
                    },
                    count: {
                      type: "number",
                      description: "Number of available slots to return (default: 5)"
                    },
                    durationMinutes: {
                      type: "number",
                      description: "Duration of each slot in minutes (default: 60)"
                    }
                  },
                  required: ["startDate"]
                },
                execution_message_description: "Searching for alternative time slots",
                timeout_ms: 120000
              }
            ],
            edges: [
              {
                destination_state_name: "slot_selection_state",
                description: "Alternative slots found, present them to user"
              },
              {
                destination_state_name: "slot_confirmation_state",
                description: "User accepts a suggested alternative slot"
              }
            ]
          },
          {
            name: "slot_confirmation_state",
            description: "Confirm slot selection before booking",
            state_prompt: `Current date: {{current_calendar_Europe/Madrid}}
      Current time: {{current_time_Europe/Madrid}}
      
      Confirm the selected slot with the user before proceeding to book.
      
      CONFIRMATION SCRIPT:
      "Perfect! Just to confirm, you'd like to book an appointment on [Day], [Date] at [Time]. Is that correct?"
      
      WHEN USER CONFIRMS (says "yes", "correct", "book it", "that's right", etc.):
      1. IMMEDIATELY call check_availability function
      2. After receiving the function result:
         - If available=true: Say ONLY "Excellent! Let me get your details." and IMMEDIATELY transition to booking_details_state in the SAME response WITHOUT waiting for user input
         - If available=false: Say "That slot just became unavailable. Let me find alternatives." and transition to fallback_search_state
      
      CRITICAL: After check_availability returns available=true, you MUST transition to booking_details_state immediately. DO NOT ask another question or wait for user response.
      
      If user wants to change BEFORE confirming:
      - "No problem, let me show you other options."
      - Transition back to intelligent_search_state
      
      Store confirmed slot details (date, startTime, endTime) in dynamic variables for booking.`,
            tools: [
              {
                type: "custom",
                name: "check_availability",
                url: "https://placeholder-will-be-updated-after-agent-creation.com/check-availability",
                speak_during_execution: false,
                speak_after_execution: false,
                description: "Silently double-check if the slot is still available",
                parameters: {
                  type: "object",
                  properties: {
                    date: {
                      type: "string",
                      description: "Date in YYYY-MM-DD format"
                    },
                    startTime: {
                      type: "string",
                      description: "Start time in HH:mm format (24-hour)"
                    },
                    endTime: {
                      type: "string",
                      description: "End time in HH:mm format (24-hour)"
                    }
                  },
                  required: ["date", "startTime", "endTime"]
                },
                execution_message_description: "Setting that up for you",
                timeout_ms: 120000
              }
            ],
            edges: [
              {
                destination_state_name: "booking_details_state",
                description: "User confirmed and slot is still available"
              },
              {
                destination_state_name: "intelligent_search_state",
                description: "User wants to change the selected slot"
              },
              {
                destination_state_name: "fallback_search_state",
                description: "Slot is no longer available, need alternatives"
              }
            ]
          },
          {
            name: "booking_details_state",
            description: "Collect user details and complete booking",
            state_prompt: `You are in Europe/Madrid timezone.
      Current time: {{current_time_Europe/Madrid}}
      Current date: {{current_calendar_Europe/Madrid}}
      
      You are now in the booking phase. Your goal is to collect details and complete the booking.
      
      STEP-BY-STEP PROCESS:
      
      1. NAME COLLECTION:
         - Ask: "May I have your full name please?"
         - Get spelling if unclear: "Could you spell that for me?"
         - Confirm: "Let me confirm - that's [SPELL LETTER BY LETTER: A... S... H... O... K]. Is that correct?"
         - Speak naturally without dashes, just pause between letters
      
      2. EMAIL COLLECTION:
         - Ask: "What's the best email address to send your confirmation to?"
         - Confirm: "Let me spell that back: [SPELL EMAIL COMPLETELY]"
         - For common domains say: "at gmail dot com" or "at outlook dot com"
      
      3. PHONE COLLECTION:
         - Ask: "And could I have a phone number to reach you?"
         - Confirm: "That's [SAY EACH DIGIT: 6... 5... 5... 1... 2... 3... 4... 5... 6... 7]. Correct?"
      
      4. BOOKING EXECUTION:
         - Once ALL THREE details are confirmed (name, email, phone), IMMEDIATELY call book_appointment function
         - Use the previously confirmed date and time slot
         - Include meeting title like "Appointment with [customer name]"
      
      5. AFTER BOOKING SUCCESS:
         - Set appointment_booked=true, appointment_description=[summary], appointment_id=[id from response]
         - Say: "Perfect! Your appointment is all set for [DATE] at [TIME]. You'll receive a confirmation email at [EMAIL] shortly."
         - Ask: "Is there anything else I can help you with today?"
         - If user says no → use end_call tool
         - If user wants another appointment → transition to preference_gathering_state
      
      ERROR HANDLING:
      - If booking fails → transition to error_recovery_state
      
      CRITICAL: Move through details collection efficiently. Once you have all 3 details, call book_appointment IMMEDIATELY.`,
            tools: [
              {
                type: "custom",
                name: "book_appointment",
                url: "https://placeholder-will-be-updated-after-agent-creation.com/book-appointment",
                speak_during_execution: false,
                speak_after_execution: true,
                description: "Book an appointment at the confirmed time slot",
                parameters: {
                  type: "object",
                  properties: {
                    date: {
                      type: "string",
                      description: "Appointment date (YYYY-MM-DD)"
                    },
                    startTime: {
                      type: "string",
                      description: "Start time (HH:mm, 24-hour format)"
                    },
                    endTime: {
                      type: "string",
                      description: "End time (HH:mm, 24-hour format)"
                    },
                    title: {
                      type: "string",
                      description: "Meeting title"
                    },
                    description: {
                      type: "string",
                      description: "Meeting description"
                    },
                    customerName: {
                      type: "string",
                      description: "Customer's name"
                    },
                    customerEmail: {
                      type: "string",
                      description: "Customer's email address"
                    },
                    customerPhone: {
                      type: "string",
                      description: "Customer's phone number"
                    },
                    notes: {
                      type: "string",
                      description: "Additional notes"
                    }
                  },
                  required: ["date", "startTime", "endTime", "title"]
                },
                execution_message_description: "Booking your appointment",
                timeout_ms: 120000
              },
              {
                type: "end_call",
                name: "end_call",
                description: "End the call ONLY after successful booking and user confirms they don't need anything else"
              }
            ],
            edges: [
              {
                destination_state_name: "error_recovery_state",
                description: "Booking failed, need to handle error"
              },
              {
                destination_state_name: "preference_gathering_state",
                description: "User wants to book another appointment"
              }
            ]
          },
          {
            name: "error_recovery_state",
            description: "Handle errors gracefully and recover",
            state_prompt: `Current date: {{current_calendar_Europe/Madrid}}
      Current time: {{current_time_Europe/Madrid}}
      
      Handle any errors that occur during the booking process gracefully.
      
      ERROR TYPES AND RESPONSES:
      
      1. BOOKING FAILURE:
         - "I apologize, but I encountered an issue while booking that appointment. Let me find another slot for you."
         - Transition back to intelligent_search_state with saved preferences
      
      2. SYSTEM UNAVAILABLE:
         - "I'm having trouble accessing the booking system right now. Could you please try again in a few moments, or feel free to call us directly at [provide phone if available]."
         - Ask if they'd like to try again
      
      3. INVALID DATA:
         - "I think there might have been an issue with the information. Let me collect that again."
         - Re-collect only the problematic information
         - Return to booking_details_state
      
      4. NETWORK/TIMEOUT:
         - "The system is taking longer than expected. Let me try once more."
         - Retry once, then provide alternative contact method if fails
      
      RECOVERY ACTIONS:
      - Always maintain positive, helpful tone
      - Preserve all previously collected information
      - Offer alternatives (different slot, call directly, try again)
      - Never leave user without a path forward
      - If user explicitly wants to end call or give up, use end_call tool
      
      TRANSITIONS:
      - For slot-related issues → intelligent_search_state
      - For data collection issues → booking_details_state
      - For temporary issues → retry current action once
      - If user wants to end call → use end_call tool`,
            tools: [
              {
                type: "end_call",
                name: "end_call",
                description: "End the call ONLY if user explicitly wants to give up or end the call after multiple errors"
              }
            ],
            edges: [
              {
                destination_state_name: "intelligent_search_state",
                description: "Need to find a new slot after booking failure"
              },
              {
                destination_state_name: "booking_details_state",
                description: "Need to re-collect information"
              }
            ]
          }
        ],
        starting_state: "general_state",
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
        knowledge_base_ids: []
      };

      const llmResponse = await retell.createLLM(llmConfig);
      llmId = llmResponse.llm_id;

      Logger.info('LLM created successfully for chat agent', {
        operationId,
        subaccountId,
        llmId
      });

      // Step 2: Create Agent with the LLM ID
      Logger.info('Creating chat agent with LLM', { operationId, subaccountId, name, llmId });

      const webhookUrl = config.retell.webhookUrl;
      if (!webhookUrl) {
        throw new Error('Webhook URL not configured. Please set RETELL_WEBHOOK_URL in environment variables.');
      }

      const agentConfig = {
        version: 0,
        response_engine: {
          type: "retell-llm",
          llm_id: llmId,
          version: 0
        },
        agent_name: name,
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
        webhook_url: webhookUrl,
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

      Logger.info('Chat agent created successfully', {
        operationId,
        subaccountId,
        agentId,
        agentName: agentResponse.agent_name
      });

      // Step 2.5: Update agent with webhook URL (now that we have agentId) and tool URLs
      if (deployedWebhookUrl) {
        const webhookUrlWithAgent = `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/retell`;
        
        Logger.info('Updating chat agent with webhook URL and tool URLs', {
          operationId,
          subaccountId,
          agentId,
          webhookUrl: webhookUrlWithAgent
        });

        // Update LLM with tool URLs that include subaccountId and agentId
        const updatedLlmConfig = {
          general_tools: llmConfig.general_tools,
          states: [
            // State 0: general_state (has end_call tool)
            llmConfig.states[0],
            // State 1: preference_gathering_state (no tools)
            llmConfig.states[1],
            // State 2: date_clarification_state (no tools)
            llmConfig.states[2],
            // State 3: check_availability_state (has custom tools - update URLs)
            {
              ...llmConfig.states[3],
              tools: llmConfig.states[3].tools.map(tool => 
                tool.type === "custom" 
                  ? { ...tool, url: `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/check-availability` }
                  : tool
              )
            },
            // State 4: intelligent_search_state (has custom tools - update URLs)
            {
              ...llmConfig.states[4],
              tools: llmConfig.states[4].tools.map(tool => 
                tool.type === "custom" 
                  ? { ...tool, url: `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/nearest-available-slots` }
                  : tool
              )
            },
            // State 5: slot_selection_state (no tools)
            llmConfig.states[5],
            // State 6: fallback_search_state (has custom tools - update URLs)
            {
              ...llmConfig.states[6],
              tools: llmConfig.states[6].tools.map(tool => 
                tool.type === "custom" 
                  ? { ...tool, url: `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/nearest-available-slots` }
                  : tool
              )
            },
            // State 7: slot_confirmation_state (has custom tools - update URLs)
            {
              ...llmConfig.states[7],
              tools: llmConfig.states[7].tools.map(tool => 
                tool.type === "custom" 
                  ? { ...tool, url: `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/check-availability` }
                  : tool
              )
            },
            // State 8: booking_details_state (has custom tools - update URLs, and end_call)
            {
              ...llmConfig.states[8],
              tools: llmConfig.states[8].tools.map(tool => 
                tool.type === "custom" 
                  ? { ...tool, url: `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/book-appointment` }
                  : tool
              )
            },
            // State 9: error_recovery_state (has end_call tool)
            llmConfig.states[9]
          ]
        };

        // Update LLM with new tool URLs
        await retell.updateLLM(llmId, updatedLlmConfig);

        // Update agent with webhook URL
        await retell.updateAgent(agentId, {
          webhook_url: webhookUrlWithAgent
        });

        Logger.info('Chat agent and LLM updated with webhook URL and tool URLs', {
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
        operationId
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
            await retell.deleteAgent(agentId);
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
        operationId
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
              $gte: previousPeriodStart
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
      const currentMeetingsData = meetingsAggregation.find(m => m._id === 'current') || {
        totalMeetings: 0,
        uniqueChatIds: []
      };
      const previousMeetingsData = meetingsAggregation.find(m => m._id === 'previous') || {
        totalMeetings: 0,
        uniqueChatIds: []
      };

      // Combine stats with meetings data
      const currentStats = {
        totalChats: currentStatsRaw.totalChats,
        meetingsBooked: currentMeetingsData.totalMeetings,
        successfulChats: currentMeetingsData.uniqueChatIds.length,
        successRate: currentStatsRaw.totalChats > 0 
          ? (currentMeetingsData.uniqueChatIds.length / currentStatsRaw.totalChats) * 100 
          : 0
      };

      const previousStats = {
        totalChats: previousStatsRaw.totalChats,
        meetingsBooked: previousMeetingsData.totalMeetings,
        successfulChats: previousMeetingsData.uniqueChatIds.length,
        successRate: previousStatsRaw.totalChats > 0 
          ? (previousMeetingsData.uniqueChatIds.length / previousStatsRaw.totalChats) * 100 
          : 0
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
      const meetingsAggregation = await meetingsCollection.aggregate([
        {
          $match: {
            subaccountId: subaccountId,
            agentId: agentId,
            createdAt: {
              $gte: previousPeriodStart
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
            totalMeetings: { $sum: 1 }
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

      const currentMeetingsData = meetingsAggregation.find(m => m._id === 'current') || { totalMeetings: 0 };
      const previousMeetingsData = meetingsAggregation.find(m => m._id === 'previous') || { totalMeetings: 0 };

      // Calculate metrics
      const currentStats = {
        totalChats: currentChatsData.totalChats,
        meetingsBooked: currentMeetingsData.totalMeetings,
        unresponsiveChats: currentChatsData.unresponsiveChats,
        cumulativeSuccessRate: currentChatsData.totalChats > 0 
          ? (currentMeetingsData.totalMeetings / currentChatsData.totalChats) * 100 
          : 0,
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
        cumulativeSuccessRate: previousChatsData.totalChats > 0 
          ? (previousMeetingsData.totalMeetings / previousChatsData.totalChats) * 100 
          : 0,
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
            change: Math.round((currentStats.cumulativeSuccessRate - previousStats.cumulativeSuccessRate) * 100) / 100,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.cumulativeSuccessRate, previousStats.cumulativeSuccessRate) * 100
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

      // Step 7: Delete WhatsApp connections from MongoDB
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

      // Step 8: Delete Instagram connections from MongoDB
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

      // Step 9: Delete all chats associated with this agent
      const chatsDeleteResult = await chatsCollection.deleteMany({ 
        agent_id: agentId,
        subaccountId: subaccountId 
      });

      Logger.info('Associated chats deleted from MongoDB', {
        operationId,
        agentId,
        deletedCount: chatsDeleteResult.deletedCount
      });

      // Step 10: Delete chat agent document from MongoDB
      const agentDeleteResult = await chatAgentsCollection.deleteOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      Logger.info('Chat agent document deleted from MongoDB', {
        operationId,
        agentId,
        deletedCount: agentDeleteResult.deletedCount
      });

      // Step 10: Delete LLM document from MongoDB
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

      // Step 11: Invalidate cache for this agent and its chats
      try {
        await redisService.invalidateChatAgentStats(subaccountId, agentId);
        await redisService.invalidateChatList(subaccountId);
      } catch (cacheError) {
        Logger.warn('Failed to invalidate chat agent cache', {
          operationId,
          error: cacheError.message
        });
      }

      // Step 11: Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CHAT_AGENT_DELETED,
        category: ACTIVITY_CATEGORIES.AGENT,
        userId,
        description: `Chat agent "${agentDocument.name}" deleted (including ${chatsDeleteResult.deletedCount} associated chats)`,
        metadata: {
          agentId,
          agentName: agentDocument.name,
          llmId,
          chatsDeleted: chatsDeleteResult.deletedCount,
          whatsappDisconnected,
          instagramDisconnected,
          whatsappConnectionsDeleted: whatsappConnectionsDeleteResult.deletedCount,
          instagramConnectionsDeleted: instagramConnectionsDeleteResult.deletedCount
        },
        resourceId: agentId,
        resourceName: agentDocument.name,
        operationId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: `Chat agent deleted successfully (${chatsDeleteResult.deletedCount} chats also deleted)`,
        data: {
          agentId,
          llmId,
          chatsDeleted: chatsDeleteResult.deletedCount,
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

      // Log activity
      await ActivityService.logActivity({
        subaccountId,
        activityType: ACTIVITY_TYPES.CHAT_AGENT_UPDATED,
        category: ACTIVITY_CATEGORIES.CHAT_AGENT,
        userId,
        description: `Chat agent "${agentDocument.name}" updated`,
        metadata: {
          agentId,
          agentName: agentDocument.name,
          llmId,
          updatedFields: Object.keys(updates)
        },
        resourceId: agentId,
        resourceName: agentDocument.name,
        operationId
      });

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
        operationId
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
        operationId
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
        operationId
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
        operationId
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
        operationId
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