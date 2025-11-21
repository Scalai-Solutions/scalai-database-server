const TimezoneHelper = require('../utils/timezoneHelper');
const Logger = require('../utils/logger');

/**
 * Middleware to fetch and attach subaccount timezone to requests
 * This middleware should be applied to routes that need timezone conversion
 */
async function attachTimezone(req, res, next) {
  try {
    // Extract subaccountId from various possible locations (use optional chaining)
    // First try params (if already parsed by route)
    let subaccountId = req.params?.subaccountId || 
                       req.body?.subaccountId || 
                       req.query?.subaccountId ||
                       req.headers?.['x-subaccount-id'];
    
    // If not found in params, try to extract from URL path
    // URL format: /api/database/:subaccountId/... or /:subaccountId/... or /:subaccountId
    if (!subaccountId && req.url) {
      // Match MongoDB ObjectID (24 hex chars) - with or without trailing slash
      const urlMatch = req.url.match(/\/([a-f0-9]{24})(?:\/|$|\?)/i);
      if (urlMatch) {
        subaccountId = urlMatch[1];
      }
    }
    
    if (!subaccountId) {
      // No subaccountId, default to UTC
      req.timezone = 'UTC';
      return next();
    }
    
    // Check if subaccount info is already attached (from other middleware)
    if (req.subaccount && req.subaccount.timezone) {
      req.timezone = req.subaccount.timezone;
      return next();
    }
    
    // Fetch subaccount timezone from tenant manager
    // This would normally be cached or fetched from a shared service
    // For now, we'll default to UTC and let the tenant manager handle it
    req.timezone = 'UTC';
    
    // Try to get timezone from subaccount if available
    try {
      const axios = require('axios');
      const config = require('../../config/config');
      
      // Only fetch if we have tenant manager configured  
      if (config.tenantManager && config.tenantManager.url) {
        const serviceToken = config.serviceToken?.tenantManagerToken || 
                           config.serviceToken?.token || 
                           process.env.TENANT_MANAGER_SERVICE_TOKEN;
        
        const response = await axios.get(
          `${config.tenantManager.url}/api/subaccounts/${subaccountId}`,
          {
            headers: {
              'X-Service-Token': serviceToken,
              'X-Service-Name': 'database-server'
            },
            timeout: 3000 // Short timeout to not block requests
          }
        );
        
        if (response.data && response.data.success && response.data.data) {
          req.timezone = response.data.data.timezone || 'UTC';
          req.subaccount = response.data.data; // Cache for other uses
          
          Logger.debug('Timezone attached to request', {
            subaccountId,
            timezone: req.timezone
          });
        }
      }
    } catch (error) {
      // If fetching fails, just use UTC
      Logger.warn('Failed to fetch subaccount timezone, using UTC', {
        subaccountId,
        error: error.message
      });
    }
    
    next();
  } catch (error) {
    Logger.error('Timezone middleware error', {
      error: error.message,
      stack: error.stack
    });
    
    // Default to UTC on error
    req.timezone = 'UTC';
    next();
  }
}

/**
 * Middleware to convert response dates from UTC to tenant timezone
 * Apply this after the response is generated but before sending
 */
function convertResponseDates(req, res, next) {
  const originalJson = res.json.bind(res);
  
  res.json = function(data) {
    // Only convert if we have a timezone set and it's not UTC
    if (req.timezone && req.timezone !== 'UTC' && data) {
      try {
        // Clone the data to avoid modifying the original
        let convertedData = JSON.parse(JSON.stringify(data));
        
        // Convert dates in the response data
        if (convertedData.data) {
          if (Array.isArray(convertedData.data)) {
            convertedData.data = TimezoneHelper.convertArrayDatesToTimezone(
              convertedData.data,
              req.timezone
            );
          } else if (typeof convertedData.data === 'object') {
            convertedData.data = TimezoneHelper.convertObjectDatesToTimezone(
              convertedData.data,
              req.timezone
            );
          }
        }
        
        // Also convert top-level date fields if they exist
        convertedData = TimezoneHelper.convertObjectDatesToTimezone(
          convertedData,
          req.timezone
        );
        
        Logger.debug('Response dates converted to tenant timezone', {
          timezone: req.timezone,
          subaccountId: req.params.subaccountId
        });
        
        return originalJson(convertedData);
      } catch (error) {
        Logger.error('Error converting response dates', {
          error: error.message,
          timezone: req.timezone
        });
        // On error, return original data
        return originalJson(data);
      }
    }
    
    // No conversion needed
    return originalJson(data);
  };
  
  next();
}

/**
 * Middleware to convert incoming request dates from tenant timezone to UTC
 * Apply this before processing the request
 */
function convertRequestDates(req, res, next) {
  try {
    // Only convert if we have a timezone set and it's not UTC
    if (req.timezone && req.timezone !== 'UTC' && req.body) {
      // Convert dates in request body to UTC
      req.body = TimezoneHelper.convertObjectDatesToUtc(
        req.body,
        req.timezone
      );
      
      // Also check query parameters for date fields
      if (req.query) {
        const dateQueryParams = ['startDate', 'endDate', 'start', 'end', 'date', 'timestamp'];
        for (const param of dateQueryParams) {
          if (req.query[param]) {
            const converted = TimezoneHelper.timezoneToUtc(req.query[param], req.timezone);
            if (converted) {
              req.query[param] = converted;
            }
          }
        }
      }
      
      Logger.debug('Request dates converted from tenant timezone to UTC', {
        timezone: req.timezone,
        subaccountId: req.params.subaccountId
      });
    }
    
    next();
  } catch (error) {
    Logger.error('Error converting request dates', {
      error: error.message,
      timezone: req.timezone
    });
    // On error, continue without conversion
    next();
  }
}

module.exports = {
  attachTimezone,
  convertResponseDates,
  convertRequestDates
};

