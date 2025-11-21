const moment = require('moment-timezone');

/**
 * Timezone Helper Utility
 * Provides functions to convert between UTC and tenant-specific timezones
 */
class TimezoneHelper {
  /**
   * Convert a UTC date to a specific timezone
   * @param {Date|String|Number} utcDate - The UTC date to convert
   * @param {String} timezone - The target timezone (e.g., 'America/New_York')
   * @returns {Date} - The converted date in the target timezone
   */
  static utcToTimezone(utcDate, timezone = 'UTC') {
    if (!utcDate) return null;
    
    try {
      // Check if this is a time-only string (HH:mm or HH:mm:ss format)
      const timeOnlyRegex = /^([0-2]?\d):([0-5]\d)(?::([0-5]\d))?$/;
      if (typeof utcDate === 'string' && timeOnlyRegex.test(utcDate.trim())) {
        // This is a time-only string, treat it as UTC time on a reference date
        const referenceDate = '2025-01-01'; // Use any date as reference
        const fullDateTime = `${referenceDate}T${utcDate}:00Z`;
        const momentDate = moment.utc(fullDateTime);
        
        if (momentDate.isValid()) {
          const converted = momentDate.tz(timezone);
          const convertedTime = converted.format('HH:mm');
          return convertedTime;
        }
      }
      
      // Parse the date as UTC
      const momentDate = moment.utc(utcDate);
      
      if (!momentDate.isValid()) {
        console.error('[TimezoneHelper] Invalid date:', utcDate);
        return utcDate;
      }
      
      // Convert to the target timezone
      const converted = momentDate.tz(timezone);
      
      // Return as formatted string to preserve timezone offset
      // (Date objects always convert back to UTC when serialized)
      return converted.format();
    } catch (error) {
      console.error('[TimezoneHelper] Error converting UTC to timezone:', error.message);
      return utcDate;
    }
  }

  /**
   * Convert a timezone-specific date to UTC
   * @param {Date|String|Number} timezoneDate - The date in the source timezone
   * @param {String} timezone - The source timezone (e.g., 'America/New_York')
   * @returns {Date} - The date converted to UTC
   */
  static timezoneToUtc(timezoneDate, timezone = 'UTC') {
    if (!timezoneDate) return null;
    
    try {
      // Parse the date in the specified timezone
      const momentDate = moment.tz(timezoneDate, timezone);
      
      if (!momentDate.isValid()) {
        console.error('[TimezoneHelper] Invalid date:', timezoneDate);
        return timezoneDate;
      }
      
      // Convert to UTC
      const utc = momentDate.utc();
      
      // Return as Date object
      return utc.toDate();
    } catch (error) {
      console.error('[TimezoneHelper] Error converting timezone to UTC:', error.message);
      return timezoneDate;
    }
  }

  /**
   * Convert all date fields in an object from UTC to a specific timezone
   * @param {Object} obj - The object containing date fields
   * @param {String} timezone - The target timezone
   * @param {Array<String>} dateFields - Array of field names that contain dates (optional)
   * @returns {Object} - The object with converted date fields
   */
  static convertObjectDatesToTimezone(obj, timezone = 'UTC', dateFields = null) {
    if (!obj || typeof obj !== 'object') return obj;
    
    // If dateFields not specified, automatically detect common date field names
    const commonDateFields = [
      'createdAt', 'updatedAt', 'deletedAt', 'timestamp',
      'startTime', 'endTime', 'startDate', 'endDate',
      'lastAccessed', 'lastModified', 'lastSyncedAt',
      'joinedAt', 'acceptedAt', 'invitedAt', 'activatedAt',
      'startTimestamp', 'endTimestamp', 'webhookReceivedAt',
      'analyzedAt', 'endedAt', 'lastVerified', 'date'
    ];
    
    const fieldsToConvert = dateFields || commonDateFields;
    const converted = { ...obj };
    
    // Convert top-level date fields
    for (const field of fieldsToConvert) {
      if (converted[field]) {
        converted[field] = this.utcToTimezone(converted[field], timezone);
      }
    }
    
    // Handle timeSlots array (for availability rules)
    if (converted.timeSlots && Array.isArray(converted.timeSlots)) {
      converted.timeSlots = converted.timeSlots.map(slot => ({
        ...slot,
        startTime: slot.startTime ? this.utcToTimezone(slot.startTime, timezone) : slot.startTime,
        endTime: slot.endTime ? this.utcToTimezone(slot.endTime, timezone) : slot.endTime
      }));
    }
    
    // Handle nested objects (like start/end in calendar events)
    if (converted.start && typeof converted.start === 'object') {
      if (converted.start.dateTime) {
        converted.start.dateTime = this.utcToTimezone(converted.start.dateTime, timezone);
      }
      if (converted.start.date) {
        converted.start.date = this.utcToTimezone(converted.start.date, timezone);
      }
    }
    
    if (converted.end && typeof converted.end === 'object') {
      if (converted.end.dateTime) {
        converted.end.dateTime = this.utcToTimezone(converted.end.dateTime, timezone);
      }
      if (converted.end.date) {
        converted.end.date = this.utcToTimezone(converted.end.date, timezone);
      }
    }
    
    // Handle stats object with timestamps
    if (converted.stats && typeof converted.stats === 'object') {
      for (const field of fieldsToConvert) {
        if (converted.stats[field]) {
          converted.stats[field] = this.utcToTimezone(converted.stats[field], timezone);
        }
      }
    }
    
    return converted;
  }

  /**
   * Convert all date fields in an array of objects from UTC to a specific timezone
   * @param {Array<Object>} array - Array of objects containing date fields
   * @param {String} timezone - The target timezone
   * @param {Array<String>} dateFields - Array of field names that contain dates (optional)
   * @returns {Array<Object>} - Array with converted date fields
   */
  static convertArrayDatesToTimezone(array, timezone = 'UTC', dateFields = null) {
    if (!Array.isArray(array)) return array;
    
    return array.map(obj => this.convertObjectDatesToTimezone(obj, timezone, dateFields));
  }

  /**
   * Convert all date fields in an object from a specific timezone to UTC
   * @param {Object} obj - The object containing date fields
   * @param {String} timezone - The source timezone
   * @param {Array<String>} dateFields - Array of field names that contain dates (optional)
   * @returns {Object} - The object with dates converted to UTC
   */
  static convertObjectDatesToUtc(obj, timezone = 'UTC', dateFields = null) {
    if (!obj || typeof obj !== 'object') return obj;
    
    const commonDateFields = [
      'createdAt', 'updatedAt', 'deletedAt', 'timestamp',
      'startTime', 'endTime', 'startDate', 'endDate',
      'lastAccessed', 'lastModified', 'lastSyncedAt',
      'joinedAt', 'acceptedAt', 'invitedAt', 'activatedAt',
      'startTimestamp', 'endTimestamp', 'webhookReceivedAt',
      'analyzedAt', 'endedAt', 'lastVerified', 'date'
    ];
    
    const fieldsToConvert = dateFields || commonDateFields;
    const converted = { ...obj };
    
    // Convert top-level date fields
    for (const field of fieldsToConvert) {
      if (converted[field]) {
        converted[field] = this.timezoneToUtc(converted[field], timezone);
      }
    }
    
    // Handle nested objects
    if (converted.start && typeof converted.start === 'object') {
      if (converted.start.dateTime) {
        converted.start.dateTime = this.timezoneToUtc(converted.start.dateTime, timezone);
      }
      if (converted.start.date) {
        converted.start.date = this.timezoneToUtc(converted.start.date, timezone);
      }
    }
    
    if (converted.end && typeof converted.end === 'object') {
      if (converted.end.dateTime) {
        converted.end.dateTime = this.timezoneToUtc(converted.end.dateTime, timezone);
      }
      if (converted.end.date) {
        converted.end.date = this.timezoneToUtc(converted.end.date, timezone);
      }
    }
    
    return converted;
  }

  /**
   * Validate if a timezone string is valid
   * @param {String} timezone - The timezone to validate
   * @returns {Boolean} - True if valid, false otherwise
   */
  static isValidTimezone(timezone) {
    if (!timezone || typeof timezone !== 'string') return false;
    
    try {
      // moment-timezone will not throw an error for invalid timezones,
      // but we can check if the timezone exists in the list
      return moment.tz.names().includes(timezone);
    } catch (error) {
      return false;
    }
  }

  /**
   * Get current time in a specific timezone
   * @param {String} timezone - The target timezone
   * @returns {Date} - Current date/time in the specified timezone
   */
  static now(timezone = 'UTC') {
    try {
      return moment.tz(timezone).toDate();
    } catch (error) {
      console.error('[TimezoneHelper] Error getting current time:', error.message);
      return new Date();
    }
  }

  /**
   * Format a date for display in a specific timezone
   * @param {Date|String|Number} date - The date to format
   * @param {String} timezone - The timezone for formatting
   * @param {String} format - The format string (default: ISO 8601)
   * @returns {String} - Formatted date string
   */
  static formatDate(date, timezone = 'UTC', format = 'YYYY-MM-DDTHH:mm:ss.SSSZ') {
    if (!date) return null;
    
    try {
      const momentDate = moment.utc(date).tz(timezone);
      
      if (!momentDate.isValid()) {
        return date.toString();
      }
      
      return momentDate.format(format);
    } catch (error) {
      console.error('[TimezoneHelper] Error formatting date:', error.message);
      return date.toString();
    }
  }
}

module.exports = TimezoneHelper;

