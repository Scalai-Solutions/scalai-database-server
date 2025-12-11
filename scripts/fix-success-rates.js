/**
 * Fix Success Rates Script
 * 
 * This script fixes incorrect success_rate values in the calls collection
 * by comparing with actual meeting bookings.
 * 
 * Usage:
 *   node scripts/fix-success-rates.js <subaccountId> [agentId] [--dry-run]
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

// Get command line arguments
const args = process.argv.slice(2);
const subaccountId = args[0];
const agentId = args[1] && !args[1].startsWith('--') ? args[1] : null;
const dryRun = args.includes('--dry-run');

if (!subaccountId) {
  console.error('Usage: node scripts/fix-success-rates.js <subaccountId> [agentId] [--dry-run]');
  console.error('Example: node scripts/fix-success-rates.js 68cf05f060d294db17c0685e agent_9c25a9ae978ca68f942da42e25');
  console.error('         node scripts/fix-success-rates.js 68cf05f060d294db17c0685e --dry-run');
  process.exit(1);
}

async function fixSuccessRates() {
  let client;
  
  try {
    console.log(`\n🔧 ${dryRun ? 'DRY RUN: ' : ''}Fixing Success Rates for Subaccount: ${subaccountId}`);
    if (agentId) {
      console.log(`   Agent: ${agentId}`);
    }
    if (dryRun) {
      console.log('   ⚠️  DRY RUN MODE - No changes will be made');
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
    
    console.log(`📊 Found ${calls.length} calls to check\n`);

    if (calls.length === 0) {
      console.log('No calls found.');
      return;
    }

    // Fix each call
    let fixedCount = 0;
    let alreadyCorrect = 0;
    const fixes = [];

    for (const call of calls) {
      const currentSuccessRate = call.success_rate || 0;
      
      // Check if there's a meeting for this call
      const meeting = await meetingsCollection.findOne({ call_id: call.call_id });
      const hasMeeting = !!meeting;
      
      // Determine correct success_rate
      const correctSuccessRate = hasMeeting ? 1 : 0;
      
      // Check if fix is needed
      if (currentSuccessRate !== correctSuccessRate) {
        fixes.push({
          call_id: call.call_id,
          agent_id: call.agent_id || call.agentId,
          start_timestamp: new Date(call.start_timestamp).toISOString(),
          old_success_rate: currentSuccessRate,
          new_success_rate: correctSuccessRate,
          has_meeting: hasMeeting,
          meeting_id: meeting ? meeting._id.toString() : null
        });

        if (!dryRun) {
          await callsCollection.updateOne(
            { _id: call._id },
            { $set: { success_rate: correctSuccessRate } }
          );
          fixedCount++;
        }
      } else {
        alreadyCorrect++;
      }
    }

    // Print results
    console.log('📈 Results:');
    console.log(`   Total Calls: ${calls.length}`);
    console.log(`   Already Correct: ${alreadyCorrect}`);
    console.log(`   ${dryRun ? 'Need Fixing' : 'Fixed'}: ${fixes.length}`);
    console.log('');

    if (fixes.length > 0) {
      console.log(`${dryRun ? '📝 Would fix' : '✅ Fixed'} ${fixes.length} calls:\n`);
      
      fixes.forEach((fix, idx) => {
        console.log(`   ${idx + 1}. call_id: ${fix.call_id}`);
        console.log(`      agent_id: ${fix.agent_id}`);
        console.log(`      date: ${fix.start_timestamp}`);
        console.log(`      old success_rate: ${fix.old_success_rate}`);
        console.log(`      new success_rate: ${fix.new_success_rate}`);
        console.log(`      has_meeting: ${fix.has_meeting}`);
        if (fix.meeting_id) {
          console.log(`      meeting_id: ${fix.meeting_id}`);
        }
        console.log('');
      });

      if (dryRun) {
        console.log('💡 To apply these fixes, run without --dry-run:');
        console.log(`   node scripts/fix-success-rates.js ${subaccountId}${agentId ? ' ' + agentId : ''}`);
      } else {
        console.log('✅ Success rates have been corrected!');
        console.log('');
        console.log('⚠️  IMPORTANT: Clear the Redis cache for these agents:');
        console.log(`   node scripts/clear-redis-cache.js --pattern "*${subaccountId}*"`);
      }
    } else {
      console.log('✅ All success rates are already correct!');
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

fixSuccessRates();

