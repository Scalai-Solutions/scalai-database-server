#!/usr/bin/env node

/**
 * Cleanup script for orphaned phone number assignments
 * 
 * This script finds phone numbers assigned to agents that no longer exist
 * and unassigns them (sets agent IDs to null) in both Retell and MongoDB.
 * 
 * Usage:
 *   node scripts/cleanup-orphaned-phone-numbers.js <subaccountId>
 * 
 * Example:
 *   node scripts/cleanup-orphaned-phone-numbers.js 68cf05f060d294db17c0685e
 */

const { MongoClient } = require('mongodb');
const axios = require('axios');
require('dotenv').config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = 'scalai';

async function getRetellApiKey(db, subaccountId) {
  const connectorsCollection = db.collection('connectors');
  const connector = await connectorsCollection.findOne({
    subaccountId,
    type: 'retell',
    isActivatedForSubaccount: true
  });

  if (!connector || !connector.config || !connector.config.apiKey) {
    throw new Error('Retell API key not found for this subaccount');
  }

  return connector.config.apiKey;
}

async function cleanupOrphanedPhoneNumbers(subaccountId) {
  const client = new MongoClient(MONGO_URI);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(DB_NAME);

    // Get collections
    const phoneNumbersCollection = db.collection('phonenumbers');
    const agentsCollection = db.collection('agents');
    const chatAgentsCollection = db.collection('chatagents');

    // Get all phone numbers for this subaccount
    const phoneNumbers = await phoneNumbersCollection.find({ subaccountId }).toArray();
    
    console.log(`✅ Found ${phoneNumbers.length} phone numbers`);

    // Get all agent IDs (both regular and chat agents)
    const regularAgents = await agentsCollection.find({ subaccountId }).toArray();
    const chatAgents = await chatAgentsCollection.find({ subaccountId }).toArray();
    
    const validAgentIds = new Set([
      ...regularAgents.map(a => a.agentId),
      ...chatAgents.map(a => a.agentId)
    ]);

    console.log(`✅ Found ${validAgentIds.size} valid agents (${regularAgents.length} regular, ${chatAgents.length} chat agents)`);

    // Get Retell API key
    const retellApiKey = await getRetellApiKey(db, subaccountId);
    console.log('✅ Found Retell API key');

    // Check each phone number for orphaned assignments
    let orphanedInboundCount = 0;
    let orphanedOutboundCount = 0;
    let fixedCount = 0;
    const orphanedPhones = [];

    for (const phoneDoc of phoneNumbers) {
      const issues = [];
      const updateData = {};

      // Check inbound assignment
      if (phoneDoc.inbound_agent_id && !validAgentIds.has(phoneDoc.inbound_agent_id)) {
        issues.push(`inbound agent ${phoneDoc.inbound_agent_id} not found`);
        updateData.inbound_agent_id = null;
        orphanedInboundCount++;
      }

      // Check outbound assignment
      if (phoneDoc.outbound_agent_id && !validAgentIds.has(phoneDoc.outbound_agent_id)) {
        issues.push(`outbound agent ${phoneDoc.outbound_agent_id} not found`);
        updateData.outbound_agent_id = null;
        orphanedOutboundCount++;
      }

      if (issues.length > 0) {
        orphanedPhones.push({
          phoneNumber: phoneDoc.phone_number,
          phoneNumberPretty: phoneDoc.phone_number_pretty,
          issues,
          inbound_agent_id: phoneDoc.inbound_agent_id,
          outbound_agent_id: phoneDoc.outbound_agent_id
        });

        console.log(`\n⚠️  Found orphaned assignment: ${phoneDoc.phone_number_pretty || phoneDoc.phone_number}`);
        console.log(`   Issues: ${issues.join(', ')}`);

        // Fix the assignment in Retell
        try {
          console.log(`   🔄 Unassigning in Retell...`);

          const response = await axios.patch(
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

          console.log(`   ✅ Unassigned in Retell`);
        } catch (retellError) {
          console.log(`   ❌ Failed to unassign in Retell: ${retellError.message}`);
          // Continue with MongoDB update even if Retell fails
        }

        // Fix the assignment in MongoDB
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
            {
              subaccountId: subaccountId,
              phone_number: phoneDoc.phone_number
            },
            { $set: mongoUpdate }
          );

          console.log(`   ✅ Unassigned in MongoDB`);

          fixedCount++;
        } catch (mongoError) {
          console.log(`   ❌ Failed to unassign in MongoDB: ${mongoError.message}`);
        }
      }
    }

    // Print summary
    console.log('\n========================================');
    console.log('ORPHANED PHONE NUMBER CLEANUP SUMMARY');
    console.log('========================================');
    console.log(`Subaccount ID: ${subaccountId}`);
    console.log(`Total phone numbers checked: ${phoneNumbers.length}`);
    console.log(`Valid agents found: ${validAgentIds.size}`);
    console.log(`Orphaned inbound assignments: ${orphanedInboundCount}`);
    console.log(`Orphaned outbound assignments: ${orphanedOutboundCount}`);
    console.log(`Phone numbers fixed: ${fixedCount}`);
    console.log('========================================\n');

    if (orphanedPhones.length > 0) {
      console.log('Orphaned phone numbers:');
      orphanedPhones.forEach(phone => {
        console.log(`  - ${phone.phoneNumberPretty || phone.phoneNumber}`);
        phone.issues.forEach(issue => {
          console.log(`    ⚠️  ${issue}`);
        });
      });
      console.log('');
    } else {
      console.log('✅ No orphaned phone number assignments found!\n');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    throw error;
  } finally {
    await client.close();
    console.log('✅ Disconnected from MongoDB');
  }
}

// Main execution
async function main() {
  try {
    // Get subaccountId from command line arguments
    const subaccountId = process.argv[2];

    if (!subaccountId) {
      console.error('Usage: node scripts/cleanup-orphaned-phone-numbers.js <subaccountId>');
      console.error('Example: node scripts/cleanup-orphaned-phone-numbers.js 68cf05f060d294db17c0685e');
      process.exit(1);
    }

    // Validate subaccountId format (24 character hex string)
    if (!/^[a-f0-9]{24}$/i.test(subaccountId)) {
      console.error('Error: Invalid subaccountId format. Must be a 24-character hex string.');
      process.exit(1);
    }

    console.log(`\n🔍 Checking for orphaned phone numbers in subaccount: ${subaccountId}\n`);

    await cleanupOrphanedPhoneNumbers(subaccountId);

    console.log('✅ Cleanup completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Cleanup failed:', error.message);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { cleanupOrphanedPhoneNumbers };

