/**
 * Call Helper Utility
 * Provides functions to calculate call success metrics
 */

/**
 * Calculate success rate for a call based on meeting booking status
 * Simple binary algorithm: 0% if no meeting booked, 100% if meeting booked
 * @param {Object} callAnalysis - The call_analysis object from the call document
 * @returns {number} - Success rate as a percentage (0 or 100)
 */
function calculateCallSuccessRate(callAnalysis) {
  if (!callAnalysis || typeof callAnalysis !== 'object') {
    return 0; // No data = no meeting = 0%
  }

  // Check if appointment was booked
  // First check custom_analysis_data.appointment_booked
  if (callAnalysis.custom_analysis_data?.appointment_booked === true) {
    return 100; // Meeting booked = 100%
  }

  // Also check if appointment_booked is set directly in call_analysis (backward compatibility)
  if (callAnalysis.appointment_booked === true) {
    return 100; // Meeting booked = 100%
  }

  // No meeting booked = 0%
  return 0;
}

module.exports = {
  calculateCallSuccessRate
};

