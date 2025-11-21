/**
 * Script to set up TTL (Time To Live) index on ai_insights collection
 * for all subaccounts. This automatically deletes insights older than 30 days.
 * 
 * Usage: node scripts/setup-ai-insights-ttl.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config/config');
const Logger = require('../src/utils/logger');

// TTL configuration
const TTL_DAYS = 30;
const TTL_SECONDS = TTL_DAYS * 24 * 60 * 60; // 30 days in seconds

/**
 * Set up TTL index for a single subaccount
 * @param {Object} subaccount - Subaccount document with mongodbUrl and databaseName
 * @param {string} encryptionKey - Encryption key for decrypting mongodbUrl
 * @returns {Promise<Object>} Result object
 */
async function setupTTLForSubaccount(subaccount, encryptionKey) {
  const subaccountId = subaccount._id.toString();
  let subConnection = null;
  
  try {
    // Decrypt MongoDB URL
    const crypto = require('crypto');
    const algorithm = 'aes-256-gcm';
    const secretKey = crypto.scryptSync(encryptionKey, 'subaccount-salt', 32);
    
    const decipher = crypto.createDecipheriv(
      algorithm,
      secretKey,
      Buffer.from(subaccount.encryptionIV, 'hex')
    );
    decipher.setAuthTag(Buffer.from(subaccount.encryptionAuthTag, 'hex'));
    
    let decryptedUrl = decipher.update(subaccount.mongodbUrl, 'hex', 'utf8');
    decryptedUrl += decipher.final('utf8');
    
    // Connect to subaccount's database
    subConnection = await mongoose.createConnection(decryptedUrl, {
      dbName: subaccount.databaseName
    }).asPromise();
    
    const insightsCollection = subConnection.db.collection('ai_insights');
    
    // Check existing indexes
    const indexes = await insightsCollection.indexes();
    const existingTTL = indexes.find(index => 
      index.key.generatedAt === 1 && index.expireAfterSeconds !== undefined
    );

    if (existingTTL) {
      await subConnection.close();
      return {
        subaccountId,
        status: 'already_exists',
        currentTTL: existingTTL.expireAfterSeconds,
        currentTTLDays: Math.round(existingTTL.expireAfterSeconds / 86400),
        indexName: existingTTL.name
      };
    }

    // Create TTL index
    await insightsCollection.createIndex(
      { generatedAt: 1 },
      { 
        expireAfterSeconds: TTL_SECONDS,
        name: 'generatedAt_ttl_30days'
      }
    );

    await subConnection.close();
    return {
      subaccountId,
      status: 'created',
      ttlSeconds: TTL_SECONDS,
      ttlDays: TTL_DAYS
    };
  } catch (error) {
    if (subConnection) {
      try {
        await subConnection.close();
      } catch (closeError) {
        // Ignore close errors
      }
    }
    return {
      subaccountId,
      status: 'error',
      error: error.message
    };
  }
}

/**
 * Main function to set up TTL indexes
 */
async function setupTTLIndexes() {
  try {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('  Setup TTL Index for AI Insights Collections');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log(`⏰ TTL Configuration: ${TTL_DAYS} days (${TTL_SECONDS} seconds)`);
    console.log('');

    // Connect to tenant manager database to get subaccounts
    console.log('🔍 Connecting to tenant manager database...');
    
    // Use tenant manager MongoDB URI (from environment or hardcoded for this script)
    const tenantManagerUri = 'mongodb+srv://business_db_user:Enz-Eu%25C5tQ3N7_@cluster0.rzui95d.mongodb.net/scalai_auth?retryWrites=true&w=majority&appName=Cluster0';
    const tenantDbName = 'scalai_tenant';
    
    if (!tenantManagerUri) {
      console.error('❌ MongoDB URI not available');
      return;
    }

    let connection;
    let subaccounts = [];
    
    try {
      connection = await mongoose.createConnection(tenantManagerUri, {
        dbName: tenantDbName
      }).asPromise();
      
      console.log(`✅ Connected to MongoDB`);
      console.log(`   Database: ${tenantDbName}`);
      console.log('');

      // Get all subaccounts with encrypted mongodbUrl
      const SubaccountModel = connection.model('Subaccount', new mongoose.Schema({}, { strict: false }), 'subaccounts');
      subaccounts = await SubaccountModel
        .find({ isActive: true })
        .select('name databaseName mongodbUrl encryptionIV encryptionAuthTag')
        .lean();
    } catch (error) {
      console.error('❌ Failed to connect to database:', error.message);
      console.error(error.stack);
      return;
    }

    console.log(`✅ Found ${subaccounts.length} subaccount(s)`);
    console.log('');

    if (subaccounts.length === 0) {
      console.log('⚠️  No subaccounts found. Nothing to set up.');
      return;
    }

    console.log('📋 Subaccounts:');
    subaccounts.forEach((sub, index) => {
      console.log(`  ${index + 1}. ${sub.name} (${sub._id})`);
    });
    console.log('');

    // Set up TTL for each subaccount
    console.log('🔧 Setting up TTL indexes...');
    console.log('');

    const encryptionKey = config.encryption.key || process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      console.error('❌ ENCRYPTION_KEY not configured');
      return;
    }

    const results = [];
    for (const subaccount of subaccounts) {
      process.stdout.write(`  Processing ${subaccount.name} (${subaccount._id})... `);
      
      const result = await setupTTLForSubaccount(subaccount, encryptionKey);
      results.push(result);

      if (result.status === 'created') {
        console.log('✅ Created');
      } else if (result.status === 'already_exists') {
        console.log(`ℹ️  Already exists (${result.currentTTLDays} days)`);
      } else if (result.status === 'error') {
        console.log(`❌ Error: ${result.error}`);
      }
    }

    console.log('');
    console.log('📊 Summary:');
    
    const created = results.filter(r => r.status === 'created').length;
    const alreadyExists = results.filter(r => r.status === 'already_exists').length;
    const errors = results.filter(r => r.status === 'error').length;

    console.log(`  ✅ Created: ${created}`);
    console.log(`  ℹ️  Already existed: ${alreadyExists}`);
    console.log(`  ❌ Errors: ${errors}`);
    console.log(`  📝 Total: ${results.length}`);
    console.log('');

    if (errors > 0) {
      console.log('❌ Errors occurred:');
      results
        .filter(r => r.status === 'error')
        .forEach(r => {
          console.log(`  - ${r.subaccountId}: ${r.error}`);
        });
      console.log('');
    }

    if (created > 0 || alreadyExists > 0) {
      console.log('🎉 TTL setup completed successfully!');
      console.log('');
      console.log('ℹ️  How TTL Works:');
      console.log(`   - AI insights older than ${TTL_DAYS} days will be automatically deleted`);
      console.log('   - MongoDB checks for expired documents approximately once per minute');
      console.log('   - Deletion happens in the background without impacting performance');
      console.log('   - Fresh insights are regenerated every 24 hours when requested');
    }

    // Close connection
    if (connection) {
      await connection.close();
      console.log('');
      console.log('✅ Disconnected from MongoDB');
    }

  } catch (error) {
    console.error('');
    console.error('❌ Fatal error:', error.message);
    console.error(error.stack);
  }
}

// Run the script
setupTTLIndexes()
  .then(() => {
    console.log('');
    console.log('✅ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.log('');
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  });

