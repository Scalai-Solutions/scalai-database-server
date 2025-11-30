const Logger = require('./logger');
const RetellSDK = require('retell-sdk').Retell;

class Retell {
  constructor(apiKey, accountInfo) {
    this.apiKey = apiKey;
    this.accountName = accountInfo.accountName;
    this.accountId = accountInfo.id;
    this.subaccountId = accountInfo.subaccountId;
    this.isActive = accountInfo.isActive;
    this.verificationStatus = accountInfo.verificationStatus;
    
    // Initialize Retell SDK client
    this.client = new RetellSDK({
      apiKey: this.apiKey
    });
    
    Logger.debug('Retell instance created', {
      accountName: this.accountName,
      accountId: this.accountId,
      subaccountId: this.subaccountId
    });
  }

  /**
   * Create a new LLM with the provided configuration
   * @param {Object} llmConfig - LLM configuration object
   * @returns {Promise<Object>} The created LLM object with llm_id
   */
  async createLLM(llmConfig) {
    try {
      Logger.info('Creating LLM', {
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      const llmResponse = await this.client.llm.create(llmConfig);
      
      Logger.info('LLM created successfully', {
        llmId: llmResponse.llm_id,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      return llmResponse;
    } catch (error) {
      Logger.error('Failed to create LLM', {
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to create LLM: ${error.message}`);
    }
  }

  /**
   * Update an LLM by ID
   * @param {string} llmId - The LLM ID to update
   * @param {Object} updates - The fields to update
   * @returns {Promise<Object>} The updated LLM object
   */
  async updateLLM(llmId, updates) {
    try {
      Logger.info('Updating LLM', {
        llmId,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        updates: Object.keys(updates)
      });

      const llmResponse = await this.client.llm.update(llmId, updates);
      
      Logger.info('LLM updated successfully', {
        llmId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      return llmResponse;
    } catch (error) {
      Logger.error('Failed to update LLM', {
        llmId,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to update LLM: ${error.message}`);
    }
  }

  /**
   * Delete an LLM by ID
   * @param {string} llmId - The LLM ID to delete
   * @returns {Promise<void>}
   */
  async deleteLLM(llmId) {
    try {
      Logger.info('Deleting LLM', {
        llmId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      await this.client.llm.delete(llmId);
      
      Logger.info('LLM deleted successfully', {
        llmId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });
    } catch (error) {
      Logger.error('Failed to delete LLM', {
        llmId,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message
      });
      throw new Error(`Failed to delete LLM: ${error.message}`);
    }
  }

  /**
   * Update an LLM model
   * @param {string} llmId - The LLM ID to update
   * @param {Object} updates - The fields to update (e.g., {model: 'gpt-4o'})
   * @returns {Promise<Object>} The updated LLM object
   */
  async updateLLM(llmId, updates) {
    try {
      Logger.info('Updating LLM model', {
        llmId,
        updates,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      const updatedLLM = await this.client.llm.update(llmId, updates);
      
      Logger.info('LLM updated successfully', {
        llmId,
        model: updatedLLM.model,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      return updatedLLM;
    } catch (error) {
      Logger.error('Failed to update LLM', {
        llmId,
        updates,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message
      });
      throw new Error(`Failed to update LLM: ${error.message}`);
    }
  }

  /**
   * Create a new agent with the provided configuration
   * @param {Object} agentConfig - Agent configuration object
   * @returns {Promise<Object>} The created agent object
   */
  async createAgent(agentConfig) {
    try {
      Logger.info('Creating agent', {
        agentName: agentConfig.agent_name,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      const agentResponse = await this.client.agent.create(agentConfig);
      
      Logger.info('Agent created successfully', {
        agentId: agentResponse.agent_id,
        agentName: agentResponse.agent_name,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      return agentResponse;
    } catch (error) {
      Logger.error('Failed to create agent', {
        agentName: agentConfig.agent_name,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to create agent: ${error.message}`);
    }
  }

  /**
   * Delete an agent by ID
   * @param {string} agentId - The agent ID to delete
   * @returns {Promise<void>}
   */
  async deleteAgent(agentId) {
    try {
      Logger.info('Deleting agent', {
        agentId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      await this.client.agent.delete(agentId);
      
      Logger.info('Agent deleted successfully', {
        agentId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });
    } catch (error) {
      Logger.error('Failed to delete agent', {
        agentId,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message
      });
      throw new Error(`Failed to delete agent: ${error.message}`);
    }
  }

  /**
   * Delete a chat agent by ID
   * @param {string} agentId - The chat agent ID to delete
   * @returns {Promise<void>}
   */
  async deleteChatAgent(agentId) {
    try {
      Logger.info('Deleting chat agent', {
        agentId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      await this.client.agent.delete(agentId);
      
      Logger.info('Chat agent deleted successfully', {
        agentId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });
    } catch (error) {
      Logger.error('Failed to delete chat agent', {
        agentId,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message
      });
      throw new Error(`Failed to delete chat agent: ${error.message}`);
    }
  }

  async getAgent(agentId) {
    try {
      Logger.info('Getting agent', {
        agentId,
        accountName: this.accountName
      });
      
      const agent = await this.client.agent.retrieve(agentId);
      
      return agent;
    } catch (error) {
      Logger.error('Failed to get agent', {
        agentId,
        error: error.message
      });
      throw new Error(`Failed to get agent: ${error.message}`);
    }
  }

  async updateAgent(agentId, updates) {
    try {
      Logger.info('Updating agent', {
        agentId,
        accountName: this.accountName
      });
      
      const updatedAgent = await this.client.agent.update(agentId, updates);
      
      return updatedAgent;
    } catch (error) {
      Logger.error('Failed to update agent', {
        agentId,
        error: error.message
      });
      throw new Error(`Failed to update agent: ${error.message}`);
    }
  }

  async listAgents() {
    try {
      Logger.info('Listing agents', {
        accountName: this.accountName
      });
      
      const agents = await this.client.agent.list();
      
      return agents;
    } catch (error) {
      Logger.error('Failed to list agents', {
        error: error.message
      });
      throw new Error(`Failed to list agents: ${error.message}`);
    }
  }

  async createPhoneNumber(areaCode) {
    try {
      Logger.info('Creating phone number', {
        areaCode,
        accountName: this.accountName
      });
      
      const phoneNumber = await this.client.phoneNumber.create({ area_code: areaCode });
      
      return phoneNumber;
    } catch (error) {
      Logger.error('Failed to create phone number', {
        areaCode,
        error: error.message
      });
      throw new Error(`Failed to create phone number: ${error.message}`);
    }
  }

  async listPhoneNumbers() {
    try {
      Logger.info('Listing phone numbers', {
        accountName: this.accountName
      });
      
      const phoneNumbers = await this.client.phoneNumber.list();
      
      return phoneNumbers;
    } catch (error) {
      Logger.error('Failed to list phone numbers', {
        error: error.message
      });
      throw new Error(`Failed to list phone numbers: ${error.message}`);
    }
  }

  /**
   * Update phone number assignment in Retell
   * @param {string} phoneNumber - Phone number to update
   * @param {Object} updateData - Update data
   * @param {string} updateData.inbound_agent_id - Inbound agent ID (optional, can be null)
   * @param {string} updateData.outbound_agent_id - Outbound agent ID (optional, can be null)
   * @param {string} updateData.nickname - Nickname (optional)
   * @returns {Promise<Object>} Updated phone number data
   */
  async updatePhoneNumber(phoneNumber, updateData) {
    try {
      Logger.info('Updating phone number', {
        phoneNumber,
        updateData,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      const updatedPhoneNumber = await this.client.phoneNumber.update(phoneNumber, updateData);
      
      Logger.info('Phone number updated successfully', {
        phoneNumber,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      return updatedPhoneNumber;
    } catch (error) {
      Logger.error('Failed to update phone number', {
        phoneNumber,
        updateData,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message
      });
      throw new Error(`Failed to update phone number: ${error.message}`);
    }
  }

  /**
   * Create a web call with an agent
   * @param {string} agentId - The agent ID to use for the call
   * @param {Object} options - Additional options for the call
   * @returns {Promise<Object>} The web call response with access_token, call_id, etc.
   */
  async createWebCall(agentId, options = {}) {
    try {
      Logger.info('Creating web call', {
        agentId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      const callConfig = {
        agent_id: agentId,
        ...options
      };

      const webCallResponse = await this.client.call.createWebCall(callConfig);
      
      Logger.info('Web call created successfully', {
        agentId: webCallResponse.agent_id,
        callId: webCallResponse.call_id,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      return webCallResponse;
    } catch (error) {
      Logger.error('Failed to create web call', {
        agentId,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to create web call: ${error.message}`);
    }
  }

  /**
   * Create a phone call
   * @param {Object} callConfig - Phone call configuration
   * @param {string} callConfig.from_number - Phone number to call from
   * @param {string} callConfig.to_number - Phone number to call to
   * @param {string} callConfig.agent_id - Agent ID to use for the call (optional if phone has default)
   * @param {Object} callConfig.metadata - Additional metadata (optional)
   * @returns {Promise<Object>} The phone call response
   */
  async createPhoneCall(callConfig) {
    try {
      Logger.info('Creating phone call', {
        from_number: callConfig.from_number,
        to_number: callConfig.to_number,
        agent_id: callConfig.agent_id,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      const phoneCallResponse = await this.client.call.createPhoneCall(callConfig);
      
      Logger.info('Phone call created successfully', {
        callId: phoneCallResponse.call_id,
        from_number: callConfig.from_number,
        to_number: callConfig.to_number,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      return phoneCallResponse;
    } catch (error) {
      Logger.error('Failed to create phone call', {
        from_number: callConfig.from_number,
        to_number: callConfig.to_number,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to create phone call: ${error.message}`);
    }
  }

  /**
   * Create a batch call (multiple outbound calls)
   * @param {Object} batchConfig - Batch call configuration
   * @param {string} batchConfig.from_number - Phone number to call from
   * @param {Array} batchConfig.tasks - Array of call tasks with to_number and optional dynamic_variables
   * @param {string} batchConfig.name - Name of the batch call (optional)
   * @param {number} batchConfig.trigger_timestamp - Scheduled timestamp in milliseconds (optional)
   * @param {boolean} batchConfig.ignore_e164_validation - Ignore E.164 validation (optional)
   * @returns {Promise<Object>} The batch call response with batch_call_id
   */
  async createBatchCall(batchConfig) {
    try {
      Logger.info('Creating batch call', {
        from_number: batchConfig.from_number,
        taskCount: batchConfig.tasks?.length || 0,
        name: batchConfig.name,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      const batchCallResponse = await this.client.batchCall.createBatchCall(batchConfig);
      
      Logger.info('Batch call created successfully', {
        batch_call_id: batchCallResponse.batch_call_id,
        from_number: batchConfig.from_number,
        totalTaskCount: batchCallResponse.total_task_count,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      return batchCallResponse;
    } catch (error) {
      Logger.error('Failed to create batch call', {
        from_number: batchConfig.from_number,
        taskCount: batchConfig.tasks?.length || 0,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to create batch call: ${error.message}`);
    }
  }

  /**
   * Create a new chat with an agent
   * @param {string} agentId - The agent ID to use for the chat
   * @param {Object} options - Optional parameters for chat creation
   * @param {Object} options.retell_llm_dynamic_variables - Dynamic variables to inject into Response Engine prompt
   * @param {Object} options.metadata - Metadata to store with the chat
   * @param {number} options.agent_version - The version of the chat agent to use
   * @returns {Promise<Object>} The chat response with chat_id, agent_id, etc.
   */
  async createChat(agentId, options = {}) {
    try {
      const { retell_llm_dynamic_variables, metadata, agent_version } = options;

      Logger.info('Creating chat', {
        agentId,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        hasDynamicVariables: !!retell_llm_dynamic_variables,
        hasMetadata: !!metadata,
        agentVersion: agent_version
      });

      const chatParams = {
        agent_id: agentId
      };

      // Add optional parameters if provided
      if (retell_llm_dynamic_variables && typeof retell_llm_dynamic_variables === 'object') {
        chatParams.retell_llm_dynamic_variables = retell_llm_dynamic_variables;
      }

      if (metadata && typeof metadata === 'object') {
        chatParams.metadata = metadata;
      }

      if (agent_version && typeof agent_version === 'number') {
        chatParams.agent_version = agent_version;
      }

      const chatResponse = await this.client.chat.create(chatParams);
      
      Logger.info('Chat created successfully', {
        chatId: chatResponse.chat_id,
        agentId: chatResponse.agent_id,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        dynamicVariables: chatResponse.retell_llm_dynamic_variables
      });

      return chatResponse;
    } catch (error) {
      Logger.error('Failed to create chat', {
        agentId,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to create chat: ${error.message}`);
    }
  }

  /**
   * Send a message in a chat (create chat completion)
   * @param {string} chatId - The chat ID
   * @param {string} content - The message content
   * @returns {Promise<Object>} The chat completion response with messages
   */
  async createChatCompletion(chatId, content) {
    try {
      Logger.info('Creating chat completion', {
        chatId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      const response = await this.client.chat.createChatCompletion({
        chat_id: chatId,
        content: content
      });
      
      Logger.info('Chat completion created successfully', {
        chatId,
        messageCount: response.messages?.length || 0,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      return response;
    } catch (error) {
      Logger.error('Failed to create chat completion', {
        chatId,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to create chat completion: ${error.message}`);
    }
  }

  /**
   * End a chat
   * @param {string} chatId - The chat ID to end
   * @returns {Promise<void>}
   */
  async endChat(chatId) {
    try {
      Logger.info('Ending chat', {
        chatId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      await this.client.chat.end(chatId);
      
      Logger.info('Chat ended successfully', {
        chatId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });
    } catch (error) {
      Logger.error('Failed to end chat', {
        chatId,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message
      });
      throw new Error(`Failed to end chat: ${error.message}`);
    }
  }

  /**
   * List all chats
   * @returns {Promise<Array>} Array of chat objects
   */
  async listChats() {
    try {
      Logger.info('Listing chats', {
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      const chatResponses = await this.client.chat.list();
      
      Logger.info('Chats listed successfully', {
        count: chatResponses?.length || 0,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      return chatResponses;
    } catch (error) {
      Logger.error('Failed to list chats', {
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message
      });
      throw new Error(`Failed to list chats: ${error.message}`);
    }
  }

  /**
   * Retrieve a single chat by ID
   * @param {string} chatId - The chat ID to retrieve
   * @returns {Promise<Object>} The chat object with full transcript
   */
  async retrieveChat(chatId) {
    try {
      Logger.info('Retrieving chat', {
        chatId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      const chatResponse = await this.client.chat.retrieve(chatId);
      
      Logger.info('Chat retrieved successfully', {
        chatId,
        agentId: chatResponse.agent_id,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      return chatResponse;
    } catch (error) {
      Logger.error('Failed to retrieve chat', {
        chatId,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message
      });
      throw new Error(`Failed to retrieve chat: ${error.message}`);
    }
  }

  /**
   * List all calls (call logs)
   * @param {Object} options - Optional filter parameters
   * @param {Object} options.filter_criteria - Filter criteria for calls
   * @param {number} options.limit - Maximum number of calls to return (default 50, max 1000)
   * @param {string} options.pagination_key - Pagination key for next page
   * @returns {Promise<Array>} Array of call objects
   */
  async listCalls(options = {}) {
    try {
      Logger.info('Listing calls', {
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        hasFilters: !!options.filter_criteria,
        limit: options.limit,
        hasPaginationKey: !!options.pagination_key
      });

      const callResponses = await this.client.call.list(options);
      
      Logger.info('Calls listed successfully', {
        count: callResponses?.length || 0,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      return callResponses;
    } catch (error) {
      Logger.error('Failed to list calls', {
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message
      });
      throw new Error(`Failed to list calls: ${error.message}`);
    }
  }

  /**
   * List all available voices
   * @returns {Promise<Array>} Array of voice objects
   */
  async listVoices() {
    try {
      Logger.info('Listing voices', {
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      const voices = await this.client.voice.list();
      
      Logger.info('Voices listed successfully', {
        count: voices?.length || 0,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      return voices;
    } catch (error) {
      Logger.error('Failed to list voices', {
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message
      });
      throw new Error(`Failed to list voices: ${error.message}`);
    }
  }

  /**
   * Delete a call by ID
   * @param {string} callId - The call ID to delete
   * @returns {Promise<void>}
   */
  async deleteCall(callId) {
    try {
      Logger.info('Deleting call', {
        callId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      await this.client.call.delete(callId);
      
      Logger.info('Call deleted successfully', {
        callId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });
    } catch (error) {
      Logger.error('Failed to delete call', {
        callId,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message
      });
      throw new Error(`Failed to delete call: ${error.message}`);
    }
  }

  /**
   * Create a knowledge base
   * @param {Object} config - Knowledge base configuration
   * @param {string} config.knowledge_base_name - Name of the knowledge base
   * @param {Array} config.knowledge_base_texts - Text sources (optional)
   * @param {Array} config.knowledge_base_urls - URL sources (optional)
   * @param {Array} config.knowledge_base_files - File sources (optional)
   * @param {boolean} config.enable_auto_refresh - Enable auto refresh for URLs (optional)
   * @returns {Promise<Object>} The created knowledge base
   */
  async createKnowledgeBase(config) {
    try {
      Logger.info('Creating knowledge base', {
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        knowledgeBaseName: config.knowledge_base_name,
        hasTexts: !!config.knowledge_base_texts && config.knowledge_base_texts.length > 0,
        hasUrls: !!config.knowledge_base_urls && config.knowledge_base_urls.length > 0,
        hasFiles: !!config.knowledge_base_files && config.knowledge_base_files.length > 0,
        textsCount: config.knowledge_base_texts?.length || 0,
        urlsCount: config.knowledge_base_urls?.length || 0,
        filesCount: config.knowledge_base_files?.length || 0
      });

      const kbResponse = await this.client.knowledgeBase.create(config);
      
      Logger.info('Knowledge base created successfully', {
        knowledgeBaseId: kbResponse.knowledge_base_id,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        sourcesCreated: kbResponse.knowledge_base_sources?.length || 0
      });

      return kbResponse;
    } catch (error) {
      console.log(error);
      Logger.error('Failed to create knowledge base', {
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to create knowledge base: ${error.message}`);
    }
  }

  /**
   * Get a knowledge base by ID
   * @param {string} knowledgeBaseId - The knowledge base ID
   * @returns {Promise<Object>} The knowledge base details
   */
  async getKnowledgeBase(knowledgeBaseId) {
    try {
      Logger.info('Getting knowledge base', {
        knowledgeBaseId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      const kbResponse = await this.client.knowledgeBase.retrieve(knowledgeBaseId);
      
      Logger.info('Knowledge base retrieved successfully', {
        knowledgeBaseId,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        status: kbResponse.status,
        sourcesCount: kbResponse.knowledge_base_sources?.length || 0
      });

      return kbResponse;
    } catch (error) {
      Logger.error('Failed to get knowledge base', {
        knowledgeBaseId,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message
      });
      throw new Error(`Failed to get knowledge base: ${error.message}`);
    }
  }

  /**
   * Wait for knowledge base to be ready (status: completed)
   * @param {string} knowledgeBaseId - The knowledge base ID
   * @param {number} maxWaitTime - Maximum wait time in ms (default: 60000 = 1 minute)
   * @param {number} pollInterval - Poll interval in ms (default: 2000 = 2 seconds)
   * @returns {Promise<Object>} The completed knowledge base details
   */
  async waitForKnowledgeBaseReady(knowledgeBaseId, maxWaitTime = 60000, pollInterval = 2000) {
    const startTime = Date.now();
    
    Logger.info('Waiting for knowledge base to be ready', {
      knowledgeBaseId,
      accountName: this.accountName,
      subaccountId: this.subaccountId,
      maxWaitTime: `${maxWaitTime}ms`,
      pollInterval: `${pollInterval}ms`
    });

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const kbResponse = await this.getKnowledgeBase(knowledgeBaseId);
        
        Logger.debug('KB status check', {
          knowledgeBaseId,
          status: kbResponse.status,
          sourcesCount: kbResponse.knowledge_base_sources?.length || 0,
          elapsed: `${Date.now() - startTime}ms`
        });

        if (kbResponse.status === 'complete') {
          Logger.info('Knowledge base is ready', {
            knowledgeBaseId,
            accountName: this.accountName,
            subaccountId: this.subaccountId,
            sourcesCount: kbResponse.knowledge_base_sources?.length || 0,
            waitTime: `${Date.now() - startTime}ms`
          });
          return kbResponse;
        }

        if (kbResponse.status === 'failed' || kbResponse.status === 'error') {
          throw new Error(`Knowledge base processing failed with status: ${kbResponse.status}`);
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error) {
        Logger.error('Error while waiting for KB', {
          knowledgeBaseId,
          error: error.message,
          elapsed: `${Date.now() - startTime}ms`
        });
        throw error;
      }
    }

    // Timeout reached
    throw new Error(`Knowledge base processing timed out after ${maxWaitTime}ms`);
  }

  /**
   * List all knowledge bases
   * @returns {Promise<Array>} Array of knowledge bases
   */
  async listKnowledgeBases() {
    try {
      Logger.info('Listing knowledge bases', {
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      const kbList = await this.client.knowledgeBase.list();
      
      Logger.info('Knowledge bases listed successfully', {
        count: kbList?.length || 0,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      return kbList;
    } catch (error) {
      Logger.error('Failed to list knowledge bases', {
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message
      });
      throw new Error(`Failed to list knowledge bases: ${error.message}`);
    }
  }

  /**
   * Delete a knowledge base
   * @param {string} knowledgeBaseId - The knowledge base ID to delete
   * @returns {Promise<void>}
   */
  async deleteKnowledgeBase(knowledgeBaseId) {
    try {
      Logger.info('Deleting knowledge base', {
        knowledgeBaseId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      await this.client.knowledgeBase.delete(knowledgeBaseId);
      
      Logger.info('Knowledge base deleted successfully', {
        knowledgeBaseId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });
    } catch (error) {
      Logger.error('Failed to delete knowledge base', {
        knowledgeBaseId,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message
      });
      throw new Error(`Failed to delete knowledge base: ${error.message}`);
    }
  }

  /**
   * Add sources to a knowledge base
   * @param {string} knowledgeBaseId - The knowledge base ID
   * @param {Object} sources - Sources to add
   * @param {Array} sources.knowledge_base_texts - Text sources (optional)
   * @param {Array} sources.knowledge_base_urls - URL sources (optional)
   * @param {Array} sources.knowledge_base_files - File sources (optional)
   * @returns {Promise<Object>} Updated knowledge base
   */
  async addKnowledgeBaseSources(knowledgeBaseId, sources) {
    try {
      Logger.info('Adding sources to knowledge base', {
        knowledgeBaseId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      const kbResponse = await this.client.knowledgeBase.addSources(knowledgeBaseId, sources);
      
      Logger.info('Sources added to knowledge base successfully', {
        knowledgeBaseId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      return kbResponse;
    } catch (error) {
      Logger.error('Failed to add sources to knowledge base', {
        knowledgeBaseId,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message
      });
      throw new Error(`Failed to add sources to knowledge base: ${error.message}`);
    }
  }

  /**
   * Delete a source from a knowledge base
   * @param {string} knowledgeBaseId - The knowledge base ID
   * @param {string} sourceId - The source ID to delete
   * @returns {Promise<void>}
   */
  async deleteKnowledgeBaseSource(knowledgeBaseId, sourceId) {
    try {
      Logger.info('Deleting source from knowledge base', {
        knowledgeBaseId,
        sourceId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      await this.client.knowledgeBase.deleteSource(knowledgeBaseId, sourceId);
      
      Logger.info('Source deleted from knowledge base successfully', {
        knowledgeBaseId,
        sourceId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });
    } catch (error) {
      Logger.error('Failed to delete source from knowledge base', {
        knowledgeBaseId,
        sourceId,
        accountName: this.accountName,
        subaccountId: this.subaccountId,
        error: error.message
      });
      throw new Error(`Failed to delete source from knowledge base: ${error.message}`);
    }
  }

  getAccountInfo() {
    return {
      accountName: this.accountName,
      accountId: this.accountId,
      subaccountId: this.subaccountId,
      isActive: this.isActive,
      verificationStatus: this.verificationStatus
    };
  }
}

module.exports = Retell; 