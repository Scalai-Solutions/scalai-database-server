#!/usr/bin/env node

/**
 * Script to update Twilio bundle SID in connector metadata
 * Usage: node scripts/update-twilio-bundle.js <subaccountId> <bundleSid>
 */

const connectionPoolManager = require('../src/services/connectionPoolManager');

async function updateTwilioBundle(subaccountId, bundleSid) {
  try {
    console.log('Updating Twilio bundle SID...');
    console.log(`Subaccount ID: ${subaccountId}`);
    console.log(`Bundle SID: ${bundleSid}`);

    // Get database connection
    const connectionInfo = await connectionPoolManager.getConnection(subaccountId);
    const { connection } = connectionInfo;

    // Find the Twilio connector
    const twilioConnector = await connection.db.collection('connectorsubaccount').findOne({
      subaccountId,
      connectorType: 'twilio'
    });

    if (!twilioConnector) {
      console.error('❌ Twilio connector not found for this subaccount');
      process.exit(1);
    }

    console.log('✅ Found Twilio connector');

    // Update the bundleSid in retellIntegration metadata
    const updateResult = await connection.db.collection('connectorsubaccount').updateOne(
      {
        subaccountId,
        connectorType: 'twilio'
      },
      {
        $set: {
          'metadata.retellIntegration.bundleSid': bundleSid,
          updatedAt: new Date()
        }
      }
    );

    if (updateResult.matchedCount === 0) {
      console.error('❌ No connector matched for update');
      process.exit(1);
    }

    if (updateResult.modifiedCount === 0) {
      console.log('⚠️  No changes made (bundleSid may already be set to this value)');
    } else {
      console.log('✅ Bundle SID updated successfully');
    }

    // Verify the update
    const updatedConnector = await connection.db.collection('connectorsubaccount').findOne({
      subaccountId,
      connectorType: 'twilio'
    });

    console.log('\n📋 Updated connector metadata:');
    console.log(JSON.stringify({
      bundleSid: updatedConnector.metadata?.retellIntegration?.bundleSid,
      emergencyAddressId: updatedConnector.metadata?.retellIntegration?.emergencyAddressId,
      trunkSid: updatedConnector.metadata?.retellIntegration?.trunkSid
    }, null, 2));

    process.exit(0);
  } catch (error) {
    console.error('❌ Error updating bundle SID:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Get command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: node scripts/update-twilio-bundle.js <subaccountId> <bundleSid>');
  console.error('\nExample:');
  console.error('  node scripts/update-twilio-bundle.js 68cf05f060d294db17c0685e BU3d5be36ba71da67b804b80c766250783');
  process.exit(1);
}

const [subaccountId, bundleSid] = args;

updateTwilioBundle(subaccountId, bundleSid);

