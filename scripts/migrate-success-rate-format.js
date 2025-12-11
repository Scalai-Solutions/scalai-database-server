/**
 * Script to migrate success_rate values from percentage format (0-100) to decimal format (0-1)
 * 
 * This fixes the issue where success rates were stored as 100 instead of 1,
 * causing display issues (10000% instead of 100%)
 * 
 * Usage:
 *   node scripts/migrate-success-rate-format.js <subaccountId> [--dry-run]
 */

const config = require('../config/config');
const { MongoClient } = require('mongodb');

const subaccountId = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!subaccountId) {
  console.error('Usage: node scripts/migrate-success-rate-format.js <subaccountId> [--dry-run]');
  process.exit(1);
}

async function migrateSuccessRates() {
  let client;

  try {
    // Connect to MongoDB
    client = new MongoClient(config.mongodb.uri);
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(config.mongodb.dbName);
    const callsCollection = db.collection('calls');

    // Find all calls with success_rate > 1 (these are in percentage format)
    const query = {
      subaccountId,
      success_rate: { $gt: 1 }
    };

    const callsToFix = await callsCollection.find(query).toArray();
    
    console.log(`\n📊 Found ${callsToFix.length} calls with success_rate > 1 (percentage format)`);

    if (callsToFix.length === 0) {
      console.log('✅ No calls need migration!');
      return;
    }

    // Group by agent for reporting
    const callsByAgent = {};
    for (const call of callsToFix) {
      const agentId = call.agent_id || call.agentId || 'unknown';
      if (!callsByAgent[agentId]) {
        callsByAgent[agentId] = [];
      }
      callsByAgent[agentId].push(call);
    }

    console.log(`\n📋 Breakdown by agent:`);
    for (const [agentId, calls] of Object.entries(callsByAgent)) {
      console.log(`   ${agentId}: ${calls.length} calls`);
    }

    if (dryRun) {
      console.log('\n🔍 DRY RUN MODE - No changes will be made\n');
      
      // Show some examples
      const examples = callsToFix.slice(0, 5);
      console.log('Examples of calls to be fixed:');
      for (const call of examples) {
        const agentId = call.agent_id || call.agentId;
        const oldRate = call.success_rate;
        const newRate = oldRate === 100 ? 1 : (oldRate === 0 ? 0 : oldRate / 100);
        console.log(`   Call ${call.call_id}:`);
        console.log(`      Agent: ${agentId}`);
        console.log(`      Date: ${new Date(call.start_timestamp).toISOString()}`);
        console.log(`      Old success_rate: ${oldRate}`);
        console.log(`      New success_rate: ${newRate}`);
      }
    } else {
      console.log('\n🔄 Migrating success_rate values...\n');
      
      let updated = 0;
      for (const call of callsToFix) {
        const oldRate = call.success_rate;
        // Convert: 100 -> 1, 0 -> 0, or divide by 100 for other values
        const newRate = oldRate === 100 ? 1 : (oldRate === 0 ? 0 : oldRate / 100);
        
        await callsCollection.updateOne(
          { _id: call._id },
          { $set: { success_rate: newRate } }
        );
        
        updated++;
        
        if (updated % 10 === 0) {
          process.stdout.write(`\r   Updated ${updated}/${callsToFix.length} calls...`);
        }
      }
      
      console.log(`\r   Updated ${updated}/${callsToFix.length} calls...`);
      console.log('\n✅ Migration complete!');
    }

    console.log('\n📊 Summary:');
    console.log(`   Total calls found: ${callsToFix.length}`);
    console.log(`   ${dryRun ? 'Would update' : 'Updated'}: ${callsToFix.length}`);

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    if (client) {
      await client.close();
      console.log('\n🔌 Disconnected from MongoDB');
    }
  }
}

migrateSuccessRates()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });

