/**
 * Audit Success Rates Script
 * 
 * This script audits all calls in the database to check for discrepancies
 * between success_rate field and actual meeting bookings.
 * 
 * Usage:
 *   node scripts/audit-success-rates.js <subaccountId> <agentId>
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');

// Get command line arguments
const subaccountId = process.argv[2];
const agentId = process.argv[3];

if (!subaccountId) {
  console.error('Usage: node scripts/audit-success-rates.js <subaccountId> [agentId]');
  console.error('Example: node scripts/audit-success-rates.js 68cf05f060d294db17c0685e agent_9c25a9ae978ca68f942da42e25');
  process.exit(1);
}

async function auditSuccessRates() {
  let client;
  
  try {
    console.log(`\n🔍 Auditing Success Rates for Subaccount: ${subaccountId}`);
    if (agentId) {
      console.log(`   Agent: ${agentId}`);
    }
    console.log('');

    // Get MongoDB connection string from env
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI or MONGO_URI environment variable not set');
    }

    // Connect to MongoDB
    client = new MongoClient(mongoUri);
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    // Get subaccount database
    const db = client.db(subaccountId);
    const callsCollection = db.collection('calls');
    const meetingsCollection = db.collection('meetings');

    // Build query
    const query = agentId ? { 
      $or: [
        { agent_id: agentId },
        { agentId: agentId }
      ]
    } : {};

    // Get all calls
    const calls = await callsCollection.find(query).sort({ start_timestamp: -1 }).toArray();
    
    console.log(`📊 Found ${calls.length} calls\n`);

    if (calls.length === 0) {
      console.log('No calls found.');
      return;
    }

    // Audit each call
    const issues = [];
    let totalCalls = 0;
    let callsWithSuccessRate = 0;
    let callsWithMeetings = 0;
    let callsWithSuccessRateButNoMeeting = 0;
    let callsWithMeetingButNoSuccessRate = 0;

    for (const call of calls) {
      totalCalls++;
      
      const successRate = call.success_rate || 0;
      const hasSuccessRate = successRate > 0;
      
      if (hasSuccessRate) {
        callsWithSuccessRate++;
      }

      // Check if there's a meeting for this call
      const meeting = await meetingsCollection.findOne({ call_id: call.call_id });
      const hasMeeting = !!meeting;
      
      if (hasMeeting) {
        callsWithMeetings++;
      }

      // Check for discrepancies
      const hasDiscrepancy = hasSuccessRate !== hasMeeting;
      
      if (hasDiscrepancy) {
        if (hasSuccessRate && !hasMeeting) {
          callsWithSuccessRateButNoMeeting++;
          issues.push({
            call_id: call.call_id,
            agent_id: call.agent_id || call.agentId,
            start_timestamp: new Date(call.start_timestamp).toISOString(),
            success_rate: successRate,
            has_meeting: false,
            issue: 'SUCCESS_RATE_WITHOUT_MEETING',
            call_analysis_appointment_booked: call.call_analysis?.custom_analysis_data?.appointment_booked || call.call_analysis?.appointment_booked || false
          });
        } else if (!hasSuccessRate && hasMeeting) {
          callsWithMeetingButNoSuccessRate++;
          issues.push({
            call_id: call.call_id,
            agent_id: call.agent_id || call.agentId,
            start_timestamp: new Date(call.start_timestamp).toISOString(),
            success_rate: successRate,
            has_meeting: true,
            meeting_id: meeting._id.toString(),
            issue: 'MEETING_WITHOUT_SUCCESS_RATE',
            call_analysis_appointment_booked: call.call_analysis?.custom_analysis_data?.appointment_booked || call.call_analysis?.appointment_booked || false
          });
        }
      }
    }

    // Print summary
    console.log('📈 Summary:');
    console.log(`   Total Calls: ${totalCalls}`);
    console.log(`   Calls with success_rate > 0: ${callsWithSuccessRate}`);
    console.log(`   Calls with actual meetings: ${callsWithMeetings}`);
    console.log(`   Calculated Success Rate: ${totalCalls > 0 ? ((callsWithMeetings / totalCalls) * 100).toFixed(2) : 0}%`);
    console.log('');

    if (issues.length > 0) {
      console.log(`❌ Found ${issues.length} discrepancies:\n`);
      
      if (callsWithSuccessRateButNoMeeting > 0) {
        console.log(`   🔴 ${callsWithSuccessRateButNoMeeting} calls with success_rate but NO meeting:`);
        issues.filter(i => i.issue === 'SUCCESS_RATE_WITHOUT_MEETING').forEach((issue, idx) => {
          console.log(`      ${idx + 1}. call_id: ${issue.call_id}`);
          console.log(`         success_rate: ${issue.success_rate}`);
          console.log(`         date: ${issue.start_timestamp}`);
          console.log(`         call_analysis.appointment_booked: ${issue.call_analysis_appointment_booked}`);
          console.log('');
        });
      }
      
      if (callsWithMeetingButNoSuccessRate > 0) {
        console.log(`   🟡 ${callsWithMeetingButNoSuccessRate} calls with meeting but NO success_rate:`);
        issues.filter(i => i.issue === 'MEETING_WITHOUT_SUCCESS_RATE').forEach((issue, idx) => {
          console.log(`      ${idx + 1}. call_id: ${issue.call_id}`);
          console.log(`         success_rate: ${issue.success_rate}`);
          console.log(`         meeting_id: ${issue.meeting_id}`);
          console.log(`         date: ${issue.start_timestamp}`);
          console.log('');
        });
      }

      console.log('\n💡 To fix these issues, run:');
      console.log(`   node scripts/fix-success-rates.js ${subaccountId}${agentId ? ' ' + agentId : ''}`);
    } else {
      console.log('✅ No discrepancies found! All success_rate values match meeting bookings.');
    }

    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('🔌 Disconnected from MongoDB');
    }
  }
}

auditSuccessRates();

