const twilio = require('twilio');
const axios = require('axios');
const crypto = require('crypto');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const redisService = require('./redisService');
const connectionPoolManager = require('./connectionPoolManager');

class TwilioService {
  constructor() {
    this.clients = new Map(); // Cache for Twilio client instances
  }

  // Encrypt credentials before storing in database
  encryptCredential(credential) {
    try {
      const algorithm = 'aes-256-gcm';
      const secretKey = crypto.scryptSync(config.encryption.key, 'twilio-salt', 32);
      
      // Generate a random IV for each encryption
      const iv = crypto.randomBytes(16);
      
      const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
      
      let encrypted = cipher.update(credential, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Get the auth tag for GCM mode
      const authTag = cipher.getAuthTag();
      
      return {
        encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
      };
    } catch (error) {
      throw new Error('Failed to encrypt credential: ' + error.message);
    }
  }

  // Decrypt credentials using the same method as MongoDB URL
  decryptCredential(encrypted, iv, authTag) {
    try {
      const algorithm = 'aes-256-gcm';
      const secretKey = crypto.scryptSync(config.encryption.key, 'twilio-salt', 32);
      
      const decipher = crypto.createDecipheriv(algorithm, secretKey, Buffer.from(iv, 'hex'));
      
      // Set auth tag for GCM mode
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      throw new Error('Failed to decrypt credential: ' + error.message);
    }
  }

  // Fetch Twilio account data from database
  async getTwilioAccount(subaccountId) {
    try {
      Logger.info('Fetching Twilio account', { subaccountId });

      // Check cache first
      const cachedData = await redisService.get(`twilio:account:${subaccountId}`);
      if (cachedData) {
        try {
          const parsed = JSON.parse(cachedData);
          // Validate cached accountSid before returning
          if (parsed.accountSid && parsed.accountSid.startsWith('AC')) {
            Logger.debug('Using cached Twilio account data', { subaccountId });
            return parsed;
          } else {
            Logger.warn('Cached Twilio data has invalid accountSid, fetching fresh', { 
              subaccountId,
              cachedSidPrefix: parsed.accountSid ? parsed.accountSid.substring(0, 2) : 'null'
            });
            // Invalidate bad cache
            await redisService.del(`twilio:account:${subaccountId}`);
          }
        } catch (parseError) {
          Logger.error('Failed to parse cached Twilio data', {
            subaccountId,
            error: parseError.message
          });
          // Clear bad cache
          await redisService.del(`twilio:account:${subaccountId}`);
        }
      }

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
      const { connection } = connectionInfo;

      // Fetch Twilio connector configuration
      const twilioConnector = await connection.db.collection('connectorsubaccount').findOne({
        subaccountId,
        connectorType: 'twilio',
        isActive: true
      });

      if (!twilioConnector) {
        throw new Error('Twilio connector not found or not active for this subaccount');
      }

      // Support both SID/AuthToken and accountSid/authToken field names
      const sidField = twilioConnector.config.SID || twilioConnector.config.accountSid;
      const tokenField = twilioConnector.config.AuthToken || twilioConnector.config.authToken;

      Logger.debug('Twilio config retrieved from database', {
        subaccountId,
        hasSID: !!twilioConnector.config.SID,
        hasAccountSid: !!twilioConnector.config.accountSid,
        hasAuthToken: !!twilioConnector.config.AuthToken,
        hasauthToken: !!twilioConnector.config.authToken,
        hasSidIV: !!twilioConnector.config.sidIV,
        hasTokenIV: !!twilioConnector.config.tokenIV,
        sidFieldLength: sidField ? sidField.length : 0,
        sidFieldPrefix: sidField ? sidField.substring(0, 4) : 'null'
      });

      if (!sidField || !tokenField) {
        throw new Error('Twilio credentials not configured properly');
      }

      // Decrypt credentials if they are encrypted
      let accountSid = sidField;
      let authToken = tokenField;

      // Check if credentials are encrypted
      if (twilioConnector.config.sidIV && twilioConnector.config.sidAuthTag) {
        try {
          accountSid = this.decryptCredential(
            sidField,
            twilioConnector.config.sidIV,
            twilioConnector.config.sidAuthTag
          );
          
          Logger.debug('Twilio SID decrypted successfully', { subaccountId });
        } catch (error) {
          Logger.error('Failed to decrypt Twilio SID', {
            subaccountId,
            error: error.message
          });
          throw new Error('Failed to decrypt Twilio SID');
        }
      }

      if (twilioConnector.config.tokenIV && twilioConnector.config.tokenAuthTag) {
        try {
          authToken = this.decryptCredential(
            tokenField,
            twilioConnector.config.tokenIV,
            twilioConnector.config.tokenAuthTag
          );

          Logger.debug('Twilio AuthToken decrypted successfully', { subaccountId });
        } catch (error) {
          Logger.error('Failed to decrypt Twilio AuthToken', {
            subaccountId,
            error: error.message
          });
          throw new Error('Failed to decrypt Twilio AuthToken');
        }
      }

      // Validate the decrypted accountSid format
      if (!accountSid || !accountSid.startsWith('AC')) {
        Logger.error('Invalid Twilio accountSid after decryption', {
          subaccountId,
          accountSidLength: accountSid ? accountSid.length : 0,
          accountSidPrefix: accountSid ? accountSid.substring(0, 2) : 'null',
          hasEncryption: !!(twilioConnector.config.sidIV && twilioConnector.config.sidAuthTag)
        });
        throw new Error('Invalid Twilio accountSid format. AccountSid must start with "AC"');
      }

      const twilioAccountData = {
        id: twilioConnector._id,
        subaccountId: twilioConnector.subaccountId,
        connectorId: twilioConnector.connectorId,
        accountSid,
        authToken,
        isActive: twilioConnector.isActive,
        metadata: twilioConnector.metadata || {},
        createdAt: twilioConnector.createdAt,
        updatedAt: twilioConnector.updatedAt
      };

      // Cache for 1 hour (3600 seconds)
      await redisService.set(
        `twilio:account:${subaccountId}`,
        JSON.stringify(twilioAccountData),
        3600
      );

      Logger.info('Twilio account fetched and cached', { subaccountId });

      return twilioAccountData;

    } catch (error) {
      Logger.error('Failed to fetch Twilio account', {
        subaccountId,
        error: error.message
      });
      throw error;
    }
  }

  // Get or create Twilio client instance
  async getTwilioClient(subaccountId) {
    try {
      // Check if we have a cached client instance
      if (this.clients.has(subaccountId)) {
        Logger.debug('Using cached Twilio client instance', { subaccountId });
        return this.clients.get(subaccountId);
      }

      // Fetch account data
      const accountData = await this.getTwilioAccount(subaccountId);

      // Create Twilio client
      const client = twilio(accountData.accountSid, accountData.authToken);

      // Cache the client instance
      this.clients.set(subaccountId, client);

      Logger.info('Twilio client created and cached', { subaccountId });

      return client;

    } catch (error) {
      Logger.error('Failed to get Twilio client', {
        subaccountId,
        error: error.message
      });
      throw error;
    }
  }

  // Invalidate cache for a Twilio account
  async invalidateCache(subaccountId) {
    try {
      // Remove from Redis cache
      await redisService.del(`twilio:account:${subaccountId}`);
      
      // Remove from memory cache
      this.clients.delete(subaccountId);
      
      Logger.info('Twilio account cache invalidated', { subaccountId });
    } catch (error) {
      Logger.error('Failed to invalidate Twilio account cache', {
        subaccountId,
        error: error.message
      });
    }
  }

  // Verify Twilio credentials
  async verifyCredentials(accountSid, authToken) {
    try {
      const client = twilio(accountSid, authToken);
      
      // Try to fetch account details to verify credentials
      await client.api.accounts(accountSid).fetch();
      
      return { success: true, message: 'Credentials verified successfully' };
    } catch (error) {
      Logger.error('Failed to verify Twilio credentials', {
        error: error.message
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Fetch or create a SIP trunk for Retell integration
   */
  async fetchOrCreateTrunk(subaccountId) {
    try {
      const client = await this.getTwilioClient(subaccountId);
      
      Logger.info('Fetching existing trunks', { subaccountId });
      
      // Fetch all trunks
      const trunks = await client.trunking.v1.trunks.list();
      
      // Look for a trunk with friendly_name starting with "scalai_"
      const scalaiTrunk = trunks.find(trunk => trunk.friendlyName.startsWith('scalai'));
      
      if (scalaiTrunk) {
        Logger.info('Found existing ScalAI trunk, fetching stored credentials', { 
          subaccountId, 
          trunkSid: scalaiTrunk.sid,
          friendlyName: scalaiTrunk.friendlyName 
        });

        // Get stored credentials from database metadata
        const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
        const { connection } = connectionInfo;
        
        const twilioConnector = await connection.db.collection('connectorsubaccount').findOne({
          subaccountId,
          connectorType: 'twilio'
        });

        const storedCredentials = twilioConnector?.metadata?.retellIntegration?.sipCredentials;
        
        Logger.debug('Stored credentials from database', {
          subaccountId,
          hasStoredCredentials: !!storedCredentials,
          storedUsername: storedCredentials?.username,
          hasStoredPassword: !!storedCredentials?.password,
          passwordLength: storedCredentials?.password ? storedCredentials.password.length : 0
        });
        
        // Fetch termination config
        const terminationConfig = await this.setupTermination(subaccountId, scalaiTrunk.sid);

        return {
          ...scalaiTrunk,
          terminationConfig,
          credentials: storedCredentials || { username: 'scalai_user', password: null }
        };
      }

      // If no scalai trunk found, create a new one
      Logger.info('No ScalAI trunk found, creating new trunk', { subaccountId });
      return await this.createTrunk(subaccountId);
    } catch (error) {
      Logger.error('Failed to fetch or create trunk', {
        subaccountId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Create a new SIP trunk for Retell integration
   */
  async createTrunk(subaccountId) {
    let trunk;
    try {
      const client = await this.getTwilioClient(subaccountId);
      
      
      const friendlyName = `scalai${Math.random().toString(36).substr(2, 8)}`;
      
      Logger.info('Creating new SIP trunk', { subaccountId, friendlyName });
      
      // Create the trunk
      trunk = await client.trunking.v1.trunks.create({
        friendlyName,
        transferMode: 'enable-all',
        domainName: `${friendlyName}.pstn.twilio.com`,
        cnamLookupEnabled: false,
        transferCallerId: 'from-transferee'
      });

      Logger.info('Trunk created successfully', { 
        subaccountId, 
        trunkSid: trunk.sid,
        friendlyName: trunk.friendlyName 
      });

      try {
        // Fetch or create credential list first (force recreate to get password)
        const credentialResult = await this.fetchOrCreateCredentialList(subaccountId, true);

        // Integrate trunk with credential list
        await this.integrateTrunkWithCredentialList(subaccountId, trunk.sid, credentialResult.credentialList.sid);

        // Set up origination (for inbound calls) - point to Retell
        await this.setupOrigination(subaccountId, trunk.sid);

        // Set up termination (for outbound calls)
        const terminationConfig = await this.setupTermination(subaccountId, trunk.sid);

        Logger.info('Trunk setup completed successfully', { 
          subaccountId, 
          trunkSid: trunk.sid,
          terminationUri: terminationConfig.primaryTerminationUri
        });

        return {
          ...trunk,
          terminationConfig,
          credentials: {
            username: credentialResult.credential.username,
            password: credentialResult.credential.password
          }
        };
      } catch (setupError) {
        Logger.error('Trunk setup failed, cleaning up', {
          subaccountId,
          trunkSid: trunk.sid,
          error: setupError.message
        });
        
        // If setup fails, delete the trunk we just created
        try {
          await client.trunking.v1.trunks(trunk.sid).remove();
          Logger.info('Trunk cleaned up after failed setup', { subaccountId, trunkSid: trunk.sid });
        } catch (cleanupError) {
          Logger.error('Failed to cleanup trunk', { 
            subaccountId, 
            trunkSid: trunk.sid,
            error: cleanupError.message 
          });
        }
        
        throw setupError;
      }
    } catch (error) {
      Logger.error('Failed to create trunk', {
        subaccountId,
        error: error.message
      });
      throw new Error(`Failed to create trunk: ${error.message}`);
    }
  }

  /**
   * Setup termination for outbound calls
   */
  async setupTermination(subaccountId, trunkSid) {
    try {
      const client = await this.getTwilioClient(subaccountId);
      
      Logger.info('Setting up termination for outbound calls', { 
        subaccountId, 
        trunkSid
      });
      
      // Fetch the trunk to get its domain and termination URI
      const trunk = await client.trunking.v1.trunks(trunkSid).fetch();
      
      // The termination URI is automatically generated based on trunk's domain
      const terminationUri = trunk.domainName ? `sip:${trunk.domainName}` : null;
      
      if (!terminationUri) {
        throw new Error('Trunk domain name not found, cannot determine termination URI');
      }

      // Get localized termination URIs for better performance
      // These are region-specific termination endpoints
      const localizedTerminationUris = {
        global: terminationUri,
        us1: `sip:${trunk.friendlyName}.us1.pstn.twilio.com`,
        ie1: `sip:${trunk.friendlyName}.ie1.pstn.twilio.com`,
        de1: `sip:${trunk.friendlyName}.de1.pstn.twilio.com`,
        sg1: `sip:${trunk.friendlyName}.sg1.pstn.twilio.com`,
        jp1: `sip:${trunk.friendlyName}.jp1.pstn.twilio.com`,
        au1: `sip:${trunk.friendlyName}.au1.pstn.twilio.com`,
        br1: `sip:${trunk.friendlyName}.br1.pstn.twilio.com`
      };

      Logger.info('Termination URIs configured', { 
        subaccountId, 
        trunkSid,
        primaryTerminationUri: terminationUri,
        localizedUris: Object.keys(localizedTerminationUris)
      });

      return {
        success: true,
        primaryTerminationUri: terminationUri,
        localizedTerminationUris,
        note: 'Use these URIs when importing numbers to Retell. Credentials are required for authentication.'
      };
    } catch (error) {
      Logger.error('Failed to setup termination', {
        subaccountId,
        trunkSid,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Setup origination for inbound calls - point to Retell
   */
  async setupOrigination(subaccountId, trunkSid) {
    try {
      const client = await this.getTwilioClient(subaccountId);
      
      Logger.info('Setting up origination URL for Retell', { subaccountId, trunkSid });
      
      // Create origination URL pointing to Retell's SIP server
      const originationUrl = await client.trunking.v1
        .trunks(trunkSid)
        .originationUrls
        .create({
          enabled: true,
          friendlyName: 'Retell AI SIP Server',
          priority: 1,
          sipUrl: 'sip:sip.retellai.com',
          weight: 1
        });

      Logger.info('Origination URL created successfully', { 
        subaccountId, 
        trunkSid,
        originationUrlSid: originationUrl.sid 
      });

      return originationUrl;
    } catch (error) {
      Logger.error('Failed to setup origination', {
        subaccountId,
        trunkSid,
        error: error.message
      });
      throw new Error(`Failed to setup origination: ${error.message}`);
    }
  }

  /**
   * Fetch or create credential list for SIP authentication
   * Always recreates the credential to ensure we have the password
   */
  async fetchOrCreateCredentialList(subaccountId, forceRecreate = false) {
    try {
      const client = await this.getTwilioClient(subaccountId);
      
      Logger.info('Fetching credential lists', { subaccountId, forceRecreate });
      
      // Fetch all credential lists
      const credentialLists = await client.sip.credentialLists.list();
      
      // Look for a credential list with friendly_name starting with "scalai_"
      const scalaiCredentialList = credentialLists.find(list => 
        list.friendlyName.startsWith('scalai_')
      );
      
      if (scalaiCredentialList) {
        Logger.info('Found existing ScalAI credential list', { 
          subaccountId, 
          credentialListSid: scalaiCredentialList.sid 
        });
        
        // Check if it has the scalai_user credential
        const credentials = await client.sip.credentialLists(scalaiCredentialList.sid)
          .credentials
          .list();
        
        const scalaiCredential = credentials.find(cred => 
          cred.username === 'scalai_user'
        );

        if (scalaiCredential) {
          // If we need a new password (forceRecreate), delete and recreate the credential
          if (forceRecreate) {
            Logger.info('Deleting existing credential to create new one with known password', {
              subaccountId,
              credentialListSid: scalaiCredentialList.sid
            });
            
            try {
              await client.sip.credentialLists(scalaiCredentialList.sid)
                .credentials(scalaiCredential.sid)
                .remove();
              
              Logger.info('Existing credential deleted', { subaccountId });
            } catch (deleteError) {
              Logger.warn('Failed to delete existing credential, will create new one anyway', {
                subaccountId,
                error: deleteError.message
              });
            }
            
            // Create new credential with known password
            const newCredential = await this.createCredential(subaccountId, scalaiCredentialList.sid);
            return {
              credentialList: scalaiCredentialList,
              credential: newCredential
            };
          }
          
          // Return existing credential with fixed password (since Twilio doesn't return it)
          Logger.info('Existing credential found, using fixed password', { 
            subaccountId,
            username: scalaiCredential.username 
          });
          return {
            credentialList: scalaiCredentialList,
            credential: {
              ...scalaiCredential,
              password: '44pass$$scalAI' // Use fixed password for existing credentials
            }
          };
        }

        // If no credential found, create one
        const credential = await this.createCredential(subaccountId, scalaiCredentialList.sid);
        return {
          credentialList: scalaiCredentialList,
          credential
        };
      }

      // If no credential list found, create new one with credential
      Logger.info('Creating new credential list', { subaccountId });
      return await this.createCredentialList(subaccountId);
    } catch (error) {
      Logger.error('Failed to fetch or create credential list', {
        subaccountId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Create a new credential list
   */
  async createCredentialList(subaccountId) {
    try {
      const client = await this.getTwilioClient(subaccountId);
      
      // Generate friendly name with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const friendlyName = `scalai_cl_${timestamp}`;
      
      Logger.info('Creating credential list', { subaccountId, friendlyName });
      
      // Create a new credential list
      const credentialList = await client.sip.credentialLists.create({
        friendlyName
      });

      // Create credential in the list
      const credential = await this.createCredential(subaccountId, credentialList.sid);

      Logger.info('Credential list created successfully', { 
        subaccountId, 
        credentialListSid: credentialList.sid 
      });

      return {
        credentialList,
        credential
      };
    } catch (error) {
      Logger.error('Failed to create credential list', {
        subaccountId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Create a credential in a credential list
   */
  async createCredential(subaccountId, credentialListSid) {
    try {
      const client = await this.getTwilioClient(subaccountId);
      
      Logger.info('Creating credential', { subaccountId, credentialListSid });
      
      // Use fixed password for consistency
      const password = '44pass$$scalAI';
      const username = 'scalai_user';
      
      const credential = await client.sip.credentialLists(credentialListSid)
        .credentials
        .create({
          username,
          password
        });

      Logger.info('Credential created successfully', { 
        subaccountId, 
        credentialListSid,
        username: credential.username,
        passwordSet: true
      });

      // Return credential with password (Twilio API doesn't return password)
      return {
        ...credential,
        password // Include the password we used
      };
    } catch (error) {
      Logger.error('Failed to create credential', {
        subaccountId,
        credentialListSid,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Integrate trunk with credential list
   */
  async integrateTrunkWithCredentialList(subaccountId, trunkSid, credentialListSid) {
    try {
      const client = await this.getTwilioClient(subaccountId);
      
      Logger.info('Integrating trunk with credential list', { 
        subaccountId, 
        trunkSid, 
        credentialListSid 
      });
      
      const credentialsList = await client.trunking.v1
        .trunks(trunkSid)
        .credentialsLists
        .create({
          credentialListSid
        });

      Logger.info('Trunk integrated with credential list successfully', { 
        subaccountId, 
        trunkSid, 
        credentialListSid 
      });

      return credentialsList;
    } catch (error) {
      Logger.error('Failed to integrate trunk with credential list', {
        subaccountId,
        trunkSid,
        credentialListSid,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get all purchased phone numbers
   */
  async getPhoneNumbers(subaccountId) {
    try {
      Logger.info('Fetching Twilio phone numbers', { subaccountId });

      // Check cache first
      const cacheKey = `twilio:phoneNumbers:${subaccountId}`;
      const cachedData = await redisService.get(cacheKey);
      if (cachedData) {
        Logger.debug('Using cached phone numbers', { subaccountId });
        return JSON.parse(cachedData);
      }

      const client = await this.getTwilioClient(subaccountId);
      
      // Get the trunk SID if exists (to filter out trunk-linked numbers)
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
      const { connection } = connectionInfo;
      
      const twilioConnector = await connection.db.collection('connectorsubaccount').findOne({
        subaccountId,
        connectorType: 'twilio'
      });

      const trunkSid = twilioConnector?.metadata?.retellIntegration?.trunkSid;

      // Fetch all incoming phone numbers
      const phoneNumbers = await client.incomingPhoneNumbers.list();

      // Filter out numbers linked to the trunk
      const availableNumbers = phoneNumbers.filter(number => {
        return !trunkSid || number.trunkSid !== trunkSid;
      });

      const result = {
        phoneNumbers: availableNumbers.map(number => ({
          sid: number.sid,
          phoneNumber: number.phoneNumber,
          friendlyName: number.friendlyName,
          capabilities: number.capabilities,
          smsUrl: number.smsUrl,
          voiceUrl: number.voiceUrl,
          statusCallback: number.statusCallback,
          trunkSid: number.trunkSid,
          emergencyAddressSid: number.emergencyAddressSid,
          addressSid: number.addressSid,
          dateCreated: number.dateCreated,
          dateUpdated: number.dateUpdated
        })),
        total: availableNumbers.length,
        trunkLinkedCount: phoneNumbers.length - availableNumbers.length
      };

      // Cache for 5 minutes
      await redisService.set(cacheKey, JSON.stringify(result), 300);

      Logger.info('Phone numbers fetched successfully', { 
        subaccountId, 
        total: result.total,
        trunkLinked: result.trunkLinkedCount
      });

      return result;
    } catch (error) {
      Logger.error('Failed to fetch phone numbers', {
        subaccountId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Search for available phone numbers to purchase
   */
  async searchAvailablePhoneNumbers(subaccountId, options = {}) {
    try {
      const {
        countryCode = 'US',
        areaCode = null,
        contains = null,
        smsEnabled = true,
        voiceEnabled = true,
        mmsEnabled = false,
        limit = 20
      } = options;

      Logger.info('Searching for available phone numbers', { 
        subaccountId, 
        countryCode,
        areaCode,
        contains 
      });

      // Create cache key based on search parameters
      const cacheKey = `twilio:available:${subaccountId}:${countryCode}:${areaCode || 'any'}:${contains || 'any'}:${smsEnabled}:${voiceEnabled}:${mmsEnabled}:${limit}`;
      const cachedData = await redisService.get(cacheKey);
      if (cachedData) {
        Logger.debug('Using cached available phone numbers', { subaccountId });
        return JSON.parse(cachedData);
      }

      const client = await this.getTwilioClient(subaccountId);

      // Build search parameters
      const searchParams = {
        limit: Math.min(limit, 30) // Twilio max is 30
      };

      if (areaCode) searchParams.areaCode = areaCode;
      if (contains) searchParams.contains = contains;
      if (smsEnabled) searchParams.smsEnabled = true;
      if (voiceEnabled) searchParams.voiceEnabled = true;
      if (mmsEnabled) searchParams.mmsEnabled = true;

      // Search for local phone numbers
      const availableNumbers = await client.availablePhoneNumbers(countryCode)
        .local
        .list(searchParams);

      const result = {
        availableNumbers: availableNumbers.map(number => ({
          phoneNumber: number.phoneNumber,
          friendlyName: number.friendlyName,
          locality: number.locality,
          region: number.region,
          postalCode: number.postalCode,
          isoCountry: number.isoCountry,
          addressRequirements: number.addressRequirements,
          capabilities: number.capabilities,
          beta: number.beta
        })),
        total: availableNumbers.length,
        searchCriteria: {
          countryCode,
          areaCode,
          contains,
          smsEnabled,
          voiceEnabled,
          mmsEnabled
        }
      };

      // Cache for 10 minutes (available numbers don't change frequently)
      await redisService.set(cacheKey, JSON.stringify(result), 600);

      Logger.info('Available phone numbers fetched successfully', { 
        subaccountId, 
        count: result.total 
      });

      return result;
    } catch (error) {
      Logger.error('Failed to search available phone numbers', {
        subaccountId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Purchase a phone number with full integration (emergency address, trunk, Retell)
   */
  async purchasePhoneNumber(subaccountId, phoneNumber) {
    try {
      Logger.info('Starting phone number purchase flow', { 
        subaccountId, 
        phoneNumber 
      });

      const client = await this.getTwilioClient(subaccountId);

      // Get connector info for emergency address and trunk
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
      const { connection } = connectionInfo;
      
      const twilioConnector = await connection.db.collection('connectorsubaccount').findOne({
        subaccountId,
        connectorType: 'twilio'
      });

      if (!twilioConnector) {
        throw new Error('Twilio connector not found for this subaccount');
      }

      const emergencyAddressId = twilioConnector.metadata?.retellIntegration?.emergencyAddressId;
      const trunkSid = twilioConnector.metadata?.retellIntegration?.trunkSid;
      const terminationSipUri = twilioConnector.metadata?.retellIntegration?.terminationSipUri;
      const sipCredentials = twilioConnector.metadata?.retellIntegration?.sipCredentials;

      if (!emergencyAddressId) {
        throw new Error('Emergency address not configured. Please run Twilio setup first.');
      }

      if (!trunkSid) {
        throw new Error('SIP trunk not configured. Please run Twilio setup first.');
      }

      // Generate friendly name
      const friendlyName = `voone_${phoneNumber.replace(/\+/g, '')}`;

      // Step 1: Purchase the phone number
      Logger.info('Step 1: Purchasing phone number', { phoneNumber, friendlyName });
      const purchaseParams = { 
        phoneNumber,
        friendlyName
      };

      const purchasedNumber = await client.incomingPhoneNumbers.create(purchaseParams);
      
      Logger.info('Phone number purchased', { 
        sid: purchasedNumber.sid,
        phoneNumber: purchasedNumber.phoneNumber
      });

      try {
        // Step 2: Integrate with emergency address
        Logger.info('Step 2: Integrating with emergency address', { 
          numberSid: purchasedNumber.sid,
          emergencyAddressId 
        });

        await this.integrateNumberWithEmergencyAddress(
          subaccountId, 
          purchasedNumber.sid, 
          emergencyAddressId
        );

        // Step 3: Register to trunk
        Logger.info('Step 3: Registering number to trunk', { 
          numberSid: purchasedNumber.sid,
          trunkSid 
        });

        await this.registerNumberToTrunk(subaccountId, purchasedNumber.sid, trunkSid);

        // Step 4: Import to Retell
        Logger.info('Step 4: Importing number to Retell', { 
          phoneNumber,
          terminationSipUri 
        });

        const retellNumber = await this.importNumberToRetell(
          subaccountId,
          phoneNumber,
          terminationSipUri,
          sipCredentials
        );

        // Check if Retell import failed
        if (retellNumber && !retellNumber.imported) {
          Logger.error('Retell import failed, triggering cleanup', {
            subaccountId,
            phoneNumber,
            retellError: retellNumber.error
          });
          throw new Error(`Retell import failed: ${retellNumber.error || 'Unknown error'}`);
        }

        // Invalidate phone numbers cache
        await redisService.del(`twilio:phoneNumbers:${subaccountId}`);

        Logger.info('Phone number purchase flow completed successfully', { 
          subaccountId, 
          phoneNumber,
          sid: purchasedNumber.sid,
          retellImported: !!retellNumber
        });

        return {
          success: true,
          twilioNumber: {
            sid: purchasedNumber.sid,
            phoneNumber: purchasedNumber.phoneNumber,
            friendlyName: purchasedNumber.friendlyName,
            capabilities: purchasedNumber.capabilities,
            emergencyAddressSid: emergencyAddressId,
            trunkSid: trunkSid,
            dateCreated: purchasedNumber.dateCreated
          },
          retellNumber: retellNumber || null
        };

      } catch (integrationError) {
        // If integration fails, cleanup the purchased number
        Logger.error('Integration failed after purchase, starting cleanup', {
          subaccountId,
          phoneNumber,
          numberSid: purchasedNumber.sid,
          error: integrationError.message,
          errorStack: integrationError.stack
        });

        let cleanupSuccess = false;

        try {
          // Step 1: Remove from trunk if it was added
          if (trunkSid) {
            try {
              Logger.info('Attempting to remove number from trunk', { 
                numberSid: purchasedNumber.sid,
                trunkSid
              });
              
              await client.trunking.v1
                .trunks(trunkSid)
                .phoneNumbers(purchasedNumber.sid)
                .remove();
              
              Logger.info('Number removed from trunk', { numberSid: purchasedNumber.sid });
            } catch (trunkRemoveError) {
              Logger.warn('Failed to remove from trunk or number was not in trunk', {
                numberSid: purchasedNumber.sid,
                error: trunkRemoveError.message
              });
            }
          }

          // Step 2: Release emergency address from number with retry logic
          await this.releaseEmergencyAddressWithRetry(
            subaccountId,
            purchasedNumber.sid,
            client
          );

          // Step 3: Delete the purchased number from Twilio
          Logger.info('Deleting purchased number from Twilio', { 
            numberSid: purchasedNumber.sid,
            phoneNumber
          });
          
          await client.incomingPhoneNumbers(purchasedNumber.sid).remove();
          
          Logger.info('Successfully cleaned up failed purchase', {
            subaccountId,
            phoneNumber,
            numberSid: purchasedNumber.sid
          });
          
          cleanupSuccess = true;
          
        } catch (cleanupError) {
          Logger.error('Failed to cleanup after failed purchase', {
            subaccountId,
            phoneNumber,
            numberSid: purchasedNumber.sid,
            error: cleanupError.message,
            errorStack: cleanupError.stack,
            note: 'MANUAL CLEANUP REQUIRED in Twilio console'
          });
        }

        const errorMessage = cleanupSuccess 
          ? `Number purchase failed during integration: ${integrationError.message}. Number has been released and deleted.`
          : `Number purchase failed during integration: ${integrationError.message}. CLEANUP FAILED - Manual cleanup required for number ${purchasedNumber.sid} in Twilio console.`;
        
        throw new Error(errorMessage);
      }

    } catch (error) {
      Logger.error('Failed to purchase phone number', {
        subaccountId,
        phoneNumber,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Release emergency address from number with retry logic
   * Waits for emergency status to complete before releasing
   */
  async releaseEmergencyAddressWithRetry(subaccountId, numberSid, client, maxRetries = 5) {
    const retryDelayMs = 60000; // 1 minute

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        Logger.info('Attempting to release emergency address', { 
          numberSid,
          attempt,
          maxRetries
        });

        // First, check the current emergency address status
        const numberInfo = await client.incomingPhoneNumbers(numberSid).fetch();
        
        Logger.info('Current emergency address status', {
          numberSid,
          emergencyStatus: numberInfo.emergencyStatus,
          emergencyAddressStatus: numberInfo.emergencyAddressStatus,
          emergencyAddressSid: numberInfo.emergencyAddressSid
        });

        // If status is pending, we need to wait
        if (numberInfo.emergencyStatus === 'pending' || 
            numberInfo.emergencyAddressStatus === 'pending') {
          
          if (attempt < maxRetries) {
            Logger.warn(`Emergency status is pending, waiting ${retryDelayMs / 1000} seconds before retry`, {
              numberSid,
              attempt,
              nextRetryIn: retryDelayMs / 1000
            });
            
            // Wait for 1 minute
            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
            continue; // Try again
          } else {
            throw new Error(`Emergency status still pending after ${maxRetries} attempts. Please try cleanup manually later.`);
          }
        }

        // If not pending, try to release the emergency address
        await client.incomingPhoneNumbers(numberSid)
          .update({
            emergencyAddressSid: '' // Clear emergency address
          });
        
        Logger.info('Emergency address released successfully', { 
          numberSid,
          attempts: attempt
        });
        
        return; // Success, exit the function

      } catch (error) {
        Logger.error('Failed to release emergency address', {
          numberSid,
          attempt,
          error: error.message
        });

        // If this is not a pending status error, or we're out of retries, throw
        if (!error.message.includes('pending') || attempt >= maxRetries) {
          throw error;
        }

        // Wait and retry
        if (attempt < maxRetries) {
          Logger.info(`Waiting ${retryDelayMs / 1000} seconds before retry`, {
            numberSid,
            attempt,
            nextRetryIn: retryDelayMs / 1000
          });
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    throw new Error(`Failed to release emergency address after ${maxRetries} attempts`);
  }

  /**
   * Integrate phone number with emergency address
   */
  async integrateNumberWithEmergencyAddress(subaccountId, numberSid, emergencyAddressId) {
    try {
      const client = await this.getTwilioClient(subaccountId);

      Logger.info('Integrating number with emergency address', {
        subaccountId,
        numberSid,
        emergencyAddressId
      });

      const updatedNumber = await client.incomingPhoneNumbers(numberSid)
        .update({
          emergencyAddressSid: emergencyAddressId
        });

      Logger.info('Successfully integrated number with emergency address', {
        subaccountId,
        numberSid,
        emergencyAddressId
      });

      return updatedNumber;

    } catch (error) {
      Logger.error('Failed to integrate number with emergency address', {
        subaccountId,
        numberSid,
        emergencyAddressId,
        error: error.message
      });
      throw new Error(`Failed to integrate number with emergency address: ${error.message}`);
    }
  }

  /**
   * Register phone number to SIP trunk
   */
  async registerNumberToTrunk(subaccountId, phoneNumberSid, trunkSid) {
    try {
      const client = await this.getTwilioClient(subaccountId);

      Logger.info('Registering phone number to trunk', {
        subaccountId,
        phoneNumberSid,
        trunkSid
      });

      const phoneNumberInstance = await client.trunking.v1
        .trunks(trunkSid)
        .phoneNumbers
        .create({
          phoneNumberSid
        });

      Logger.info('Successfully registered phone number to trunk', {
        subaccountId,
        phoneNumberSid,
        trunkSid
      });

      return phoneNumberInstance;

    } catch (error) {
      Logger.error('Failed to register phone number to trunk', {
        subaccountId,
        phoneNumberSid,
        trunkSid,
        error: error.message
      });
      throw new Error(`Failed to register phone number to trunk: ${error.message}`);
    }
  }

  /**
   * Import phone number to Retell AI
   */
  async importNumberToRetell(subaccountId, phoneNumber, terminationUri, sipCredentials) {
    try {
      Logger.info('Importing phone number to Retell', {
        subaccountId,
        phoneNumber,
        terminationUri
      });

      // Get Retell API key from retellService
      const retellService = require('./retellService');
      let retellApiKey;
      
      try {
        const retellAccount = await retellService.getRetellAccount(subaccountId);
        retellApiKey = retellAccount.apiKey;
      } catch (retellError) {
        Logger.warn('Retell account not configured, skipping Retell import', {
          subaccountId,
          error: retellError.message
        });
        return {
          imported: false,
          message: 'Retell account not configured for this subaccount'
        };
      }

      if (!retellApiKey) {
        Logger.warn('Retell API key not found, skipping Retell import');
        return {
          imported: false,
          message: 'Retell API key not configured'
        };
      }

      const payload = {
        phone_number: phoneNumber,
        termination_uri: terminationUri && terminationUri.startsWith('sip:') 
          ? terminationUri.slice(4) 
          : terminationUri
      };

      // Add SIP auth credentials if available
      if (sipCredentials?.username && sipCredentials?.password) {
        payload.sip_trunk_auth_username = sipCredentials.username;
        payload.sip_trunk_auth_password = sipCredentials.password;
      }

      Logger.info('=== RETELL IMPORT REQUEST DETAILS ===', {
        url: 'https://api.retellai.com/import-phone-number',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${retellApiKey.substring(0, 10)}...${retellApiKey.substring(retellApiKey.length - 4)}`,
          'Content-Type': 'application/json'
        },
        payload: {
          phone_number: payload.phone_number,
          termination_uri: payload.termination_uri,
          sip_trunk_auth_username: payload.sip_trunk_auth_username || 'NOT_PROVIDED',
          sip_trunk_auth_password: payload.sip_trunk_auth_password 
        },
        fullPayloadForTesting: JSON.stringify(payload, null, 2)
      });

      const response = await axios.post(
        'https://api.retellai.com/import-phone-number',
        payload,
        {
          headers: {
            'Authorization': `Bearer ${retellApiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      Logger.info('Successfully imported phone number to Retell', {
        phoneNumber,
        retellPhoneNumberType: response.data.phone_number_type,
        areaCode: response.data.area_code
      });

      // Store phone number in MongoDB
      try {
        const connectionInfo = await connectionPoolManager.getConnection(subaccountId, 'system');
        const { connection } = connectionInfo;
        const phoneNumbersCollection = connection.db.collection('phonenumbers');

        const phoneNumberDocument = {
          subaccountId,
          phone_number: response.data.phone_number,
          phone_number_type: response.data.phone_number_type,
          phone_number_pretty: response.data.phone_number_pretty,
          inbound_agent_id: response.data.inbound_agent_id || null,
          outbound_agent_id: response.data.outbound_agent_id || null,
          inbound_agent_version: response.data.inbound_agent_version || null,
          outbound_agent_version: response.data.outbound_agent_version || null,
          area_code: response.data.area_code,
          nickname: response.data.nickname || null,
          inbound_webhook_url: response.data.inbound_webhook_url || null,
          last_modification_timestamp: response.data.last_modification_timestamp,
          termination_uri: terminationUri,
          sip_credentials: sipCredentials ? {
            username: sipCredentials.username
            // Don't store password in plain text
          } : null,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        await phoneNumbersCollection.insertOne(phoneNumberDocument);
        Logger.info('Phone number stored in MongoDB', { phoneNumber, subaccountId });
      } catch (dbError) {
        Logger.error('Failed to store phone number in MongoDB', {
          phoneNumber,
          subaccountId,
          error: dbError.message
        });
        // Don't fail the import if DB storage fails
      }

      return {
        ...response.data,
        imported: true
      };

    } catch (error) {
      Logger.error('Failed to import phone number to Retell', {
        subaccountId,
        phoneNumber,
        terminationUri,
        error: error.message,
        response: error.response?.data
      });
      
      // Don't throw error if it's just Retell import that failed
      // The number is still usable in Twilio
      return {
        error: error.message,
        errorDetails: error.response?.data,
        imported: false
      };
    }
  }

  /**
   * Setup Twilio for Retell AI integration
   */
  async setupTwilioForRetell(subaccountId, emergencyAddressId) {
    try {
      Logger.info('Starting Twilio setup for Retell AI', { 
        subaccountId, 
        emergencyAddressId 
      });

      // Fetch or create trunk
      const trunkResult = await this.fetchOrCreateTrunk(subaccountId);
      
      // Extract trunk, termination config, and credentials
      const trunk = trunkResult.sid ? trunkResult : trunkResult;
      const terminationConfig = trunkResult.terminationConfig || null;
      const credentials = trunkResult.credentials || { username: 'scalai_user', password: null };

      // Get termination SIP URIs
      const primaryTerminationUri = terminationConfig?.primaryTerminationUri || 
                                     (trunk.domainName ? `sip:${trunk.domainName}` : null);
      const localizedTerminationUris = terminationConfig?.localizedTerminationUris || {};

      // Store trunk details, credentials, and emergency address in metadata
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
      const { connection } = connectionInfo;

      Logger.debug('Storing Retell integration metadata', {
        subaccountId,
        trunkSid: trunk.sid,
        emergencyAddressId,
        credentialsToStore: {
          username: credentials.username,
          hasPassword: !!credentials.password,
          passwordLength: credentials.password ? credentials.password.length : 0
        }
      });

      const updateResult = await connection.db.collection('connectorsubaccount').updateOne(
        {
          subaccountId,
          connectorType: 'twilio'
        },
        {
          $set: {
            'metadata.retellIntegration': {
              trunkSid: trunk.sid,
              trunkFriendlyName: trunk.friendlyName,
              trunkDomainName: trunk.domainName,
              terminationSipUri: primaryTerminationUri,
              localizedTerminationUris,
              originationSipUri: 'sip:sip.retellai.com',
              sipCredentials: {
                username: credentials.username,
                password: credentials.password
              },
              emergencyAddressId,
              setupCompletedAt: new Date(),
              status: 'configured'
            },
            updatedAt: new Date()
          }
        }
      );

      Logger.debug('Update result', {
        subaccountId,
        matched: updateResult.matchedCount,
        modified: updateResult.modifiedCount
      });

      // Invalidate cache
      await this.invalidateCache(subaccountId);

      Logger.info('Twilio setup for Retell completed successfully', { 
        subaccountId, 
        trunkSid: trunk.sid,
        terminationUri: primaryTerminationUri
      });

      return {
        success: true,
        trunk: {
          sid: trunk.sid,
          friendlyName: trunk.friendlyName,
          domainName: trunk.domainName,
          terminationSipUri: primaryTerminationUri,
          localizedTerminationUris
        },
        sipCredentials: {
          username: credentials.username,
          password: credentials.password
        },
        emergencyAddressId,
        originationSipUri: 'sip:sip.retellai.com',
        instructions: {
          steps: [
            '1. Trunk and credentials are configured automatically',
            '2. Import phone numbers to this trunk in Twilio Console',
            '3. Use the termination SIP URI and credentials below when importing numbers to Retell'
          ],
          terminationUri: primaryTerminationUri,
          regionalUris: localizedTerminationUris,
          sipAuth: {
            username: credentials.username,
            password: credentials.password,
            note: 'Use these credentials when importing numbers to Retell'
          },
          retellImportExample: {
            terminationSipUri: primaryTerminationUri,
            username: credentials.username,
            password: credentials.password
          }
        }
      };
    } catch (error) {
      Logger.error('Failed to setup Twilio for Retell', {
        subaccountId,
        emergencyAddressId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get Retell API key for a subaccount
   * @param {string} subaccountId - Subaccount ID
   * @returns {Promise<string>} Retell API key
   */
  async getRetellApiKey(subaccountId) {
    try {
      const retellService = require('./retellService');
      const retellAccount = await retellService.getRetellAccount(subaccountId);
      return retellAccount.apiKey;
    } catch (error) {
      Logger.error('Failed to get Retell API key', {
        subaccountId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get all phone numbers for a subaccount
   * @param {string} subaccountId - Subaccount ID
   * @param {string} userId - User ID making the request
   * @returns {Promise<Array>} Array of phone numbers
   */
  async getAllPhoneNumbers(subaccountId, userId) {
    try {
      Logger.info('Getting all phone numbers', { subaccountId });

      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      const phoneNumbersCollection = connection.db.collection('phonenumbers');

      const phoneNumbers = await phoneNumbersCollection
        .find({ subaccountId })
        .sort({ createdAt: -1 })
        .toArray();

      Logger.info('Retrieved phone numbers', {
        subaccountId,
        count: phoneNumbers.length
      });

      return phoneNumbers;
    } catch (error) {
      Logger.error('Failed to get phone numbers', {
        subaccountId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Update phone number agent assignment in Retell and MongoDB
   * @param {string} subaccountId - Subaccount ID
   * @param {string} phoneNumber - Phone number to update
   * @param {Object} updateData - Update data
   * @param {string} updateData.inbound_agent_id - Inbound agent ID (optional)
   * @param {string} updateData.outbound_agent_id - Outbound agent ID (optional)
   * @param {string} updateData.nickname - Nickname (optional)
   * @param {string} userId - User ID making the request
   * @returns {Promise<Object>} Updated phone number data
   */
  async updatePhoneNumber(subaccountId, phoneNumber, updateData, userId) {
    try {
      Logger.info('Updating phone number', {
        subaccountId,
        phoneNumber,
        updateData
      });

      // Get Retell API key
      const retellApiKey = await this.getRetellApiKey(subaccountId);
      
      if (!retellApiKey) {
        throw new Error('Retell API key not configured for this subaccount');
      }

      // Prepare Retell update payload
      const retellPayload = {};
      if (updateData.inbound_agent_id !== undefined) {
        retellPayload.inbound_agent_id = updateData.inbound_agent_id;
      }
      if (updateData.outbound_agent_id !== undefined) {
        retellPayload.outbound_agent_id = updateData.outbound_agent_id;
      }
      if (updateData.nickname !== undefined) {
        retellPayload.nickname = updateData.nickname;
      }

      // Update in Retell
      const response = await axios.patch(
        `https://api.retellai.com/update-phone-number/${encodeURIComponent(phoneNumber)}`,
        retellPayload,
        {
          headers: {
            'Authorization': `Bearer ${retellApiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      Logger.info('Successfully updated phone number in Retell', {
        phoneNumber,
        response: response.data
      });

      // Update in MongoDB
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      const phoneNumbersCollection = connection.db.collection('phonenumbers');

      const mongoUpdateData = {
        updatedAt: new Date(),
        last_modification_timestamp: Date.now()
      };

      if (updateData.inbound_agent_id !== undefined) {
        mongoUpdateData.inbound_agent_id = updateData.inbound_agent_id;
        mongoUpdateData.inbound_agent_version = response.data.inbound_agent_version;
      }
      if (updateData.outbound_agent_id !== undefined) {
        mongoUpdateData.outbound_agent_id = updateData.outbound_agent_id;
        mongoUpdateData.outbound_agent_version = response.data.outbound_agent_version;
      }
      if (updateData.nickname !== undefined) {
        mongoUpdateData.nickname = updateData.nickname;
      }

      await phoneNumbersCollection.updateOne(
        { subaccountId, phone_number: phoneNumber },
        { $set: mongoUpdateData }
      );

      Logger.info('Phone number updated in MongoDB', { phoneNumber, subaccountId });

      return response.data;
    } catch (error) {
      Logger.error('Failed to update phone number', {
        subaccountId,
        phoneNumber,
        error: error.message,
        response: error.response?.data,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Delete phone number from Retell, Twilio, and MongoDB
   * @param {string} subaccountId - Subaccount ID
   * @param {string} phoneNumber - Phone number to delete
   * @param {string} userId - User ID making the request
   * @returns {Promise<Object>} Deletion result
   */
  async deletePhoneNumber(subaccountId, phoneNumber, userId) {
    try {
      Logger.info('Deleting phone number from all systems', {
        subaccountId,
        phoneNumber
      });

      const results = {
        retell: { success: false },
        twilio: { success: false },
        mongodb: { success: false }
      };

      // Get Retell API key
      let retellApiKey;
      try {
        retellApiKey = await this.getRetellApiKey(subaccountId);
      } catch (error) {
        Logger.warn('Could not get Retell API key', { error: error.message });
      }

      // Delete from Retell
      if (retellApiKey) {
        try {
          await axios.delete(
            `https://api.retellai.com/delete-phone-number/${encodeURIComponent(phoneNumber)}`,
            {
              headers: {
                'Authorization': `Bearer ${retellApiKey}`,
                'Content-Type': 'application/json'
              },
              timeout: 30000
            }
          );
          results.retell.success = true;
          Logger.info('Phone number deleted from Retell', { phoneNumber });
        } catch (retellError) {
          Logger.error('Failed to delete phone number from Retell', {
            phoneNumber,
            error: retellError.message,
            response: retellError.response?.data
          });
          results.retell.error = retellError.message;
        }
      } else {
        results.retell.skipped = true;
        results.retell.reason = 'Retell API key not configured';
      }

      // Delete from Twilio
      try {
        const twilioCredentials = await this.getTwilioCredentials(subaccountId);
        const client = twilio(twilioCredentials.accountSid, twilioCredentials.authToken);

        // Get the phone number SID
        const incomingNumbers = await client.incomingPhoneNumbers.list({
          phoneNumber: phoneNumber
        });

        if (incomingNumbers.length > 0) {
          const phoneNumberSid = incomingNumbers[0].sid;
          await client.incomingPhoneNumbers(phoneNumberSid).remove();
          results.twilio.success = true;
          Logger.info('Phone number deleted from Twilio', { phoneNumber });
        } else {
          results.twilio.skipped = true;
          results.twilio.reason = 'Phone number not found in Twilio';
          Logger.warn('Phone number not found in Twilio', { phoneNumber });
        }
      } catch (twilioError) {
        Logger.error('Failed to delete phone number from Twilio', {
          phoneNumber,
          error: twilioError.message
        });
        results.twilio.error = twilioError.message;
      }

      // Delete from MongoDB
      try {
        const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
        const { connection } = connectionInfo;
        const phoneNumbersCollection = connection.db.collection('phonenumbers');

        const deleteResult = await phoneNumbersCollection.deleteOne({
          subaccountId,
          phone_number: phoneNumber
        });

        results.mongodb.success = deleteResult.deletedCount > 0;
        results.mongodb.deletedCount = deleteResult.deletedCount;
        Logger.info('Phone number deleted from MongoDB', {
          phoneNumber,
          deletedCount: deleteResult.deletedCount
        });
      } catch (mongoError) {
        Logger.error('Failed to delete phone number from MongoDB', {
          phoneNumber,
          error: mongoError.message
        });
        results.mongodb.error = mongoError.message;
      }

      return {
        phoneNumber,
        results,
        success: results.retell.success || results.twilio.success || results.mongodb.success
      };
    } catch (error) {
      Logger.error('Failed to delete phone number', {
        subaccountId,
        phoneNumber,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
}

// Singleton instance
const twilioService = new TwilioService();

module.exports = twilioService;

