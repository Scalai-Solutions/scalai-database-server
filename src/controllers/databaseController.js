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

Check availability for a slot using check_availability function.
Specifications for check_availability function
# send payload time in Europe/Madrid timezone



ALWAYS TRANSITION TO BOOK_APPOINTMENT_STATE AFTER THIS STATE`,
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
                destination_state_name: "book_appointment_state",
                description: "If the slot checked is available and user agrees to proceed further on booking meet."
              }
            ]
          },
          {
            name: "nearest_slots_state",
            description: "State for finding nearest available slots",
            state_prompt: `You are in Europe/Madrid timezone. Current time in Europe/Madrid is {{current_time_Europe/Madrid}} and current calendar date in Europe/Madrid is {{current_calendar_Europe/Madrid}}

Use nearest_available_slots function to find available slots. It responds with available slots in 30 days range from start date.
So if no slots found in 30 days range, extend startDate by 30 days unless you find a slot.

After user agrees to book appointment for a slot, then only transition to book_appointment_state, otherwise do not.

DO NOT MENTION FUNCTION nearest_available_slots NAME ANYTIME DURING THE CONVERSATION`,
            tools: [
              {
                type: "custom",
                name: "nearest_available_slots",
                url: "https://placeholder-will-be-updated-after-agent-creation.com/nearest-available-slots",
                speak_during_execution: false,
                speak_after_execution: true,
                description: "Find the nearest available appointment slots",
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
                execution_message_description: "Finding nearest available time slots",
                timeout_ms: 120000
              }
            ],
            edges: [
              {
                destination_state_name: "book_appointment_state",
                description: "If user selects a slot to book meeting or agrees to proceed further on booking meet."
              }
            ]
          },
          {
            name: "book_appointment_state",
            description: "State for booking appointments",
            state_prompt: `You are in Europe/Madrid timezone. Current time in Europe/Madrid is {{current_time_Europe/Madrid}} and current calendar date in Europe/Madrid is {{current_calendar_Europe/Madrid}}

Remember, if entered this state, book_appointment function has to be called at completion. 

- Collect name of user. Ask to spell it to understand properly. Repeat it letter by letter to confirm. be fluent like A....S....H....O....K for ashok. Speak like a normal conversation, no dashes and all
- Collect email of user. Ask to spell it to understand properly. Repeat it letter by letter to confirm. Repeat it letter by letter to confirm. be fluent like A....S....H....O....K for ashok. Speak like a normal conversation, no dashes and all
- Collect phone number. Repeat it digit by digit to confirm. 

After appointment is booked:
## set appointment_booked variable to be true.
## set appointment_description to be a short description of all about appointment booked
## set appointment_id equal to id received back in response from book_appointment function.`,
            tools: [
              {
                type: "custom",
                name: "book_appointment",
                url: "https://placeholder-will-be-updated-after-agent-creation.com/book-appointment",
                speak_during_execution: false,
                speak_after_execution: true,
                description: "Book an appointment at a specific time slot",
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
                  description: "Check if a specific time slot is available for booking an appointment",
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
                  description: "Book an appointment at a specific time slot",
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
          Logger.debug('Using cached agent statistics with cost', { 
            operationId, 
            agentId,
            currentPeriodStart: currentPeriodStart.toISOString(),
            currentPeriodEnd: currentPeriodEnd.toISOString(),
            cacheHit: true 
          });
          
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
        Logger.debug('Agent statistics with cost cached', { 
          operationId, 
          agentId,
          currentPeriodStart: currentPeriodStart.toISOString(),
          currentPeriodEnd: currentPeriodEnd.toISOString()
        });
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
          Logger.debug('Using cached call analytics', { 
            operationId, 
            agentId,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            cacheHit: true 
          });
          
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
            agent_id: agentId,
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
            agent_id: agentId,
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
            agent_id: agentId,
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
            agent_id: agentId,
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

      Logger.debug('Success timeline data processed', {
        operationId,
        rawAggregationCount: successTimelineAggregation.length,
        timelineDataKeys: Object.keys(timelineData).length,
        successTimelineLength: successTimeline.length,
        sampleData: successTimeline.slice(0, 3)
      });

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
        Logger.debug('Agent call analytics cached', { 
          operationId, 
          agentId,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString()
        });
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
          Logger.debug('Using cached call costs breakdown', { 
            operationId, 
            agentId,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            cacheHit: true 
          });
          
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
            agent_id: agentId,
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
            agent_id: agentId,
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
            agent_id: agentId,
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
            durationUnitPrice: { $divide: [{ $ifNull: ['$call_cost.total_duration_unit_price', 0] }, 100] }
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
      const calls = callDetailsAggregation.map(call => ({
        callId: call.callId,
        startTimestamp: call.startTimestamp,
        endTimestamp: call.endTimestamp,
        startDate: call.startTimestamp ? new Date(call.startTimestamp).toISOString() : null,
        endDate: call.endTimestamp ? new Date(call.endTimestamp).toISOString() : null,
        duration: call.duration || 0,
        combinedCost: call.combinedCost ? Math.round(call.combinedCost * 100) / 100 : 0,
        durationUnitPrice: call.durationUnitPrice ? Math.round(call.durationUnitPrice * 1000000) / 1000000 : 0,
        productCosts: (call.productCosts || []).map(pc => ({
          product: pc.product,
          unitPrice: Math.round((pc.unit_price || 0) * 1000000) / 1000000,
          cost: Math.round(((pc.cost || 0) / 100) * 100) / 100
        }))
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
        Logger.debug('Agent call costs breakdown cached', { 
          operationId, 
          agentId,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString()
        });
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

      // Get deployed webhook URL from config
      const deployedWebhookUrl = config.retell.deployedWebhookServerUrl || config.webhookServer.deployedUrl || 'https://scalai-b-48660c785242.herokuapp.com';

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

Check availability for a slot using check_availability function.
Specifications for check_availability function
# send payload time in Europe/Madrid timezone



ALWAYS TRANSITION TO BOOK_APPOINTMENT_STATE AFTER THIS STATE`,
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
                destination_state_name: "book_appointment_state",
                description: "If the slot checked is available and user agrees to proceed further on booking meet."
              }
            ]
          },
          {
            name: "nearest_slots_state",
            description: "State for finding nearest available slots",
            state_prompt: `You are in Europe/Madrid timezone. Current time in Europe/Madrid is {{current_time_Europe/Madrid}} and current calendar date in Europe/Madrid is {{current_calendar_Europe/Madrid}}

Use nearest_available_slots function to find available slots. It responds with available slots in 30 days range from start date.
So if no slots found in 30 days range, extend startDate by 30 days unless you find a slot.

After user agrees to book appointment for a slot, then only transition to book_appointment_state, otherwise do not.

DO NOT MENTION FUNCTION nearest_available_slots NAME ANYTIME DURING THE CONVERSATION`,
            tools: [
              {
                type: "custom",
                name: "nearest_available_slots",
                url: "https://placeholder-will-be-updated-after-agent-creation.com/nearest-available-slots",
                speak_during_execution: false,
                speak_after_execution: true,
                description: "Find the nearest available appointment slots",
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
                execution_message_description: "Finding nearest available time slots",
                timeout_ms: 120000
              }
            ],
            edges: [
              {
                destination_state_name: "book_appointment_state",
                description: "If user selects a slot to book meeting or agrees to proceed further on booking meet."
              }
            ]
          },
          {
            name: "book_appointment_state",
            description: `You are in Europe/Madrid timezone. Current time in Europe/Madrid is {{current_time_Europe/Madrid}} and current calendar date in Europe/Madrid is {{current_calendar_Europe/Madrid}}

Remember, if entered this state, book_appointment function has to be called at completion. 

- Collect name of user. Ask to spell it to understand properly. Repeat it letter by letter to confirm. be fluent like A....S....H....O....K for ashok. Speak like a normal conversation, no dashes and all
- Collect email of user. Ask to spell it to understand properly. Repeat it letter by letter to confirm. Repeat it letter by letter to confirm. be fluent like A....S....H....O....K for ashok. Speak like a normal conversation, no dashes and all
- Collect phone number. Repeat it digit by digit to confirm. 

After appointment is booked:
## set appointment_booked variable to be true.
## set appointment_description to be a short description of all about appointment booked
## set appointment_id equal to id received back in response from book_appointment function.`,
            tools: [
              {
                type: "custom",
                name: "book_appointment",
                url: "https://placeholder-will-be-updated-after-agent-creation.com/book-appointment",
                speak_during_execution: false,
                speak_after_execution: true,
                description: "Book an appointment at a specific time slot",
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
            },
            // Identify unresponsive chats
            isUnresponsive: {
                // Check if messages array has no messages with role 'agent'
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
            chatIds: { $push: '$chat_id' }
          }
        },
        {
          $project: {
            _id: 1,
            totalChats: 1,
            unresponsiveChats: 1,
            chatIds: 1
          }
        }
      ]).toArray();

      // Get meetings count for both periods (successful chats = meetings booked)
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

      // Parse aggregation results
      const currentStatsRaw = statisticsAggregation.find(s => s._id === 'current') || {
        totalChats: 0,
        unresponsiveChats: 0,
        chatIds: []
      };

      const previousStatsRaw = statisticsAggregation.find(s => s._id === 'previous') || {
        totalChats: 0,
        unresponsiveChats: 0,
        chatIds: []
      };

      // Parse meetings aggregation results (meetings booked = successful chats)
      const currentPeriodMeetings = meetingsAggregation.find(m => m._id === 'current')?.count || 0;
      const previousPeriodMeetings = meetingsAggregation.find(m => m._id === 'previous')?.count || 0;

      // Combine stats with meetings count
      const currentStats = {
        ...currentStatsRaw,
        successfulChats: currentPeriodMeetings,
        cumulativeSuccessRate: currentStatsRaw.totalChats > 0 
          ? (currentPeriodMeetings / currentStatsRaw.totalChats) * 100 
          : 0
      };

      const previousStats = {
        ...previousStatsRaw,
        successfulChats: previousPeriodMeetings,
        cumulativeSuccessRate: previousStatsRaw.totalChats > 0 
          ? (previousPeriodMeetings / previousStatsRaw.totalChats) * 100 
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

      // Step 3: Delete agent from Retell
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

      // Step 5: Delete all chats associated with this agent
      const chatsDeleteResult = await chatsCollection.deleteMany({ 
        agent_id: agentId,
        subaccountId: subaccountId 
      });

      Logger.info('Associated chats deleted from MongoDB', {
        operationId,
        agentId,
        deletedCount: chatsDeleteResult.deletedCount
      });

      // Step 6: Delete chat agent document from MongoDB
      const agentDeleteResult = await chatAgentsCollection.deleteOne({ 
        agentId: agentId,
        subaccountId: subaccountId 
      });

      Logger.info('Chat agent document deleted from MongoDB', {
        operationId,
        agentId,
        deletedCount: agentDeleteResult.deletedCount
      });

      // Step 7: Delete LLM document from MongoDB
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

      // Step 8: Invalidate cache for this agent and its chats
      try {
        await redisService.invalidateChatAgentStats(subaccountId, agentId);
        await redisService.invalidateChatList(subaccountId);
        Logger.debug('Chat agent statistics and chat list cache invalidated', {
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
        activityType: ACTIVITY_TYPES.CHAT_AGENT_DELETED,
        category: ACTIVITY_CATEGORIES.AGENT,
        userId,
        description: `Chat agent "${agentDocument.name}" deleted`,
        metadata: {
          agentId,
          agentName: agentDocument.name,
          llmId,
          chatsDeleted: chatsDeleteResult.deletedCount
        },
        resourceId: agentId,
        resourceName: agentDocument.name,
        operationId
      });

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        message: 'Chat agent deleted successfully',
        data: {
          agentId,
          llmId,
          chatsDeleted: chatsDeleteResult.deletedCount,
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
}

module.exports = DatabaseController; 