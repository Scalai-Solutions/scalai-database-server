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
   * Create a new chat with an agent
   * @param {string} agentId - The agent ID to use for the chat
   * @returns {Promise<Object>} The chat response with chat_id, agent_id, etc.
   */
  async createChat(agentId) {
    try {
      Logger.info('Creating chat', {
        agentId,
        accountName: this.accountName,
        subaccountId: this.subaccountId
      });

      const chatResponse = await this.client.chat.create({ agent_id: agentId });
      
      Logger.info('Chat created successfully', {
        chatId: chatResponse.chat_id,
        agentId: chatResponse.agent_id,
        accountName: this.accountName,
        subaccountId: this.subaccountId
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