/**
 * Utility script to sync phone numbers from Retell to MongoDB
 * This helps fix any inconsistencies where MongoDB has stale agent assignments
 * 
 * Usage:
 *   node scripts/sync-phone-numbers-from-retell.js <subaccountId>
 */

const axios = require('axios');
const { MongoClient } = require('mongodb');
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

async function syncPhoneNumbers(subaccountId) {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(DB_NAME);
    const phoneNumbersCollection = db.collection('phonenumbers');

    // Get Retell API key
    const retellApiKey = await getRetellApiKey(db, subaccountId);
    console.log('✅ Found Retell API key');

    // Get phone numbers from Retell
    console.log('\n🔍 Fetching phone numbers from Retell...');
    const response = await axios.get('https://api.retellai.com/list-phone-numbers', {
      headers: {
        'Authorization': `Bearer ${retellApiKey}`
      }
    });

    const retellPhoneNumbers = response.data;
    console.log(`✅ Found ${retellPhoneNumbers.length} phone numbers in Retell`);

    // Get phone numbers from MongoDB
    const mongoPhoneNumbers = await phoneNumbersCollection.find({ subaccountId }).toArray();
    console.log(`✅ Found ${mongoPhoneNumbers.length} phone numbers in MongoDB`);

    // Sync each phone number
    console.log('\n🔄 Syncing phone numbers...\n');
    let syncedCount = 0;
    let errorCount = 0;

    for (const retellPhone of retellPhoneNumbers) {
      const phoneNumber = retellPhone.phone_number;
      const mongoPhone = mongoPhoneNumbers.find(p => p.phone_number === phoneNumber);

      if (!mongoPhone) {
        console.log(`⚠️  ${phoneNumber}: Not found in MongoDB, skipping`);
        continue;
      }

      // Check if sync is needed
      const needsSync = 
        mongoPhone.inbound_agent_id !== retellPhone.inbound_agent_id ||
        mongoPhone.outbound_agent_id !== retellPhone.outbound_agent_id;

      if (needsSync) {
        console.log(`🔧 ${phoneNumber}:`);
        console.log(`   MongoDB  - Inbound: ${mongoPhone.inbound_agent_id || 'null'}, Outbound: ${mongoPhone.outbound_agent_id || 'null'}`);
        console.log(`   Retell   - Inbound: ${retellPhone.inbound_agent_id || 'null'}, Outbound: ${retellPhone.outbound_agent_id || 'null'}`);

        try {
          const updateData = {
            inbound_agent_id: retellPhone.inbound_agent_id,
            outbound_agent_id: retellPhone.outbound_agent_id,
            inbound_agent_version: retellPhone.inbound_agent_version,
            outbound_agent_version: retellPhone.outbound_agent_version,
            last_modification_timestamp: retellPhone.last_modification_timestamp || Date.now(),
            updatedAt: new Date()
          };

          await phoneNumbersCollection.updateOne(
            { subaccountId, phone_number: phoneNumber },
            { $set: updateData }
          );

          console.log(`   ✅ Synced to match Retell\n`);
          syncedCount++;
        } catch (error) {
          console.log(`   ❌ Error: ${error.message}\n`);
          errorCount++;
        }
      } else {
        console.log(`✓ ${phoneNumber}: Already in sync`);
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log(`✅ Sync complete!`);
    console.log(`   Synced: ${syncedCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log(`   Already in sync: ${retellPhoneNumbers.length - syncedCount - errorCount}`);
    console.log('='.repeat(50));

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await client.close();
  }
}

// Get subaccountId from command line
const subaccountId = process.argv[2];

if (!subaccountId) {
  console.error('❌ Error: Please provide subaccountId as argument');
  console.error('Usage: node scripts/sync-phone-numbers-from-retell.js <subaccountId>');
  process.exit(1);
}

// Validate subaccountId format (24-character hex string)
if (!/^[0-9a-fA-F]{24}$/.test(subaccountId)) {
  console.error('❌ Error: Invalid subaccountId format (must be 24-character hex string)');
  process.exit(1);
}

console.log(`\n🚀 Starting sync for subaccount: ${subaccountId}\n`);
syncPhoneNumbers(subaccountId);

