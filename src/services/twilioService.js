const twilio = require('twilio');
const axios = require('axios');
const crypto = require('crypto');
const config = require('../../config/config');
const Logger = require('../utils/logger');
const redisService = require('./redisService');
const connectionPoolManager = require('./connectionPoolManager');
const encryptionService = require('./encryptionService');

class TwilioService {
  constructor() {
    this.clients = new Map(); // Cache for Twilio client instances
    
    // Map phone country codes to ISO country codes
    // This allows users to pass phone country codes (e.g., 44) instead of ISO codes (e.g., GB)
    this.phoneCountryCodeToISO = {
      '1': 'US',      // North America (US/Canada)
      '7': 'RU',      // Russia/Kazakhstan
      '20': 'EG',     // Egypt
      '27': 'ZA',     // South Africa
      '30': 'GR',     // Greece
      '31': 'NL',     // Netherlands
      '32': 'BE',     // Belgium
      '33': 'FR',     // France
      '34': 'ES',     // Spain
      '36': 'HU',     // Hungary
      '39': 'IT',     // Italy
      '40': 'RO',     // Romania
      '41': 'CH',     // Switzerland
      '43': 'AT',     // Austria
      '44': 'GB',     // United Kingdom
      '45': 'DK',     // Denmark
      '46': 'SE',     // Sweden
      '47': 'NO',     // Norway
      '48': 'PL',     // Poland
      '49': 'DE',     // Germany
      '51': 'PE',     // Peru
      '52': 'MX',     // Mexico
      '53': 'CU',     // Cuba
      '54': 'AR',     // Argentina
      '55': 'BR',     // Brazil
      '56': 'CL',     // Chile
      '57': 'CO',     // Colombia
      '58': 'VE',     // Venezuela
      '60': 'MY',     // Malaysia
      '61': 'AU',     // Australia
      '62': 'ID',     // Indonesia
      '63': 'PH',     // Philippines
      '64': 'NZ',     // New Zealand
      '65': 'SG',     // Singapore
      '66': 'TH',     // Thailand
      '81': 'JP',     // Japan
      '82': 'KR',     // South Korea
      '84': 'VN',     // Vietnam
      '86': 'CN',     // China
      '90': 'TR',     // Turkey
      '91': 'IN',     // India
      '92': 'PK',     // Pakistan
      '93': 'AF',     // Afghanistan
      '94': 'LK',     // Sri Lanka
      '95': 'MM',     // Myanmar
      '98': 'IR',     // Iran
      '212': 'MA',    // Morocco
      '213': 'DZ',    // Algeria
      '216': 'TN',    // Tunisia
      '218': 'LY',    // Libya
      '220': 'GM',    // Gambia
      '221': 'SN',    // Senegal
      '222': 'MR',    // Mauritania
      '223': 'ML',    // Mali
      '224': 'GN',    // Guinea
      '225': 'CI',    // Côte d'Ivoire
      '226': 'BF',    // Burkina Faso
      '227': 'NE',    // Niger
      '228': 'TG',    // Togo
      '229': 'BJ',    // Benin
      '230': 'MU',    // Mauritius
      '231': 'LR',    // Liberia
      '232': 'SL',    // Sierra Leone
      '233': 'GH',    // Ghana
      '234': 'NG',    // Nigeria
      '235': 'TD',    // Chad
      '236': 'CF',    // Central African Republic
      '237': 'CM',    // Cameroon
      '238': 'CV',    // Cape Verde
      '239': 'ST',    // São Tomé and Príncipe
      '240': 'GQ',    // Equatorial Guinea
      '241': 'GA',    // Gabon
      '242': 'CG',    // Republic of the Congo
      '243': 'CD',    // Democratic Republic of the Congo
      '244': 'AO',    // Angola
      '245': 'GW',    // Guinea-Bissau
      '246': 'IO',    // British Indian Ocean Territory
      '248': 'SC',    // Seychelles
      '249': 'SD',    // Sudan
      '250': 'RW',    // Rwanda
      '251': 'ET',    // Ethiopia
      '252': 'SO',    // Somalia
      '253': 'DJ',    // Djibouti
      '254': 'KE',    // Kenya
      '255': 'TZ',    // Tanzania
      '256': 'UG',    // Uganda
      '257': 'BI',    // Burundi
      '258': 'MZ',    // Mozambique
      '260': 'ZM',    // Zambia
      '261': 'MG',    // Madagascar
      '262': 'RE',    // Réunion / Mayotte
      '263': 'ZW',    // Zimbabwe
      '264': 'NA',    // Namibia
      '265': 'MW',    // Malawi
      '266': 'LS',    // Lesotho
      '267': 'BW',    // Botswana
      '268': 'SZ',    // Eswatini
      '269': 'KM',    // Comoros
      '290': 'SH',    // Saint Helena
      '291': 'ER',    // Eritrea
      '297': 'AW',    // Aruba
      '298': 'FO',    // Faroe Islands
      '299': 'GL',    // Greenland
      '350': 'GI',    // Gibraltar
      '351': 'PT',    // Portugal
      '352': 'LU',    // Luxembourg
      '353': 'IE',    // Ireland
      '354': 'IS',    // Iceland
      '355': 'AL',    // Albania
      '356': 'MT',    // Malta
      '357': 'CY',    // Cyprus
      '358': 'FI',    // Finland
      '359': 'BG',    // Bulgaria
      '370': 'LT',    // Lithuania
      '371': 'LV',    // Latvia
      '372': 'EE',    // Estonia
      '373': 'MD',    // Moldova
      '374': 'AM',    // Armenia
      '375': 'BY',    // Belarus
      '376': 'AD',    // Andorra
      '377': 'MC',    // Monaco
      '378': 'SM',    // San Marino
      '380': 'UA',    // Ukraine
      '381': 'RS',    // Serbia
      '382': 'ME',    // Montenegro
      '383': 'XK',    // Kosovo
      '385': 'HR',    // Croatia
      '386': 'SI',    // Slovenia
      '387': 'BA',    // Bosnia and Herzegovina
      '389': 'MK',    // North Macedonia
      '420': 'CZ',    // Czech Republic
      '421': 'SK',    // Slovakia
      '423': 'LI',    // Liechtenstein
      '500': 'FK',    // Falkland Islands
      '501': 'BZ',    // Belize
      '502': 'GT',    // Guatemala
      '503': 'SV',    // El Salvador
      '504': 'HN',    // Honduras
      '505': 'NI',    // Nicaragua
      '506': 'CR',    // Costa Rica
      '507': 'PA',    // Panama
      '508': 'PM',    // Saint Pierre and Miquelon
      '509': 'HT',    // Haiti
      '590': 'BL',    // Saint Barthélemy
      '591': 'BO',    // Bolivia
      '592': 'GY',    // Guyana
      '593': 'EC',    // Ecuador
      '594': 'GF',    // French Guiana
      '595': 'PY',    // Paraguay
      '596': 'MQ',    // Martinique
      '597': 'SR',    // Suriname
      '598': 'UY',    // Uruguay
      '599': 'CW',    // Curaçao / Caribbean Netherlands
      '670': 'TL',    // East Timor
      '672': 'AQ',    // Australian External Territories
      '673': 'BN',    // Brunei
      '674': 'NR',    // Nauru
      '675': 'PG',    // Papua New Guinea
      '676': 'TO',    // Tonga
      '677': 'SB',    // Solomon Islands
      '678': 'VU',    // Vanuatu
      '679': 'FJ',    // Fiji
      '680': 'PW',    // Palau
      '681': 'WF',    // Wallis and Futuna
      '682': 'CK',    // Cook Islands
      '683': 'NU',    // Niue
      '685': 'WS',    // Samoa
      '686': 'KI',    // Kiribati
      '687': 'NC',    // New Caledonia
      '688': 'TV',    // Tuvalu
      '689': 'PF',    // French Polynesia
      '850': 'KP',    // North Korea
      '852': 'HK',    // Hong Kong
      '853': 'MO',    // Macau
      '855': 'KH',    // Cambodia
      '856': 'LA',    // Laos
      '880': 'BD',    // Bangladesh
      '886': 'TW',    // Taiwan
      '960': 'MV',    // Maldives
      '961': 'LB',    // Lebanon
      '962': 'JO',    // Jordan
      '963': 'SY',    // Syria
      '964': 'IQ',    // Iraq
      '965': 'KW',    // Kuwait
      '966': 'SA',    // Saudi Arabia
      '967': 'YE',    // Yemen
      '968': 'OM',    // Oman
      '970': 'PS',    // Palestine
      '971': 'AE',    // United Arab Emirates
      '972': 'IL',    // Israel
      '973': 'BH',    // Bahrain
      '974': 'QA',    // Qatar
      '975': 'BT',    // Bhutan
      '976': 'MN',    // Mongolia
      '977': 'NP',    // Nepal
      '992': 'TJ',    // Tajikistan
      '993': 'TM',    // Turkmenistan
      '994': 'AZ',    // Azerbaijan
      '995': 'GE',    // Georgia
      '996': 'KG',    // Kyrgyzstan
      '998': 'UZ'     // Uzbekistan
    };
  }

  /**
   * Normalize country code and area code parameters
   * Converts phone country codes to ISO codes automatically
   * @param {string} countryCode - ISO country code or phone country code
   * @param {string|number} areaCode - Area code or potentially a phone country code
   * @returns {Object} { countryCode: ISO code, areaCode: normalized area code, wasConverted: boolean }
   */
  normalizeCountryAndAreaCode(countryCode, areaCode) {
    let normalizedCountryCode = countryCode;
    let normalizedAreaCode = areaCode;
    let wasConverted = false;
    const originalCountryCode = countryCode;
    const originalAreaCode = areaCode;

    // Convert countryCode if it's a phone country code (numeric string)
    if (countryCode && /^\d+$/.test(String(countryCode))) {
      const isoCode = this.phoneCountryCodeToISO[String(countryCode)];
      if (isoCode) {
        normalizedCountryCode = isoCode;
        wasConverted = true;
        Logger.debug('Converted phone country code to ISO', {
          phoneCode: countryCode,
          isoCode: isoCode
        });
      }
    }

    // If areaCode is provided, check if it's actually a phone country code
    // This handles cases like: countryCode=US&areaCode=44 (should be countryCode=GB)
    if (areaCode) {
      const areaCodeStr = String(areaCode).trim();
      
      // Check if areaCode matches a phone country code
      const isoFromAreaCode = this.phoneCountryCodeToISO[areaCodeStr];
      
      if (isoFromAreaCode) {
        // If countryCode is US/CA or not set, and areaCode is a phone country code,
        // treat areaCode as the country code
        if (!countryCode || countryCode === 'US' || countryCode === 'CA') {
          // Special case: if areaCode is "1", it's US/CA, so keep it as areaCode
          if (areaCodeStr === '1') {
            normalizedCountryCode = 'US';
            normalizedAreaCode = null; // Remove areaCode since 1 is the country code
            wasConverted = true;
          } else {
            // areaCode is actually a phone country code, use it as countryCode
            normalizedCountryCode = isoFromAreaCode;
            normalizedAreaCode = null; // Clear areaCode since it was actually a country code
            wasConverted = true;
            Logger.debug('Detected phone country code in areaCode parameter', {
              originalAreaCode: areaCode,
              convertedToCountryCode: isoFromAreaCode
            });
          }
        } else if (normalizedCountryCode === 'US' || normalizedCountryCode === 'CA') {
          // If we still have US/CA and areaCode is a phone country code, convert it
          if (areaCodeStr !== '1') {
            normalizedCountryCode = isoFromAreaCode;
            normalizedAreaCode = null;
            wasConverted = true;
            Logger.debug('Converted areaCode (phone country code) to countryCode', {
              originalAreaCode: areaCode,
              convertedToCountryCode: isoFromAreaCode
            });
          }
        }
      }
    }

    return {
      countryCode: normalizedCountryCode,
      areaCode: normalizedAreaCode,
      wasConverted,
      originalCountryCode,
      originalAreaCode
    };
  }

  /**
   * Encrypt credentials before storing in database
   * Uses generic encryption service for consistency
   * @param {string} credential - The credential to encrypt
   * @returns {Object} { encrypted, iv, authTag }
   */
  encryptCredential(credential) {
    try {
      return encryptionService.encryptField(credential, 'twilio');
    } catch (error) {
      Logger.error('Failed to encrypt Twilio credential', { error: error.message });
      throw new Error('Failed to encrypt credential: ' + error.message);
    }
  }

  /**
   * Decrypt credentials
   * Uses generic encryption service for consistency
   * @param {string} encrypted - The encrypted value
   * @param {string} iv - The initialization vector
   * @param {string} authTag - The authentication tag
   * @returns {string} Decrypted credential
   */
  decryptCredential(encrypted, iv, authTag) {
    try {
      return encryptionService.decryptField(encrypted, iv, authTag, 'twilio');
    } catch (error) {
      Logger.error('Failed to decrypt Twilio credential', { error: error.message });
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
      
      // Determine which field name is used to get correct IV/AuthTag field names
      const sidFieldName = twilioConnector.config.SID ? 'SID' : 'accountSid';
      const tokenFieldName = twilioConnector.config.AuthToken ? 'AuthToken' : 'authToken';
      
      // Get IV and AuthTag from document-level metadata (new structure), config.metadata, or config root (backward compatibility)
      const documentMetadata = twilioConnector.metadata || {};
      const configMetadata = twilioConnector.config.metadata || {};
      
      // Try document metadata first, then config.metadata, then config root for backward compatibility
      const sidIV = documentMetadata[`${sidFieldName}IV`] || 
                    configMetadata[`${sidFieldName}IV`] || 
                    twilioConnector.config[`${sidFieldName}IV`] || 
                    twilioConnector.config.sidIV;
      const sidAuthTag = documentMetadata[`${sidFieldName}AuthTag`] || 
                         configMetadata[`${sidFieldName}AuthTag`] || 
                         twilioConnector.config[`${sidFieldName}AuthTag`] || 
                         twilioConnector.config.sidAuthTag;
      const tokenIV = documentMetadata[`${tokenFieldName}IV`] || 
                      configMetadata[`${tokenFieldName}IV`] || 
                      twilioConnector.config[`${tokenFieldName}IV`] || 
                      twilioConnector.config.tokenIV;
      const tokenAuthTag = documentMetadata[`${tokenFieldName}AuthTag`] || 
                           configMetadata[`${tokenFieldName}AuthTag`] || 
                           twilioConnector.config[`${tokenFieldName}AuthTag`] || 
                           twilioConnector.config.tokenAuthTag;

      Logger.debug('Twilio config retrieved from database', {
        subaccountId,
        hasSID: !!twilioConnector.config.SID,
        hasAccountSid: !!twilioConnector.config.accountSid,
        hasAuthToken: !!twilioConnector.config.AuthToken,
        hasauthToken: !!twilioConnector.config.authToken,
        sidFieldName,
        tokenFieldName,
        hasSidIV: !!sidIV,
        hasSidAuthTag: !!sidAuthTag,
        hasTokenIV: !!tokenIV,
        hasTokenAuthTag: !!tokenAuthTag,
        sidFieldLength: sidField ? sidField.length : 0,
        sidFieldPrefix: sidField ? sidField.substring(0, 4) : 'null'
      });

      if (!sidField || !tokenField) {
        throw new Error('Twilio credentials not configured properly');
      }

      // Decrypt credentials if they are encrypted
      let accountSid = sidField;
      let authToken = tokenField;

      // Check if credentials are encrypted (try both naming conventions)
      if (sidIV && sidAuthTag) {
        try {
          accountSid = this.decryptCredential(
            sidField,
            sidIV,
            sidAuthTag
          );
          
          Logger.debug('Twilio SID decrypted successfully', { subaccountId });
        } catch (error) {
          Logger.error('Failed to decrypt Twilio SID', {
            subaccountId,
            error: error.message,
            errorCode: error.code,
            sidFieldName,
            hasSidIV: !!sidIV,
            hasSidAuthTag: !!sidAuthTag,
            sidIVLength: sidIV ? sidIV.length : 0,
            sidAuthTagLength: sidAuthTag ? sidAuthTag.length : 0
          });
          
          // Provide more helpful error message
          if (error.message.includes('Unsupported state') || error.message.includes('bad decrypt')) {
            throw new Error('Failed to decrypt Twilio SID. The encryption key may have changed or the data is corrupted. Please reconfigure your Twilio credentials.');
          }
          throw new Error('Failed to decrypt Twilio SID: ' + error.message);
        }
      }

      if (tokenIV && tokenAuthTag) {
        try {
          authToken = this.decryptCredential(
            tokenField,
            tokenIV,
            tokenAuthTag
          );

          Logger.debug('Twilio AuthToken decrypted successfully', { subaccountId });
        } catch (error) {
          Logger.error('Failed to decrypt Twilio AuthToken', {
            subaccountId,
            error: error.message,
            errorCode: error.code,
            tokenFieldName
          });
          
          // Provide more helpful error message
          if (error.message.includes('Unsupported state') || error.message.includes('bad decrypt')) {
            throw new Error('Failed to decrypt Twilio AuthToken. The encryption key may have changed or the data is corrupted. Please reconfigure your Twilio credentials.');
          }
          throw new Error('Failed to decrypt Twilio AuthToken: ' + error.message);
        }
      }

      // Validate the decrypted accountSid format
      if (!accountSid || !accountSid.startsWith('AC')) {
        const documentMetadata = twilioConnector.metadata || {};
        const configMetadata = twilioConnector.config.metadata || {};
        const hasEncryptionInDocumentMetadata = !!(documentMetadata.sidIV && documentMetadata.sidAuthTag);
        const hasEncryptionInConfigMetadata = !!(configMetadata.sidIV && configMetadata.sidAuthTag);
        const hasEncryptionInConfig = !!(twilioConnector.config.sidIV && twilioConnector.config.sidAuthTag);
        
        Logger.error('Invalid Twilio accountSid after decryption', {
          subaccountId,
          accountSidLength: accountSid ? accountSid.length : 0,
          accountSidPrefix: accountSid ? accountSid.substring(0, 2) : 'null',
          hasEncryption: hasEncryptionInDocumentMetadata || hasEncryptionInConfigMetadata || hasEncryptionInConfig,
          encryptionLocation: hasEncryptionInDocumentMetadata ? 'document.metadata' : 
                             (hasEncryptionInConfigMetadata ? 'config.metadata' : 
                             (hasEncryptionInConfig ? 'config' : 'none'))
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
   * Each subaccount gets its own trunk for full isolation
   */
  async fetchOrCreateTrunk(subaccountId) {
    try {
      const client = await this.getTwilioClient(subaccountId);
      
      Logger.info('Fetching existing trunks for subaccount', { subaccountId });
      
      // Fetch all trunks
      const trunks = await client.trunking.v1.trunks.list();
      
      // Generate subaccount-specific trunk prefix for isolation
      const subaccountPrefix = `scalai_${subaccountId.slice(0, 8)}`;
      
      // First, check database for stored trunk mapping (most reliable)
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
      const { connection } = connectionInfo;
      
      const twilioConnector = await connection.db.collection('connectorsubaccount').findOne({
        subaccountId,
        connectorType: 'twilio'
      });
      
      const storedTrunkSid = twilioConnector?.metadata?.retellIntegration?.trunkSid;
      
      let scalaiTrunk = null;
      
      // If we have a stored trunk SID, try to find it by SID (most accurate)
      if (storedTrunkSid) {
        scalaiTrunk = trunks.find(trunk => trunk.sid === storedTrunkSid);
        
        if (scalaiTrunk) {
          Logger.info('Found trunk by stored SID from database', {
            subaccountId,
            trunkSid: storedTrunkSid,
            friendlyName: scalaiTrunk.friendlyName
          });
        } else {
          Logger.warn('Stored trunk SID not found in Twilio - trunk may have been deleted', {
            subaccountId,
            storedTrunkSid
          });
        }
      }
      
      // If not found by SID, search by subaccount-specific prefix
      if (!scalaiTrunk) {
        scalaiTrunk = trunks.find(trunk => 
          trunk.friendlyName.startsWith(subaccountPrefix)
        );
        
        if (scalaiTrunk) {
          Logger.info('Found trunk by subaccount prefix', {
            subaccountId,
            subaccountPrefix,
            trunkSid: scalaiTrunk.sid,
            friendlyName: scalaiTrunk.friendlyName
          });
        }
      }
      
      // Backward compatibility: If still not found, check for old naming scheme (no subaccount ID)
      // But ONLY if this is the only "scalai" trunk (to avoid conflicts)
      if (!scalaiTrunk) {
        const oldStyleTrunks = trunks.filter(trunk => 
          trunk.friendlyName.startsWith('scalai') && 
          !trunk.friendlyName.match(/^scalai_[a-f0-9]{8}_/)
        );
        
        if (oldStyleTrunks.length === 1) {
          scalaiTrunk = oldStyleTrunks[0];
          Logger.warn('Found old-style trunk (no subaccount isolation) - consider migrating', {
            subaccountId,
            trunkSid: scalaiTrunk.sid,
            friendlyName: scalaiTrunk.friendlyName,
            migration: 'This trunk was created before subaccount isolation was implemented'
          });
        } else if (oldStyleTrunks.length > 1) {
          Logger.error('Multiple old-style trunks found - cannot determine which belongs to this subaccount', {
            subaccountId,
            oldStyleTrunkCount: oldStyleTrunks.length,
            oldStyleTrunks: oldStyleTrunks.map(t => ({ sid: t.sid, name: t.friendlyName }))
          });
        }
      }
      
      Logger.debug('Trunk search result', {
        subaccountId,
        subaccountPrefix,
        totalTrunks: trunks.length,
        foundSubaccountTrunk: !!scalaiTrunk,
        trunkSid: scalaiTrunk?.sid,
        trunkName: scalaiTrunk?.friendlyName
      });
      
      if (scalaiTrunk) {
        Logger.info('Found existing ScalAI trunk - using existing credentials', { 
          subaccountId, 
          trunkSid: scalaiTrunk.sid,
          friendlyName: scalaiTrunk.friendlyName 
        });

        // Get trunk's credential list from Twilio (don't recreate!)
        const credentialLists = await client.trunking.v1
          .trunks(scalaiTrunk.sid)
          .credentialLists
          .list();
        
        if (credentialLists.length === 0) {
          throw new Error('Trunk has no credential list. Please run Twilio setup again to create credentials.');
        }
        
        const credentialListSid = credentialLists[0].sid;
        Logger.debug('Found credential list for trunk', { 
          subaccountId, 
          credentialListSid 
        });
        
        // Get credentials from the credential list
        const credentials = await client.sip.credentialLists(credentialListSid)
          .credentials
          .list();
        
        if (credentials.length === 0) {
          throw new Error('Credential list has no credentials. Please run Twilio setup again.');
        }
        
        const existingCredential = credentials[0];
        const username = existingCredential.username;
        
        Logger.info('Using existing credential from Twilio', {
          subaccountId,
          username,
          credentialSid: existingCredential.sid
        });
        
        // The password is always '44pass$$scalAI' (we set this when creating)
        // Store it encrypted in the database
        const encryptionService = require('./encryptionService');
        const password = '44pass$$scalAI';
        const encryptedPassword = encryptionService.encryptField(password, 'twilio');
        
        // Get database connection to store encrypted credentials
        const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
        const { connection } = connectionInfo;
        
        // Store encrypted password AND trunk SID in database for future lookups
        await connection.db.collection('connectorsubaccount').updateOne(
          {
            subaccountId,
            connectorType: 'twilio'
          },
          {
            $set: {
              'metadata.retellIntegration.trunkSid': scalaiTrunk.sid,
              'metadata.retellIntegration.trunkFriendlyName': scalaiTrunk.friendlyName,
              'metadata.retellIntegration.sipCredentials': {
                username: username,
                password: encryptedPassword.encrypted,
                passwordIV: encryptedPassword.iv,
                passwordAuthTag: encryptedPassword.authTag
              },
              updatedAt: new Date()
            }
          }
        );
        
        Logger.info('Encrypted credentials and trunk mapping stored in database', {
          subaccountId,
          trunkSid: scalaiTrunk.sid,
          username,
          encrypted: true
        });
        
        // Fetch termination config
        const terminationConfig = await this.setupTermination(subaccountId, scalaiTrunk.sid);

        return {
          ...scalaiTrunk,
          terminationConfig,
          credentials: {
            username: username,
            password: password  // Return plain password for use (not encrypted)
          }
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
   * Trunk name includes subaccount ID for full isolation
   */
  async createTrunk(subaccountId) {
    let trunk;
    try {
      const client = await this.getTwilioClient(subaccountId);
      
      // Generate subaccount-specific trunk name for isolation
      // Format: scalai_{first_8_chars_of_subaccount}_{random}
      const subaccountPrefix = subaccountId.slice(0, 8);
      const randomSuffix = Math.random().toString(36).substr(2, 6);
      const friendlyName = `scalai_${subaccountPrefix}_${randomSuffix}`;
      
      // Domain name should be valid (no underscores)
      const domainName = `scalai${subaccountPrefix}${randomSuffix}.pstn.twilio.com`;
      
      Logger.info('Creating new SIP trunk with subaccount isolation', { 
        subaccountId, 
        friendlyName,
        domainName,
        subaccountPrefix
      });
      
      // Create the trunk
      trunk = await client.trunking.v1.trunks.create({
        friendlyName,
        transferMode: 'enable-all',
        domainName,
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
        // Pass trunk friendly name so username matches the trunk (NOT hardcoded!)
        const credentialResult = await this.fetchOrCreateCredentialList(subaccountId, true, trunk.friendlyName);

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
  async fetchOrCreateCredentialList(subaccountId, forceRecreate = false, trunkFriendlyName = null) {
    try {
      const client = await this.getTwilioClient(subaccountId);
      
      Logger.info('Fetching credential lists', { subaccountId, forceRecreate, trunkFriendlyName });
      
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
        
        // Get ALL credentials from the list (don't search for hardcoded username!)
        const credentials = await client.sip.credentialLists(scalaiCredentialList.sid)
          .credentials
          .list();
        
        // Use the FIRST credential if any exist (don't assume username)
        const existingCredential = credentials.length > 0 ? credentials[0] : null;

        if (existingCredential) {
          // If we need a new password (forceRecreate), delete and recreate the credential
          if (forceRecreate) {
            const existingUsername = existingCredential.username;
            
            Logger.info('Deleting existing credential to create new one with known password', {
              subaccountId,
              credentialListSid: scalaiCredentialList.sid,
              existingUsername
            });
            
            try {
              await client.sip.credentialLists(scalaiCredentialList.sid)
                .credentials(existingCredential.sid)
                .remove();
              
              Logger.info('Existing credential deleted', { 
                subaccountId,
                username: existingUsername 
              });
            } catch (deleteError) {
              Logger.warn('Failed to delete existing credential, will create new one anyway', {
                subaccountId,
                error: deleteError.message
              });
            }
            
            // CRITICAL: Recreate with the SAME username (not a new one!)
            // Use existing username if we have it, otherwise generate from trunk name
            const usernameForRecreate = existingUsername || trunkFriendlyName;
            
            Logger.info('Recreating credential with existing username', {
              subaccountId,
              username: usernameForRecreate,
              preservingExisting: !!existingUsername
            });
            
            const newCredential = await this.createCredential(
              subaccountId, 
              scalaiCredentialList.sid, 
              usernameForRecreate,
              true  // preserveUsername flag
            );
            
            return {
              credentialList: scalaiCredentialList,
              credential: newCredential
            };
          }
          
          // Return existing credential with fixed password (since Twilio doesn't return it)
          Logger.info('Existing credential found, using fixed password', { 
            subaccountId,
            username: existingCredential.username 
          });
          return {
            credentialList: scalaiCredentialList,
            credential: {
              ...existingCredential,
              password: '44pass$$scalAI' // Use fixed password for existing credentials
            }
          };
        }

        // If no credential found, create one
        const credential = await this.createCredential(subaccountId, scalaiCredentialList.sid, trunkFriendlyName);
        return {
          credentialList: scalaiCredentialList,
          credential
        };
      }

      // If no credential list found, create new one with credential
      Logger.info('Creating new credential list', { subaccountId, trunkFriendlyName });
      return await this.createCredentialList(subaccountId, trunkFriendlyName);
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
  async createCredentialList(subaccountId, trunkFriendlyName = null) {
    try {
      const client = await this.getTwilioClient(subaccountId);
      
      // Generate friendly name with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const friendlyName = `scalai_cl_${timestamp}`;
      
      Logger.info('Creating credential list', { subaccountId, friendlyName, trunkFriendlyName });
      
      // Create a new credential list
      const credentialList = await client.sip.credentialLists.create({
        friendlyName
      });

      // Create credential in the list with dynamic username based on trunk
      const credential = await this.createCredential(subaccountId, credentialList.sid, trunkFriendlyName);

      Logger.info('Credential list created successfully', { 
        subaccountId, 
        credentialListSid: credentialList.sid,
        username: credential.username
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
   * Username is dynamically generated based on trunk, NOT hardcoded
   */
  async createCredential(subaccountId, credentialListSid, trunkFriendlyName = null, preserveUsername = false) {
    try {
      const client = await this.getTwilioClient(subaccountId);
      
      Logger.info('Creating credential', { subaccountId, credentialListSid, trunkFriendlyName, preserveUsername });
      
      // Use fixed password for consistency
      const password = '44pass$$scalAI';
      
      let username;
      
      // If preserveUsername is true, use the trunkFriendlyName AS-IS (it's the existing username)
      if (preserveUsername && trunkFriendlyName) {
        username = trunkFriendlyName;  // This is actually the existing username!
        Logger.info('Preserving existing username', {
          subaccountId,
          username
        });
      } else {
        // Generate username based on trunk name (NOT hardcoded!)
        // Use trunk friendly name if provided, otherwise use subaccount ID
        username = trunkFriendlyName 
          ? `${trunkFriendlyName.replace(/[^a-zA-Z0-9]/g, '_')}_user`
          : `scalai_${subaccountId.slice(0, 8)}_user`;
        
        Logger.info('Creating SIP credential with dynamic username', {
          subaccountId,
          username,
          source: trunkFriendlyName ? 'trunk_name' : 'subaccount_id'
        });
      }
      
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

      // Don't use cache - always fetch fresh data from Twilio
      const cacheKey = `twilio:phoneNumbers:${subaccountId}`;
      
      // Clear any existing cache to ensure fresh data
      try {
        await redisService.del(cacheKey);
        Logger.debug('Cleared cached phone numbers', { subaccountId });
      } catch (cacheError) {
        Logger.warn('Failed to clear cache (non-critical)', {
          subaccountId,
          error: cacheError.message
        });
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
      // Fetch with full details to get locality and country information
      const phoneNumbers = await client.incomingPhoneNumbers.list({ limit: 1000 });

      // Filter out numbers linked to ANY trunk (only show unassigned numbers)
      const availableNumbers = phoneNumbers.filter(number => {
        // Include only if number is NOT connected to any trunk
        return !number.trunkSid || number.trunkSid === null || number.trunkSid === '';
      });

      // Fetch detailed information for each number to get locality and country code
      // Note: Twilio's list() may not include all fields, so we use Lookup API for locality/country
      const phoneNumbersWithDetails = await Promise.all(
        availableNumbers.map(async (number) => {
          try {
            let locality = null;
            let countryCode = null;
            let region = null;

            // Fetch individual phone number details (may include locality/country)
            try {
              const fullDetails = await client.incomingPhoneNumbers(number.sid).fetch();
              locality = fullDetails.locality || null;
              countryCode = fullDetails.isoCountry || null;
              region = fullDetails.region || null;
            } catch (fetchError) {
              // Individual fetch may not include locality/country, continue to Lookup API
            }

            // If we don't have locality/country from individual fetch, use Lookup API
            if (!locality || !countryCode) {
              try {
                // Use Lookup API v1 for country code (most reliable)
                const lookupResult = await client.lookups.v1
                  .phoneNumbers(number.phoneNumber)
                  .fetch();
                
                if (!countryCode) {
                  countryCode = lookupResult.countryCode || null;
                }
              } catch (lookupV1Error) {
                Logger.debug('Lookup API v1 failed', {
                  phoneNumber: number.phoneNumber,
                  error: lookupV1Error.message
                });
              }

              // Try Lookup API v2 for locality and region (if available)
              if (!locality) {
                try {
                  const lookupV2Result = await client.lookups.v2
                    .phoneNumbers(number.phoneNumber)
                    .fetch();
                  
                  locality = lookupV2Result.locality || null;
                  region = lookupV2Result.region || null;
                  
                  // Use v2 countryCode if we still don't have it
                  if (!countryCode) {
                    countryCode = lookupV2Result.countryCode || null;
                  }
                } catch (lookupV2Error) {
                  Logger.debug('Lookup API v2 failed', {
                    phoneNumber: number.phoneNumber,
                    error: lookupV2Error.message
                  });
                }
              }
            }

            // Fallback: Extract country code from phone number if Lookup APIs failed
            if (!countryCode) {
              const phoneStr = number.phoneNumber.replace(/[^0-9+]/g, '');
              if (phoneStr.startsWith('+1')) {
                countryCode = 'US';
              } else if (phoneStr.startsWith('+44')) {
                countryCode = 'GB';
              } else if (phoneStr.startsWith('+')) {
                // Map common country codes
                const countryCodeMap = {
                  '+1': 'US',
                  '+44': 'GB',
                  '+33': 'FR',
                  '+49': 'DE',
                  '+39': 'IT',
                  '+34': 'ES',
                  '+31': 'NL',
                  '+32': 'BE',
                  '+41': 'CH',
                  '+43': 'AT',
                  '+61': 'AU',
                  '+81': 'JP',
                  '+86': 'CN',
                  '+91': 'IN',
                  '+55': 'BR',
                  '+52': 'MX'
                };
                // Check 2-digit prefixes first, then 3-digit
                const prefix2 = phoneStr.substring(0, 2);
                const prefix3 = phoneStr.substring(0, 3);
                countryCode = countryCodeMap[prefix2] || countryCodeMap[prefix3] || null;
              }
            }

            return {
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
              dateUpdated: number.dateUpdated,
              locality: locality,
              region: region,
              countryCode: countryCode
            };
          } catch (error) {
            Logger.warn('Failed to fetch details for phone number', {
              sid: number.sid,
              phoneNumber: number.phoneNumber,
              error: error.message
            });
            // Fallback to basic info if detailed fetch fails
            // Try to extract country code from phone number
            let countryCode = null;
            const phoneStr = number.phoneNumber.replace(/[^0-9+]/g, '');
            if (phoneStr.startsWith('+1')) {
              countryCode = 'US';
            } else if (phoneStr.startsWith('+44')) {
              countryCode = 'GB';
            } else if (phoneStr.startsWith('+')) {
              // Map common country codes
              const countryCodeMap = {
                '+1': 'US',
                '+44': 'GB',
                '+33': 'FR',
                '+49': 'DE',
                '+39': 'IT',
                '+34': 'ES',
                '+31': 'NL',
                '+32': 'BE',
                '+41': 'CH',
                '+43': 'AT',
                '+61': 'AU',
                '+81': 'JP',
                '+86': 'CN',
                '+91': 'IN',
                '+55': 'BR',
                '+52': 'MX'
              };
              // Check 2-digit prefixes first, then 3-digit
              const prefix2 = phoneStr.substring(0, 2);
              const prefix3 = phoneStr.substring(0, 3);
              countryCode = countryCodeMap[prefix2] || countryCodeMap[prefix3] || null;
            }

            return {
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
              dateUpdated: number.dateUpdated,
              locality: null,
              region: null,
              countryCode: countryCode
            };
          }
        })
      );

      const result = {
        phoneNumbers: phoneNumbersWithDetails,
        total: availableNumbers.length,
        trunkLinkedCount: phoneNumbers.length - availableNumbers.length
      };

      // Don't cache - always return fresh data from Twilio
      // Cache was removed per user request to ensure real-time data

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
      let {
        countryCode = 'US',
        areaCode = null,
        contains = null,
        smsEnabled = undefined, // undefined = don't filter by SMS (more flexible)
        voiceEnabled = undefined, // undefined = don't filter by Voice (more flexible)
        mmsEnabled = undefined, // undefined = don't filter by MMS (more flexible)
        limit = 20,
        type = 'local' // 'local', 'mobile', 'tollFree', or 'all'
      } = options;

      // Normalize country code and area code (convert phone country codes to ISO codes)
      const normalized = this.normalizeCountryAndAreaCode(countryCode, areaCode);
      countryCode = normalized.countryCode;
      areaCode = normalized.areaCode;

      if (normalized.wasConverted) {
        Logger.info('Normalized country/area codes', {
          originalCountryCode: normalized.originalCountryCode,
          originalAreaCode: normalized.originalAreaCode,
          normalizedCountryCode: countryCode,
          normalizedAreaCode: areaCode
        });
      }

      Logger.info('Searching for available phone numbers', { 
        subaccountId, 
        countryCode,
        areaCode,
        contains 
      });

      // Validate areaCode BEFORE checking cache (to catch invalid requests early)
      if (areaCode) {
        // Convert to string for validation
        const areaCodeStr = String(areaCode).trim();
        
        Logger.debug('Validating area code', { 
          areaCode, 
          areaCodeStr, 
          countryCode,
          length: areaCodeStr.length 
        });
        
        // For US/Canada, area codes must be 3 digits and cannot start with 0 or 1
        if (countryCode === 'US' || countryCode === 'CA') {
          const isValidUSAreaCode = /^[2-9]\d{2}$/.test(areaCodeStr);
          Logger.debug('US area code validation', { 
            areaCodeStr, 
            isValidUSAreaCode,
            regexMatch: /^[2-9]\d{2}$/.test(areaCodeStr)
          });
          
          if (!isValidUSAreaCode) {
            // At this point, normalization should have already handled phone country codes
            // If we still have an invalid area code, it's truly invalid
            let errorMsg = `Invalid area code: ${areaCode}. US/Canada area codes must be 3 digits starting with 2-9 (e.g., 415, 212, 310)`;
            
            Logger.warn('Invalid area code provided', { areaCode, countryCode, errorMsg });
            
            // Clear any cached invalid result for this area code
            const invalidCacheKey = `twilio:available:${subaccountId}:${countryCode}:${areaCode}:${contains || 'any'}:${smsEnabled}:${voiceEnabled}:${mmsEnabled}:${limit}:${type || 'local'}`;
            await redisService.del(invalidCacheKey).catch(() => {
              // Ignore cache deletion errors
            });
            
            throw new Error(errorMsg);
          }
        }
        
        // For other countries, validate it's numeric
        if (countryCode !== 'US' && countryCode !== 'CA') {
          if (!/^\d+$/.test(areaCodeStr)) {
            throw new Error(`Invalid area code: ${areaCode}. Area code must be numeric`);
          }
        }
      }

      // Create cache key based on search parameters
      const cacheKey = `twilio:available:${subaccountId}:${countryCode}:${areaCode || 'any'}:${contains || 'any'}:${smsEnabled}:${voiceEnabled}:${mmsEnabled}:${limit}:${type || 'local'}`;
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

      if (areaCode) {
        // Use validated areaCode (convert to string/number as Twilio expects)
        searchParams.areaCode = String(areaCode).trim();
      }
      if (contains) searchParams.contains = contains;
      // Only add capability filters if explicitly set (true or false)
      // This allows finding numbers with any capabilities, matching Twilio UI behavior
      if (smsEnabled !== undefined) searchParams.smsEnabled = smsEnabled === true || smsEnabled === 'true';
      if (voiceEnabled !== undefined) searchParams.voiceEnabled = voiceEnabled === true || voiceEnabled === 'true';
      if (mmsEnabled !== undefined) searchParams.mmsEnabled = mmsEnabled === true || mmsEnabled === 'true';

      // Search for phone numbers based on type
      // Support: 'local', 'mobile', 'tollFree', or 'all' (searches all types)
      let availableNumbers = [];
      const numberTypes = type === 'all' ? ['local', 'mobile', 'tollFree'] : [type];
      
      for (const numberType of numberTypes) {
        try {
          let numbers;
          switch (numberType) {
            case 'local':
              numbers = await client.availablePhoneNumbers(countryCode)
                .local
                .list(searchParams);
              break;
            case 'mobile':
              numbers = await client.availablePhoneNumbers(countryCode)
                .mobile
                .list(searchParams);
              break;
            case 'tollFree':
              numbers = await client.availablePhoneNumbers(countryCode)
                .tollFree
                .list(searchParams);
              break;
            default:
              Logger.warn('Unknown number type, defaulting to local', { numberType, countryCode });
              numbers = await client.availablePhoneNumbers(countryCode)
                .local
                .list(searchParams);
          }
          
          // Add type information to each number
          numbers.forEach(num => {
            num._numberType = numberType;
          });
          
          availableNumbers = availableNumbers.concat(numbers);
          
          // If we have enough numbers and not searching 'all', break early
          if (availableNumbers.length >= limit && type !== 'all') {
            break;
          }
        } catch (error) {
          // Some countries don't support all number types (e.g., mobile, tollFree)
          // Log but continue with other types
          Logger.debug(`Number type ${numberType} not available for ${countryCode}`, {
            error: error.message,
            countryCode,
            numberType
          });
        }
      }
      
      // Limit results to requested limit
      availableNumbers = availableNumbers.slice(0, limit);

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
          beta: number.beta,
          numberType: number._numberType || type
        })),
        total: availableNumbers.length,
        searchCriteria: {
          countryCode,
          areaCode,
          contains,
          smsEnabled,
          voiceEnabled,
          mmsEnabled,
          type
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
  /**
   * Import an existing Twilio phone number and complete all integration steps
   * (Skip purchase, do trunk registration, Retell import, MongoDB storage)
   */
  async importExistingPhoneNumber(subaccountId, phoneNumber) {
    try {
      Logger.info('Starting import of existing phone number', { 
        subaccountId, 
        phoneNumber 
      });

      const client = await this.getTwilioClient(subaccountId);

      // Step 1: Fetch the existing number from Twilio
      Logger.info('Step 1: Fetching existing phone number from Twilio', { phoneNumber });
      
      const existingNumbers = await client.incomingPhoneNumbers.list({ phoneNumber });
      
      if (!existingNumbers || existingNumbers.length === 0) {
        throw new Error(`Phone number ${phoneNumber} not found in Twilio account`);
      }

      const purchasedNumber = existingNumbers[0];
      
      Logger.info('Phone number found in Twilio', { 
        sid: purchasedNumber.sid,
        phoneNumber: purchasedNumber.phoneNumber,
        friendlyName: purchasedNumber.friendlyName
      });

      // Get connector info for emergency address and trunk (same as purchase flow)
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
      
      // Get decrypted SIP credentials
      let sipCredentials = await this.getDecryptedSipCredentials(subaccountId);

      if (!sipCredentials || !sipCredentials.username || !sipCredentials.password) {
        Logger.warn('SIP credentials missing, fetching from trunk', { subaccountId });
        const trunkResult = await this.fetchOrCreateTrunk(subaccountId);
        sipCredentials = trunkResult.credentials;
      }

      if (!emergencyAddressId) {
        throw new Error('Emergency address not configured. Please run Twilio setup first.');
      }

      if (!trunkSid) {
        throw new Error('SIP trunk not configured. Please run Twilio setup first.');
      }

      // Now run all the post-purchase integration steps
      return await this.completePhoneNumberIntegration(
        subaccountId,
        purchasedNumber,
        emergencyAddressId,
        trunkSid,
        terminationSipUri,
        sipCredentials,
        connection
      );

    } catch (error) {
      Logger.error('Failed to import existing phone number', {
        subaccountId,
        phoneNumber,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Complete phone number integration steps (used by both purchase and import)
   * Steps: Emergency address, trunk registration, Retell import, MongoDB storage
   */
  async completePhoneNumberIntegration(
    subaccountId,
    purchasedNumber,
    emergencyAddressId,
    trunkSid,
    terminationSipUri,
    sipCredentials,
    connection
  ) {
    const phoneNumber = purchasedNumber.phoneNumber;
    
    try {
      // Detect country code to determine if emergency address is needed
      const phoneStr = phoneNumber.replace(/[^0-9+]/g, '');
      let countryCode = 'US'; // default
      
      if (phoneStr.startsWith('+34')) {
        countryCode = 'ES'; // Spain
      } else if (phoneStr.startsWith('+44')) {
        countryCode = 'GB'; // UK
      } else if (phoneStr.startsWith('+1')) {
        countryCode = 'US'; // US/Canada
      } else if (phoneStr.startsWith('+')) {
        const phoneCode = phoneStr.substring(1, 3);
        const isoCode = this.phoneCountryCodeToISO[phoneCode] || this.phoneCountryCodeToISO[phoneStr.substring(1, 4)];
        if (isoCode) countryCode = isoCode;
      }
      
      // Countries that require emergency addresses
      const countriesRequiringEmergencyAddress = ['US', 'GB', 'CA', 'AU'];
      const requiresEmergencyAddress = countriesRequiringEmergencyAddress.includes(countryCode);
      
      // Step 2: Integrate with emergency address (only if required for this country)
      if (requiresEmergencyAddress && emergencyAddressId) {
        Logger.info('Step 2: Integrating with emergency address', { 
          numberSid: purchasedNumber.sid,
          emergencyAddressId,
          countryCode 
        });

        await this.integrateNumberWithEmergencyAddress(
          subaccountId, 
          purchasedNumber.sid, 
          emergencyAddressId
        );
      } else {
        Logger.info('Step 2: Skipping emergency address (not required for this country)', { 
          phoneNumber,
          countryCode,
          requiresEmergencyAddress
        });
      }

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
        Logger.warn('Retell import indicated failure but continuing', {
          phoneNumber,
          retellNumber
        });
      }

      // Step 5: Store in MongoDB
      Logger.info('Step 5: Storing phone number in MongoDB', { phoneNumber });

      const phoneNumbersCollection = connection.db.collection('phonenumbers');
      
      const phoneNumberDocument = {
        phone_number: phoneNumber,
        phone_number_id: retellNumber?.phone_number_id || null,
        sid: purchasedNumber.sid,
        friendlyName: purchasedNumber.friendlyName,
        subaccountId: subaccountId,
        trunkSid: trunkSid,
        emergencyAddressId: emergencyAddressId,
        retellImported: retellNumber?.imported || false,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await phoneNumbersCollection.updateOne(
        { phone_number: phoneNumber, subaccountId },
        { $set: phoneNumberDocument },
        { upsert: true }
      );

      Logger.info('Phone number integration completed successfully', {
        phoneNumber,
        sid: purchasedNumber.sid,
        retellImported: retellNumber?.imported || false
      });

      return {
        twilioNumber: purchasedNumber,
        retellNumber,
        mongoDocument: phoneNumberDocument
      };

    } catch (integrationError) {
      Logger.error('Phone number integration failed', {
        phoneNumber,
        sid: purchasedNumber.sid,
        error: integrationError.message,
        stack: integrationError.stack
      });
      throw integrationError;
    }
  }

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
      const bundleSid = twilioConnector.metadata?.retellIntegration?.bundleSid;
      const trunkSid = twilioConnector.metadata?.retellIntegration?.trunkSid;
      const terminationSipUri = twilioConnector.metadata?.retellIntegration?.terminationSipUri;
      
      // Get decrypted SIP credentials from database
      let sipCredentials = await this.getDecryptedSipCredentials(subaccountId);

      // If credentials are missing or incomplete, fetch from trunk (DON'T recreate!)
      if (!sipCredentials || !sipCredentials.username || !sipCredentials.password) {
        Logger.warn('SIP credentials missing or incomplete, fetching from existing Twilio trunk', {
          subaccountId,
          hasCredentials: !!sipCredentials,
          hasUsername: !!sipCredentials?.username,
          hasPassword: !!sipCredentials?.password
        });

        try {
          // Fetch existing trunk which will read credentials from Twilio and store encrypted
          const trunkResult = await this.fetchOrCreateTrunk(subaccountId);
          sipCredentials = trunkResult.credentials;

          Logger.info('Retrieved credentials from existing trunk', {
            subaccountId,
            username: sipCredentials.username,
            hasPassword: !!sipCredentials.password
          });
        } catch (credError) {
          Logger.error('Failed to fetch credentials from trunk', {
            subaccountId,
            error: credError.message
          });
          throw new Error(`Cannot purchase number: SIP credentials unavailable. Please run Twilio setup first.`);
        }
      } else {
        Logger.debug('Valid SIP credentials retrieved and decrypted', {
          subaccountId,
          username: sipCredentials.username,
          hasPassword: !!sipCredentials.password
        });
      }

      // Determine country code from phone number to check if bundle is required
      const phoneNumberStr = phoneNumber.replace(/[^0-9+]/g, '');
      let countryCode = 'US'; // default
      if (phoneNumberStr.startsWith('+44')) {
        countryCode = 'GB';
      } else if (phoneNumberStr.startsWith('+1')) {
        countryCode = 'US';
      } else if (phoneNumberStr.startsWith('+')) {
        // Try to detect country code
        const phoneCode = phoneNumberStr.substring(1, 3);
        const isoCode = this.phoneCountryCodeToISO[phoneCode] || this.phoneCountryCodeToISO[phoneNumberStr.substring(1, 4)];
        if (isoCode) countryCode = isoCode;
      }

      // Countries that require bundles (regulatory compliance)
      const countriesRequiringBundles = ['GB', 'AU', 'CA']; // UK, Australia, Canada
      const requiresBundle = countriesRequiringBundles.includes(countryCode);

      if (!emergencyAddressId) {
        throw new Error('Emergency address not configured. Please run Twilio setup first.');
      }

      if (requiresBundle && !bundleSid) {
        throw new Error(`Regulatory bundle required for ${countryCode} phone numbers. Please create a compliance bundle in Twilio Console and configure it in the connector settings.`);
      }

      if (!trunkSid) {
        throw new Error('SIP trunk not configured. Please run Twilio setup first.');
      }

      // Determine number type - CRITICAL for bundle validation and retry logic
      // First, try to detect from phone number pattern
      let numberType = null;
      const phoneStr = phoneNumber.replace(/[^0-9+]/g, '');
      
      // Detect number type from pattern (UK numbers as example)
      if (countryCode === 'GB') {
        if (phoneStr.startsWith('+447') && phoneStr.length === 13) {
          numberType = 'mobile';
          Logger.debug('Detected mobile number from pattern', { phoneNumber, numberType });
        } else if (phoneStr.startsWith('+441') || phoneStr.startsWith('+4420')) {
          numberType = 'local';
          Logger.debug('Detected local number from pattern', { phoneNumber, numberType });
        } else if (phoneStr.startsWith('+448')) {
          numberType = 'tollFree';
          Logger.debug('Detected toll-free number from pattern', { phoneNumber, numberType });
        }
      }
      
      // If we couldn't detect from pattern and bundle is required, try searching
      if (!numberType && requiresBundle && bundleSid) {
        try {
          Logger.debug('Checking number type from available numbers', { phoneNumber, countryCode });
          
          // Try to find the number in available numbers to determine its type
          const searchResults = await this.searchAvailablePhoneNumbers(subaccountId, {
            countryCode,
            limit: 100,
            type: 'all'
          });
          
          const foundNumber = searchResults.availableNumbers.find(
            num => num.phoneNumber === phoneNumber
          );
          
          if (foundNumber) {
            numberType = foundNumber.numberType; // 'local', 'mobile', or 'tollFree'
            Logger.debug('Number type determined from search', { phoneNumber, numberType });
          } else {
            Logger.warn('Could not determine number type from available numbers', { phoneNumber });
          }
        } catch (error) {
          Logger.warn('Failed to determine number type from search', { 
            phoneNumber, 
            error: error.message 
          });
        }
      }
      
      // Store the original number type for retry logic - MUST match bundle type!
      const originalNumberType = numberType;
      Logger.info('Number type for purchase', { 
        phoneNumber, 
        numberType, 
        countryCode,
        requiresBundle 
      });

      // Generate friendly name
      const friendlyName = `voone_${phoneNumber.replace(/\+/g, '')}`;

      // Step 1: Purchase the phone number
      Logger.info('Step 1: Purchasing phone number', { phoneNumber, friendlyName, numberType });
      const purchaseParams = { 
        phoneNumber,
        friendlyName
      };

      // For certain countries (like UK), Twilio requires the emergency address during purchase
      // Check if we have an emergency address and include it in purchase params
      if (emergencyAddressId) {
        purchaseParams.addressSid = emergencyAddressId;
        Logger.debug('Including emergency address in purchase', { 
          phoneNumber, 
          emergencyAddressId 
        });
      }

      // For certain countries (like UK, AU, CA), Twilio requires a regulatory bundle during purchase
      // Only include bundle if we have it and it's required
      // Note: Bundle type validation happens at Twilio level - if bundle type doesn't match number type,
      // Twilio will reject it with a clear error message
      if (requiresBundle && bundleSid) {
        purchaseParams.bundleSid = bundleSid;
        Logger.debug('Including regulatory bundle in purchase', { 
          phoneNumber, 
          bundleSid,
          countryCode,
          numberType
        });
        
        // Warn if we detected number type and it might not match bundle
        if (numberType && numberType === 'local') {
          Logger.warn('Purchasing local number with bundle - ensure bundle type is "Local"', {
            phoneNumber,
            numberType,
            bundleSid
          });
        } else if (numberType && numberType === 'mobile') {
          Logger.info('Purchasing mobile number with bundle - bundle should be "Mobile" type', {
            phoneNumber,
            numberType,
            bundleSid
          });
        }
      }

      let purchasedNumber;
      let retryAttempt = 0;
      const maxRetries = 3;

      while (retryAttempt <= maxRetries) {
        try {
          purchasedNumber = await client.incomingPhoneNumbers.create(purchaseParams);
          break; // Success! Exit the retry loop
        } catch (purchaseError) {
          // Check if the number is no longer available
          if (purchaseError.message && purchaseError.message.includes('is not available') && retryAttempt < maxRetries) {
            Logger.warn('Phone number no longer available, attempting to find alternative', {
              phoneNumber,
              attempt: retryAttempt + 1,
              maxRetries,
              countryCode
            });

            try {
              // CRITICAL: Search for numbers of the SAME TYPE as the original to avoid bundle mismatches
              const searchType = originalNumberType || 'all';
              
              if (!originalNumberType) {
                Logger.warn('Original number type unknown - searching all types may cause bundle issues', {
                  phoneNumber,
                  countryCode
                });
              }
              
              Logger.info('Searching for alternative number of same type', {
                originalNumber: phoneNumber,
                searchType,
                countryCode,
                requiresBundle
              });
              
              // Search for a new available number with the SAME TYPE as the original
              const searchResults = await this.searchAvailablePhoneNumbers(subaccountId, {
                countryCode,
                limit: 10,
                type: searchType
              });

              if (searchResults.availableNumbers && searchResults.availableNumbers.length > 0) {
                // Get the first available number of the same type
                const alternativeNumber = searchResults.availableNumbers[0];
                const newPhoneNumber = alternativeNumber.phoneNumber;
                const newNumberType = alternativeNumber.numberType;

                // Verify the new number type matches the original (critical for bundle validation)
                if (originalNumberType && newNumberType !== originalNumberType) {
                  Logger.error('Alternative number type mismatch', {
                    originalNumber: phoneNumber,
                    originalType: originalNumberType,
                    alternativeNumber: newPhoneNumber,
                    alternativeType: newNumberType,
                    bundleSid
                  });
                  throw new Error(`${phoneNumber} is no longer available. Alternative numbers found are of different type (${newNumberType} vs ${originalNumberType}) and won't match your bundle. Please search for ${originalNumberType} numbers specifically.`);
                }

                Logger.info('Found alternative phone number of same type, retrying purchase', {
                  originalNumber: phoneNumber,
                  newNumber: newPhoneNumber,
                  numberType: newNumberType,
                  originalType: originalNumberType,
                  bundleCompatible: true,
                  attempt: retryAttempt + 1
                });

                // Update purchase params with the new number
                purchaseParams.phoneNumber = newPhoneNumber;
                purchaseParams.friendlyName = `voone_${newPhoneNumber.replace(/\+/g, '')}`;
                
                // Update local variables for the rest of the flow
                phoneNumber = newPhoneNumber;
                numberType = newNumberType;

                retryAttempt++;
                continue; // Retry with the new number
              } else {
                const typeMsg = originalNumberType ? ` of type "${originalNumberType}"` : '';
                Logger.error('No alternative numbers available', { 
                  countryCode, 
                  numberType: originalNumberType,
                  searchType 
                });
                throw new Error(`${phoneNumber} is no longer available and no alternative ${countryCode} numbers${typeMsg} found. Please try again.`);
              }
            } catch (searchError) {
              Logger.error('Failed to search for alternative number', {
                error: searchError.message,
                originalNumber: phoneNumber,
                originalType: originalNumberType
              });
              // Re-throw as-is if it's our custom error about type mismatch
              if (searchError.message.includes('won\'t match your bundle') || 
                  searchError.message.includes('no alternative')) {
                throw searchError;
              }
              throw new Error(`${phoneNumber} is no longer available and failed to find alternatives: ${searchError.message}`);
            }
          }
          
          // Check if error is related to bundle type mismatch
          if (purchaseError.message && purchaseError.message.includes('does not have the correct regulation type')) {
          // Try to determine number type if we didn't get it earlier
          let detectedNumberType = numberType;
          if (!detectedNumberType) {
            // UK number patterns: mobile usually start with +447, local with +441 or +4420
            const phoneStr = phoneNumber.replace(/[^0-9+]/g, '');
            if (phoneStr.startsWith('+447') && phoneStr.length === 13) {
              detectedNumberType = 'mobile';
            } else if (phoneStr.startsWith('+441') || phoneStr.startsWith('+4420')) {
              detectedNumberType = 'local';
            }
          }
          
          // Build helpful error message
          let errorMsg = `Bundle type mismatch: Your configured bundle (${bundleSid}) is for a different number type. `;
          
          if (detectedNumberType === 'mobile') {
            errorMsg += `You're trying to purchase a mobile number, but your bundle appears to be for local numbers. ` +
              `Please search for mobile numbers using: &type=mobile`;
          } else if (detectedNumberType === 'local') {
            errorMsg += `You're trying to purchase a local number, but your bundle is for mobile numbers. ` +
              `Please either: 1) Search for mobile numbers using: &type=mobile, ` +
              `or 2) Create a "Local" bundle in Twilio Console and update the bundle SID using: ` +
              `PUT /api/connectors/:subaccountId/twilio/bundle`;
          } else {
            errorMsg += `The number type couldn't be determined. ` +
              `Please ensure your bundle type matches the number type you're trying to purchase. ` +
              `For UK numbers: Mobile bundle for mobile numbers (+447...), Local bundle for local numbers (+441... or +4420...).`;
          }
          
          Logger.error('Bundle type mismatch during purchase', {
            phoneNumber,
            detectedNumberType,
            numberType,
            bundleSid,
            error: purchaseError.message
          });
          throw new Error(errorMsg);
        }
        // Re-throw other errors as-is
        throw purchaseError;
        }
      }

      if (!purchasedNumber) {
        throw new Error('Failed to purchase phone number after multiple attempts');
      }
      
      Logger.info('Phone number purchased', { 
        sid: purchasedNumber.sid,
        phoneNumber: purchasedNumber.phoneNumber
      });

      try {
        // Run all integration steps using shared method
        const integrationResult = await this.completePhoneNumberIntegration(
          subaccountId,
          purchasedNumber,
          emergencyAddressId,
          trunkSid,
          terminationSipUri,
          sipCredentials,
          connection
        );

        // Invalidate phone numbers cache
        await redisService.del(`twilio:phoneNumbers:${subaccountId}`);

        Logger.info('Phone number purchase flow completed successfully', { 
          subaccountId, 
          phoneNumber,
          sid: purchasedNumber.sid,
          retellImported: integrationResult.retellNumber?.imported || false
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
          retellNumber: integrationResult.retellNumber || null
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
   * Get decrypted SIP credentials from database
   * Handles both encrypted and plain text passwords for backward compatibility
   */
  async getDecryptedSipCredentials(subaccountId) {
    try {
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
      const { connection } = connectionInfo;
      
      const twilioConnector = await connection.db.collection('connectorsubaccount').findOne({
        subaccountId,
        connectorType: 'twilio'
      });

      if (!twilioConnector) {
        return null;
      }

      const storedCredentials = twilioConnector.metadata?.retellIntegration?.sipCredentials;
      
      if (!storedCredentials || !storedCredentials.username) {
        return null;
      }

      // Check if password is encrypted
      const isEncrypted = storedCredentials.passwordIV && storedCredentials.passwordAuthTag;
      
      if (isEncrypted) {
        // Decrypt password
        const encryptionService = require('./encryptionService');
        const decryptedPassword = encryptionService.decryptField(
          storedCredentials.password,
          storedCredentials.passwordIV,
          storedCredentials.passwordAuthTag,
          'twilio'
        );
        
        Logger.debug('Decrypted SIP credentials from database', {
          subaccountId,
          username: storedCredentials.username,
          wasEncrypted: true
        });
        
        return {
          username: storedCredentials.username,
          password: decryptedPassword
        };
      } else {
        // Plain text password (backward compatibility)
        Logger.debug('Retrieved plain text SIP credentials from database', {
          subaccountId,
          username: storedCredentials.username,
          wasEncrypted: false
        });
        
        return {
          username: storedCredentials.username,
          password: storedCredentials.password
        };
      }
    } catch (error) {
      Logger.error('Failed to get decrypted SIP credentials', {
        subaccountId,
        error: error.message
      });
      return null;
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

      // Encrypt password before storing
      const encryptionService = require('./encryptionService');
      const encryptedPassword = credentials.password 
        ? encryptionService.encryptField(credentials.password, 'twilio')
        : null;
      
      Logger.debug('Storing Retell integration metadata with encrypted password', {
        subaccountId,
        trunkSid: trunk.sid,
        emergencyAddressId,
        credentialsToStore: {
          username: credentials.username,
          hasPassword: !!credentials.password,
          encrypted: !!encryptedPassword
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
              sipCredentials: encryptedPassword ? {
                username: credentials.username,
                password: encryptedPassword.encrypted,
                passwordIV: encryptedPassword.iv,
                passwordAuthTag: encryptedPassword.authTag
              } : {
                username: credentials.username,
                password: null
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
   * Fix existing Retell numbers that are missing SIP authentication credentials
   * This updates the phone numbers in Retell with the correct auth username and password
   */
  async fixRetellNumberCredentials(subaccountId, phoneNumber = null) {
    try {
      Logger.info('Fixing Retell number credentials', { 
        subaccountId, 
        phoneNumber: phoneNumber || 'all numbers' 
      });

      // Get connector info for SIP credentials
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
      const { connection } = connectionInfo;
      
      const twilioConnector = await connection.db.collection('connectorsubaccount').findOne({
        subaccountId,
        connectorType: 'twilio'
      });

      if (!twilioConnector) {
        throw new Error('Twilio connector not found for this subaccount');
      }

      const terminationSipUri = twilioConnector.metadata?.retellIntegration?.terminationSipUri;
      
      // Get decrypted SIP credentials
      const sipCredentials = await this.getDecryptedSipCredentials(subaccountId);

      if (!sipCredentials || !sipCredentials.username || !sipCredentials.password) {
        throw new Error('SIP credentials not found or incomplete. Please run Twilio setup first.');
      }

      Logger.info('Found decrypted SIP credentials', {
        subaccountId,
        username: sipCredentials.username,
        hasPassword: !!sipCredentials.password,
        terminationUri: terminationSipUri
      });

      // Get Retell API key
      const retellService = require('./retellService');
      let retellApiKey;
      
      try {
        const retellAccount = await retellService.getRetellAccount(subaccountId);
        retellApiKey = retellAccount.apiKey;
      } catch (retellError) {
        throw new Error(`Retell account not configured: ${retellError.message}`);
      }

      // Get all phone numbers or specific number
      const query = { subaccountId };
      if (phoneNumber) {
        query.phone_number = phoneNumber;
      }

      const phoneNumbersCollection = connection.db.collection('phonenumbers');
      const phoneNumbers = await phoneNumbersCollection.find(query).toArray();

      if (phoneNumbers.length === 0) {
        throw new Error(`No phone numbers found for subaccount`);
      }

      Logger.info('Found phone numbers to fix', {
        subaccountId,
        count: phoneNumbers.length,
        numbers: phoneNumbers.map(n => n.phone_number)
      });

      const results = [];

      for (const phoneNum of phoneNumbers) {
        try {
          Logger.info('Updating credentials in Retell', {
            phoneNumber: phoneNum.phone_number,
            username: sipCredentials.username
          });

          // Update the phone number in Retell with SIP credentials
          const updatePayload = {
            sip_trunk_auth_username: sipCredentials.username,
            sip_trunk_auth_password: sipCredentials.password
          };

          const response = await axios.patch(
            `https://api.retellai.com/update-phone-number/${encodeURIComponent(phoneNum.phone_number)}`,
            updatePayload,
            {
              headers: {
                'Authorization': `Bearer ${retellApiKey}`,
                'Content-Type': 'application/json'
              },
              timeout: 30000
            }
          );

          Logger.info('Successfully updated credentials in Retell', {
            phoneNumber: phoneNum.phone_number,
            retellResponse: {
              auth_username: response.data.sip_outbound_trunk_config?.auth_username,
              termination_uri: response.data.sip_outbound_trunk_config?.termination_uri
            }
          });

          results.push({
            phoneNumber: phoneNum.phone_number,
            success: true,
            auth_username: response.data.sip_outbound_trunk_config?.auth_username,
            message: 'Credentials updated successfully'
          });

        } catch (updateError) {
          Logger.error('Failed to update credentials for phone number', {
            phoneNumber: phoneNum.phone_number,
            error: updateError.message,
            response: updateError.response?.data
          });

          results.push({
            phoneNumber: phoneNum.phone_number,
            success: false,
            error: updateError.message
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      Logger.info('Credential fix completed', {
        subaccountId,
        total: results.length,
        success: successCount,
        failed: failCount
      });

      return {
        success: true,
        total: results.length,
        successCount,
        failCount,
        results
      };

    } catch (error) {
      Logger.error('Failed to fix Retell number credentials', {
        subaccountId,
        phoneNumber,
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

      // Get MongoDB connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      const phoneNumbersCollection = connection.db.collection('phonenumbers');

      // Validation: Check restrictions before updating
      // Use Retell as the source of truth to avoid stale MongoDB data
      const needsValidation = 
        (updateData.inbound_agent_id !== undefined && updateData.inbound_agent_id !== null) ||
        (updateData.outbound_agent_id !== undefined && updateData.outbound_agent_id !== null);

      if (needsValidation) {
        Logger.info('Validating phone number assignment against Retell', {
          phoneNumber,
          updateData
        });

        // Fetch all phone numbers from Retell (single API call for all validations)
        const response = await axios.get('https://api.retellai.com/list-phone-numbers', {
          headers: {
            'Authorization': `Bearer ${retellApiKey}`
          },
          timeout: 30000
        });
        
        const retellPhoneNumbers = response.data;
        const currentPhone = retellPhoneNumbers.find(p => p.phone_number === phoneNumber);
        
        Logger.info('Current state in Retell', {
          phoneNumber,
          currentInbound: currentPhone?.inbound_agent_id,
          currentOutbound: currentPhone?.outbound_agent_id,
          totalPhoneNumbers: retellPhoneNumbers.length
        });

        // Validate inbound assignment
        if (updateData.inbound_agent_id !== undefined && updateData.inbound_agent_id !== null) {
          // Check if this agent already has another inbound number
          const agentHasInbound = retellPhoneNumbers.find(p => 
            p.inbound_agent_id === updateData.inbound_agent_id && 
            p.phone_number !== phoneNumber
          );

          if (agentHasInbound) {
            const error = new Error(
              `This agent already has an inbound phone number assigned (${agentHasInbound.phone_number_pretty || agentHasInbound.phone_number}). Please remove the existing assignment first.`
            );
            error.statusCode = 400;
            error.code = 'AGENT_INBOUND_LIMIT_REACHED';
            throw error;
          }

          // Check if this phone number is currently assigned to another agent in Retell
          if (currentPhone && 
              currentPhone.inbound_agent_id && 
              currentPhone.inbound_agent_id !== updateData.inbound_agent_id) {
            const error = new Error(
              `This phone number is currently assigned for inbound calls to another agent (${currentPhone.inbound_agent_id}). Please remove that assignment first.`
            );
            error.statusCode = 409;
            error.code = 'PHONE_NUMBER_INBOUND_CONFLICT';
            throw error;
          }
        }

        // Validate outbound assignment
        if (updateData.outbound_agent_id !== undefined && updateData.outbound_agent_id !== null) {
          // Check if this agent already has another outbound number
          const agentHasOutbound = retellPhoneNumbers.find(p => 
            p.outbound_agent_id === updateData.outbound_agent_id && 
            p.phone_number !== phoneNumber
          );

          if (agentHasOutbound) {
            const error = new Error(
              `This agent already has an outbound phone number assigned (${agentHasOutbound.phone_number_pretty || agentHasOutbound.phone_number}). Please remove the existing assignment first.`
            );
            error.statusCode = 400;
            error.code = 'AGENT_OUTBOUND_LIMIT_REACHED';
            throw error;
          }

          // Check if this phone number is currently assigned to another agent in Retell
          if (currentPhone && 
              currentPhone.outbound_agent_id && 
              currentPhone.outbound_agent_id !== updateData.outbound_agent_id) {
            const error = new Error(
              `This phone number is currently assigned for outbound calls to another agent (${currentPhone.outbound_agent_id}). Please remove that assignment first.`
            );
            error.statusCode = 409;
            error.code = 'PHONE_NUMBER_OUTBOUND_CONFLICT';
            throw error;
          }
        }
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

      Logger.info('Sending update to Retell', {
        phoneNumber,
        payload: retellPayload,
        updateData
      });

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
        requestPayload: retellPayload,
        responseData: response.data
      });

      // Update in MongoDB (reuse connection from validation)

      const mongoUpdateData = {
        updatedAt: new Date(),
        last_modification_timestamp: Date.now()
      };

      if (updateData.inbound_agent_id !== undefined) {
        mongoUpdateData.inbound_agent_id = updateData.inbound_agent_id;
        // Only set version if agent is assigned (not null)
        if (updateData.inbound_agent_id !== null && response.data.inbound_agent_version !== undefined) {
          mongoUpdateData.inbound_agent_version = response.data.inbound_agent_version;
        } else if (updateData.inbound_agent_id === null) {
          // Explicitly set version to null when agent is removed
          mongoUpdateData.inbound_agent_version = null;
        }
      }
      if (updateData.outbound_agent_id !== undefined) {
        mongoUpdateData.outbound_agent_id = updateData.outbound_agent_id;
        // Only set version if agent is assigned (not null)
        if (updateData.outbound_agent_id !== null && response.data.outbound_agent_version !== undefined) {
          mongoUpdateData.outbound_agent_version = response.data.outbound_agent_version;
        } else if (updateData.outbound_agent_id === null) {
          // Explicitly set version to null when agent is removed
          mongoUpdateData.outbound_agent_version = null;
        }
      }
      if (updateData.nickname !== undefined) {
        mongoUpdateData.nickname = updateData.nickname;
      }

      Logger.info('Updating MongoDB with data', {
        phoneNumber,
        subaccountId,
        mongoUpdateData,
        updateFields: Object.keys(mongoUpdateData),
        isSettingToNull: {
          inbound: updateData.inbound_agent_id === null,
          outbound: updateData.outbound_agent_id === null
        }
      });

      // First, check current state in MongoDB
      const currentDoc = await phoneNumbersCollection.findOne({
        subaccountId,
        phone_number: phoneNumber
      });

      Logger.info('Current MongoDB state before update', {
        phoneNumber,
        currentInbound: currentDoc?.inbound_agent_id,
        currentOutbound: currentDoc?.outbound_agent_id
      });

      const updateResult = await phoneNumbersCollection.updateOne(
        { subaccountId, phone_number: phoneNumber },
        { $set: mongoUpdateData }
      );

      Logger.info('Phone number updated in MongoDB successfully', {
        phoneNumber,
        subaccountId,
        matchedCount: updateResult.matchedCount,
        modifiedCount: updateResult.modifiedCount,
        returnData: response.data
      });

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
   * First unlinks the phone number from all agents, then deletes it
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
        unlink: { success: false },
        retell: { success: false },
        twilio: { success: false },
        mongodb: { success: false }
      };

      // Get MongoDB connection first to check current state
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
      const { connection } = connectionInfo;
      const phoneNumbersCollection = connection.db.collection('phonenumbers');

      // Get current phone number document to check agent assignments
      const phoneNumberDoc = await phoneNumbersCollection.findOne({
        subaccountId,
        phone_number: phoneNumber
      });

      if (!phoneNumberDoc) {
        throw new Error('Phone number not found in database');
      }

      // Get Retell API key
      let retellApiKey;
      try {
        retellApiKey = await this.getRetellApiKey(subaccountId);
      } catch (error) {
        Logger.warn('Could not get Retell API key', { error: error.message });
      }

      // Step 1: Unlink phone number from all agents before deletion
      const needsUnlink = phoneNumberDoc.inbound_agent_id || phoneNumberDoc.outbound_agent_id;
      
      if (needsUnlink && retellApiKey) {
        try {
          Logger.info('Unlinking phone number from agents before deletion', {
            phoneNumber,
            inbound_agent_id: phoneNumberDoc.inbound_agent_id,
            outbound_agent_id: phoneNumberDoc.outbound_agent_id
          });

          const unlinkPayload = {};
          if (phoneNumberDoc.inbound_agent_id) {
            unlinkPayload.inbound_agent_id = null;
          }
          if (phoneNumberDoc.outbound_agent_id) {
            unlinkPayload.outbound_agent_id = null;
          }

          await axios.patch(
            `https://api.retellai.com/update-phone-number/${encodeURIComponent(phoneNumber)}`,
            unlinkPayload,
            {
              headers: {
                'Authorization': `Bearer ${retellApiKey}`,
                'Content-Type': 'application/json'
              },
              timeout: 30000
            }
          );

          // Update MongoDB to reflect unlink
          await phoneNumbersCollection.updateOne(
            { subaccountId, phone_number: phoneNumber },
            {
              $set: {
                inbound_agent_id: null,
                outbound_agent_id: null,
                inbound_agent_version: null,
                outbound_agent_version: null,
                updatedAt: new Date()
              }
            }
          );

          results.unlink.success = true;
          Logger.info('Phone number unlinked from agents successfully', {
            phoneNumber,
            unlinkedAgents: {
              inbound: phoneNumberDoc.inbound_agent_id,
              outbound: phoneNumberDoc.outbound_agent_id
            }
          });
        } catch (unlinkError) {
          Logger.error('Failed to unlink phone number from agents', {
            phoneNumber,
            error: unlinkError.message,
            response: unlinkError.response?.data
          });
          results.unlink.error = unlinkError.message;
          // Continue with deletion even if unlink fails
        }
      } else if (needsUnlink && !retellApiKey) {
        results.unlink.skipped = true;
        results.unlink.reason = 'Retell API key not configured';
        Logger.warn('Cannot unlink phone number - Retell API key not available', { phoneNumber });
      } else {
        results.unlink.skipped = true;
        results.unlink.reason = 'No agent assignments found';
        Logger.info('Phone number has no agent assignments, skipping unlink', { phoneNumber });
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

      // Unregister from Twilio trunk (but keep the number purchased)
      try {
        const client = await this.getTwilioClient(subaccountId);

        // Get the phone number SID
        const incomingNumbers = await client.incomingPhoneNumbers.list({
          phoneNumber: phoneNumber
        });

        if (incomingNumbers.length > 0) {
          const phoneNumberSid = incomingNumbers[0].sid;
          const currentTrunkSid = incomingNumbers[0].trunkSid;
          
          // Step 1: Remove from trunk if connected
          if (currentTrunkSid) {
            try {
              Logger.info('Removing phone number from trunk', { 
                phoneNumber, 
                phoneNumberSid,
                trunkSid: currentTrunkSid
              });
              
              await client.trunking.v1
                .trunks(currentTrunkSid)
                .phoneNumbers(phoneNumberSid)
                .remove();
              
              Logger.info('Phone number removed from trunk successfully', { 
                phoneNumber,
                trunkSid: currentTrunkSid
              });
            } catch (trunkError) {
              Logger.warn('Failed to remove from trunk (may not be in trunk)', {
                phoneNumber,
                trunkSid: currentTrunkSid,
                error: trunkError.message
              });
              // Continue even if trunk removal fails
            }
          } else {
            Logger.info('Phone number not connected to any trunk', { phoneNumber });
          }
          
          // Step 2: Clear voice URL and status callback (reset to idle state)
          try {
            Logger.debug('Resetting phone number configuration', { 
              phoneNumber, 
              phoneNumberSid 
            });
            
            await client.incomingPhoneNumbers(phoneNumberSid).update({
              voiceUrl: '', // Clear voice URL
              statusCallback: '', // Clear status callback
              voiceMethod: 'POST',
              statusCallbackMethod: 'POST'
            });
            
            Logger.info('Phone number configuration reset successfully', { phoneNumber });
          } catch (updateError) {
            Logger.warn('Failed to reset phone number configuration', {
              phoneNumber,
              error: updateError.message
            });
            // Continue even if config reset fails
          }
          
          results.twilio.success = true;
          results.twilio.action = 'unregistered_from_trunk';
          Logger.info('Phone number kept in Twilio (not released)', { 
            phoneNumber,
            note: 'Number remains purchased and can be reused'
          });
        } else {
          results.twilio.skipped = true;
          results.twilio.reason = 'Phone number not found in Twilio';
          Logger.warn('Phone number not found in Twilio', { phoneNumber });
        }
      } catch (twilioError) {
        Logger.error('Failed to unregister phone number from trunk', {
          phoneNumber,
          error: twilioError.message
        });
        results.twilio.error = twilioError.message;
      }

      // Delete from MongoDB (reuse connection from earlier)
      try {
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
        success: results.unlink.success !== false && (results.retell.success || results.twilio.success || results.mongodb.success),
        unlinkedFromAgents: results.unlink.success ? {
          inbound_agent_id: phoneNumberDoc.inbound_agent_id,
          outbound_agent_id: phoneNumberDoc.outbound_agent_id
        } : null
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

  /**
   * Delete Twilio trunk for a subaccount
   * This method records phone numbers attached to the trunk, deletes the trunk,
   * and returns the phone numbers that need to be released separately
   * @param {string} subaccountId - The subaccount ID
   * @param {string} userId - User ID for audit logging
   * @returns {Promise<Object>} - Deletion results with phone numbers to release
   */
  async deleteTrunkForSubaccount(subaccountId, userId) {
    try {
      Logger.info('Starting Twilio trunk deletion', {
        subaccountId,
        userId
      });

      // Get database connection
      const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
      const { connection } = connectionInfo;
      
      // Get Twilio connector configuration
      const twilioConnector = await connection.db.collection('connectorsubaccount').findOne({
        subaccountId,
        connectorType: 'twilio'
      });

      if (!twilioConnector) {
        return {
          success: false,
          skipped: true,
          reason: 'No Twilio connector found for this subaccount',
          trunkDeleted: false,
          phoneNumbersToRelease: []
        };
      }

      const trunkSid = twilioConnector?.metadata?.retellIntegration?.trunkSid;

      if (!trunkSid) {
        return {
          success: false,
          skipped: true,
          reason: 'No trunk SID found in connector metadata',
          trunkDeleted: false,
          phoneNumbersToRelease: []
        };
      }

      Logger.info('Found trunk SID to delete', {
        subaccountId,
        trunkSid
      });

      // Get Twilio client
      const client = await this.getTwilioClient(subaccountId);

      // STEP 1: Record all phone numbers attached to the trunk
      let phoneNumbersToRelease = [];
      
      try {
        const phoneNumbers = await client.trunking.v1
          .trunks(trunkSid)
          .phoneNumbers
          .list();
        
        // Record the phone numbers
        phoneNumbersToRelease = phoneNumbers.map(pn => ({
          phoneNumber: pn.phoneNumber,
          sid: pn.sid
        }));
        
        Logger.info('Recorded phone numbers attached to trunk', {
          subaccountId,
          trunkSid,
          phoneNumberCount: phoneNumbersToRelease.length,
          phoneNumbers: phoneNumbersToRelease.map(n => n.phoneNumber)
        });
      } catch (listError) {
        if (listError.code === 20404) {
          Logger.info('Trunk not found in Twilio (may have been deleted already)', {
            subaccountId,
            trunkSid
          });
          
          // Still clean up database metadata
          await connection.db.collection('connectorsubaccount').updateOne(
            { subaccountId, connectorType: 'twilio' },
            { $unset: { 'metadata.retellIntegration.trunkSid': '' } }
          );

          return {
            success: true,
            skipped: true,
            reason: 'Trunk not found in Twilio (already deleted)',
            trunkSid,
            trunkDeleted: false,
            metadataCleared: true,
            phoneNumbersToRelease: []
          };
        }
        
        Logger.warn('Failed to list phone numbers from trunk, continuing with deletion', {
          subaccountId,
          trunkSid,
          error: listError.message
        });
      }

      // STEP 2: Delete the trunk from Twilio (even if it has phone numbers)
      try {
        await client.trunking.v1.trunks(trunkSid).remove();
        
        Logger.info('Trunk deleted successfully from Twilio', {
          subaccountId,
          trunkSid,
          phoneNumbersRecorded: phoneNumbersToRelease.length
        });
      } catch (deleteError) {
        if (deleteError.code === 20404) {
          Logger.info('Trunk not found in Twilio (may have been deleted already)', {
            subaccountId,
            trunkSid
          });
        } else {
          Logger.error('Failed to delete trunk from Twilio', {
            subaccountId,
            trunkSid,
            error: deleteError.message,
            errorCode: deleteError.code
          });
          
          return {
            success: false,
            error: deleteError.message,
            errorCode: deleteError.code,
            trunkSid,
            trunkDeleted: false,
            phoneNumbersToRelease
          };
        }
      }

      // STEP 3: Clear trunk metadata from database
      try {
        await connection.db.collection('connectorsubaccount').updateOne(
          { subaccountId, connectorType: 'twilio' },
          { $unset: { 'metadata.retellIntegration.trunkSid': '' } }
        );
        
        Logger.info('Trunk metadata cleared from database', {
          subaccountId,
          trunkSid
        });
      } catch (dbError) {
        Logger.warn('Failed to clear trunk metadata from database', {
          subaccountId,
          trunkSid,
          error: dbError.message
        });
      }

      return {
        success: true,
        trunkSid,
        trunkDeleted: true,
        metadataCleared: true,
        phoneNumbersToRelease
      };

    } catch (error) {
      Logger.error('Failed to delete trunk for subaccount', {
        subaccountId,
        userId,
        error: error.message,
        stack: error.stack
      });
      
      return {
        success: false,
        error: error.message,
        trunkDeleted: false,
        phoneNumbersToRelease: []
      };
    }
  }

  /**
   * Release phone numbers from Twilio
   * This is called after trunk deletion to clean up the phone numbers
   * @param {string} subaccountId - The subaccount ID
   * @param {Array} phoneNumbersToRelease - Array of phone numbers with {phoneNumber, sid}
   * @returns {Promise<Object>} - Release results
   */
  async releasePhoneNumbersFromTwilio(subaccountId, phoneNumbersToRelease) {
    const phoneNumbersReleased = [];
    const phoneNumbersFailed = [];

    if (!phoneNumbersToRelease || phoneNumbersToRelease.length === 0) {
      Logger.info('No phone numbers to release from Twilio', {
        subaccountId
      });
      return {
        success: true,
        phoneNumbersReleased: [],
        phoneNumbersFailed: []
      };
    }

    try {
      // Get Twilio client
      const client = await this.getTwilioClient(subaccountId);

      Logger.info('Starting phone number release from Twilio', {
        subaccountId,
        phoneNumberCount: phoneNumbersToRelease.length,
        phoneNumbers: phoneNumbersToRelease.map(n => n.phoneNumber)
      });

      // Release each phone number
      for (const phoneNumberInfo of phoneNumbersToRelease) {
        try {
          const phoneNumber = phoneNumberInfo.phoneNumber;
          
          Logger.info('Releasing phone number from Twilio', {
            subaccountId,
            phoneNumber
          });

          // Get the IncomingPhoneNumber resource SID
          const incomingNumbers = await client.incomingPhoneNumbers.list({
            phoneNumber
          });

          if (incomingNumbers.length > 0) {
            const phoneNumberSid = incomingNumbers[0].sid;
            
            // Remove emergency address if present (required before deletion)
            try {
              await client.incomingPhoneNumbers(phoneNumberSid).update({
                emergencyAddressSid: ''
              });
            } catch (addressError) {
              Logger.debug('Emergency address removal skipped', {
                phoneNumber,
                error: addressError.message
              });
            }
            
            // Delete the phone number
            await client.incomingPhoneNumbers(phoneNumberSid).remove();
            
            phoneNumbersReleased.push(phoneNumber);
            
            Logger.info('Phone number released from Twilio', {
              subaccountId,
              phoneNumber,
              phoneNumberSid
            });
          } else {
            Logger.warn('Phone number not found in incoming numbers', {
              subaccountId,
              phoneNumber
            });
            phoneNumbersFailed.push({
              phoneNumber,
              reason: 'Not found in incoming numbers'
            });
          }
        } catch (releaseError) {
          Logger.error('Failed to release phone number from Twilio', {
            subaccountId,
            phoneNumber: phoneNumberInfo.phoneNumber,
            error: releaseError.message
          });
          phoneNumbersFailed.push({
            phoneNumber: phoneNumberInfo.phoneNumber,
            error: releaseError.message
          });
          // Continue with other phone numbers even if one fails
        }
      }

      Logger.info('Finished releasing phone numbers from Twilio', {
        subaccountId,
        totalPhoneNumbers: phoneNumbersToRelease.length,
        phoneNumbersReleased: phoneNumbersReleased.length,
        phoneNumbersFailed: phoneNumbersFailed.length,
        releasedNumbers: phoneNumbersReleased
      });

      return {
        success: true,
        phoneNumbersReleased,
        phoneNumbersFailed
      };

    } catch (error) {
      Logger.error('Failed to release phone numbers from Twilio', {
        subaccountId,
        error: error.message,
        stack: error.stack
      });
      
      return {
        success: false,
        error: error.message,
        phoneNumbersReleased,
        phoneNumbersFailed
      };
    }
  }
}

// Singleton instance
const twilioService = new TwilioService();

module.exports = twilioService;

