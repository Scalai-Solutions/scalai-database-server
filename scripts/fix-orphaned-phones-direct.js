#!/usr/bin/env node

/**
 * Direct fix for orphaned phone numbers
 * Uses the Retell API key from environment or Retell service
 */

const { MongoClient } = require('mongodb');
const axios = require('axios');
require('dotenv').config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'scalai';

async function getRetellApiKey(db, subaccountId) {
  // Try scalai database first (connectors collection)
  const connector = await db.collection('connectors').findOne({
    subaccountId,
    type: 'retell',
    isActivatedForSubaccount: true
  });

  if (connector && connector.config && connector.config.apiKey) {
    return connector.config.apiKey;
  }

  // Try scalai-voone database (retellaccounts collection)
  const vooneDb = db.client.db('scalai-voone');
  const retellAccount = await vooneDb.collection('retellaccounts').findOne({
    subaccountId,
    isActive: true
  });

  if (retellAccount && retellAccount.apiKey) {
    return retellAccount.apiKey;
  }

  throw new Error('Retell API key not found');
}

async function fixOrphanedPhones(subaccountId) {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const db = client.db(DB_NAME);
    const phoneNumbersCollection = db.collection('phonenumbers');
    const agentsCollection = db.collection('agents');
    const chatAgentsCollection = db.collection('chatagents');

    // Get all phone numbers
    const phoneNumbers = await phoneNumbersCollection.find({ subaccountId }).toArray();
    console.log(`Found ${phoneNumbers.length} phone numbers\n`);

    // Get all valid agents
    const regularAgents = await agentsCollection.find({ subaccountId }).toArray();
    const chatAgents = await chatAgentsCollection.find({ subaccountId }).toArray();
    const validAgentIds = new Set([
      ...regularAgents.map(a => a.agentId),
      ...chatAgents.map(a => a.agentId)
    ]);
    console.log(`Found ${validAgentIds.size} valid agents\n`);

    // Get Retell API key
    const retellApiKey = await getRetellApiKey(db, subaccountId);
    console.log('✅ Found Retell API key\n');

    let fixedCount = 0;

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
          console.log(`   ⚠️  Retell update failed: ${retellError.message}`);
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

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    throw error;
  } finally {
    await client.close();
    console.log('✅ Disconnected from MongoDB');
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

