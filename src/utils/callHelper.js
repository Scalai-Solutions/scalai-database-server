/**
 * Call Helper Utility
 * Provides functions to calculate call success metrics
 */

/**
 * Calculate success rate for a call based on call_analysis fields
 * @param {Object} callAnalysis - The call_analysis object from the call document
 * @returns {number} - Success rate as a percentage (0-100)
 */
function calculateCallSuccessRate(callAnalysis) {
  if (!callAnalysis || typeof callAnalysis !== 'object') {
    return null;
  }

  // Base score starts at 0
  let score = 0;
  let maxScore = 0;

  // Factor 1: call_successful (40% weight)
  maxScore += 40;
  if (callAnalysis.call_successful === true) {
    score += 40;
  } else if (callAnalysis.call_successful === false) {
    score += 0;
  } else {
    // If undefined/null, don't add to score but also don't penalize
    maxScore -= 40;
  }

  // Factor 2: user_sentiment (30% weight)
  maxScore += 30;
  if (callAnalysis.user_sentiment) {
    const sentiment = String(callAnalysis.user_sentiment).toLowerCase();
    if (sentiment === 'positive') {
      score += 30;
    } else if (sentiment === 'neutral') {
      score += 15; // Half points for neutral
    } else if (sentiment === 'negative') {
      score += 0;
    } else {
      // Unknown sentiment, don't penalize
      maxScore -= 30;
    }
  } else {
    maxScore -= 30;
  }

  // Factor 3: appointment_booked (if available in custom_analysis_data) (20% weight)
  if (callAnalysis.custom_analysis_data) {
    maxScore += 20;
    if (callAnalysis.custom_analysis_data.appointment_booked === true) {
      score += 20;
    } else if (callAnalysis.custom_analysis_data.appointment_booked === false) {
      score += 0;
    } else {
      // If undefined/null, don't add to score but also don't penalize
      maxScore -= 20;
    }
  }

  // Factor 4: in_voicemail (10% weight) - negative indicator
  maxScore += 10;
  if (callAnalysis.in_voicemail === true) {
    score += 0; // Voicemail is negative
  } else if (callAnalysis.in_voicemail === false) {
    score += 10; // Not voicemail is positive
  } else {
    // If undefined/null, don't add to score but also don't penalize
    maxScore -= 10;
  }

  // Calculate percentage (avoid division by zero)
  if (maxScore === 0) {
    return null; // No data available
  }

  const successRate = Math.round((score / maxScore) * 100);
  return Math.max(0, Math.min(100, successRate)); // Clamp between 0 and 100
}

module.exports = {
  calculateCallSuccessRate
};

