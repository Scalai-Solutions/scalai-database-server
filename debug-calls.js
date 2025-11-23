const mongoose = require('mongoose');
const config = require('./config/config');

async function debugCalls() {
  try {
    // Connect to MongoDB
    await mongoose.connect(config.db.uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('Connected to MongoDB');
    
    const subaccountId = '68cf05f060d294db17c0685e';
    const agentId = 'agent_d909aa94d27c219a2b0300a6e8';
    
    // Get the calls collection
    const db = mongoose.connection.db;
    const callsCollection = db.collection('calls');
    
    // Check total calls in collection
    const totalCalls = await callsCollection.countDocuments();
    console.log('\n=== TOTAL CALLS IN COLLECTION ===');
    console.log('Total:', totalCalls);
    
    // Check calls for this subaccount
    const subaccountCalls = await callsCollection.find({ subaccountId }).toArray();
    console.log('\n=== CALLS FOR SUBACCOUNT ===');
    console.log('SubaccountId:', subaccountId);
    console.log('Count:', subaccountCalls.length);
    if (subaccountCalls.length > 0) {
      console.log('Sample call:', JSON.stringify(subaccountCalls[0], null, 2));
    }
    
    // Check calls for this agent
    const agentCalls = await callsCollection.find({ agent_id: agentId }).toArray();
    console.log('\n=== CALLS FOR AGENT ===');
    console.log('AgentId:', agentId);
    console.log('Count:', agentCalls.length);
    if (agentCalls.length > 0) {
      agentCalls.forEach((call, idx) => {
        console.log(`\nCall ${idx + 1}:`);
        console.log('  call_id:', call.call_id);
        console.log('  agent_id:', call.agent_id);
        console.log('  subaccountId:', call.subaccountId);
        console.log('  start_timestamp:', call.start_timestamp);
        console.log('  call_type:', call.call_type);
        console.log('  call_status:', call.call_status);
      });
    }
    
    // Check all calls (to see what's in there)
    const allCalls = await callsCollection.find({}).limit(10).toArray();
    console.log('\n=== ALL CALLS (first 10) ===');
    allCalls.forEach((call, idx) => {
      console.log(`\nCall ${idx + 1}:`);
      console.log('  call_id:', call.call_id);
      console.log('  agent_id:', call.agent_id);
      console.log('  subaccountId:', call.subaccountId);
      console.log('  start_timestamp:', call.start_timestamp);
      console.log('  call_type:', call.call_type);
    });
    
    await mongoose.connection.close();
    console.log('\n\nConnection closed');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

debugCalls();

