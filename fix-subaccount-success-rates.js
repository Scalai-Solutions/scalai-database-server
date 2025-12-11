/**
 * Fix Success Rates for Specific Subaccount
 * Uses the existing connection pool infrastructure
 */

require('dotenv').config();
const connectionPoolManager = require('./src/services/connectionPoolManager');
const redisService = require('./src/services/redisService');

const subaccountId = process.argv[2] || '68cf05f060d294db17c0685e';
const userId = process.argv[3] || '68cd5f76605c030f71d32e01'; // Admin user from the token
const dryRun = process.argv.includes('--dry-run');

async function fixSuccessRates() {
  try {
    console.log(`\n🔧 ${dryRun ? 'DRY RUN: ' : ''}Fixing Success Rates for Subaccount: ${subaccountId}`);
    if (dryRun) {
      console.log('   ⚠️  DRY RUN MODE - No changes will be made\n');
    } else {
      console.log('');
    }

    // Connect to Redis first
    await redisService.connect();
    console.log('✅ Connected to Redis\n');

    // Get connection to the subaccount database
    const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
    const { connection } = connectionInfo;
    console.log('✅ Connected to MongoDB\n');

    // Get collections
    const callsCollection = connection.db.collection('calls');
    const meetingsCollection = connection.db.collection('meetings');

    // Get all calls for this subaccount
    const calls = await callsCollection.find({}).sort({ start_timestamp: -1 }).toArray();
    
    console.log(`📊 Found ${calls.length} calls\n`);

    if (calls.length === 0) {
      console.log('No calls found.');
      await cleanup();
      return;
    }

    // Group calls by agent
    const callsByAgent = {};
    for (const call of calls) {
      const agentId = call.agent_id || call.agentId;
      if (!agentId) continue;
      
      if (!callsByAgent[agentId]) {
        callsByAgent[agentId] = [];
      }
      callsByAgent[agentId].push(call);
    }

    console.log(`📈 Agents with calls: ${Object.keys(callsByAgent).length}\n`);

    // Fix each agent's calls
    let totalFixed = 0;
    let totalCorrect = 0;
    let totalIssues = 0;

    for (const [agentId, agentCalls] of Object.entries(callsByAgent)) {
      console.log(`\n🤖 Agent: ${agentId}`);
      console.log(`   Calls: ${agentCalls.length}`);

      let fixedForAgent = 0;
      let correctForAgent = 0;
      const issues = [];

      for (const call of agentCalls) {
        const currentSuccessRate = call.success_rate || 0;
        
        // Check if there's a meeting for this call
        const meeting = await meetingsCollection.findOne({ call_id: call.call_id });
        const hasMeeting = !!meeting;
        
        // Determine correct success_rate (binary: 1 or 0)
        const correctSuccessRate = hasMeeting ? 1 : 0;
        
        // Check if fix is needed
        if (currentSuccessRate !== correctSuccessRate) {
          issues.push({
            call_id: call.call_id,
            date: new Date(call.start_timestamp).toISOString(),
            old: currentSuccessRate,
            new: correctSuccessRate,
            hasMeeting
          });

          if (!dryRun) {
            await callsCollection.updateOne(
              { _id: call._id },
              { $set: { success_rate: correctSuccessRate } }
            );
            fixedForAgent++;
            totalFixed++;
          }
        } else {
          correctForAgent++;
          totalCorrect++;
        }
      }

      // Calculate stats
      const meetingsCount = issues.filter(i => i.hasMeeting).length + 
                           agentCalls.filter(c => {
                             const sr = c.success_rate || 0;
                             return sr === 1;
                           }).length - issues.filter(i => i.old === 1).length;
      
      const oldSuccessRate = agentCalls.reduce((sum, c) => sum + (c.success_rate || 0), 0) / agentCalls.length * 100;
      const newSuccessRate = (meetingsCount / agentCalls.length) * 100;

      console.log(`   Meetings booked: ${meetingsCount}`);
      console.log(`   Already correct: ${correctForAgent}`);
      console.log(`   ${dryRun ? 'Need fixing' : 'Fixed'}: ${issues.length}`);
      console.log(`   Success rate: ${oldSuccessRate.toFixed(2)}% → ${newSuccessRate.toFixed(2)}%`);

      if (issues.length > 0) {
        totalIssues += issues.length;
        console.log(`\n   Issues found:`);
        issues.forEach((issue, idx) => {
          console.log(`      ${idx + 1}. ${issue.call_id}`);
          console.log(`         Date: ${issue.date}`);
          console.log(`         ${issue.old} → ${issue.new} (${issue.hasMeeting ? 'has meeting' : 'no meeting'})`);
        });
      }
    }

    // Print summary
    console.log(`\n\n📊 Summary:`);
    console.log(`   Total calls: ${calls.length}`);
    console.log(`   Already correct: ${totalCorrect}`);
    console.log(`   ${dryRun ? 'Need fixing' : 'Fixed'}: ${totalIssues}`);

    if (!dryRun && totalIssues > 0) {
      console.log(`\n✅ Fixed ${totalIssues} calls!`);
      console.log(`\n⚠️  IMPORTANT: Clear the Redis cache:`);
      console.log(`   node scripts/clear-redis-cache.js --pattern "*${subaccountId}*"`);
    } else if (dryRun && totalIssues > 0) {
      console.log(`\n💡 To apply these fixes, run without --dry-run:`);
      console.log(`   node fix-subaccount-success-rates.js ${subaccountId}`);
    } else {
      console.log(`\n✅ All success rates are correct!`);
    }

    console.log('');

    await cleanup();

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    await cleanup();
    process.exit(1);
  }
}

async function cleanup() {
  try {
    // Close connection pool
    await connectionPoolManager.closeAllConnections();
    // Disconnect Redis
    await redisService.disconnect();
    console.log('🔌 Disconnected\n');
  } catch (error) {
    console.error('Error during cleanup:', error.message);
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n\nReceived SIGINT, cleaning up...');
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\nReceived SIGTERM, cleaning up...');
  await cleanup();
  process.exit(0);
});

fixSuccessRates();

