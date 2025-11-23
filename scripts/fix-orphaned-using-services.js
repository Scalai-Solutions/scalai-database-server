#!/usr/bin/env node

/**
 * Fix orphaned phone numbers using the same services as the API
 */

const twilioService = require('../src/services/twilioService');
const connectionPoolManager = require('../src/services/connectionPoolManager');
const retellService = require('../src/services/retellService');
const redisService = require('../src/services/redisService');
const axios = require('axios');

async function fixOrphanedPhones(subaccountId) {
  try {
    // Initialize Redis
    await redisService.connect();
    console.log('✅ Connected to Redis\n');

    // Get phone numbers using twilioService (same as API)
    const phoneNumbers = await twilioService.getAllPhoneNumbers(subaccountId, 'system');
    console.log(`Found ${phoneNumbers.length} phone numbers\n`);

    // Get database connection
    const connectionInfo = await connectionPoolManager.getConnection(subaccountId, 'system');
    const { connection } = connectionInfo;

    // Get all valid agents
    const agentsCollection = connection.db.collection('agents');
    const chatAgentsCollection = connection.db.collection('chatagents');
    
    const regularAgents = await agentsCollection.find({ subaccountId }).toArray();
    const chatAgents = await chatAgentsCollection.find({ subaccountId }).toArray();
    
    const validAgentIds = new Set([
      ...regularAgents.map(a => a.agentId),
      ...chatAgents.map(a => a.agentId)
    ]);

    console.log(`Found ${validAgentIds.size} valid agents\n`);

    // Get Retell API key
    const retellAccountData = await retellService.getRetellAccount(subaccountId);
    if (!retellAccountData || !retellAccountData.isActive) {
      throw new Error('Retell account not found or not active');
    }
    const retellApiKey = retellAccountData.apiKey;
    console.log('✅ Found Retell API key\n');

    let fixedCount = 0;
    const phoneNumbersCollection = connection.db.collection('phonenumbers');

    // Check each phone for orphaned assignments
    for (const phoneDoc of phoneNumbers) {
      const updateData = {};
      const issues = [];

      if (phoneDoc.inbound_agent_id && !validAgentIds.has(phoneDoc.inbound_agent_id)) {
        issues.push('inbound agent not found');
        updateData.inbound_agent_id = null;
      }

      if (phoneDoc.outbound_agent_id && !validAgentIds.has(phoneDoc.outbound_agent_id)) {
        issues.push('outbound agent not found');
        updateData.outbound_agent_id = null;
      }

      if (issues.length > 0) {
        console.log(`\n📞 ${phoneDoc.phone_number_pretty || phoneDoc.phone_number}`);
        console.log(`   Issues: ${issues.join(', ')}`);
        console.log(`   Orphaned inbound: ${phoneDoc.inbound_agent_id || 'none'}`);
        console.log(`   Orphaned outbound: ${phoneDoc.outbound_agent_id || 'none'}`);

        // Fix in Retell
        try {
          console.log('   🔄 Updating Retell...');
          await axios.patch(
            `https://api.retellai.com/update-phone-number/${encodeURIComponent(phoneDoc.phone_number)}`,
            updateData,
            {
              headers: {
                'Authorization': `Bearer ${retellApiKey}`,
                'Content-Type': 'application/json'
              },
              timeout: 30000
            }
          );
          console.log('   ✅ Updated in Retell');
        } catch (retellError) {
          console.log(`   ⚠️  Retell update failed: ${retellError.response?.data?.message || retellError.message}`);
        }

        // Fix in MongoDB
        try {
          const mongoUpdate = {
            updatedAt: new Date(),
            last_modification_timestamp: Date.now()
          };

          if (updateData.inbound_agent_id !== undefined) {
            mongoUpdate.inbound_agent_id = null;
            mongoUpdate.inbound_agent_version = null;
          }
          if (updateData.outbound_agent_id !== undefined) {
            mongoUpdate.outbound_agent_id = null;
            mongoUpdate.outbound_agent_version = null;
          }

          await phoneNumbersCollection.updateOne(
            { subaccountId, phone_number: phoneDoc.phone_number },
            { $set: mongoUpdate }
          );
          console.log('   ✅ Updated in MongoDB');
          fixedCount++;
        } catch (mongoError) {
          console.log(`   ❌ MongoDB update failed: ${mongoError.message}`);
        }
      }
    }

    console.log('\n========================================');
    console.log('SUMMARY');
    console.log('========================================');
    console.log(`Phone numbers checked: ${phoneNumbers.length}`);
    console.log(`Phone numbers fixed: ${fixedCount}`);
    console.log('========================================\n');

    await redisService.disconnect();

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Main execution
const subaccountId = process.argv[2] || '68cf05f060d294db17c0685e';

console.log(`\n🔧 Fixing orphaned phone numbers for: ${subaccountId}\n`);

fixOrphanedPhones(subaccountId)
  .then(() => {
    console.log('\n✅ Complete!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error.message);
    process.exit(1);
  });

