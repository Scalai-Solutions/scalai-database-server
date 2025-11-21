#!/usr/bin/env node

const axios = require('axios');
require('dotenv').config();

const DATABASE_SERVER_URL = process.env.DATABASE_SERVER_URL || 'http://localhost:3002';
const SERVICE_TOKEN = process.env.SERVICE_TOKEN;

async function clearRBACCache() {
  console.log('🧹 Clearing RBAC cache...\n');
  
  try {
    // Use service token if available, otherwise rely on manual authentication
    const headers = {};
    if (SERVICE_TOKEN) {
      headers['x-service-token'] = SERVICE_TOKEN;
      console.log('✅ Using service token for authentication');
    } else {
      console.log('⚠️  No service token found. This might fail if authentication is required.');
      console.log('   Please ensure you have SERVICE_TOKEN in your .env file or call this endpoint manually.\n');
    }

    const response = await axios.delete(`${DATABASE_SERVER_URL}/api/cache/clear`, {
      headers
    });

    if (response.data.success) {
      console.log('✅ RBAC cache cleared successfully!');
      console.log('\n📋 Cache Status:');
      console.log('   ✓ Permission cache cleared');
      console.log('   ✓ Resource resolution cache cleared');
      console.log('   ✓ User cache cleared');
      console.log('\n🎉 Your Twilio setup endpoint should now work without 404 errors!');
      console.log('   Try the setup again - the new connector resource is now registered.');
    } else {
      console.log('❌ Failed to clear cache:', response.data.message);
    }
  } catch (error) {
    if (error.response) {
      console.error('❌ Server error:', error.response.status, error.response.data);
      
      if (error.response.status === 401 || error.response.status === 403) {
        console.log('\n💡 Alternative Solution:');
        console.log('   1. Simply restart your database-server process');
        console.log('   2. Or call this endpoint from your frontend (you\'re already authenticated there):');
        console.log(`      DELETE ${DATABASE_SERVER_URL}/api/cache/clear`);
        console.log('\n   In your browser console, run:');
        console.log(`   fetch('${DATABASE_SERVER_URL}/api/cache/clear', { 
     method: 'DELETE',
     headers: { 
       'Authorization': 'Bearer ' + localStorage.getItem('token') 
     }
   }).then(r => r.json()).then(console.log)`);
      }
    } else if (error.request) {
      console.error('❌ Cannot connect to database server:', DATABASE_SERVER_URL);
      console.log('   Make sure your database server is running.');
    } else {
      console.error('❌ Error:', error.message);
    }
    
    console.log('\n🔄 Fallback: Restart your database-server to clear all caches.');
  }
}

// Run the function
clearRBACCache();

