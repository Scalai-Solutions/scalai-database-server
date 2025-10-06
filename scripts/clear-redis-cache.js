#!/usr/bin/env node

const redisService = require('../src/services/redisService');
const Logger = require('../src/utils/logger');

/**
 * Script to clear Redis cache for a specific key or pattern
 * Usage: node clear-redis-cache.js <key>
 * Example: node clear-redis-cache.js "subaccount:123"
 * Example: node clear-redis-cache.js "permissions:user123:subaccount456"
 */

async function clearCache(key) {
  try {
    // Connect to Redis
    await redisService.connect();
    
    // Check if key exists
    const exists = await redisService.exists(key);
    
    if (!exists) {
      Logger.warn(`Key "${key}" does not exist in Redis cache`);
      return false;
    }
    
    // Delete the key
    await redisService.del(key);
    Logger.info(`Successfully cleared cache for key: "${key}"`);
    
    return true;
    
  } catch (error) {
    Logger.error('Error clearing cache:', error);
    throw error;
  } finally {
    // Disconnect from Redis
    await redisService.disconnect();
  }
}

async function clearCachePattern(pattern) {
  try {
    // Connect to Redis
    await redisService.connect();
    
    // Get all keys matching the pattern
    const keys = await redisService.client.keys(pattern);
    
    if (keys.length === 0) {
      Logger.warn(`No keys found matching pattern: "${pattern}"`);
      return 0;
    }
    
    Logger.info(`Found ${keys.length} keys matching pattern: "${pattern}"`);
    
    // Delete all matching keys
    let deletedCount = 0;
    for (const key of keys) {
      await redisService.del(key);
      deletedCount++;
      Logger.info(`Deleted key: "${key}"`);
    }
    
    Logger.info(`Successfully cleared ${deletedCount} cache entries`);
    return deletedCount;
    
  } catch (error) {
    Logger.error('Error clearing cache pattern:', error);
    throw error;
  } finally {
    // Disconnect from Redis
    await redisService.disconnect();
  }
}

// Helper functions for common cache clearing operations
async function clearSubaccountCache(subaccountId) {
  const key = `subaccount:${subaccountId}`;
  return await clearCache(key);
}

async function clearUserSubaccountsCache(userId) {
  const key = `user_subaccounts:${userId}`;
  return await clearCache(key);
}

async function clearPermissionsCache(userId, subaccountId) {
  const key = `permissions:${userId}:${subaccountId}`;
  return await clearCache(key);
}

async function clearAllUserPermissions(userId) {
  const pattern = `permissions:${userId}:*`;
  return await clearCachePattern(pattern);
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage: node clear-redis-cache.js [options] <key_or_pattern>

Options:
  --pattern, -p     Clear all keys matching the pattern (uses Redis KEYS command)
  --subaccount, -s  Clear subaccount cache (provide subaccount ID)
  --user, -u        Clear user subaccounts cache (provide user ID)
  --permissions     Clear specific permissions cache (provide userId:subaccountId)
  --user-perms      Clear all permissions for a user (provide user ID)

Examples:
  node clear-redis-cache.js "subaccount:123"
  node clear-redis-cache.js --pattern "permissions:user123:*"
  node clear-redis-cache.js --subaccount 123
  node clear-redis-cache.js --user user123
  node clear-redis-cache.js --permissions user123:subaccount456
  node clear-redis-cache.js --user-perms user123
    `);
    process.exit(1);
  }
  
  try {
    const option = args[0];
    const value = args[1];
    
    switch (option) {
      case '--pattern':
      case '-p':
        if (!value) {
          Logger.error('Pattern is required');
          process.exit(1);
        }
        await clearCachePattern(value);
        break;
        
      case '--subaccount':
      case '-s':
        if (!value) {
          Logger.error('Subaccount ID is required');
          process.exit(1);
        }
        await clearSubaccountCache(value);
        break;
        
      case '--user':
      case '-u':
        if (!value) {
          Logger.error('User ID is required');
          process.exit(1);
        }
        await clearUserSubaccountsCache(value);
        break;
        
      case '--permissions':
        if (!value) {
          Logger.error('userId:subaccountId is required');
          process.exit(1);
        }
        const [userId, subaccountId] = value.split(':');
        if (!userId || !subaccountId) {
          Logger.error('Format should be userId:subaccountId');
          process.exit(1);
        }
        await clearPermissionsCache(userId, subaccountId);
        break;
        
      case '--user-perms':
        if (!value) {
          Logger.error('User ID is required');
          process.exit(1);
        }
        await clearAllUserPermissions(value);
        break;
        
      default:
        // Treat as a direct key
        await clearCache(option);
        break;
    }
    
    Logger.info('Cache clearing completed successfully');
    process.exit(0);
    
  } catch (error) {
    Logger.error('Script failed:', error);
    process.exit(1);
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  Logger.info('Received SIGINT, closing Redis connection...');
  await redisService.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  Logger.info('Received SIGTERM, closing Redis connection...');
  await redisService.disconnect();
  process.exit(0);
});

// Run the script
if (require.main === module) {
  main();
}

module.exports = {
  clearCache,
  clearCachePattern,
  clearSubaccountCache,
  clearUserSubaccountsCache,
  clearPermissionsCache,
  clearAllUserPermissions
}; 