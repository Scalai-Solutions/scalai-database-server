#!/usr/bin/env node

/**
 * Cleanup Twilio Trunk for Subaccount
 * 
 * This script helps clean up old trunk configuration for a subaccount:
 * 1. Optionally deletes the trunk from Twilio
 * 2. Clears retellIntegration metadata from database
 * 3. Prepares subaccount for fresh Twilio setup
 * 
 * Usage:
 *   node scripts/cleanup-twilio-trunk.js <subaccountId> [--delete-trunk]
 * 
 * Examples:
 *   node scripts/cleanup-twilio-trunk.js 69199436c98895ff97a17e95
 *   node scripts/cleanup-twilio-trunk.js 69199436c98895ff97a17e95 --delete-trunk
 */

require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config/config');
const twilioService = require('../src/services/twilioService');

async function cleanupTwilioTrunk(subaccountId, deleteTrunkFromTwilio = false) {
  console.log('🧹 Cleaning up Twilio trunk for subaccount...\n');
  console.log(`Subaccount ID: ${subaccountId}`);
  console.log(`Delete from Twilio: ${deleteTrunkFromTwilio ? 'YES' : 'NO (metadata only)'}\n`);
  
  try {
    // Connect to database
    await mongoose.connect(config.database.mongoUri, {
      dbName: config.database.dbName
    });
    console.log('✅ Connected to MongoDB\n');

    // Get database connection
    const db = mongoose.connection.db;
    
    // Fetch current connector data
    const twilioConnector = await db.collection('connectorsubaccount').findOne({
      subaccountId,
      connectorType: 'twilio'
    });

    if (!twilioConnector) {
      console.log('❌ No Twilio connector found for this subaccount');
      console.log('   Nothing to clean up!');
      await mongoose.disconnect();
      return;
    }

    console.log('📊 Current Configuration:');
    console.log('─────────────────────────────────────────');
    
    if (twilioConnector.metadata?.retellIntegration) {
      const integration = twilioConnector.metadata.retellIntegration;
      console.log(`Trunk SID:         ${integration.trunkSid || 'Not set'}`);
      console.log(`Trunk Name:        ${integration.trunkFriendlyName || 'Not set'}`);
      console.log(`Termination URI:   ${integration.terminationSipUri || 'Not set'}`);
      console.log(`Emergency Address: ${integration.emergencyAddressId || 'Not set'}`);
      console.log(`Bundle SID:        ${integration.bundleSid || 'Not set'}`);
      console.log(`Credentials:       ${integration.sipCredentials?.username || 'Not set'}`);
      console.log(`Setup Completed:   ${integration.setupCompletedAt || 'Not set'}`);
    } else {
      console.log('No retellIntegration metadata found');
    }
    console.log('─────────────────────────────────────────\n');

    // Delete trunk from Twilio if requested
    if (deleteTrunkFromTwilio && twilioConnector.metadata?.retellIntegration?.trunkSid) {
      const trunkSid = twilioConnector.metadata.retellIntegration.trunkSid;
      
      console.log('🗑️  Deleting trunk from Twilio...');
      console.log(`   Trunk SID: ${trunkSid}`);
      
      try {
        const client = await twilioService.getTwilioClient(subaccountId);
        
        // First, check if trunk has phone numbers
        const phoneNumbers = await client.trunking.v1
          .trunks(trunkSid)
          .phoneNumbers
          .list();
        
        if (phoneNumbers.length > 0) {
          console.log(`\n⚠️  Trunk has ${phoneNumbers.length} phone number(s) attached:`);
          phoneNumbers.forEach((num, idx) => {
            console.log(`   ${idx + 1}. ${num.phoneNumber} (${num.sid})`);
          });
          console.log('\n❌ Cannot delete trunk with attached phone numbers!');
          console.log('   You must either:');
          console.log('   1. Release the phone numbers from Twilio first, OR');
          console.log('   2. Run this script without --delete-trunk to only clear metadata');
          await mongoose.disconnect();
          return;
        }
        
        // Delete the trunk
        await client.trunking.v1.trunks(trunkSid).remove();
        console.log('✅ Trunk deleted from Twilio\n');
        
      } catch (twilioError) {
        if (twilioError.code === 20404) {
          console.log('⚠️  Trunk not found in Twilio (already deleted or never existed)');
          console.log('   Continuing with database cleanup...\n');
        } else {
          console.error('❌ Failed to delete trunk from Twilio:', twilioError.message);
          console.log('   Continuing with database cleanup anyway...\n');
        }
      }
    }

    // Clear retellIntegration metadata from database
    console.log('🗑️  Clearing retellIntegration metadata from database...');
    
    const updateResult = await db.collection('connectorsubaccount').updateOne(
      {
        subaccountId,
        connectorType: 'twilio'
      },
      {
        $unset: {
          'metadata.retellIntegration': ''
        },
        $set: {
          updatedAt: new Date()
        }
      }
    );

    if (updateResult.modifiedCount > 0) {
      console.log('✅ Database metadata cleared\n');
    } else {
      console.log('⚠️  No metadata to clear (may have been empty already)\n');
    }

    // Invalidate cache
    try {
      await twilioService.invalidateCache(subaccountId);
      console.log('✅ Twilio cache invalidated\n');
    } catch (cacheError) {
      console.log('⚠️  Failed to invalidate cache (non-critical):', cacheError.message);
    }

    console.log('═══════════════════════════════════════════');
    console.log('🎉 Cleanup completed successfully!');
    console.log('═══════════════════════════════════════════\n');
    
    console.log('📚 Next Steps:');
    console.log('1. Re-add Twilio connector with fresh credentials (via frontend)');
    console.log('2. Run Twilio setup again:');
    console.log(`   POST /api/connectors/${subaccountId}/twilio/setup/{emergencyAddressId}`);
    console.log('3. This will create a NEW subaccount-isolated trunk:');
    console.log(`   Format: scalai_${subaccountId.slice(0, 8)}_XXXXXX`);
    console.log('4. Purchase phone numbers with the new isolated trunk! 🎉\n');

  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔒 Database connection closed');
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const subaccountId = args[0];
const deleteTrunkFromTwilio = args.includes('--delete-trunk');

if (!subaccountId) {
  console.error('❌ Error: Subaccount ID is required\n');
  console.log('Usage:');
  console.log('  node scripts/cleanup-twilio-trunk.js <subaccountId> [--delete-trunk]\n');
  console.log('Examples:');
  console.log('  node scripts/cleanup-twilio-trunk.js 69199436c98895ff97a17e95');
  console.log('  node scripts/cleanup-twilio-trunk.js 69199436c98895ff97a17e95 --delete-trunk\n');
  process.exit(1);
}

// Run cleanup
cleanupTwilioTrunk(subaccountId, deleteTrunkFromTwilio);

