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

      // Step 1: Create LLM
      Logger.info('Creating LLM for agent', { operationId, subaccountId, name });
      
      const llmConfig = {
        version: 0,
        model: "gpt-4o-mini",
        model_temperature: 0,
        model_high_priority: true,
        tool_call_strict_mode: true,
        begin_message: "",
        general_prompt: "You are a helpful assistant.",
        general_tools: [
          {
            type: "end_call",
            name: "end_call",
            description: "End the call with user."
          }
        ],
        states: [
          {
            name: "general_state",
            description: "General state with additional information",
            state_prompt: `Your agent_id is {{agent_id}}. You are in Europe/Madrid timezone. Current time in Europe/Madrid is {{current_time_Europe/Madrid}} and current calendar date in Europe/Madrid is {{current_calendar_Europe/Madrid}}

ALWAYS transition to book_appointment_state once a slot is selected and user agrees to book meeting. For this, at the end you should ask user if user wants to book meeting at the selected slot. Do not end call without booking a meeting.

You are an agent to schedule meetings. You can check availability of slot on a date. You can find earliest slot starting from a date.

You should always schedule an appointment in following scenarios:
# if user is interested to take services offered by the business. 
# if user in seems interested in conversation ahead
# If user asks for a callback or appointment.

Steps to schedule a meeting
# Ask user for his availability
# if user provides an availability then transition to check_availability_state and  check its availability.
# if user is unsure about availability then transition to nearest_slots_state and find nearest slot available.
# Whenever user is unsure about date and slot you should transition to nearest_slots_state to get slots after today or provided date.
# After confirming a slot from user again check its availability before transitioning to book_appointment_state. (This time do not mention that you are checking availability)
# If available, transition to book_appointment_state

YOUR ULTIMATE GOAL IS TO BOOK A MEETING

TRANSITIONS
# transition to nearest_slots_state without asking whenever required if no meeting slot is mentioned.
# transition to check_availability_slot without asking whenever required if a meeting slot is mentioned`,
            edges: [
              {
                destination_state_name: "check_availability_state",
                description: "Transition to check appointment availability. Or when user wants to book an appointment and has a specific time in mind."
              },
              {
                destination_state_name: "nearest_slots_state",
                description: "Transition to find nearest available slots. Or When user wants to book an appointment but doesn't have a specific time in mind."
              }
            ]
          },
          {
            name: "check_availability_state",
            description: "State for checking appointment availability",
            state_prompt: `Do not ask to proceed before calling check_availability function. Do it whenever required

You are in Europe/Madrid timezone. Current time in Europe/Madrid is {{current_time_Europe/Madrid}} and current calendar date in Europe/Madrid is {{current_calendar_Europe/Madrid}}

Check availability for a slot using check_availablity function.
Specifications for check_availability function
#  Use {{agent_id}} as agent_id in payload
# send payload time in Europe/Madrid timezone



ALWAYS TRANSITION TO BOOK_APPOINTMENT_STATE AFTER THIS STATE`,
            tools: [
              {
                type: "custom",
                name: "check_availability",
                url: "https://scalai-b-48660c785242.herokuapp.com/api/webhooks/check-availability",
                speak_during_execution: false,
                speak_after_execution: true,
                description: "Check the availability of the appointment",
                parameters: {
                  type: "object",
                  properties: {
                    agent_id: {
                      type: "integer",
                      description: "The agent id for which the availability is to be checked."
                    },
                    date: {
                      type: "string",
                      description: "The date of the appointment in yyyy-mm-dd format"
                    },
                    start_time: {
                      type: "string",
                      description: "The start time of the appointment in hh:mm format 24 hour format"
                    },
                    end_time: {
                      type: "string",
                      description: "The end time of the appointment in hh:mm format 24 hour format"
                    }
                  },
                  required: ["agent_id", "date", "start_time", "end_time"]
                },
                execution_message_description: "Checking availability for the appointment",
                timeout_ms: 120000
              }
            ],
            edges: [
              {
                destination_state_name: "book_appointment_state",
                description: "If the slot checked is available and user agrees to proceed further on booking meet.",
                parameters: {
                  type: "object",
                  properties: {
                    date: {
                      type: "string",
                      description: "The date at which meeting is to be booked in yyyy-mm-dd format"
                    },
                    end_time: {
                      type: "string",
                      description: "The end time of meeting in hh:mm format."
                    },
                    start_time: {
                      type: "string",
                      description: "The start time of meeting in hh:mm format."
                    },
                    timezone: {
                      type: "string",
                      description: "The timezone to book meeting in +hh:mm / -hh:mm format"
                    }
                  },
                  required: ["date", "start_time", "end_time", "timezone"]
                }
              }
            ]
          },
          {
            name: "nearest_slots_state",
            description: "State for finding nearest available slots",
            state_prompt: `Do not ask to proceed before calling nearest_available_slots function. Do it whenever required

You are in Europe/Madrid timezone. Current time in Europe/Madrid is {{current_time_Europe/Madrid}} and current calendar date in Europe/Madrid is {{current_calendar_Europe/Madrid}}

Do not suggest slots like a list if multiple slots are fetched, instead keep your tone like a normal conversation and suggetion.
ALWAYS, After getting response back from nearest_available_slots custom function, filter out the slot options those are already suggested in earlier nearest_available_slots custom function:calls.
For example, if a slot is suggested and user asks for more options, then the previously suggested slot is also returned in response, so you should not repeat and suggest it again. ALWAYS MAKEIT SURE.

If same slots are returned, find more slots by increasing value of n. Do this until atleast one new slot is got.

# If no from_date and to_date are mentioned, do not ask it. Consider from_date be today and to_date be null. 
# If from_date and to_date is mentioned, use them in payload. Do not use whichever is not mentioned.
# Do not assume any date on your own. (Only consider today's date as from_date if from_date is not mentioned)


Specifications about, nearest_available_slots custom function:
# Use {{agent_id}} as agent_id in payload
# Use nearest_available_slots function to get n number of available slots.
Unless mentioned, number of slots to fetch be 1 by default. If asked by user for more options then increase n value to get more available slots.
# default duration in minutes is 30.
# send payload time in Europe/Madrid timezone


ALWAYS TRANSITION TO BOOK_APPOINTMENT_STATE AFTER THIS STATE`,
            tools: [
              {
                type: "custom",
                name: "nearest_available_slots",
                url: "https://scalai-b-48660c785242.herokuapp.com/api/webhooks/nearest-available-slots",
                speak_during_execution: false,
                speak_after_execution: true,
                description: "Get the nearest available time slots for an appointment",
                parameters: {
                  type: "object",
                  properties: {
                    agent_id: {
                      type: "integer",
                      description: "The agent id for which to find available slots"
                    },
                    n: {
                      type: "integer",
                      description: "Number of nearest available slots to find"
                    },
                    from_datetime: {
                      type: "string",
                      description: "Start datetime to search from in ISO format (YYYY-MM-DDTHH:mm:ssZ). Default from_time is current date and time."
                    },
                    to_datetime: {
                      type: "string",
                      description: "End datetime to search until in ISO format (YYYY-MM-DDTHH:mm:ssZ)"
                    },
                    duration_minutes: {
                      type: "integer",
                      description: "Duration of the appointment in minutes"
                    }
                  },
                  required: ["agent_id", "n", "duration_minutes", "from_datetime"]
                },
                execution_message_description: "Finding nearest available time slots",
                timeout_ms: 120000
              }
            ],
            edges: [
              {
                destination_state_name: "book_appointment_state",
                description: "If user selects a slot to book meeting or agrees to proceed further on booking meet.",
                parameters: {
                  type: "object",
                  properties: {
                    date: {
                      type: "string",
                      description: "The date at which meeting is to be booked in yyyy-mm-dd format"
                    },
                    end_time: {
                      type: "string",
                      description: "The end time of meeting in hh:mm format."
                    },
                    start_time: {
                      type: "string",
                      description: "The start time of meeting in hh:mm format."
                    },
                    timezone: {
                      type: "string",
                      description: "The timezone to book meeting in +hh:mm / -hh:mm format"
                    }
                  },
                  required: ["date", "start_time", "end_time", "timezone"]
                }
              }
            ]
          },
          {
            name: "book_appointment_state",
            description: "State for booking appointments",
            state_prompt: `Do not ask to proceed before calling book_appointment function. Do it whenever required without waiting for instruction.

Remember, if entered this state, book_appointment function has to be called at completion. 

Specifications for book_appointment function
#  Use {{agent_id}} as agent_id in payload
# Use timezone passed from earlier state. It is also in +hh:mm or -hh:mm format

After appointment is booked:
## set appointment_booked variable to be true.
## set appointment_description to be a short description of all about appointment booked
## set appointment_id equal to id received back in response from book_appointment function.`,
            tools: [
              {
                type: "custom",
                name: "book_appointment",
                url: "https://scalai-b-48660c785242.herokuapp.com/api/webhooks/book-appointment",
                speak_during_execution: false,
                speak_after_execution: true,
                description: "Book an appointment with the specified details",
                parameters: {
                  type: "object",
                  properties: {
                    agent_id: {
                      type: "integer",
                      description: "The agent id for which to book the appointment"
                    },
                    date: {
                      type: "string",
                      description: "The date of the appointment in yyyy-mm-dd format"
                    },
                    start_time: {
                      type: "string",
                      description: "The start time of the appointment in hh:mm format 24 hour format"
                    },
                    end_time: {
                      type: "string",
                      description: "The end time of the appointment in hh:mm format 24 hour format"
                    },
                    name: {
                      type: "string",
                      description: "Name of the person booking the appointment"
                    },
                    phone: {
                      type: "string",
                      description: "Phone number of the person booking the appointment. It must be 10 digit number without any other character. Just 10 digit number"
                    },
                    email: {
                      type: "string",
                      description: "Email address of the person booking the appointment"
                    },
                    timezone: {
                      type: "string",
                      description: "Timezone of the person booking the appointment in format like +hh:mm or -hh:mm",
                      examples: ["+05:30", "-02:30", "+00:00"]
                    }
                  },
                  required: ["agent_id", "date", "start_time", "end_time", "name", "phone", "email", "timezone"]
                },
                execution_message_description: "Booking the appointment",
                timeout_ms: 120000
              }
            ],
            edges: []
          }
        ],
        starting_state: "general_state",
        default_dynamic_variables: {
          agent_id: ""
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
      const deployedWebhookUrl = config.retell.deployedWebhookServerUrl || config.webhookServer.deployedUrl;
      
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
          general_tools: [
            {
              type: "end_call",
              name: "end_call",
              description: "End the call with user."
            }
          ],
          states: [
            {
              name: "general_state",
              description: "General state with additional information",
              state_prompt: llmConfig.states[0].state_prompt,
              edges: llmConfig.states[0].edges
            },
            {
              name: "check_availability_state",
              description: "State for checking appointment availability",
              state_prompt: llmConfig.states[1].state_prompt,
              tools: [
                {
                  type: "custom",
                  name: "check_availability",
                  url: `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/check-availability`,
                  speak_during_execution: false,
                  speak_after_execution: true,
                  description: "Check the availability of the appointment",
                  parameters: llmConfig.states[1].tools[0].parameters,
                  execution_message_description: "Checking availability for the appointment",
                  timeout_ms: 120000
                }
              ],
              edges: llmConfig.states[1].edges
            },
            {
              name: "nearest_slots_state",
              description: "State for finding nearest available slots",
              state_prompt: llmConfig.states[2].state_prompt,
              tools: [
                {
                  type: "custom",
                  name: "nearest_available_slots",
                  url: `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/nearest-available-slots`,
                  speak_during_execution: false,
                  speak_after_execution: true,
                  description: "Find the nearest available appointment slots",
                  parameters: llmConfig.states[2].tools[0].parameters,
                  execution_message_description: "Finding nearest available slots",
                  timeout_ms: 120000
                }
              ],
              edges: llmConfig.states[2].edges
            },
            {
              name: "book_appointment_state",
              description: "State for booking an appointment",
              state_prompt: llmConfig.states[3].state_prompt,
              tools: [
                {
                  type: "custom",
                  name: "book_appointment",
                  url: `${deployedWebhookUrl}/api/webhooks/${subaccountId}/${agentId}/book-appointment`,
                  speak_during_execution: false,
                  speak_after_execution: true,
                  description: "Book an appointment with the specified details",
                  parameters: llmConfig.states[3].tools[0].parameters,
                  execution_message_description: "Booking the appointment",
                  timeout_ms: 120000
                }
              ],
              edges: llmConfig.states[3].edges
            }
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
        userId
      });

      // Get database connection
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

      // Step 7: Invalidate cache for this agent
      try {
        await redisService.invalidateAgentStats(subaccountId, agentId);
        Logger.debug('Agent statistics cache invalidated', {
          operationId,
          agentId
        });
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
        description: `Agent "${agentDocument.name}" deleted`,
        metadata: {
          agentId,
          agentName: agentDocument.name,
          llmId
        },
        resourceId: agentId,
        resourceName: agentDocument.name,
        operationId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Agent deleted successfully',
        data: {
          agentId,
          llmId,
          deletedFromRetell: true,
          deletedFromDatabase: true
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
        previousPeriodEnd: previousPeriodEnd.toISOString()
      });

      // Check cache first (cache key includes date range)
      const cacheKey = `${subaccountId}:${agentId}:${currentPeriodStart.getTime()}:${currentPeriodEnd.getTime()}`;
      try {
        const cachedStats = await redisService.getCachedAgentStats(cacheKey, cacheKey);
        if (cachedStats) {
          Logger.debug('Using cached agent statistics', { 
            operationId, 
            agentId,
            currentPeriodStart: currentPeriodStart.toISOString(),
            currentPeriodEnd: currentPeriodEnd.toISOString(),
            cacheHit: true 
          });
          
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

      // Step 2: Use aggregation to calculate statistics for both periods
      const statisticsAggregation = await callsCollection.aggregate([
        // Match calls for this agent in both periods
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
            },
            // Identify unresponsive calls
            isUnresponsive: {
              $or: [
                { $eq: [{ $ifNull: ['$user_sentiment', null] }, null] },
                { $eq: ['$disconnection_reason', 'user_hangup'] }
              ]
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
            agent_id: agentId,
            call_id: {
              $in: [...currentStats.callIds, ...previousStats.callIds]
            }
          }
        },
        {
          $group: {
            _id: null,
            currentPeriodMeetings: {
              $sum: {
                $cond: [
                  { $in: ['$call_id', currentStats.callIds] },
                  1,
                  0
                ]
              }
            },
            previousPeriodMeetings: {
              $sum: {
                $cond: [
                  { $in: ['$call_id', previousStats.callIds] },
                  1,
                  0
                ]
              }
            }
          }
        }
      ]).toArray();

      const meetingsCounts = meetingsAggregation[0] || {
        currentPeriodMeetings: 0,
        previousPeriodMeetings: 0
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
        Logger.debug('Agent statistics cached', { 
          operationId, 
          agentId,
          currentPeriodStart: currentPeriodStart.toISOString(),
          currentPeriodEnd: currentPeriodEnd.toISOString()
        });
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
        Logger.debug('Agent details cache invalidated', {
          operationId,
          agentId
        });
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
          Logger.debug('Using cached agent configuration details', { 
            operationId, 
            agentId,
            cacheHit: true 
          });
          
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
        Logger.debug('Agent configuration details cached', { 
          operationId, 
          agentId
        });
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

      // Step 1: Create LLM (same as normal agent)
      Logger.info('Creating LLM for chat agent', { operationId, subaccountId, name });
      
      const llmConfig = {
        version: 0,
        model: "gpt-4o-mini",
        model_temperature: 0,
        model_high_priority: true,
        tool_call_strict_mode: true,
        begin_message: "",
        general_prompt: "You are a helpful assistant.",
        general_tools: [
          {
            type: "end_call",
            name: "end_call",
            description: "End the call with user."
          }
        ],
        states: [
          {
            name: "general_state",
            description: "General state with additional information",
            state_prompt: `Your agent_id is {{agent_id}}. You are in Europe/Madrid timezone. Current time in Europe/Madrid is {{current_time_Europe/Madrid}} and current calendar date in Europe/Madrid is {{current_calendar_Europe/Madrid}}

ALWAYS transition to book_appointment_state once a slot is selected and user agrees to book meeting. For this, at the end you should ask user if user wants to book meeting at the selected slot. Do not end call without booking a meeting.

You are an agent to schedule meetings. You can check availability of slot on a date. You can find earliest slot starting from a date.

You should always schedule an appointment in following scenarios:
# if user is interested to take services offered by the business. 
# if user in seems interested in conversation ahead
# If user asks for a callback or appointment.

Steps to schedule a meeting
# Ask user for his availability
# if user provides an availability then transition to check_availability_state and  check its availability.
# if user is unsure about availability then transition to nearest_slots_state and find nearest slot available.
# Whenever user is unsure about date and slot you should transition to nearest_slots_state to get slots after today or provided date.
# After confirming a slot from user again check its availability before transitioning to book_appointment_state. (This time do not mention that you are checking availability)
# If available, transition to book_appointment_state

YOUR ULTIMATE GOAL IS TO BOOK A MEETING

TRANSITIONS
# transition to nearest_slots_state without asking whenever required if no meeting slot is mentioned.
# transition to check_availability_slot without asking whenever required if a meeting slot is mentioned`,
            edges: [
              {
                destination_state_name: "check_availability_state",
                description: "Transition to check appointment availability. Or when user wants to book an appointment and has a specific time in mind."
              },
              {
                destination_state_name: "nearest_slots_state",
                description: "Transition to find nearest available slots. Or When user wants to book an appointment but doesn't have a specific time in mind."
              }
            ]
          },
          {
            name: "check_availability_state",
            description: "State for checking appointment availability",
            state_prompt: `Do not ask to proceed before calling check_availability function. Do it whenever required

You are in Europe/Madrid timezone. Current time in Europe/Madrid is {{current_time_Europe/Madrid}} and current calendar date in Europe/Madrid is {{current_calendar_Europe/Madrid}}

Check availability for a slot using check_availablity function.
Specifications for check_availability function
#  Use {{agent_id}} as agent_id in payload
# send payload time in Europe/Madrid timezone



ALWAYS TRANSITION TO BOOK_APPOINTMENT_STATE AFTER THIS STATE`,
            tools: [
              {
                type: "custom",
                name: "check_availability",
                url: "https://scalai-b-48660c785242.herokuapp.com/api/webhooks/check-availability",
                speak_during_execution: false,
                speak_after_execution: true,
                description: "Check the availability of the appointment",
                parameters: {
                  type: "object",
                  properties: {
                    agent_id: {
                      type: "integer",
                      description: "The agent id for which the availability is to be checked."
                    },
                    date: {
                      type: "string",
                      description: "The date of the appointment in yyyy-mm-dd format"
                    },
                    start_time: {
                      type: "string",
                      description: "The start time of the appointment in hh:mm format 24 hour format"
                    },
                    end_time: {
                      type: "string",
                      description: "The end time of the appointment in hh:mm format 24 hour format"
                    }
                  },
                  required: ["agent_id", "date", "start_time", "end_time"]
                },
                execution_message_description: "Checking availability for the appointment",
                timeout_ms: 120000
              }
            ],
            edges: [
              {
                destination_state_name: "book_appointment_state",
                description: "If the slot checked is available and user agrees to proceed further on booking meet.",
                parameters: {
                  type: "object",
                  properties: {
                    date: {
                      type: "string",
                      description: "The date at which meeting is to be booked in yyyy-mm-dd format"
                    },
                    end_time: {
                      type: "string",
                      description: "The end time of meeting in hh:mm format."
                    },
                    start_time: {
                      type: "string",
                      description: "The start time of meeting in hh:mm format."
                    },
                    timezone: {
                      type: "string",
                      description: "The timezone to book meeting in +hh:mm / -hh:mm format"
                    }
                  },
                  required: ["date", "start_time", "end_time", "timezone"]
                }
              }
            ]
          },
          {
            name: "nearest_slots_state",
            description: "State for finding nearest available slots",
            state_prompt: `Do not ask to proceed before calling nearest_available_slots function. Do it whenever required

You are in Europe/Madrid timezone. Current time in Europe/Madrid is {{current_time_Europe/Madrid}} and current calendar date in Europe/Madrid is {{current_calendar_Europe/Madrid}}

Do not suggest slots like a list if multiple slots are fetched, instead keep your tone like a normal conversation and suggetion.
ALWAYS, After getting response back from nearest_available_slots custom function, filter out the slot options those are already suggested in earlier nearest_available_slots custom function:calls.
For example, if a slot is suggested and user asks for more options, then the previously suggested slot is also returned in response, so you should not repeat and suggest it again. ALWAYS MAKEIT SURE.

If same slots are returned, find more slots by increasing value of n. Do this until atleast one new slot is got.

# If no from_date and to_date are mentioned, do not ask it. Consider from_date be today and to_date be null. 
# If from_date and to_date is mentioned, use them in payload. Do not use whichever is not mentioned.
# Do not assume any date on your own. (Only consider today's date as from_date if from_date is not mentioned)


Specifications about, nearest_available_slots custom function:
# Use {{agent_id}} as agent_id in payload
# Use nearest_available_slots function to get n number of available slots.
Unless mentioned, number of slots to fetch be 1 by default. If asked by user for more options then increase n value to get more available slots.
# default duration in minutes is 30.
# send payload time in Europe/Madrid timezone


ALWAYS TRANSITION TO BOOK_APPOINTMENT_STATE AFTER THIS STATE`,
            tools: [
              {
                type: "custom",
                name: "nearest_available_slots",
                url: "https://scalai-b-48660c785242.herokuapp.com/api/webhooks/nearest-available-slots",
                speak_during_execution: false,
                speak_after_execution: true,
                description: "Get the nearest available time slots for an appointment",
                parameters: {
                  type: "object",
                  properties: {
                    agent_id: {
                      type: "integer",
                      description: "The agent id for which to find available slots"
                    },
                    n: {
                      type: "integer",
                      description: "Number of nearest available slots to find"
                    },
                    from_datetime: {
                      type: "string",
                      description: "Start datetime to search from in ISO format (YYYY-MM-DDTHH:mm:ssZ). Default from_time is current date and time."
                    },
                    to_datetime: {
                      type: "string",
                      description: "End datetime to search until in ISO format (YYYY-MM-DDTHH:mm:ssZ)"
                    },
                    duration_minutes: {
                      type: "integer",
                      description: "Duration of the appointment in minutes"
                    }
                  },
                  required: ["agent_id", "n", "duration_minutes", "from_datetime"]
                },
                execution_message_description: "Finding nearest available time slots",
                timeout_ms: 120000
              }
            ],
            edges: [
              {
                destination_state_name: "book_appointment_state",
                description: "If user selects a slot to book meeting or agrees to proceed further on booking meet.",
                parameters: {
                  type: "object",
                  properties: {
                    date: {
                      type: "string",
                      description: "The date at which meeting is to be booked in yyyy-mm-dd format"
                    },
                    end_time: {
                      type: "string",
                      description: "The end time of meeting in hh:mm format."
                    },
                    start_time: {
                      type: "string",
                      description: "The start time of meeting in hh:mm format."
                    },
                    timezone: {
                      type: "string",
                      description: "The timezone to book meeting in +hh:mm / -hh:mm format"
                    }
                  },
                  required: ["date", "start_time", "end_time", "timezone"]
                }
              }
            ]
          },
          {
            name: "book_appointment_state",
            description: "State for booking appointments",
            state_prompt: `Do not ask to proceed before calling book_appointment function. Do it whenever required without waiting for instruction.

Remember, if entered this state, book_appointment function has to be called at completion. 

Specifications for book_appointment function
#  Use {{agent_id}} as agent_id in payload
# Use timezone passed from earlier state. It is also in +hh:mm or -hh:mm format

After appointment is booked:
## set appointment_booked variable to be true.
## set appointment_description to be a short description of all about appointment booked
## set appointment_id equal to id received back in response from book_appointment function.`,
            tools: [
              {
                type: "custom",
                name: "book_appointment",
                url: "https://scalai-b-48660c785242.herokuapp.com/api/webhooks/book-appointment",
                speak_during_execution: false,
                speak_after_execution: true,
                description: "Book an appointment with the specified details",
                parameters: {
                  type: "object",
                  properties: {
                    agent_id: {
                      type: "integer",
                      description: "The agent id for which to book the appointment"
                    },
                    date: {
                      type: "string",
                      description: "The date of the appointment in yyyy-mm-dd format"
                    },
                    start_time: {
                      type: "string",
                      description: "The start time of the appointment in hh:mm format 24 hour format"
                    },
                    end_time: {
                      type: "string",
                      description: "The end time of the appointment in hh:mm format 24 hour format"
                    },
                    name: {
                      type: "string",
                      description: "Name of the person booking the appointment"
                    },
                    phone: {
                      type: "string",
                      description: "Phone number of the person booking the appointment. It must be 10 digit number without any other character. Just 10 digit number"
                    },
                    email: {
                      type: "string",
                      description: "Email address of the person booking the appointment"
                    },
                    timezone: {
                      type: "string",
                      description: "Timezone of the person booking the appointment in format like +hh:mm or -hh:mm",
                      examples: ["+05:30", "-02:30", "+00:00"]
                    }
                  },
                  required: ["agent_id", "date", "start_time", "end_time", "name", "phone", "email", "timezone"]
                },
                execution_message_description: "Booking the appointment",
                timeout_ms: 120000
              }
            ],
            edges: []
          }
        ],
        starting_state: "general_state",
        default_dynamic_variables: {
          agent_id: ""
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
            },
            // Identify unresponsive chats
            isUnresponsive: {
              $or: [
                { $eq: [{ $ifNull: ['$chat_analysis.user_sentiment', null] }, null] },
                { $eq: ['$chat_status', 'failed'] }
              ]
            },
            // Chat successful flag
            isChatSuccessful: {
              $cond: {
                if: { $eq: ['$chat_analysis.chat_successful', true] },
                then: 1,
                else: 0
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
            unresponsiveChats: {
              $sum: { $cond: ['$isUnresponsive', 1, 0] }
            },
            successfulChats: {
              $sum: '$isChatSuccessful'
            },
            chatIds: { $push: '$chat_id' }
          }
        },
        // Calculate cumulative success rate
        {
          $project: {
            _id: 1,
            totalChats: 1,
            unresponsiveChats: 1,
            successfulChats: 1,
            chatIds: 1,
            cumulativeSuccessRate: {
              $cond: {
                if: { $gt: ['$totalChats', 0] },
                then: {
                  $multiply: [
                    { $divide: ['$successfulChats', '$totalChats'] },
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
        totalChats: 0,
        unresponsiveChats: 0,
        successfulChats: 0,
        cumulativeSuccessRate: 0,
        chatIds: []
      };

      const previousStats = statisticsAggregation.find(s => s._id === 'previous') || {
        totalChats: 0,
        unresponsiveChats: 0,
        successfulChats: 0,
        cumulativeSuccessRate: 0,
        chatIds: []
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
          successfulChats: currentStats.successfulChats,
          unresponsiveChats: currentStats.unresponsiveChats,
          cumulativeSuccessRate: Math.round(currentStats.cumulativeSuccessRate * 100) / 100,
          periodStart: currentPeriodStart,
          periodEnd: currentPeriodEnd
        },
        previousPeriod: {
          totalChats: previousStats.totalChats,
          successfulChats: previousStats.successfulChats,
          unresponsiveChats: previousStats.unresponsiveChats,
          cumulativeSuccessRate: Math.round(previousStats.cumulativeSuccessRate * 100) / 100,
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
          successfulChats: {
            change: currentStats.successfulChats - previousStats.successfulChats,
            percentageChange: Math.round(
              calculatePercentageChange(currentStats.successfulChats, previousStats.successfulChats) * 100
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
}

module.exports = DatabaseController; 