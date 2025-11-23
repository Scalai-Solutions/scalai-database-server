const connectionPoolManager = require('./src/services/connectionPoolManager');
const retellService = require('./src/services/retellService');
const Retell = require('./src/utils/retell');
const Logger = require('./src/utils/logger');

async function debugCallLogs() {
  try {
    const subaccountId = '68cf05f060d294db17c0685e';
    const agentId = 'agent_d909aa94d27c219a2b0300a6e8';
    const userId = '68cd5f76605c030f71d32e01'; // From the JWT
    
    console.log('\n=== DEBUGGING CALL LOGS ===');
    console.log('SubaccountId:', subaccountId);
    console.log('AgentId:', agentId);
    console.log('UserId:', userId);
    
    // Initialize connection pool manager
    await connectionPoolManager.initialize();
    
    // Step 1: Check MongoDB for calls
    console.log('\n=== STEP 1: CHECKING MONGODB ===');
    const connectionInfo = await connectionPoolManager.getConnection(subaccountId, userId);
    const callsCollection = connectionInfo.connection.db.collection('calls');
    
    // Get all calls for this subaccount
    const allCalls = await callsCollection.find({ subaccountId }).toArray();
    console.log(`Found ${allCalls.length} calls in MongoDB for subaccount ${subaccountId}`);
    
    if (allCalls.length > 0) {
      console.log('\nMongoDB Calls:');
      allCalls.forEach((call, idx) => {
        console.log(`  Call ${idx + 1}:`);
        console.log('    call_id:', call.call_id);
        console.log('    agent_id:', call.agent_id);
        console.log('    start_timestamp:', call.start_timestamp);
        console.log('    call_type:', call.call_type);
        console.log('    call_status:', call.call_status);
      });
      
      // Create set of call_ids in MongoDB
      const mongoCallIds = new Set(allCalls.map(c => c.call_id));
      console.log('\nMongoDB call_ids:', Array.from(mongoCallIds));
      
      // Step 2: Fetch from Retell
      console.log('\n=== STEP 2: FETCHING FROM RETELL ===');
      const retellAccountData = await retellService.getRetellAccount(subaccountId);
      console.log('Retell Account:', retellAccountData.accountName, retellAccountData.id);
      
      if (!retellAccountData.isActive) {
        console.log('ERROR: Retell account is not active!');
        process.exit(1);
      }
      
      // Create Retell instance
      const retell = new Retell(retellAccountData.apiKey, retellAccountData);
      
      // Build filter options
      const filterCriteria = {
        agent_id: [agentId],
        start_timestamp: {
          lower: 1761244200000,
          upper: 1763922599999
        }
      };
      
      const listOptions = {
        filter_criteria: filterCriteria,
        limit: 50
      };
      
      console.log('Fetching from Retell with filters:', JSON.stringify(listOptions, null, 2));
      
      const retellCalls = await retell.listCalls(listOptions);
      console.log(`\nRetell returned ${retellCalls.length} calls`);
      
      if (retellCalls.length > 0) {
        console.log('\nRetell Calls:');
        retellCalls.forEach((call, idx) => {
          console.log(`  Call ${idx + 1}:`);
          console.log('    call_id:', call.call_id);
          console.log('    agent_id:', call.agent_id);
          console.log('    start_timestamp:', call.start_timestamp);
          console.log('    call_type:', call.call_type);
          console.log('    call_status:', call.call_status);
          console.log('    in_mongodb:', mongoCallIds.has(call.call_id) ? 'YES' : 'NO');
        });
        
        // Step 3: Filter by MongoDB presence
        console.log('\n=== STEP 3: FILTERING BY MONGODB PRESENCE ===');
        const filteredCalls = retellCalls.filter(call => mongoCallIds.has(call.call_id));
        console.log(`After filtering: ${filteredCalls.length} calls`);
        
        if (filteredCalls.length === 0) {
          console.log('\n❌ PROBLEM: None of the Retell calls exist in MongoDB!');
          console.log('\nRetell call_ids:', retellCalls.map(c => c.call_id));
          console.log('MongoDB call_ids:', Array.from(mongoCallIds));
        } else {
          console.log('\n✅ SUCCESS: Found matching calls');
        }
      } else {
        console.log('\n⚠️  Retell returned no calls for the given filters');
        console.log('This could mean:');
        console.log('  1. No calls exist in Retell for agent_id:', agentId);
        console.log('  2. No calls exist in the timestamp range');
        console.log('  3. The agent_id is incorrect');
        
        // Try fetching without filters
        console.log('\n=== TRYING WITHOUT FILTERS ===');
        const allRetellCalls = await retell.listCalls({ limit: 10 });
        console.log(`Found ${allRetellCalls.length} calls in Retell (no filters):`);
        
        if (allRetellCalls.length > 0) {
          allRetellCalls.forEach((call, idx) => {
            console.log(`  Call ${idx + 1}:`);
            console.log('    call_id:', call.call_id);
            console.log('    agent_id:', call.agent_id);
            console.log('    start_timestamp:', call.start_timestamp);
            console.log('    in_mongodb:', mongoCallIds.has(call.call_id) ? 'YES' : 'NO');
          });
        }
      }
    } else {
      console.log('\n❌ PROBLEM: No calls found in MongoDB for subaccount!');
      console.log('\nChecking if calls exist for ANY subaccount...');
      const anyCalls = await callsCollection.find({}).limit(10).toArray();
      console.log(`Found ${anyCalls.length} calls total in the calls collection`);
      
      if (anyCalls.length > 0) {
        console.log('\nSample calls:');
        anyCalls.forEach((call, idx) => {
          console.log(`  Call ${idx + 1}:`);
          console.log('    call_id:', call.call_id);
          console.log('    agent_id:', call.agent_id);
          console.log('    subaccountId:', call.subaccountId);
          console.log('    start_timestamp:', call.start_timestamp);
        });
      }
    }
    
    // Cleanup
    await connectionPoolManager.closeAllPools();
    console.log('\n=== DEBUG COMPLETE ===\n');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

debugCallLogs();

